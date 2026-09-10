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

// v8.3.124+: 深化参数信息
export interface ApiParameterDetail {
  name: string;
  type?: string;
  required?: boolean;
  decorators?: string[];       // @Body, @Query, @Param, @Headers
  validationRules?: string[];  // @IsString, @MinLength(6), @IsEmail
}

// v8.3.125+: Service 调用链
export interface ServiceCall {
  service: string;        // Service 类名或模块名
  method: string;         // 调用的方法名
  line?: number;          // 调用所在行号
}

export interface ApiEndpoint {
  path: string;
  method: string;
  handler: string;        // 处理函数/类名
  filePath: string;
  line: number;
  parameters?: string[];  // 参数名列表（保持兼容）
  parameterDetails?: ApiParameterDetail[]; // v8.3.124+: 详细参数信息
  responseType?: string;  // 返回类型
  decorators?: string[];  // 路由装饰器（如 @Get, @Post）
  authDecorators?: string[]; // v8.3.124+: 鉴权装饰器（@Auth, @Roles, @Public）
  description?: string;   // JSDoc 描述
  dtoRef?: string;        // v8.3.124+: DTO 类名引用
  serviceCalls?: ServiceCall[]; // v8.3.125+: 方法内部调用的 Service 链
}

export interface EntityField {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  description?: string;
  columnOptions?: Record<string, any>; // v8.3.124+: @Column({ length: 20, type: 'varchar' })
  validationRules?: string[];          // v8.3.124+: class-validator 装饰器
}

export interface EntityDefinition {
  name: string;
  tableName?: string;
  filePath: string;
  line: number;
  fields: EntityField[];
  relations?: { target: string; type: string; field: string }[];
  description?: string;
  indexes?: { name?: string; fields: string[]; unique?: boolean }[]; // v8.3.124+
  constraints?: { type: string; fields: string[] }[];                // v8.3.124+
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

// v8.3.126+: DTO 定义（跨文件解析）
export interface DtoField {
  name: string;
  type: string;
  required?: boolean;
  decorators?: string[];        // @IsString, @IsOptional 等
  validationRules?: string[];   // 校验规则
  defaultValue?: string;
  description?: string;
}

export interface DtoDefinition {
  name: string;
  filePath: string;
  line: number;
  fields: DtoField[];
  description?: string;
  usedByApis?: string[];        // 哪些 API 引用了这个 DTO
}

// v8.3.126+: Service 方法定义
export interface ServiceMethod {
  name: string;
  returnType?: string;
  parameters: { name: string; type?: string }[];
  decorators?: string[];
  description?: string;
  line: number;
}

export interface ServiceDefinition {
  name: string;                 // 类名
  filePath: string;
  line: number;
  methods: ServiceMethod[];
  description?: string;
  injects?: string[];           // 注入的依赖（构造函数参数）
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
  dtos: DtoDefinition[];        // v8.3.126+: 全局 DTO 定义（跨平台）
  services: ServiceDefinition[]; // v8.3.126+: 全局 Service 定义（跨平台）
  dependencies: DependencyEdge[];
  stats: {
    totalApis: number;
    totalEntities: number;
    totalRoutes: number;
    totalComponents: number;
    totalDtos: number;           // v8.3.126+
    totalServices: number;       // v8.3.126+
    totalFiles: number;
  };
}

const CACHE_PATH = join('.speccore', 'cache', 'structured-data.json');

// ── TypeScript AST 辅助 ──

function isTsOrJs(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mts|cts)$/i.test(filePath);
}

// v8.3.125+: 支持 Java / Python / Go
function isSupportedSource(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mts|cts|java|py|go)$/i.test(filePath);
}

