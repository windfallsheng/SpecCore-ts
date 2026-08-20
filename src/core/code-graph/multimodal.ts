/**
 * Code Knowledge Graph — 多模态解析器
 * v6.91.0: 将 API_CONTRACT + SQL Schema 纳入图谱
 */
import { join } from 'path';
import { readFile, pathExists } from 'fs-extra';
import { glob } from 'glob';
import * as yaml from 'js-yaml';
import type { CodeNode, CodeEdge } from './types';

// ── API Contract 解析 ──

interface ApiEndpoint {
  path: string;
  method: string;
  summary?: string;
  operationId?: string;
  tags?: string[];
}

/**
 * 扫描项目中的 API_CONTRACT.yaml / openapi.yaml
 */
export async function scanApiContracts(projectRoot: string): Promise<ApiEndpoint[]> {
  const results: ApiEndpoint[] = [];

  // 可能的文件位置
  const candidates = [
    join(projectRoot, '.speccore', 'API_CONTRACT.yaml'),
    join(projectRoot, '.speccore', 'api-contract.yaml'),
    join(projectRoot, 'API_CONTRACT.yaml'),
    join(projectRoot, 'openapi.yaml'),
    join(projectRoot, 'openapi.yml'),
  ];

  // 也扫描迭代目录
  const iterDirs = await glob(join(projectRoot, 'Iteration-*/_shared/API_CONTRACT.yaml'));
  candidates.push(...iterDirs);

  for (const filePath of candidates) {
    if (!(await pathExists(filePath))) continue;
    try {
      const content = await readFile(filePath, 'utf-8');
      const doc = yaml.load(content) as Record<string, unknown>;
      if (doc && typeof doc === 'object' && 'paths' in doc) {
        const paths = doc.paths as Record<string, Record<string, unknown>>;
        for (const [path, methods] of Object.entries(paths)) {
          for (const [method, spec] of Object.entries(methods)) {
            if (typeof spec !== 'object' || spec === null) continue;
            results.push({
              path,
              method: method.toUpperCase(),
              summary: (spec as Record<string, string>).summary,
              operationId: (spec as Record<string, string>).operationId,
              tags: (spec as Record<string, string[]>).tags,
            });
          }
        }
      }
    } catch {
      // 解析失败静默跳过
    }
  }

  return results;
}

/**
 * 将 API 端点转为图谱节点
 */
export function apiEndpointsToNodes(endpoints: ApiEndpoint[]): CodeNode[] {
  return endpoints.map((ep, i) => ({
    id: `api:${ep.method}:${ep.path}`,
    name: ep.operationId || `${ep.method} ${ep.path}`,
    type: 'api_endpoint',
    filePath: 'API_CONTRACT.yaml',
    line: i + 1,
    column: 1,
  }));
}

// ── SQL Schema 解析 ──

interface DbTable {
  name: string;
  columns: string[];
  sourceFile: string;
}

/**
 * 扫描项目中的 .sql 文件和 TypeORM entity 文件
 */
export async function scanSqlSchemas(projectRoot: string): Promise<DbTable[]> {
  const results: DbTable[] = [];

  // 1. 扫描 .sql 文件
  const sqlFiles = await glob(join(projectRoot, '**/*.sql'), {
    ignore: ['node_modules/**', 'dist/**', '.speccore/cache/**'],
  });

  for (const filePath of sqlFiles) {
    try {
      const content = await readFile(filePath, 'utf-8');
      const tables = parseSqlTables(content, filePath);
      results.push(...tables);
    } catch {
      // 跳过
    }
  }

  // 2. 从已解析的 TypeORM entity 中补充（由调用方提供）
  // 这里只处理 .sql 文件，TypeORM entity 在 parser.ts 中已识别为 class 节点

  return results;
}

/**
 * 简单正则解析 CREATE TABLE 语句
 */
