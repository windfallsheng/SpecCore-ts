/**
 * structured-extractor — 结构化代码数据提取器
 * v7.2.0+
 *
 * 基于 code-scanner 和 code-graph/parser，提取 AI 可消费的结构化数据：
 *   - API 接口清单（Controller/Handler 中的路由定义）
 *   - Entity/Model 定义（字段、类型、关系）
 *   - 路由配置（前端页面路由映射）
 *   - 依赖关系（模块间 import 依赖）
 *   - 组件树（前端组件层级）
 *
 * 输出: .speccore/cache/structured-data.json
 * 供 analyze 命令的 Layer 1-4 Prompt 直接引用，减少 AI 读源码的 Token 消耗。
 */
import { readFile, writeFile, pathExists, ensureDir, readdir, stat } from 'fs-extra';
import { join, relative, basename, dirname } from 'path';
import * as ts from 'typescript';
import { logger } from '../utils/logger';

// ── 输出数据结构 ──

export interface ApiEndpoint {
  path: string;
  method: string;
  handler: string;        // 处理函数/类名
  filePath: string;
  line: number;
  parameters?: string[];  // 参数名列表
  responseType?: string;  // 返回类型
  decorators?: string[];  // 装饰器（如 @Auth, @RateLimit）
  description?: string;   // JSDoc 描述
}

export interface EntityField {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  description?: string;
}

export interface EntityDefinition {
  name: string;
  tableName?: string;
  filePath: string;
  line: number;
  fields: EntityField[];
  relations?: { target: string; type: string; field: string }[];
  description?: string;
}

export interface RouteConfig {
  path: string;
  component?: string;
  layout?: string;
  lazy?: boolean;
  guards?: string[];
  children?: RouteConfig[];
  filePath: string;
  line: number;
}

export interface ComponentInfo {
  name: string;
  filePath: string;
  line: number;
  props?: string[];
  slots?: string[];
  emits?: string[];
  dependencies?: string[];  // 引用的子组件
  description?: string;
}

export interface DependencyEdge {
  from: string;   // 模块路径
  to: string;     // 依赖模块路径
  type: 'import' | 'inherit' | 'implement';
}

export interface StructuredData {
  generatedAt: string;
  projectRoot: string;
  endpoints: {
    [platform: string]: {
      apis: ApiEndpoint[];
      entities: EntityDefinition[];
      routes: RouteConfig[];
      components: ComponentInfo[];
    };
  };
  dependencies: DependencyEdge[];
  stats: {
    totalApis: number;
    totalEntities: number;
    totalRoutes: number;
    totalComponents: number;
    totalFiles: number;
  };
}

const CACHE_PATH = join('.speccore', 'cache', 'structured-data.json');

// ── TypeScript AST 辅助 ──

function isTsOrJs(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mts|cts)$/i.test(filePath);
}