function detectLanguage(filePath: string): 'typescript' | 'java' | 'python' | 'go' | 'unknown' {
  if (/\.(ts|tsx|js|jsx|mts|cts)$/i.test(filePath)) return 'typescript';
  if (/\.java$/i.test(filePath)) return 'java';
  if (/\.py$/i.test(filePath)) return 'python';
  if (/\.go$/i.test(filePath)) return 'go';
  return 'unknown';
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

/** v8.3.124+: 从参数节点提取详细信息（类型、装饰器、校验规则） */
function extractParameterDetail(param: ts.ParameterDeclaration, sourceFile: ts.SourceFile): ApiParameterDetail {
  const name = param.name.getText(sourceFile);
  const type = param.type?.getText(sourceFile);
  const required = !param.questionToken && !param.initializer;

  const paramDecs: string[] = [];
  const validations: string[] = [];
  let dtoRef: string | undefined;

  const decorators = ts.canHaveDecorators(param) ? ts.getDecorators(param) : undefined;
  if (decorators) {
    for (const d of decorators) {
      const decText = d.getText(sourceFile);
      paramDecs.push(decText);
      // 校验规则: @IsString, @MinLength(6), @IsEmail, @IsOptional
      if (/^@(Is|String|Min|Max|Length|Email|UUID|URL|Enum|Array|Optional|Validate)/.test(decText)) {
        validations.push(decText);
      }
      // DTO 引用: @Body() dto: CreateUserDto
      if (decText.includes('@Body') && param.type) {
        const typeText = param.type.getText(sourceFile);
        if (!/^string|^number|^boolean|^Date/.test(typeText)) {
          dtoRef = typeText;
        }
      }
    }
  }

  return { name, type, required, decorators: paramDecs, validationRules: validations.length > 0 ? validations : undefined };
}

/** v8.3.124+: 提取鉴权装饰器 */
function extractAuthDecorators(decorators: readonly ts.Decorator[] | undefined, sourceFile: ts.SourceFile): string[] {
  if (!decorators) return [];
  const authDecs: string[] = [];
  for (const d of decorators) {
    const text = d.getText(sourceFile);
    if (/^@(Auth|Roles|Public|UseGuards|Permissions|Scope|Require)/.test(text)) {
      authDecs.push(text.slice(0, 60));
    }
  }
  return authDecs;
}

/** v8.3.125+: 从方法体提取 Service 调用链 */
function extractServiceCalls(body: ts.Block | ts.Node | undefined, sourceFile: ts.SourceFile): ServiceCall[] {
  const calls: ServiceCall[] = [];
  if (!body) return calls;

  function visitCall(n: ts.Node) {
    if (ts.isCallExpression(n)) {
      const expr = n.expression;
      // 模式: this.userService.findById(...) / userService.create(...)
      if (ts.isPropertyAccessExpression(expr)) {
        const serviceName = expr.expression.getText(sourceFile);
        const methodName = expr.name.getText(sourceFile);
        // 过滤掉原生方法和内置对象
        if (!/^(console|Math|Date|JSON|Object|Array|String|Number|Promise|process|require)$/.test(serviceName)) {
          const line = sourceFile.getLineAndCharacterOfPosition(n.getStart(sourceFile)).line + 1;
          calls.push({ service: serviceName, method: methodName, line });
        }
      }
      // 模式: await someAsyncCall(...)
      if (ts.isIdentifier(expr)) {
        const name = expr.getText(sourceFile);
        if (/^(find|get|create|update|delete|save|remove|query|execute|call)/i.test(name)) {
          const line = sourceFile.getLineAndCharacterOfPosition(n.getStart(sourceFile)).line + 1;
          calls.push({ service: 'unknown', method: name, line });
        }
      }
    }
    ts.forEachChild(n, visitCall);
  }

  visitCall(body);
  return [...new Map(calls.map(c => [`${c.service}.${c.method}`, c])).values()]; // 去重
}

/**
 * 从 TypeScript 源码提取 API 端点
 * v8.3.124+: 增强参数详情、鉴权装饰器、DTO 引用
 * v8.3.125+: 增加 Service 调用链
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

            // v8.3.124+: 提取详细参数信息
            const paramDetails = node.parameters.map(p => extractParameterDetail(p, sourceFile));
            const authDecs = extractAuthDecorators(decorators, sourceFile);

            // v8.3.124+: 提取 DTO 引用
            let dtoRef: string | undefined;
            for (const pd of paramDetails) {
              if (pd.decorators?.some(d => d.includes('@Body'))) {
                const p = node.parameters.find(param => param.name.getText(sourceFile) === pd.name);
                if (p && p.type) {
                  const typeText = p.type.getText(sourceFile);
                  if (!/^(string|number|boolean|Date|any|unknown)\b/.test(typeText)) {
                    dtoRef = typeText;
                    break;
                  }
                }
              }
            }

            // v8.3.125+: 提取 Service 调用链
            const svcCalls = extractServiceCalls(ts.isMethodDeclaration(node) ? node.body : undefined, sourceFile);

            apis.push({
              path: pathArg || '/',
              method: decName.toUpperCase(),
              handler: handlerName,
              filePath: relPath,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
              parameters: params,
              parameterDetails: paramDetails.length > 0 ? paramDetails : undefined,
              responseType: returnType,
              decorators: decorators.map(d => d.getText(sourceFile).slice(0, 50)),
              authDecorators: authDecs.length > 0 ? authDecs : undefined,
              description: getJSDoc(node, sourceFile),
              dtoRef,
              serviceCalls: svcCalls.length > 0 ? svcCalls : undefined,
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

/** v8.3.124+: 从装饰器参数提取数组（用于 @Index(['a','b'])） */
function extractArrayFromArg(arg: ts.Expression, sourceFile: ts.SourceFile): string[] {
  if (ts.isArrayLiteralExpression(arg)) {
    return arg.elements
      .filter(e => ts.isStringLiteral(e))
      .map(e => (e as ts.StringLiteral).text);
  }
  return [];
}

/** v8.3.124+: 从类装饰器提取索引和约束 */
function extractClassIndexesAndConstraints(
  decorators: readonly ts.Decorator[] | undefined,
  sourceFile: ts.SourceFile
): { indexes: EntityDefinition['indexes']; constraints: EntityDefinition['constraints'] } {
  const indexes: NonNullable<EntityDefinition['indexes']> = [];
  const constraints: NonNullable<EntityDefinition['constraints']> = [];
  if (!decorators) return { indexes, constraints };

  for (const d of decorators) {
    const text = d.getText(sourceFile);
    if (!ts.isCallExpression(d.expression)) continue;
    const decName = d.expression.expression.getText(sourceFile);

    // @Index(['email', 'phone'], { unique: true })
    if (/^Index$/i.test(decName) && d.expression.arguments.length > 0) {
      const fields = extractArrayFromArg(d.expression.arguments[0], sourceFile);
      let unique = false;
      if (d.expression.arguments.length > 1 && ts.isObjectLiteralExpression(d.expression.arguments[1])) {
        const uniqueProp = d.expression.arguments[1].properties.find(p =>
          ts.isPropertyAssignment(p) && p.name.getText(sourceFile) === 'unique'
        ) as ts.PropertyAssignment | undefined;
        if (uniqueProp && uniqueProp.initializer.getText(sourceFile) === 'true') unique = true;
      }
      if (fields.length > 0) indexes.push({ fields, unique });
    }

    // @Unique(['username'])
    if (/^Unique$/i.test(decName) && d.expression.arguments.length > 0) {
      const fields = extractArrayFromArg(d.expression.arguments[0], sourceFile);
      if (fields.length > 0) constraints.push({ type: 'UNIQUE', fields });
    }

    // @Check('age > 0')
    if (/^Check$/i.test(decName) && d.expression.arguments.length > 0) {
      const expr = d.expression.arguments[0].getText(sourceFile).replace(/['"]/g, '');
      constraints.push({ type: 'CHECK', fields: [expr] });
    }
  }

  return { indexes, constraints };
}

/**
 * 从 TypeScript 源码提取 Entity/Model 定义
 * v8.3.124+: 增强字段装饰器、索引、约束、默认值提取
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

          // 字段装饰器
          const fieldDecs = ts.canHaveDecorators(member) ? ts.getDecorators(member) : undefined;
          const fieldDecoratorTexts: string[] = [];
          const fieldValidations: string[] = [];
          let isPrimary = false;
          let defaultValue: string | undefined;
          let columnOptions: Record<string, any> = {};

          if (fieldDecs) {
            for (const d of fieldDecs) {
              const decText = d.getText(sourceFile);
              fieldDecoratorTexts.push(decText.slice(0, 80));

              // 关系装饰器
              const relationMatch = decText.match(/@(ManyToOne|OneToMany|ManyToMany|OneToOne)/);
              if (relationMatch) {
                const targetType = member.type?.getText(sourceFile) || 'unknown';
                relations.push({
                  target: targetType.replace(/[\[\]]/g, ''),
                  type: relationMatch[1],
                  field: fieldName,
                });
                continue;
              }

              // 主键
              if (/@PrimaryGeneratedColumn|@PrimaryColumn/.test(decText)) isPrimary = true;

              // 校验规则
              if (/^@(Is|String|Min|Max|Length|Email|UUID|URL|Enum|Array|Optional|Validate|Matches)/.test(decText)) {
                fieldValidations.push(decText.slice(0, 60));
              }

              // @Column 选项提取
              if (/^@Column/.test(decText) && ts.isCallExpression(d.expression)) {
                // 尝试提取 @Column({ length: 20, default: 'active' })
                for (const arg of d.expression.arguments) {
                  if (ts.isObjectLiteralExpression(arg)) {
                    for (const prop of arg.properties) {
                      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                        const key = prop.name.getText(sourceFile);
                        const valText = prop.initializer.getText(sourceFile);
                        if (key === 'default') defaultValue = valText.replace(/['"]/g, '');
                        try {
                          columnOptions[key] = JSON.parse(valText);
                        } catch {
                          columnOptions[key] = valText;
                        }
                      }
                    }
                  } else if (ts.isStringLiteral(arg)) {
                    columnOptions.type = arg.text;
                  }
                }
              }
            }
          }

          fields.push({
            name: fieldName,
            type: fieldType,
            nullable: isOptional,
            isPrimaryKey: isPrimary,
            defaultValue,
            description: getJSDoc(member, sourceFile),
            columnOptions: Object.keys(columnOptions).length > 0 ? columnOptions : undefined,
            validationRules: fieldValidations.length > 0 ? fieldValidations : undefined,
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

      // v8.3.124+: 提取类级索引和约束
      const { indexes = [], constraints = [] } = extractClassIndexesAndConstraints(decorators, sourceFile);

      entities.push({
        name: className,
        tableName: tableName || className,
        filePath: relPath,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        fields,
        relations: relations.length > 0 ? relations : undefined,
        description: getJSDoc(node, sourceFile),
        indexes: indexes.length > 0 ? indexes : undefined,
        constraints: constraints.length > 0 ? constraints : undefined,
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
    dtos: [],
    services: [],
    dependencies: [],
    stats: { totalApis: 0, totalEntities: 0, totalRoutes: 0, totalComponents: 0, totalDtos: 0, totalServices: 0, totalFiles: 0 },
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

    const files = await collectSourceFiles(absPath);
    for (const filePath of files) {
      totalFiles++;
      const relPath = relative(projectRoot, filePath);
      const content = await readFile(filePath, 'utf-8');
      const lang = detectLanguage(filePath);

      let apis: ApiEndpoint[] = [];
      let entities: EntityDefinition[] = [];
      let routes: RouteConfig[] = [];
      let components: ComponentInfo[] = [];
      let fileDtos: DtoDefinition[] = [];        // v8.3.126+
      let fileServices: ServiceDefinition[] = []; // v8.3.126+

      if (lang === 'typescript') {
        const sourceFile = ts.createSourceFile(
          filePath,
          content,
          ts.ScriptTarget.ES2020,
          true,
          getScriptKind(filePath)
        );
        apis = extractApisFromFile(filePath, sourceFile, relPath);
        entities = extractEntitiesFromFile(filePath, sourceFile, relPath);
        routes = extractRoutesFromFile(filePath, sourceFile, relPath);
        components = extractComponentsFromFile(filePath, sourceFile, relPath);
        fileDtos = extractDtosFromTsFile(filePath, sourceFile, relPath);       // v8.3.126+
        fileServices = extractServicesFromTsFile(filePath, sourceFile, relPath); // v8.3.126+
      } else if (lang === 'java') {
        const result = extractFromJavaFile(content, relPath);
        apis = result.apis; entities = result.entities; routes = result.routes; components = result.components;
        fileDtos = result.dtos || [];        // v8.3.126+
        fileServices = result.services || []; // v8.3.126+
      } else if (lang === 'python') {
        const result = extractFromPythonFile(content, relPath);
        apis = result.apis; entities = result.entities; routes = result.routes; components = result.components;
        fileDtos = result.dtos || [];
        fileServices = result.services || [];
      } else if (lang === 'go') {
        const result = extractFromGoFile(content, relPath);
        apis = result.apis; entities = result.entities; routes = result.routes; components = result.components;
        fileDtos = result.dtos || [];
        fileServices = result.services || [];
      }

      data.endpoints[platform].apis.push(...apis);
      data.endpoints[platform].entities.push(...entities);
      data.endpoints[platform].routes.push(...routes);
      data.endpoints[platform].components.push(...components);
      data.dtos.push(...fileDtos);              // v8.3.126+
      data.services.push(...fileServices);      // v8.3.126+

      // 提取 import 依赖（按语言适配）
      const imports = extractImportsByLang(content, relPath, lang);
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
  data.stats.totalDtos = data.dtos.length;          // v8.3.126+
  data.stats.totalServices = data.services.length;  // v8.3.126+
  data.stats.totalFiles = totalFiles;

  // 写入缓存
  await ensureDir(dirname(CACHE_PATH));
  await writeFile(CACHE_PATH, JSON.stringify(data, null, 2));
  logger.info(`📊 结构化数据提取完成: ${CACHE_PATH}`);
  logger.info(`   API: ${data.stats.totalApis}, Entity: ${data.stats.totalEntities}, Route: ${data.stats.totalRoutes}, Component: ${data.stats.totalComponents}, DTO: ${data.stats.totalDtos}, Service: ${data.stats.totalServices}, Files: ${totalFiles}`);

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

async function collectSourceFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== '__pycache__' && entry.name !== 'venv') {
        results.push(...await collectSourceFiles(fullPath));
      } else if (entry.isFile() && isSupportedSource(fullPath)) {
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

function extractImportsByLang(content: string, fromPath: string, lang: string): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const lines = content.split('\n');
  if (lang === 'typescript' || lang === 'java') {
    for (const line of lines) {
      const match = line.match(/import\s+.*?\s+from\s+['"](\.\/[^'"]+)['"]/);
      if (match) edges.push({ from: fromPath, to: match[1], type: 'import' });
    }
  } else if (lang === 'python') {
    for (const line of lines) {
      const match = line.match(/from\s+([.\w]+)\s+import|import\s+([.\w]+)/);
      if (match) edges.push({ from: fromPath, to: match[1] || match[2], type: 'import' });
    }
  } else if (lang === 'go') {
    for (const line of lines) {
      const match = line.match(/"([^"]+\/[^"]+)"/);
      if (match) edges.push({ from: fromPath, to: match[1], type: 'import' });
    }
  }
  return edges;
}

// 保留旧函数兼容
function extractImports(content: string, fromPath: string): DependencyEdge[] {
  return extractImportsByLang(content, fromPath, 'typescript');
}

// ═══════════════════════════════════════════════════════════
// v8.3.125+: 多语言提取器（Java / Python / Go）
// ═══════════════════════════════════════════════════════════

interface ExtractionResult {
  apis: ApiEndpoint[];
  entities: EntityDefinition[];
  routes: RouteConfig[];
  components: ComponentInfo[];
  dtos?: DtoDefinition[];       // v8.3.126+
  services?: ServiceDefinition[]; // v8.3.126+
}

// ── Java (Spring Boot) ──

function extractFromJavaFile(content: string, relPath: string): ExtractionResult {
  const apis: ApiEndpoint[] = [];
  const entities: EntityDefinition[] = [];
  const routes: RouteConfig[] = [];
  const components: ComponentInfo[] = [];
  const lines = content.split('\n');

  let currentClass: string | null = null;
  let currentClassLine = 0;
  let classAnnotations: string[] = [];
  let inClass = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 类级注解收集
    if (/^@\w+/.test(line)) {
      classAnnotations.push(line);
      continue;
    }

    // 类定义
    const classMatch = line.match(/(?:public\s+)?(?:class|interface)\s+(\w+)/);
    if (classMatch) {
      currentClass = classMatch[1];
      currentClassLine = i + 1;
      inClass = true;
      braceDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

      // @Entity 检测
      const isEntity = classAnnotations.some(a => /@Entity/.test(a));
      if (isEntity) {
        const tableMatch = classAnnotations.find(a => /@Table\s*\(/.test(a));
        let tableName: string | undefined;
        if (tableMatch) {
          const tm = tableMatch.match(/name\s*=\s*["'](\w+)["']/);
          if (tm) tableName = tm[1];
        }
        const entity = extractJavaEntity(currentClass, tableName, content, relPath, currentClassLine, i);
        if (entity) entities.push(entity);
      }

      classAnnotations = [];
      continue;
    }

    if (inClass) {
      braceDepth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (braceDepth <= 0) {
        inClass = false;
        currentClass = null;
      }

      // Spring Boot API 方法检测
      const methodMatch = line.match(/@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*\(([^)]*)\)/);
      if (methodMatch && currentClass) {
        const httpMethod = methodMatch[1].replace('Mapping', '').toUpperCase();
        const methodArg = methodMatch[2];
        let path = '/';
        const pathMatch = methodArg.match(/["']([^"']+)["']/);
        if (pathMatch) path = pathMatch[1];

        // 查找方法签名（下一行或当前行剩余部分）
        let methodLine = i + 1;
        let sig = '';
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          sig += lines[j];
          if (lines[j].includes('{') || lines[j].includes(';')) break;
        }
        const sigMatch = sig.match(/(?:public\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*\(([^)]*)\)/);
        const returnType = sigMatch ? sigMatch[1] : undefined;
        const methodName = sigMatch ? sigMatch[2] : 'unknown';

        // 参数解析
        const params: string[] = [];
        const paramDetails: ApiParameterDetail[] = [];
        if (sigMatch && sigMatch[3]) {
          const paramParts = sigMatch[3].split(',');
          for (const pp of paramParts) {
            const pm = pp.trim().match(/(?:@\w+(?:\([^)]*\))?\s+)*(\w+(?:<[^>]+>)?)\s+(\w+)/);
            if (pm) {
              params.push(pm[2]);
              const pDecs: string[] = [];
              const pVals: string[] = [];
              const decMatch = pp.match(/@(\w+)(?:\([^)]*\))?/g);
              if (decMatch) {
                for (const d of decMatch) {
                  pDecs.push(d);
                  if (/RequestBody|Valid|Validated/.test(d)) pVals.push(d);
                }
              }
              paramDetails.push({ name: pm[2], type: pm[1], decorators: pDecs, validationRules: pVals });
            }
          }
        }

        // 鉴权注解（方法级）
        const authDecs: string[] = [];
        for (let j = Math.max(0, i - 5); j < i; j++) {
          if (/@(PreAuthorize|Secured|RolesAllowed)/.test(lines[j])) {
            authDecs.push(lines[j].trim());
          }
        }

        // v8.3.125+: 提取方法体内的 Service 调用
        const svcCalls = extractServiceCallsFromLines(lines, i, 40, 'java');

        apis.push({
          path,
          method: httpMethod === 'REQUEST' ? 'GET' : httpMethod,
          handler: `${currentClass}.${methodName}`,
          filePath: relPath,
          line: methodLine,
          parameters: params,
          parameterDetails: paramDetails.length > 0 ? paramDetails : undefined,
          responseType: returnType,
          authDecorators: authDecs.length > 0 ? authDecs : undefined,
          serviceCalls: svcCalls.length > 0 ? svcCalls : undefined,
        });
      }
    }
  }

  const dtos = extractDtosFromJavaFile(content, relPath);        // v8.3.126+
  const services = extractServicesFromJavaFile(content, relPath); // v8.3.126+

  return { apis, entities, routes, components, dtos, services };
}

function extractJavaEntity(
  className: string,
  tableName: string | undefined,
  content: string,
  relPath: string,
  classLine: number,
  startIdx: number
): EntityDefinition | null {
  const lines = content.split('\n');
  const fields: EntityField[] = [];
  let braceDepth = 0;
  let inClass = false;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!inClass) {
      if (line.includes('{')) inClass = true;
      continue;
    }
    braceDepth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (braceDepth < 0) break;

    const trimmed = line.trim();
    // 字段检测: private Type fieldName;
    const fieldMatch = trimmed.match(/^private\s+(?:@\w+(?:\([^)]*\))?\s+)*(\w+(?:<[^>]+>)?)\s+(\w+)\s*;/);
    if (fieldMatch) {
      const fieldType = fieldMatch[1];
      const fieldName = fieldMatch[2];
      let isPrimary = false;
      let isNullable = true;
      let defaultValue: string | undefined;
      const colOpts: Record<string, any> = {};
      const validations: string[] = [];

      // 检查前面几行的注解
      for (let j = Math.max(0, i - 3); j < i; j++) {
        const al = lines[j].trim();
        if (/@Id|@PrimaryKey/.test(al)) isPrimary = true;
        if (/@Column\s*\(/.test(al)) {
          const nullableMatch = al.match(/nullable\s*=\s*(false|true)/);
          if (nullableMatch) isNullable = nullableMatch[1] === 'true';
          const lenMatch = al.match(/length\s*=\s*(\d+)/);
          if (lenMatch) colOpts.length = parseInt(lenMatch[1]);
          const defMatch = al.match(/columnDefinition\s*=\s*["']([^"']+)["']/);
          if (defMatch) colOpts.columnDefinition = defMatch[1];
        }
        if (/@NotNull/.test(al)) isNullable = false;
        if (/^@\w+/.test(al) && !/@Column|@Id|@PrimaryKey/.test(al)) {
          validations.push(al.slice(0, 60));
        }
      }

      fields.push({
        name: fieldName,
        type: fieldType,
        nullable: isNullable,
        isPrimaryKey: isPrimary,
        defaultValue,
        columnOptions: Object.keys(colOpts).length > 0 ? colOpts : undefined,
        validationRules: validations.length > 0 ? validations : undefined,
      });
    }
  }

  if (fields.length === 0) return null;
  return { name: className, tableName: tableName || className, filePath: relPath, line: classLine, fields };
}

// ── Python (FastAPI / Django / Flask) ──

function extractFromPythonFile(content: string, relPath: string): ExtractionResult {
  const apis: ApiEndpoint[] = [];
  const entities: EntityDefinition[] = [];
  const routes: RouteConfig[] = [];
  const components: ComponentInfo[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // FastAPI 路由: @app.get("/path") 或 @router.post("/path")
    const apiMatch = line.match(/@(app|router|api)\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/);
    if (apiMatch) {
      const method = apiMatch[2].toUpperCase();
      const path = apiMatch[3];
      let handler = 'unknown';
      // 查找下一行的 def
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const defMatch = lines[j].match(/def\s+(\w+)\s*\(([^)]*)\)/);
        if (defMatch) {
          handler = defMatch[1];
          const params: string[] = [];
          const paramDetails: ApiParameterDetail[] = [];
          const paramStr = defMatch[2];
          // 解析参数（跳过 self, cls, 和依赖注入参数）
          const paramParts = paramStr.split(',');
          for (const pp of paramParts) {
            const pt = pp.trim();
            if (!pt || pt === 'self' || pt === 'cls') continue;
            // 支持 type hint: param: Type
            const pm = pt.match(/(\w+)\s*:\s*(.+)/);
            if (pm) {
              params.push(pm[1]);
              paramDetails.push({ name: pm[1], type: pm[2] });
            } else {
              const simple = pt.match(/(\w+)/);
              if (simple) {
                params.push(simple[1]);
                paramDetails.push({ name: simple[1] });
              }
            }
          }

          const pySvcCalls = extractServiceCallsFromLines(lines, j, 30, 'python');

          apis.push({
            path,
            method,
            handler,
            filePath: relPath,
            line: j + 1,
            parameters: params,
            parameterDetails: paramDetails.length > 0 ? paramDetails : undefined,
            serviceCalls: pySvcCalls.length > 0 ? pySvcCalls : undefined,
          });
          break;
        }
      }
    }

    // Django 视图: def view_name(request): 带有 url 注释
    const djangoUrlMatch = line.match(/#\s*url:\s*(\S+)/);
    if (djangoUrlMatch) {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const defMatch = lines[j].match(/def\s+(\w+)\s*\(/);
        if (defMatch) {
          const djangoSvcCalls = extractServiceCallsFromLines(lines, j, 30, 'python');
          apis.push({
            path: djangoUrlMatch[1],
            method: 'GET',
            handler: defMatch[1],
            filePath: relPath,
            line: j + 1,
            serviceCalls: djangoSvcCalls.length > 0 ? djangoSvcCalls : undefined,
          });
          break;
        }
      }
    }

    // Pydantic / Dataclass Entity
    const classMatch = line.match(/class\s+(\w+)\s*\(([^)]*)\)/);
    if (classMatch) {
      const className = classMatch[1];
      const bases = classMatch[2];
      const isPydantic = /BaseModel| pydantic/.test(bases);
      const isDataclass = /@dataclass/.test(bases) || lines.slice(Math.max(0, i - 2), i).some(l => l.includes('@dataclass'));
      const isDjangoModel = /models\.Model/.test(bases);

      if (isPydantic || isDataclass || isDjangoModel) {
        const entity = extractPythonEntity(className, content, relPath, i + 1, i);
        if (entity) entities.push(entity);
      }
    }
  }

  const dtos = extractDtosFromPythonFile(content, relPath);        // v8.3.126+
  const services = extractServicesFromPythonFile(content, relPath); // v8.3.126+

  return { apis, entities, routes, components, dtos, services };
}

function extractPythonEntity(
  className: string,
  content: string,
  relPath: string,
  classLine: number,
  startIdx: number
): EntityDefinition | null {
  const lines = content.split('\n');
  const fields: EntityField[] = [];

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    // 类结束检测
    if (line.trim() && !line.startsWith(' ') && !line.startsWith('\t') && !line.startsWith('#')) break;

    // 字段检测: name: Type = Field(...) 或 name = models.CharField(...)
    const fieldMatch = line.match(/^(\s+)(\w+)\s*:\s*(\w+(?:\[[^\]]+\])?)\s*(?:=\s*(.+))?/);
    if (fieldMatch) {
      const fieldName = fieldMatch[2];
      const fieldType = fieldMatch[3];
      const defaultExpr = fieldMatch[4];
      let defaultValue: string | undefined;
      let isNullable = true;
      const validations: string[] = [];

      if (defaultExpr) {
        if (/Field\s*\(/.test(defaultExpr)) {
          const nullMatch = defaultExpr.match(/nullable\s*=\s*(True|False)/);
          if (nullMatch) isNullable = nullMatch[1] === 'True';
          const defMatch = defaultExpr.match(/default\s*=\s*([^,)]+)/);
          if (defMatch) defaultValue = defMatch[1].trim();
        } else {
          defaultValue = defaultExpr.trim();
        }
      }

      fields.push({
        name: fieldName,
        type: fieldType,
        nullable: isNullable,
        defaultValue,
        validationRules: validations.length > 0 ? validations : undefined,
      });
    }

    // Django ORM 字段: name = models.CharField(...)
    const djangoFieldMatch = line.match(/(\w+)\s*=\s*models\.(\w+)Field\s*\(([^)]*)\)/);
    if (djangoFieldMatch) {
      const fieldName = djangoFieldMatch[1];
      const fieldType = djangoFieldMatch[2];
      const args = djangoFieldMatch[3];
      let isPrimary = false;
      let isNullable = true;
      let defaultValue: string | undefined;
      const colOpts: Record<string, any> = {};

      if (/primary_key\s*=\s*True/.test(args)) isPrimary = true;
      if (/null\s*=\s*False/.test(args)) isNullable = false;
      const defMatch = args.match(/default\s*=\s*([^,)]+)/);
      if (defMatch) defaultValue = defMatch[1].trim();
      const maxMatch = args.match(/max_length\s*=\s*(\d+)/);
      if (maxMatch) colOpts.maxLength = parseInt(maxMatch[1]);

      fields.push({
        name: fieldName,
        type: fieldType,
        nullable: isNullable,
        isPrimaryKey: isPrimary,
        defaultValue,
        columnOptions: Object.keys(colOpts).length > 0 ? colOpts : undefined,
      });
    }
  }

  if (fields.length === 0) return null;
  return { name: className, filePath: relPath, line: classLine, fields };
}

// ── Go (Gin / Echo) ──

function extractFromGoFile(content: string, relPath: string): ExtractionResult {
  const apis: ApiEndpoint[] = [];
  const entities: EntityDefinition[] = [];
  const routes: RouteConfig[] = [];
  const components: ComponentInfo[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Gin 路由: r.GET("/path", handler) 或 router.POST("/path", handler)
    const ginMatch = line.match(/\b(r|router|g|engine|e)\.(GET|POST|PUT|DELETE|PATCH|OPTIONS)\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)/);
    if (ginMatch) {
      const handlerLine = findGoHandlerLine(lines, ginMatch[4]);
      const goSvcCalls = handlerLine >= 0 ? extractServiceCallsFromLines(lines, handlerLine, 30, 'go') : [];
      apis.push({
        path: ginMatch[3],
        method: ginMatch[2],
        handler: ginMatch[4],
        filePath: relPath,
        line: i + 1,
        serviceCalls: goSvcCalls.length > 0 ? goSvcCalls : undefined,
      });
    }

    // Echo 路由: e.GET("/path", handler) 或 group.GET(...)
    const echoMatch = line.match(/\b(\w+)\.(GET|POST|PUT|DELETE|PATCH|OPTIONS)\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)/);
    if (echoMatch && !ginMatch) {
      const handlerLine = findGoHandlerLine(lines, echoMatch[4]);
      const goSvcCalls = handlerLine >= 0 ? extractServiceCallsFromLines(lines, handlerLine, 30, 'go') : [];
      apis.push({
        path: echoMatch[3],
        method: echoMatch[2],
        handler: echoMatch[4],
        filePath: relPath,
        line: i + 1,
        serviceCalls: goSvcCalls.length > 0 ? goSvcCalls : undefined,
      });
    }

    // Go struct Entity（带 gorm 标签）
    const structMatch = line.match(/type\s+(\w+)\s+struct\s*\{/);
    if (structMatch) {
      const structName = structMatch[1];
      const entity = extractGoEntity(structName, content, relPath, i + 1, i);
      if (entity) entities.push(entity);
    }
  }

  const dtos = extractDtosFromGoFile(content, relPath);        // v8.3.126+
  const services = extractServicesFromGoFile(content, relPath); // v8.3.126+

  return { apis, entities, routes, components, dtos, services };
}

function extractGoEntity(
  structName: string,
  content: string,
  relPath: string,
  structLine: number,
  startIdx: number
): EntityDefinition | null {
  const lines = content.split('\n');
  const fields: EntityField[] = [];
  let inStruct = false;
  let braceDepth = 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!inStruct) {
      if (line.includes('{')) inStruct = true;
      continue;
    }
    braceDepth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (braceDepth < 0) break;

    const trimmed = line.trim();
    // 字段: Name Type `gorm:"..." json:"..."`
    const fieldMatch = trimmed.match(/^(\w+)\s+(\S+(?:\[[^\]]+\])?)\s*(?:`([^`]+)`)?/);
    if (fieldMatch && !trimmed.startsWith('//')) {
      const fieldName = fieldMatch[1];
      const fieldType = fieldMatch[2];
      const tagStr = fieldMatch[3] || '';
      let isPrimary = false;
      let isNullable = true;
      let defaultValue: string | undefined;
      const colOpts: Record<string, any> = {};

      // 解析 gorm 标签
      const gormMatch = tagStr.match(/gorm:"([^"]+)"/);
      if (gormMatch) {
        const gormOpts = gormMatch[1];
        if (/primaryKey/.test(gormOpts)) isPrimary = true;
        if (/autoIncrement/.test(gormOpts)) colOpts.autoIncrement = true;
        if (/default:/.test(gormOpts)) {
          const defMatch = gormOpts.match(/default:([^;]+)/);
          if (defMatch) defaultValue = defMatch[1];
        }
        if (/size:/.test(gormOpts)) {
          const sizeMatch = gormOpts.match(/size:(\d+)/);
          if (sizeMatch) colOpts.size = parseInt(sizeMatch[1]);
        }
        if (/type:/.test(gormOpts)) {
          const typeMatch = gormOpts.match(/type:([^;]+)/);
          if (typeMatch) colOpts.type = typeMatch[1];
        }
      }

      // 解析 json 标签判断 omitempty
      const jsonMatch = tagStr.match(/json:"([^"]+)"/);
      if (jsonMatch && jsonMatch[1].includes('omitempty')) {
        isNullable = true;
      }

      fields.push({
        name: fieldName,
        type: fieldType,
        nullable: isNullable,
        isPrimaryKey: isPrimary,
        defaultValue,
        columnOptions: Object.keys(colOpts).length > 0 ? colOpts : undefined,
      });
    }
  }

  if (fields.length === 0) return null;
  return { name: structName, filePath: relPath, line: structLine, fields };
}

/** v8.3.125+: 在 Go 文件中查找 handler 函数定义行 */
function findGoHandlerLine(lines: string[], handlerName: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`func\\s+(?:\\([^)]+\\)\\s+)?${handlerName}\\s*\\(`).test(lines[i])) {
      return i;
    }
  }
  return -1;
}

