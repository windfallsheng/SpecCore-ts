/**
 * Code Knowledge Graph — 类型定义
 * v6.90.0: 本地 AST 解析构建代码知识图谱
 */

export type NodeType =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'module'
  | 'method'
  | 'property'
  | 'enum'
  // v6.91.0+: 多模态节点
  | 'api_endpoint'
  | 'db_table';

export type EdgeType =
  | 'calls'
  | 'imports'
  | 'exports'
  | 'extends'
  | 'implements'
  | 'references'
  | 'contains'
  | 'typed_by';

export type Confidence = 'EXTRACTED' | 'INFERRED';

export interface CodeNode {
  id: string;
  name: string;
  type: NodeType;
  filePath: string;
  line: number;
  column: number;
  community?: number;
  degree?: number;
  /** 代码片段（前200字符） */
  snippet?: string;
}

export interface CodeEdge {
  source: string;
  target: string;
  type: EdgeType;
  confidence: Confidence;
  /** 关系发生的文件 */
  filePath?: string;
  /** 行号 */
  line?: number;
}

export interface CodeCommunity {
  id: number;
  /** 社区标签（通常是目录名或高频概念） */
  label: string;
  nodes: string[];
  /** 内部边数 / 总边数 */
  density: number;
}

export interface CodeGraph {
  nodes: CodeNode[];
  edges: CodeEdge[];
  communities: CodeCommunity[];
  /** 高度数节点（连接数前10%） */
  godNodes: string[];
  metadata: {
    projectName: string;
    projectRoot: string;
    scannedFiles: number;
    totalNodes: number;
    totalEdges: number;
    extractedEdges: number;
    inferredEdges: number;
    generatedAt: string;
  };
}

export interface GraphQueryResult {
  nodes: CodeNode[];
  edges: CodeEdge[];
  path?: string[];
}