function getScriptKind(filePath: string): ts.ScriptKind {
  if (/\.tsx$/i.test(filePath)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(filePath)) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/i.test(filePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function getJSDoc(node: ts.Node, sourceFile: ts.SourceFile): string {
  const jsDocs = (node as any).jsDoc;
  if (!jsDocs || !Array.isArray(jsDocs)) return '';
  const text = jsDocs[0]?.getText(sourceFile) || '';
  return text
    .replace(/\/\*\*/g, '')
    .replace(/\*\//g, '')
    .replace(/^\s*\*\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// ── 提取器实现 ──

/**
 * 从 TypeScript 源码提取 API 端点
 */
function extractApisFromFile(filePath: string, sourceFile: ts.SourceFile, relPath: string): ApiEndpoint[] {
  const apis: ApiEndpoint[] = [];

  function visit(node: ts.Node) {
    // NestJS: @Controller() + @Get/@Post/@Put/@Delete/@Patch
    if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) {
      const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
      if (decorators && decorators.length > 0) {
        for (const dec of decorators) {
          const decName = ts.isCallExpression(dec.expression)
            ? dec.expression.expression.getText(sourceFile)
            : dec.expression.getText(sourceFile);
          if (/^(Get|Post|Put|Delete|Patch)$/i.test(decName)) {
            const pathArg = ts.isCallExpression(dec.expression)
              ? dec.expression.arguments[0]?.getText(sourceFile).replace(/['"]/g, '')
              : '';
            const handlerName = node.name?.getText(sourceFile) || 'anonymous';
            const params = node.parameters.map(p => p.name.getText(sourceFile));
            const returnType = node.type?.getText(sourceFile);

            apis.push({
              path: pathArg || '/',
              method: decName.toUpperCase(),
              handler: handlerName,
              filePath: relPath,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
              parameters: params,
              responseType: returnType,
              decorators: decorators.map(d => d.getText(sourceFile).slice(0, 50)),
              description: getJSDoc(node, sourceFile),
            });
          }
        }
      }
    }

    // Express/Koa/Fastify: router.get('/path', handler)
    if (ts.isCallExpression(node)) {
      const expr = node.expression.getText(sourceFile);
      const match = expr.match(/^(?:router|app|route)\.?(get|post|put|delete|patch)$/i);
      if (match && node.arguments.length >= 1) {
        const pathArg = node.arguments[0].getText(sourceFile).replace(/['"`]/g, '');
        const handlerArg = node.arguments[1];
        const handlerName = handlerArg
          ? (ts.isIdentifier(handlerArg) ? handlerArg.getText(sourceFile) : 'anonymous')
          : 'anonymous';

        apis.push({
          path: pathArg,
          method: match[1].toUpperCase(),
          handler: handlerName,
          filePath: relPath,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          description: '',
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return apis;
}

/**
 * 从 TypeScript 源码提取 Entity/Model 定义
 */
function extractEntitiesFromFile(filePath: string, sourceFile: ts.SourceFile, relPath: string): EntityDefinition[] {
  const entities: EntityDefinition[] = [];

  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node)) {
      const className = node.name?.getText(sourceFile);
      if (!className) return;

      // 检测是否是 Entity（有 @Entity 装饰器或继承 BaseEntity）
      const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
      const isEntity = decorators?.some(d => {
        const name = ts.isCallExpression(d.expression)
          ? d.expression.expression.getText(sourceFile)
          : d.expression.getText(sourceFile);
        return /^(Entity|Table|Document|Model|Schema)$/i.test(name);
      });
      const heritage = node.heritageClauses?.some(h =>
        h.types.some(t => /BaseEntity|Model|Document/.test(t.getText(sourceFile)))
      );

      if (!isEntity && !heritage) return;

      const fields: EntityField[] = [];
      const relations: { target: string; type: string; field: string }[] = [];

      for (const member of node.members) {
        if (ts.isPropertyDeclaration(member)) {
          const fieldName = member.name.getText(sourceFile);
          const fieldType = member.type?.getText(sourceFile) || 'unknown';
          const isOptional = member.questionToken !== undefined;
          const isPrimary = decorators?.some(d =>
            d.getText(sourceFile).includes('@PrimaryGeneratedColumn') ||
            d.getText(sourceFile).includes('@PrimaryColumn')
          );

          // 检测关系装饰器
          const fieldDecs = ts.canHaveDecorators(member) ? ts.getDecorators(member) : undefined;
          if (fieldDecs) {
            for (const d of fieldDecs) {
              const decText = d.getText(sourceFile);
              const relationMatch = decText.match(/@(ManyToOne|OneToMany|ManyToMany|OneToOne)/);
              if (relationMatch) {
                const targetType = member.type?.getText(sourceFile) || 'unknown';
                relations.push({
                  target: targetType.replace(/[\[\]]/g, ''),
                  type: relationMatch[1],
                  field: fieldName,
                });
              }
            }
          }

          fields.push({
            name: fieldName,
            type: fieldType,
            nullable: isOptional,
            isPrimaryKey: isPrimary,
            description: getJSDoc(member, sourceFile),
          });
        }
      }

      // 提取表名（从 @Entity('name')）
      let tableName: string | undefined;
      if (decorators) {
        for (const d of decorators) {
          if (ts.isCallExpression(d.expression)) {
            const decName = d.expression.expression.getText(sourceFile);
            if (/^Entity$/i.test(decName) && d.expression.arguments.length > 0) {
              tableName = d.expression.arguments[0].getText(sourceFile).replace(/['"]/g, '');
            }
          }
        }
      }

      entities.push({
        name: className,
        tableName: tableName || className,
        filePath: relPath,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        fields,
        relations: relations.length > 0 ? relations : undefined,
        description: getJSDoc(node, sourceFile),
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return entities;
}

/**
 * 从前端路由配置文件提取路由
 */
function extractRoutesFromFile(filePath: string, sourceFile: ts.SourceFile, relPath: string): RouteConfig[] {
  const routes: RouteConfig[] = [];

  function visit(node: ts.Node) {
    // React Router / Vue Router 配置数组
    if (ts.isObjectLiteralExpression(node)) {
      const pathProp = node.properties.find(p =>
        ts.isPropertyAssignment(p) && p.name.getText(sourceFile) === 'path'
      ) as ts.PropertyAssignment | undefined;
      const componentProp = node.properties.find(p =>
        ts.isPropertyAssignment(p) && (p.name.getText(sourceFile) === 'component' || p.name.getText(sourceFile) === 'element')
      ) as ts.PropertyAssignment | undefined;
      const lazyProp = node.properties.find(p =>
        ts.isPropertyAssignment(p) && p.name.getText(sourceFile) === 'lazy'
      );

      if (pathProp) {
        const path = pathProp.initializer.getText(sourceFile).replace(/['"]/g, '');
        const component = componentProp?.initializer.getText(sourceFile).replace(/[<>]/g, '');

        routes.push({
          path,
          component: component || undefined,
          lazy: !!lazyProp,
          filePath: relPath,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return routes;
}

/**
 * 提取组件信息
 */
function extractComponentsFromFile(filePath: string, sourceFile: ts.SourceFile, relPath: string): ComponentInfo[] {
  const components: ComponentInfo[] = [];

  function visit(node: ts.Node) {
    // React 函数组件
    if (ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)) {
      const name = ts.isFunctionDeclaration(node)
        ? node.name?.getText(sourceFile)
        : (node.declarationList.declarations[0].name as ts.Identifier)?.getText(sourceFile);

      if (name && /^[A-Z]/.test(name)) {
        const props: string[] = [];
        if (ts.isFunctionDeclaration(node) && node.parameters.length > 0) {
          const param = node.parameters[0];
          if (param.type && ts.isTypeLiteralNode(param.type)) {
            for (const member of param.type.members) {
              if (ts.isPropertySignature(member)) {
                props.push(member.name.getText(sourceFile));
              }
            }
          }
        }

        components.push({
          name,
          filePath: relPath,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          props: props.length > 0 ? props : undefined,
          description: getJSDoc(node, sourceFile),
        });
      }
    }

    // Vue 组件（.vue 文件需要单独处理，这里只处理 TS 中的 defineComponent）
    if (ts.isCallExpression(node)) {
      const expr = node.expression.getText(sourceFile);
      if (expr === 'defineComponent' && node.arguments.length > 0) {
        const arg = node.arguments[0];
        if (ts.isObjectLiteralExpression(arg)) {
          const nameProp = arg.properties.find(p =>
            ts.isPropertyAssignment(p) && p.name.getText(sourceFile) === 'name'
          ) as ts.PropertyAssignment | undefined;
          const name = nameProp?.initializer.getText(sourceFile).replace(/['"]/g, '');
          if (name) {
            components.push({
              name,
              filePath: relPath,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
              description: getJSDoc(node, sourceFile),
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return components;
}

// ── 主入口 ──

/**
 * 扫描项目源码，提取结构化数据
 * @param projectRoot 项目根目录
 * @param sourcePaths 源码路径列表（从 CONSTITUTION.md 读取）
 */
export async function extractStructuredData(
  projectRoot: string,
  sourcePaths: string[],
): Promise<StructuredData> {
  const data: StructuredData = {
    generatedAt: new Date().toISOString(),
    projectRoot,
    endpoints: {},
    dependencies: [],
    stats: { totalApis: 0, totalEntities: 0, totalRoutes: 0, totalComponents: 0, totalFiles: 0 },
  };

  let totalFiles = 0;

  for (const srcPath of sourcePaths) {
    const absPath = join(projectRoot, srcPath);
    if (!(await pathExists(absPath))) continue;

    // 推断端名（从路径）
    const platform = inferPlatform(srcPath);
    if (!data.endpoints[platform]) {
      data.endpoints[platform] = { apis: [], entities: [], routes: [], components: [] };
    }

    const files = await collectTsFiles(absPath);
    for (const filePath of files) {
      totalFiles++;
      const relPath = relative(projectRoot, filePath);
      const content = await readFile(filePath, 'utf-8');

      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.ES2020,
        true,
        getScriptKind(filePath)
      );

      // 提取各类数据
      const apis = extractApisFromFile(filePath, sourceFile, relPath);
      const entities = extractEntitiesFromFile(filePath, sourceFile, relPath);
      const routes = extractRoutesFromFile(filePath, sourceFile, relPath);
      const components = extractComponentsFromFile(filePath, sourceFile, relPath);

      data.endpoints[platform].apis.push(...apis);
      data.endpoints[platform].entities.push(...entities);
      data.endpoints[platform].routes.push(...routes);
      data.endpoints[platform].components.push(...components);

      // 提取 import 依赖
      const imports = extractImports(content, relPath);
      data.dependencies.push(...imports);
    }
  }

  // 统计
  for (const platform of Object.keys(data.endpoints)) {
    const ep = data.endpoints[platform];
    data.stats.totalApis += ep.apis.length;
    data.stats.totalEntities += ep.entities.length;
    data.stats.totalRoutes += ep.routes.length;
    data.stats.totalComponents += ep.components.length;
  }
  data.stats.totalFiles = totalFiles;

  // 写入缓存
  await ensureDir(dirname(CACHE_PATH));
  await writeFile(CACHE_PATH, JSON.stringify(data, null, 2));
  logger.info(`📊 结构化数据提取完成: ${CACHE_PATH}`);
  logger.info(`   API: ${data.stats.totalApis}, Entity: ${data.stats.totalEntities}, Route: ${data.stats.totalRoutes}, Component: ${data.stats.totalComponents}, Files: ${totalFiles}`);

  return data;
}

/**
 * 加载已提取的结构化数据
 */
export async function loadStructuredData(): Promise<StructuredData | null> {
  if (!(await pathExists(CACHE_PATH))) return null;
  try {
    const content = await readFile(CACHE_PATH, 'utf-8');
    return JSON.parse(content) as StructuredData;
  } catch {
    return null;
  }
}

// ── 内部辅助 ──

async function collectTsFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        results.push(...await collectTsFiles(fullPath));
      } else if (entry.isFile() && isTsOrJs(fullPath)) {
        results.push(fullPath);
      }
    }
  } catch { /* ignore */ }
  return results;
}

function inferPlatform(path: string): string {
  const lower = path.toLowerCase();
  if (/admin|web|frontend|client|h5/.test(lower)) return 'frontend';
  if (/api|server|backend|service/.test(lower)) return 'backend';
  if (/mobile|app|ios|android/.test(lower)) return 'mobile';
  if (/cli|command|bin/.test(lower)) return 'cli';
  if (/shared|common|lib|utils/.test(lower)) return 'shared';
  return 'unknown';
}

function extractImports(content: string, fromPath: string): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/import\s+.*?\s+from\s+['"](\.\/[^'"]+)['"]/);
    if (match) {
      edges.push({ from: fromPath, to: match[1], type: 'import' });
    }
  }
  return edges;
}