function parseSqlTables(sql: string, sourceFile: string): DbTable[] {
  const tables: DbTable[] = [];
  // 匹配 CREATE TABLE `name` 或 CREATE TABLE name (
  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([^;]+)\)/gi;

  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(sql)) !== null) {
    const tableName = match[1];
    const body = match[2];
    // 提取列名（简单取每行第一个单词）
    const columns = body
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*'))
      .map(l => {
        const m = l.match(/[`"]?(\w+)[`"]?/);
        return m ? m[1] : '';
      })
      .filter(Boolean);

    tables.push({ name: tableName, columns, sourceFile });
  }

  return tables;
}

/**
 * 将数据库表转为图谱节点
 */
export function dbTablesToNodes(tables: DbTable[]): CodeNode[] {
  return tables.map((t, i) => ({
    id: `db:${t.name}`,
    name: t.name,
    type: 'db_table',
    filePath: t.sourceFile,
    line: i + 1,
    column: 1,
  }));
}

// ── 关联边构建 ──

/**
 * 将 API 端点与代码中的 handler/controller/service 关联
 * 策略：operationId / path 片段与函数/类名匹配
 */
export function linkApiToCode(
  apiNodes: CodeNode[],
  codeNodes: CodeNode[]
): CodeEdge[] {
  const edges: CodeEdge[] = [];

  for (const api of apiNodes) {
    const apiName = api.name.toLowerCase();
    const pathParts = apiName.split(/[\/\s_-]+/).filter(Boolean);

    for (const node of codeNodes) {
      if (node.type !== 'function' && node.type !== 'method' && node.type !== 'class') continue;

      const nodeName = node.name.toLowerCase();
      let matched = false;

      // 1. operationId 精确匹配
      if (apiName.replace(/\s+/g, '') === nodeName) {
        matched = true;
      }
      // 2. path 关键词匹配（如 /users/{id} → 匹配 handleUser、UserController）
      else if (pathParts.length > 1) {
        const matchCount = pathParts.filter(p => nodeName.includes(p)).length;
        if (matchCount >= Math.min(2, pathParts.length)) {
          matched = true;
        }
      }

      if (matched) {
        edges.push({
          source: api.id,
          target: node.id,
          type: 'references',
          confidence: 'INFERRED',
        });
      }
    }
  }

  return edges;
}

/**
 * 将数据库表与代码中的 repository/model/entity 关联
 * 策略：表名与类名/变量名匹配
 */
export function linkSchemaToCode(
  dbNodes: CodeNode[],
  codeNodes: CodeNode[]
): CodeEdge[] {
  const edges: CodeEdge[] = [];

  for (const db of dbNodes) {
    const tableName = db.name.toLowerCase();
    const camelTable = tableName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const pascalTable = camelTable.charAt(0).toUpperCase() + camelTable.slice(1);

    for (const node of codeNodes) {
      if (node.type !== 'class' && node.type !== 'interface' && node.type !== 'variable') continue;

      const nodeName = node.name.toLowerCase();
      const nodePascal = node.name;

      let matched = false;

      // 1. 表名精确匹配（忽略大小写）
      if (nodeName === tableName) {
        matched = true;
      }
      // 2. 驼峰/帕斯卡匹配（user → User、UserEntity）
      else if (nodePascal === pascalTable || nodePascal === pascalTable + 'Entity') {
        matched = true;
      }
      // 3. 包含关系（如 user_profile → UserProfileRepository）
      else if (nodePascal.toLowerCase().includes(tableName) || tableName.includes(nodeName)) {
        matched = true;
      }

      if (matched) {
        edges.push({
          source: db.id,
          target: node.id,
          type: 'references',
          confidence: 'INFERRED',
        });
      }
    }
  }

  return edges;
}

// ── 统一入口 ──

export interface MultimodalResult {
  nodes: CodeNode[];
  edges: CodeEdge[];
}

/**
 * 扫描并解析项目中的 API Contract 和 SQL Schema，返回图谱节点和边
 */
export async function extractMultimodalNodes(
  projectRoot: string,
  codeNodes: CodeNode[]
): Promise<MultimodalResult> {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];

  // 1. API Contract
  const apiEndpoints = await scanApiContracts(projectRoot);
  if (apiEndpoints.length > 0) {
    const apiNodes = apiEndpointsToNodes(apiEndpoints);
    nodes.push(...apiNodes);
    edges.push(...linkApiToCode(apiNodes, codeNodes));
  }

  // 2. SQL Schema
  const dbTables = await scanSqlSchemas(projectRoot);
  if (dbTables.length > 0) {
    const dbNodes = dbTablesToNodes(dbTables);
    nodes.push(...dbNodes);
    edges.push(...linkSchemaToCode(dbNodes, codeNodes));
  }

  return { nodes, edges };
}
