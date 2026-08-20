/**
 * Code Knowledge Graph — AST 解析器
 * v6.90.0: 基于 TypeScript 编译器 API 的本地确定性解析
 *
 * 零 LLM Token 消耗，代码不出本机。
 */
import * as ts from 'typescript';
import { readFileSync } from 'fs';
import { basename, relative } from 'path';
import type { CodeNode, CodeEdge, Confidence } from './types';

interface ParsedFile {
  filePath: string;
  nodes: CodeNode[];
  edges: CodeEdge[];
  exports: string[];
}

const SCRIPT_TARGET = ts.ScriptTarget.ES2020;
const SCRIPT_KIND_TS = ts.ScriptKind.TS;
const SCRIPT_KIND_JS = ts.ScriptKind.JS;

function isTsOrJs(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i.test(filePath);
}

function getScriptKind(filePath: string): ts.ScriptKind {
  if (/\.tsx$/i.test(filePath)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(filePath)) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/i.test(filePath)) return SCRIPT_KIND_JS;
  return SCRIPT_KIND_TS;
}

function makeNodeId(filePath: string, name: string): string {
  return `${filePath}::${name}`;
}

function getNodePosition(node: ts.Node, sourceFile: ts.SourceFile): { line: number; column: number } {
  const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: pos.line + 1, column: pos.character + 1 };
}

function getSnippet(node: ts.Node, sourceFile: ts.SourceFile): string {
  const text = node.getText(sourceFile);
  return text.slice(0, 200).replace(/\s+/g, ' ').trim();
}

/**
 * 解析单个文件，提取节点和边
 */