/** v8.3.125+: 通用 Service 调用提取（从代码行数组） */
function extractServiceCallsFromLines(lines: string[], startIdx: number, maxLines: number, lang: string): ServiceCall[] {
  const calls: ServiceCall[] = [];
  const seen = new Set<string>();
  const endIdx = Math.min(startIdx + maxLines, lines.length);

  for (let i = startIdx; i < endIdx; i++) {
    const line = lines[i].trim();
    if (line.startsWith('//') || line.startsWith('#') || line.startsWith('*')) continue;

    let matches: RegExpMatchArray[] = [];

    if (lang === 'java') {
      // this.userService.findById(...) 或 userService.create(...)
      const regex = /(\w+)\.(\w+)\s*\(/g;
      let m;
      while ((m = regex.exec(line)) !== null) {
        if (!/^(if|while|for|switch|return|new|assert|System|Math|String|Integer|Long|Boolean|Object|Arrays|Collections|Stream|Optional|logger|log)\b/.test(m[1])) {
          matches.push(m);
        }
      }
    } else if (lang === 'python') {
      // self.user_service.find_by_id(...) 或 user_service.create(...)
      const regex = /(\w+)\.(\w+)\s*\(/g;
      let m;
      while ((m = regex.exec(line)) !== null) {
        if (!/^(if|while|for|return|print|len|range|enumerate|zip|map|filter|super|self).__/.test(m[1] + '.' + m[2])) {
          matches.push(m);
        }
      }
    } else if (lang === 'go') {
      // svc.FindById(...) 或 service.Create(...)
      const regex = /(\w+)\.(\w+)\s*\(/g;
      let m;
      while ((m = regex.exec(line)) !== null) {
        if (!/^(if|for|switch|return|defer|go|make|new|append|copy|len|cap|panic|recover|print|println|fmt|log|strings|strconv|time|errors)\b/.test(m[1])) {
          matches.push(m);
        }
      }
    }

    for (const m of matches) {
      const key = `${m[1]}.${m[2]}`;
      if (!seen.has(key)) {
        seen.add(key);
        calls.push({ service: m[1], method: m[2], line: i + 1 });
      }
    }
  }

  return calls;
}

// ═══════════════════════════════════════════════════════════
// v8.3.126+: DTO / Service 独立提取器
// ═══════════════════════════════════════════════════════════

/** 从 TypeScript 文件提取 DTO 定义（class/interface + class-validator 装饰器） */
function extractDtosFromTsFile(filePath: string, sourceFile: ts.SourceFile, relPath: string): DtoDefinition[] {
  const dtos: DtoDefinition[] = [];

  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      const className = node.name?.getText(sourceFile);
      if (!className) return;

      // DTO 检测：类名含 DTO/Vo/Input/Output/Query/Command/Request/Response
      // 或包含 class-validator 装饰器
      const isDtoLike = /(Dto|VO|Input|Output|Query|Command|Request|Response|Create|Update|Delete|Filter|Search|Sort)$/i.test(className);

      const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
      const hasValidator = node.members.some(m => {
        const memberDecs = ts.canHaveDecorators(m) ? ts.getDecorators(m) : undefined;
        return memberDecs?.some(d => /^@(Is|String|Min|Max|Length|Email|UUID|URL|Enum|Array|Optional|Validate|Matches|Not)/.test(d.getText(sourceFile)));
      });

      if (!isDtoLike && !hasValidator) return;

      const fields: DtoField[] = [];
      for (const member of node.members) {
        if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
          const fieldName = member.name.getText(sourceFile);
          const fieldType = member.type?.getText(sourceFile) || 'unknown';
          const isOptional = member.questionToken !== undefined;

          const fieldDecs = ts.canHaveDecorators(member) ? ts.getDecorators(member) : undefined;
          const validations: string[] = [];
          const decorators: string[] = [];

          if (fieldDecs) {
            for (const d of fieldDecs) {
              const dt = d.getText(sourceFile);
              decorators.push(dt.slice(0, 80));
              if (/^@(Is|String|Min|Max|Length|Email|UUID|URL|Enum|Array|Optional|Validate|Matches|Not)/.test(dt)) {
                validations.push(dt.slice(0, 60));
              }
            }
          }

          fields.push({
            name: fieldName,
            type: fieldType,
            required: !isOptional,
            decorators: decorators.length > 0 ? decorators : undefined,
            validationRules: validations.length > 0 ? validations : undefined,
            description: getJSDoc(member, sourceFile),
          });
        }
      }

      if (fields.length > 0) {
        dtos.push({
          name: className,
          filePath: relPath,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          fields,
          description: getJSDoc(node, sourceFile),
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return dtos;
}

/** 从 TypeScript 文件提取 Service 定义 */
function extractServicesFromTsFile(filePath: string, sourceFile: ts.SourceFile, relPath: string): ServiceDefinition[] {
  const services: ServiceDefinition[] = [];

  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node)) {
      const className = node.name?.getText(sourceFile);
      if (!className) return;

      // Service 检测：类名含 Service/Provider/Repository/Manager/Handler
      const isServiceLike = /(Service|Provider|Repository|Manager|Handler|Facade|Gateway)$/i.test(className);
      const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
      const hasInjectable = decorators?.some(d => /^@(Injectable|Service|Repository|Component)/.test(d.getText(sourceFile)));

      if (!isServiceLike && !hasInjectable) return;

      const methods: ServiceMethod[] = [];
      const injects: string[] = [];

      for (const member of node.members) {
        // 构造函数注入提取
        if (ts.isConstructorDeclaration(member)) {
          for (const param of member.parameters) {
            const paramType = param.type?.getText(sourceFile);
            if (paramType && /(Service|Repository|Manager|Provider|Client|Dao|Gateway)/i.test(paramType)) {
              injects.push(paramType);
            }
          }
        }

        // 方法提取
        if (ts.isMethodDeclaration(member)) {
          const methodName = member.name.getText(sourceFile);
          // 跳过私有方法和生命周期方法
          if (methodName.startsWith('_') || /^(constructor|onModuleInit|onModuleDestroy|onApplicationBootstrap|beforeApplicationShutdown)$/.test(methodName)) continue;

          const returnType = member.type?.getText(sourceFile);
          const params = member.parameters.map(p => ({
            name: p.name.getText(sourceFile),
            type: p.type?.getText(sourceFile),
          }));

          const methodDecs = ts.canHaveDecorators(member) ? ts.getDecorators(member) : undefined;
          const decorators = methodDecs?.map(d => d.getText(sourceFile).slice(0, 50)) || [];

          methods.push({
            name: methodName,
            returnType,
            parameters: params,
            decorators: decorators.length > 0 ? decorators : undefined,
            description: getJSDoc(member, sourceFile),
            line: sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1,
          });
        }
      }

      if (methods.length > 0) {
        services.push({
          name: className,
          filePath: relPath,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          methods,
          description: getJSDoc(node, sourceFile),
          injects: injects.length > 0 ? injects : undefined,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return services;
}

// ── Java DTO / Service 提取 ──

function extractDtosFromJavaFile(content: string, relPath: string): DtoDefinition[] {
  const dtos: DtoDefinition[] = [];
  const lines = content.split('\n');
  let currentClass: string | null = null;
  let classLine = 0;
  let classAnnotations: string[] = [];
  let inClass = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^@\w+/.test(line)) { classAnnotations.push(line); continue; }

    const classMatch = line.match(/(?:public\s+)?class\s+(\w+)/);
    if (classMatch) {
      currentClass = classMatch[1];
      classLine = i + 1;
      inClass = true;
      braceDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

      const isDtoLike = /(DTO|VO|Request|Response|Input|Output|Query|Command|Form|Param)/i.test(currentClass);
      if (!isDtoLike) { currentClass = null; inClass = false; classAnnotations = []; continue; }

      classAnnotations = [];
      continue;
    }

    if (inClass && currentClass) {
      braceDepth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (braceDepth <= 0) {
        inClass = false; currentClass = null; continue;
      }

      const fieldMatch = line.match(/(?:private\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*;/);
      if (fieldMatch) {
        const fieldType = fieldMatch[1];
        const fieldName = fieldMatch[2];
        let required = true;
        const validations: string[] = [];
        const decorators: string[] = [];

        for (let j = Math.max(0, i - 3); j < i; j++) {
          const al = lines[j].trim();
          if (/^@\w+/.test(al)) {
            decorators.push(al.slice(0, 80));
            if (/@(NotNull|NotBlank|NotEmpty|Valid)/.test(al)) validations.push(al.slice(0, 60));
            if (/@(Nullable|Optional)/.test(al)) required = false;
          }
        }

        // 查找对应的 getter 是否有 @NotNull
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          if (lines[j].includes(`get${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}()`)) {
            for (let k = Math.max(0, j - 3); k < j; k++) {
              if (/^@\w+/.test(lines[k].trim())) {
                decorators.push(lines[k].trim().slice(0, 80));
              }
            }
            break;
          }
        }

        // 如果已经有这个 DTO，追加字段
        const existing = dtos.find(d => d.name === currentClass);
        if (existing) {
          existing.fields.push({ name: fieldName, type: fieldType, required, decorators: decorators.length > 0 ? decorators : undefined, validationRules: validations.length > 0 ? validations : undefined });
        } else {
          dtos.push({
            name: currentClass!,
            filePath: relPath,
            line: classLine,
            fields: [{ name: fieldName, type: fieldType, required, decorators: decorators.length > 0 ? decorators : undefined, validationRules: validations.length > 0 ? validations : undefined }],
          });
        }
      }
    }
  }

  return dtos.filter(d => d.fields.length > 0);
}

function extractServicesFromJavaFile(content: string, relPath: string): ServiceDefinition[] {
  const services: ServiceDefinition[] = [];
  const lines = content.split('\n');
  let currentClass: string | null = null;
  let classLine = 0;
  let inClass = false;
  let braceDepth = 0;
  let injects: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const classMatch = line.match(/(?:public\s+)?class\s+(\w+)/);
    if (classMatch) {
      currentClass = classMatch[1];
      classLine = i + 1;
      inClass = true;
      braceDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      injects = [];

      const isServiceLike = /(Service|Repository|Manager|Provider|Handler|Facade|Gateway|Impl)/i.test(currentClass);
      if (!isServiceLike) { currentClass = null; inClass = false; continue; }
      continue;
    }

    if (inClass && currentClass) {
      braceDepth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (braceDepth <= 0) {
        if (injects.length > 0 || services.find(s => s.name === currentClass)?.methods.length) {
          const svc = services.find(s => s.name === currentClass);
          if (svc) svc.injects = injects.length > 0 ? injects : undefined;
        }
        inClass = false; currentClass = null; injects = []; continue;
      }

      // 构造函数注入
      const ctorMatch = line.match(/public\s+\w+\s*\(([^)]*)\)/);
      if (ctorMatch) {
        const paramStr = ctorMatch[1];
        const parts = paramStr.split(',');
        for (const p of parts) {
          const pm = p.trim().match(/(\w+(?:<[^>]+>)?)\s+(\w+)/);
          if (pm && /(Service|Repository|Manager|Provider|Client|Dao|Gateway)/i.test(pm[1])) {
            injects.push(pm[1]);
          }
        }
      }

      // 方法提取
      const methodMatch = line.match(/(?:public|protected)\s+(?:\w+(?:<[^>]+>)?\s+)?(\w+)\s*\(([^)]*)\)/);
      if (methodMatch && !/^(if|while|for|switch|return|class|interface|enum)/.test(methodMatch[1])) {
        const methodName = methodMatch[1];
        const params: { name: string; type?: string }[] = [];
        const paramStr = methodMatch[2];
        if (paramStr) {
          const parts = paramStr.split(',');
          for (const p of parts) {
            const pm = p.trim().match(/(?:@\w+(?:\([^)]*\))?\s+)*(\w+(?:<[^>]+>)?)\s+(\w+)/);
            if (pm) params.push({ name: pm[2], type: pm[1] });
          }
        }

        const existing = services.find(s => s.name === currentClass);
        if (existing) {
          existing.methods.push({ name: methodName, parameters: params, line: i + 1 });
        } else {
          services.push({
            name: currentClass!,
            filePath: relPath,
            line: classLine,
            methods: [{ name: methodName, parameters: params, line: i + 1 }],
            injects: injects.length > 0 ? injects : undefined,
          });
        }
      }
    }
  }

  return services.filter(s => s.methods.length > 0);
}

// ── Python DTO / Service 提取 ──

function extractDtosFromPythonFile(content: string, relPath: string): DtoDefinition[] {
  const dtos: DtoDefinition[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const classMatch = line.match(/class\s+(\w+)\s*\(([^)]*)\)/);
    if (classMatch) {
      const className = classMatch[1];
      const bases = classMatch[2];
      const isDtoLike = /(BaseModel|Schema|Dto|Input|Output|Request|Response|Form)/i.test(bases);
      if (!isDtoLike) continue;

      const fields: DtoField[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() && !l.startsWith(' ') && !l.startsWith('\t') && !l.startsWith('#')) break;

        const fieldMatch = l.match(/^\s+(\w+)\s*:\s*(\w+(?:\[[^\]]+\])?)\s*(?:=\s*(.+))?/);
        if (fieldMatch) {
          const fieldName = fieldMatch[1];
          const fieldType = fieldMatch[2];
          const defaultExpr = fieldMatch[3];
          let required = true;
          const validations: string[] = [];

          if (defaultExpr) {
            if (/Field\s*\(/.test(defaultExpr)) {
              if (/default\s*=/.test(defaultExpr)) required = false;
            } else if (defaultExpr.trim() !== '...') {
              required = false;
            }
          }

          fields.push({ name: fieldName, type: fieldType, required, validationRules: validations.length > 0 ? validations : undefined });
        }
      }

      if (fields.length > 0) {
        dtos.push({ name: className, filePath: relPath, line: i + 1, fields });
      }
    }
  }

  return dtos;
}

