import { readFileSync } from 'fs';

/**
 * YAML 解析工具 — 轻量级 YAML → JSON 解析
 * 支持：简单键值、嵌套对象、列表、注释跳过
 */
export class YamlParser {
  static parse(content: string): Record<string, unknown> {
    const lines = content.split('\n');
    const result: Record<string, unknown> = {};
    const stack: Array<{ key: string; obj: Record<string, unknown>; indent: number }> = [];
    let currentListKey = '';
    let currentList: string[] = [];
    let currentListIndent = 0;
    let pendingEmptyKey = '';   // Key that had empty value, waiting to see if list follows
    let pendingIndent = 0;

    function popStackTo(indent: number): void {
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        const popped = stack.pop()!;
        if (stack.length === 0) {
          result[popped.key] = popped.obj;
        } else {
          stack[stack.length - 1].obj[popped.key] = popped.obj;
        }
      }
    }

    for (const rawLine of lines) {
      const line = rawLine.replace(/#.*$/, '');
      const trimmed = line.trim();
      if (!trimmed) {
        // Empty line — flush pending list
        if (currentList.length > 0 && currentListKey) {
          this.setValue(result, stack, currentListKey, [...currentList]);
          currentList = [];
          currentListKey = '';
        }
        continue;
      }

      const indent = line.search(/\S/);

      // Flush pending list when we exit its indentation level
      if (currentList.length > 0 && indent < currentListIndent) {
        this.setValue(result, stack, currentListKey, [...currentList]);
        currentList = [];
        currentListKey = '';
      }

      // List item
      if (/^\s*-\s+/.test(line)) {
        const item = trimmed.replace(/^-\s+/, '');

        // If we had a pending empty key, use it as the list key
        if (pendingEmptyKey) {
          currentListKey = pendingEmptyKey;
          currentListIndent = indent;
          pendingEmptyKey = '';
        }

        if (!currentListKey) {
          if (stack.length > 0) {
            currentListKey = stack[stack.length - 1].key;
          }
        }
        currentList.push(item);
        currentListIndent = indent;
        continue;
      }

      const kvMatch = trimmed.match(/^(\w[\w-]*):\s*(.*)/);
      if (!kvMatch) {
        // Flush pending empty key if line isn't related
        if (pendingEmptyKey && !/^\s*-\s+/.test(line)) {
          result[pendingEmptyKey] = {};
          pendingEmptyKey = '';
        }
        continue;
      }

      const [, key, val] = kvMatch;
      const cleanVal = val.trim();

      // Pop stack if indent decreased
      popStackTo(indent);

      if (!cleanVal) {
        // Empty value — may be nested object or list. Defer until we see next line.
        if (pendingEmptyKey) {
          // Previous empty key wasn't resolved yet — treat as nested obj
          const obj: Record<string, unknown> = {};
          stack.push({ key: pendingEmptyKey, obj, indent: pendingIndent });
        }
        pendingEmptyKey = key;
        pendingIndent = indent;
      } else {
        // Flush pending empty key based on indent
        if (pendingEmptyKey) {
          if (indent > pendingIndent) {
            // This key is at deeper indent → pending key starts a nested object
            const obj: Record<string, unknown> = {};
            stack.push({ key: pendingEmptyKey, obj, indent: pendingIndent });
          } else {
            // Same or shallower indent → pending key is a leaf-level empty obj
            result[pendingEmptyKey] = {};
          }
          pendingEmptyKey = '';
        }
        // Leaf value
        fromString(cleanVal, (parsed) => {
          if (stack.length === 0) {
            result[key] = parsed;
          } else {
            stack[stack.length - 1].obj[key] = parsed;
          }
        });
      }
    }

    // Flush remaining list
    if (currentList.length > 0 && currentListKey) {
      this.setValue(result, stack, currentListKey, [...currentList]);
    }

    // Flush pending empty key
    if (pendingEmptyKey) {
      result[pendingEmptyKey] = {};
    }

    // Pop remaining stack
    popStackTo(-1);

    return result;
  }

  private static setValue(root: Record<string, unknown>, stack: Array<{ key: string; obj: Record<string, unknown> }>, key: string, value: unknown): void {
    // Find the right level in stack
    for (let i = stack.length - 1; i >= 0; i--) {
      if (key in stack[i].obj || i === 0) {
        stack[i].obj[key] = value;
        return;
      }
    }
    root[key] = value;
  }

  static parseFile(filePath: string): Record<string, unknown> {
    return YamlParser.parse(readFileSync(filePath, 'utf-8'));
  }
}

function fromString(val: string, fn: (v: unknown) => void): void {
  const stripped = val.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  if (stripped === 'true') fn(true);
  else if (stripped === 'false') fn(false);
  else if (/^-?\d+$/.test(stripped)) fn(parseInt(stripped, 10));
  else if (/^-?\d+\.\d+$/.test(stripped)) fn(parseFloat(stripped));
  else fn(stripped);
}