function parseSingleFile(filePath: string, projectRoot: string): ParsedFile | null {
  if (!isTsOrJs(filePath)) return null;

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const relPath = relative(projectRoot, filePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    SCRIPT_TARGET,
    true,
    getScriptKind(filePath)
  );

  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const exports: string[] = [];
  const localNames = new Set<string>();

  // 文件级 module 节点
  const moduleId = relPath;
  nodes.push({
    id: moduleId,
    name: basename(relPath),
    type: 'module',
    filePath: relPath,
    line: 1,
    column: 1,
  });

  function addNode(name: string, type: CodeNode['type'], node: ts.Node): CodeNode {
    const pos = getNodePosition(node, sourceFile);
    const id = makeNodeId(relPath, name);
    const n: CodeNode = {
      id,
      name,
      type,
      filePath: relPath,
      line: pos.line,
      column: pos.column,
      snippet: getSnippet(node, sourceFile),
    };
    nodes.push(n);
    localNames.add(name);
    return n;
  }

  function addEdge(source: string, target: string, type: CodeEdge['type'], confidence: Confidence, line?: number) {
    edges.push({ source, target, type, confidence, filePath: relPath, line });
  }

  function visit(node: ts.Node) {
    // 1. Import declarations → module dependency edges
    if (ts.isImportDeclaration(node)) {
      const moduleName = (node.moduleSpecifier as ts.StringLiteral)?.text;
      if (moduleName) {
        // Named imports / namespace imports
        const importClause = node.importClause;
        if (importClause) {
          if (importClause.namedBindings) {
            if (ts.isNamedImports(importClause.namedBindings)) {
              for (const elem of importClause.namedBindings.elements) {
                const name = elem.name.text;
                addNode(name, 'variable', elem); // imported symbol as a node
                addEdge(makeNodeId(relPath, name), moduleName, 'imports', 'EXTRACTED', getNodePosition(node, sourceFile).line);
              }
            } else if (ts.isNamespaceImport(importClause.namedBindings)) {
              const name = importClause.namedBindings.name.text;
              addNode(name, 'variable', importClause.namedBindings);
              addEdge(makeNodeId(relPath, name), moduleName, 'imports', 'EXTRACTED', getNodePosition(node, sourceFile).line);
            }
          }
          if (importClause.name) {
            const name = importClause.name.text;
            addNode(name, 'variable', importClause);
            addEdge(makeNodeId(relPath, name), moduleName, 'imports', 'EXTRACTED', getNodePosition(node, sourceFile).line);
          }
        } else {
          // side-effect import: import "module"
          addEdge(relPath, moduleName, 'imports', 'EXTRACTED', getNodePosition(node, sourceFile).line);
        }
      }
    }

    // 2. Export declarations
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const elem of node.exportClause.elements) {
        exports.push(elem.name.text);
      }
    }
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      // export default <expr>
      const expr = node.expression;
      if (ts.isIdentifier(expr)) {
        exports.push(`default:${expr.text}`);
      }
    }

    // 3. Function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      addNode(node.name.text, 'function', node);
    }

    // 4. Class declarations
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const classId = makeNodeId(relPath, className);
      addNode(className, 'class', node);

      // extends
      if (node.heritageClauses) {
        for (const clause of node.heritageClauses) {
          if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
            for (const type of clause.types) {
              const parentName = type.expression.getText(sourceFile);
              addEdge(classId, parentName, 'extends', 'EXTRACTED', getNodePosition(clause, sourceFile).line);
            }
          }
          if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
            for (const type of clause.types) {
              const ifaceName = type.expression.getText(sourceFile);
              addEdge(classId, ifaceName, 'implements', 'EXTRACTED', getNodePosition(clause, sourceFile).line);
            }
          }
        }
      }

      // methods and properties
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = member.name.getText(sourceFile);
          const methodId = makeNodeId(relPath, `${className}.${methodName}`);
          nodes.push({
            id: methodId,
            name: methodName,
            type: 'method',
            filePath: relPath,
            line: getNodePosition(member, sourceFile).line,
            column: getNodePosition(member, sourceFile).column,
            snippet: getSnippet(member, sourceFile),
          });
          localNames.add(methodName);
          addEdge(classId, methodId, 'contains', 'EXTRACTED', getNodePosition(member, sourceFile).line);
        }
        if (ts.isPropertyDeclaration(member) && member.name) {
          const propName = member.name.getText(sourceFile);
          const propId = makeNodeId(relPath, `${className}.${propName}`);
          nodes.push({
            id: propId,
            name: propName,
            type: 'property',
            filePath: relPath,
            line: getNodePosition(member, sourceFile).line,
            column: getNodePosition(member, sourceFile).column,
            snippet: getSnippet(member, sourceFile),
          });
          addEdge(classId, propId, 'contains', 'EXTRACTED', getNodePosition(member, sourceFile).line);
        }
      }
    }

    // 5. Interface declarations
    if (ts.isInterfaceDeclaration(node) && node.name) {
      const ifaceName = node.name.text;
      const ifaceId = makeNodeId(relPath, ifaceName);
      addNode(ifaceName, 'interface', node);

      if (node.heritageClauses) {
        for (const clause of node.heritageClauses) {
          for (const type of clause.types) {
            const parentName = type.expression.getText(sourceFile);
            addEdge(ifaceId, parentName, 'extends', 'EXTRACTED', getNodePosition(clause, sourceFile).line);
          }
        }
      }
    }

    // 6. Type alias declarations
    if (ts.isTypeAliasDeclaration(node) && node.name) {
      addNode(node.name.text, 'type', node);
    }

    // 7. Enum declarations
    if (ts.isEnumDeclaration(node) && node.name) {
      addNode(node.name.text, 'enum', node);
    }

    // 8. Variable declarations (catch arrow functions / function expressions)
    if (ts.isVariableDeclaration(node) && node.name) {
      const varName = node.name.getText(sourceFile);
      const isFunctionLike = node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer));
      addNode(varName, isFunctionLike ? 'function' : 'variable', node);
    }

    // 9. Call expressions → same-file call edges
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      let calleeName: string | undefined;

      if (ts.isIdentifier(expr)) {
        calleeName = expr.text;
      } else if (ts.isPropertyAccessExpression(expr)) {
        // obj.method() or Class.method()
        calleeName = expr.name.text;
        // Try to get full chain like "fs.readFileSync"
        const fullChain = expr.getText(sourceFile);
        if (fullChain.includes('.')) {
          calleeName = fullChain;
        }
      }

      if (calleeName && localNames.has(calleeName)) {
        // 简单推断：如果调用的是本文件已知的名称，标记为 EXTRACTED
        const confidence: Confidence = 'EXTRACTED';
        addEdge(moduleId, makeNodeId(relPath, calleeName), 'calls', confidence, getNodePosition(node, sourceFile).line);
      } else if (calleeName) {
        // INFERRED: could be imported or built-in
        addEdge(moduleId, calleeName, 'calls', 'INFERRED', getNodePosition(node, sourceFile).line);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return { filePath: relPath, nodes, edges, exports };
}

/**
 * 扫描目录，解析所有 TS/JS 文件
 */
export async function parseProject(
  filePaths: string[],
  projectRoot: string
): Promise<{ nodes: CodeNode[]; edges: CodeEdge[]; fileCount: number }> {
  const allNodes: CodeNode[] = [];
  const allEdges: CodeEdge[] = [];
  let fileCount = 0;

  for (const fp of filePaths) {
    const parsed = parseSingleFile(fp, projectRoot);
    if (parsed) {
      allNodes.push(...parsed.nodes);
      allEdges.push(...parsed.edges);
      fileCount++;
    }
  }

  // 去重节点（按 id）
  const nodeMap = new Map<string, CodeNode>();
  for (const n of allNodes) {
    if (!nodeMap.has(n.id)) {
      nodeMap.set(n.id, n);
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: allEdges,
    fileCount,
  };
}