function extractServicesFromPythonFile(content: string, relPath: string): ServiceDefinition[] {
  const services: ServiceDefinition[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const classMatch = line.match(/class\s+(\w+)\s*\(/);
    if (classMatch) {
      const className = classMatch[1];
      const isServiceLike = /(Service|Repository|Manager|Provider|Handler|Facade|Gateway)/i.test(className);
      if (!isServiceLike) continue;

      const methods: ServiceMethod[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() && !l.startsWith(' ') && !l.startsWith('\t') && !l.startsWith('#')) break;

        const methodMatch = l.match(/def\s+(\w+)\s*\(([^)]*)\)/);
        if (methodMatch) {
          const methodName = methodMatch[1];
          if (methodName.startsWith('_')) continue;
          const params: { name: string; type?: string }[] = [];
          const paramStr = methodMatch[2];
          if (paramStr) {
            const parts = paramStr.split(',');
            for (const p of parts) {
              const pt = p.trim();
              if (!pt || pt === 'self' || pt === 'cls') continue;
              const pm = pt.match(/(\w+)\s*:\s*(.+)/);
              if (pm) params.push({ name: pm[1], type: pm[2] });
              else { const sm = pt.match(/(\w+)/); if (sm) params.push({ name: sm[1] }); }
            }
          }
          methods.push({ name: methodName, parameters: params, line: j + 1 });
        }
      }

      if (methods.length > 0) {
        services.push({ name: className, filePath: relPath, line: i + 1, methods });
      }
    }
  }

  return services;
}

// ── Go DTO / Service 提取 ──

function extractDtosFromGoFile(content: string, relPath: string): DtoDefinition[] {
  const dtos: DtoDefinition[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const structMatch = line.match(/type\s+(\w+)\s+struct\s*\{/);
    if (structMatch) {
      const structName = structMatch[1];
      const isDtoLike = /(DTO|VO|Request|Response|Input|Output|Query|Command|Form|Param)/i.test(structName);
      if (!isDtoLike) continue;

      const fields: DtoField[] = [];
      let inStruct = false;
      let braceDepth = 0;

      for (let j = i; j < lines.length; j++) {
        const l = lines[j];
        if (!inStruct) { if (l.includes('{')) inStruct = true; continue; }
        braceDepth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
        if (braceDepth < 0) break;

        const trimmed = l.trim();
        const fieldMatch = trimmed.match(/^(\w+)\s+(\S+(?:\[[^\]]+\])?)\s*(?:`([^`]+)`)?/);
        if (fieldMatch && !trimmed.startsWith('//')) {
          const fieldName = fieldMatch[1];
          const fieldType = fieldMatch[2];
          const tagStr = fieldMatch[3] || '';
          let required = true;

          const jsonMatch = tagStr.match(/json:"([^"]+)"/);
          if (jsonMatch && jsonMatch[1].includes('omitempty')) required = false;
          if (jsonMatch && jsonMatch[1].startsWith('-')) continue; // 跳过不序列化的字段

          const validateMatch = tagStr.match(/validate:"([^"]+)"/);
          const validations = validateMatch ? validateMatch[1].split(',').map(s => s.trim()) : [];

          fields.push({ name: fieldName, type: fieldType, required, validationRules: validations.length > 0 ? validations : undefined });
        }
      }

      if (fields.length > 0) {
        dtos.push({ name: structName, filePath: relPath, line: i + 1, fields });
      }
    }
  }

  return dtos;
}

function extractServicesFromGoFile(content: string, relPath: string): ServiceDefinition[] {
  const services: ServiceDefinition[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const structMatch = line.match(/type\s+(\w+)\s+struct\s*\{/);
    if (structMatch) {
      const structName = structMatch[1];
      const isServiceLike = /(Service|Repository|Manager|Provider|Handler|Facade|Gateway|Impl)/i.test(structName);
      if (!isServiceLike) continue;

      const methods: ServiceMethod[] = [];
      for (let j = 0; j < lines.length; j++) {
        const l = lines[j];
        const methodMatch = l.match(/func\s+\(\s*\w+\s*\*?\s*\)?\s*\)?\s*(\w+)\s*\(([^)]*)\)/);
        if (methodMatch) {
          const methodName = methodMatch[1];
          if (methodName.startsWith('_')) continue;
          const params: { name: string; type?: string }[] = [];
          const paramStr = methodMatch[2];
          if (paramStr) {
            const parts = paramStr.split(',');
            for (const p of parts) {
              const pt = p.trim();
              if (!pt) continue;
              const pm = pt.match(/(\w+)\s+(\S+)/);
              if (pm) params.push({ name: pm[1], type: pm[2] });
            }
          }
          methods.push({ name: methodName, parameters: params, line: j + 1 });
        }
      }

      if (methods.length > 0) {
        services.push({ name: structName, filePath: relPath, line: i + 1, methods });
      }
    }
  }

  return services;
}
