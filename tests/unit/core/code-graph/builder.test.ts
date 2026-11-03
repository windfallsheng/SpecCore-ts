import { describe, it, expect } from 'vitest';
import { buildCodeGraph } from '../../../../src/core/code-graph/builder';
import type { CodeNode, CodeEdge } from '../../../../src/core/code-graph/types';

function makeNode(id: string, name: string, type: CodeNode['type'], filePath: string): CodeNode {
  return { id, name, type, filePath, line: 1, column: 1 };
}

function makeEdge(source: string, target: string, type: CodeEdge['type'], confidence: CodeEdge['confidence']): CodeEdge {
  return { source, target, type, confidence };
}

describe('buildCodeGraph', () => {
  it('should build a graph with correct metadata', () => {
    const nodes = [
      makeNode('a', 'AuthService', 'class', 'src/auth.ts'),
      makeNode('b', 'UserDB', 'class', 'src/db.ts'),
    ];
    const edges = [makeEdge('a', 'b', 'calls', 'EXTRACTED')];

    const graph = buildCodeGraph(nodes, edges, 'TestProject', '/test', 10);

    expect(graph.metadata.projectName).toBe('TestProject');
    expect(graph.metadata.totalNodes).toBe(2);
    expect(graph.metadata.totalEdges).toBe(1);
    expect(graph.metadata.extractedEdges).toBe(1);
    expect(graph.metadata.inferredEdges).toBe(0);
    expect(graph.metadata.scannedFiles).toBe(10);
  });

  it('should compute degrees correctly', () => {
    const nodes = [
      makeNode('a', 'A', 'function', 'src/a.ts'),
      makeNode('b', 'B', 'function', 'src/b.ts'),
      makeNode('c', 'C', 'function', 'src/c.ts'),
    ];
    const edges = [
      makeEdge('a', 'b', 'calls', 'EXTRACTED'),
      makeEdge('a', 'c', 'calls', 'EXTRACTED'),
      makeEdge('b', 'c', 'calls', 'EXTRACTED'),
    ];

    const graph = buildCodeGraph(nodes, edges, 'P', '/', 3);

    expect(graph.nodes.find(n => n.id === 'a')?.degree).toBe(2);
    expect(graph.nodes.find(n => n.id === 'b')?.degree).toBe(2);
    expect(graph.nodes.find(n => n.id === 'c')?.degree).toBe(2);
  });

  it('should identify god nodes (top 10% by degree)', () => {
    const nodes = Array.from({ length: 20 }, (_, i) =>
      makeNode(`n${i}`, `Node${i}`, 'function', `src/f${i}.ts`)
    );
    // n0 connects to everyone (hub)
    const edges: CodeEdge[] = [];
    for (let i = 1; i < 20; i++) {
      edges.push(makeEdge('n0', `n${i}`, 'calls', 'EXTRACTED'));
    }

    const graph = buildCodeGraph(nodes, edges, 'P', '/', 20);

    expect(graph.godNodes).toContain('n0');
    expect(graph.godNodes.length).toBe(2); // 10% of 20 = 2
  });

  it('should fix bare names to ids when cross-file references exist', () => {
    const nodes = [
      makeNode('src/a.ts::foo', 'foo', 'function', 'src/a.ts'),
      makeNode('src/b.ts::bar', 'bar', 'function', 'src/b.ts'),
    ];
    // Edge uses bare name 'foo' instead of full id
    const edges = [makeEdge('foo', 'src/b.ts::bar', 'calls', 'EXTRACTED')];

    const graph = buildCodeGraph(nodes, edges, 'P', '/', 2);

    expect(graph.edges[0].source).toBe('src/a.ts::foo');
  });

  it('should detect communities by directory hierarchy (v8.3.358)', () => {
    const nodes = [
      makeNode('a1', 'A1', 'function', 'src/core/a.ts'),
      makeNode('a2', 'A2', 'function', 'src/core/b.ts'),
      makeNode('b1', 'B1', 'function', 'src/utils/c.ts'),
      makeNode('b2', 'B2', 'function', 'src/utils/d.ts'),
    ];
    // 二段目录前缀 = 社区边界（src/core vs src/utils）
    const edges = [
      makeEdge('a1', 'a2', 'calls', 'EXTRACTED'),
      makeEdge('b1', 'b2', 'calls', 'EXTRACTED'),
    ];

    const graph = buildCodeGraph(nodes, edges, 'P', '/', 4);

    expect(graph.communities.length).toBe(2);
    expect(graph.nodes.find(n => n.id === 'a1')?.community).toBeDefined();
    expect(graph.nodes.find(n => n.id === 'b1')?.community).toBeDefined();
    expect(graph.nodes.find(n => n.id === 'a1')?.community)
      .not.toBe(graph.nodes.find(n => n.id === 'b1')?.community);
  });

  it('should keep cross-dir edge endpoints in separate communities (v8.3.358)', () => {
    const nodes = [
      makeNode('a1', 'A1', 'function', 'src/core/a.ts'),
      makeNode('b1', 'B1', 'function', 'src/utils/b.ts'),
      makeNode('c1', 'C1', 'function', 'src/core/c.ts'), // 无边孤立节点也应有社区
    ];
    // 跨目录引用 = 桥接边（连通分量算法下两端会被合并，目录社区下保持分属两社区）
    const edges = [makeEdge('a1', 'b1', 'imports', 'EXTRACTED')];

    const graph = buildCodeGraph(nodes, edges, 'P', '/', 3);

    expect(graph.communities.length).toBe(2); // src/core 与 src/utils
    const a1 = graph.nodes.find(n => n.id === 'a1');
    const b1 = graph.nodes.find(n => n.id === 'b1');
    const c1 = graph.nodes.find(n => n.id === 'c1');
    expect(a1?.community).toBeDefined();
    expect(b1?.community).toBeDefined();
    expect(a1?.community).not.toBe(b1?.community);
    expect(c1?.community).toBe(a1?.community); // 孤立节点按目录归队
  });

  it('should split oversized communities by deeper directory (v8.3.358)', () => {
    // src/core 下两个子目录各 300 节点 → 超阈值按三段目录细分
    const nodes = [
      makeNode('root', 'R', 'function', 'src/core/root.ts'),
      ...Array.from({ length: 300 }, (_, i) =>
        makeNode(`a${i}`, `A${i}`, 'function', `src/core/alpha/f${i}.ts`)
      ),
      ...Array.from({ length: 300 }, (_, i) =>
        makeNode(`b${i}`, `B${i}`, 'function', `src/core/beta/f${i}.ts`)
      ),
    ];

    const graph = buildCodeGraph(nodes, [], 'P', '/', nodes.length);

    expect(graph.communities.length).toBe(3); // src/core（root）与 src/core/alpha、src/core/beta
    const alpha = graph.nodes.find(n => n.id === 'a0');
    const beta = graph.nodes.find(n => n.id === 'b0');
    expect(alpha?.community).toBeDefined();
    expect(beta?.community).toBeDefined();
    expect(alpha?.community).not.toBe(beta?.community);
    const alphaComm = graph.communities.find(c => c.nodes.includes('a0'));
    expect(alphaComm?.label).toBe('src/core/alpha');
    expect(alphaComm?.nodes.length).toBe(300);
  });

  it('should fall back to per-file grouping when no deeper dir exists (v8.3.358)', () => {
    // src/core 下两个直接文件各 300 节点 → 无更深目录可细分，按文件分组
    const nodes = [
      ...Array.from({ length: 300 }, (_, i) =>
        makeNode(`a${i}`, `A${i}`, 'function', 'src/core/alpha.ts')
      ),
      ...Array.from({ length: 300 }, (_, i) =>
        makeNode(`b${i}`, `B${i}`, 'function', 'src/core/beta.ts')
      ),
    ];

    const graph = buildCodeGraph(nodes, [], 'P', '/', nodes.length);

    expect(graph.communities.length).toBe(2); // 两个文件各成一个社区
    const a0 = graph.nodes.find(n => n.id === 'a0');
    const b0 = graph.nodes.find(n => n.id === 'b0');
    expect(a0?.community).toBeDefined();
    expect(b0?.community).toBeDefined();
    expect(a0?.community).not.toBe(b0?.community);
    const fileComm = graph.communities.find(c => c.nodes.includes('a0'));
    expect(fileComm?.label).toBe('src/core/alpha.ts');
    expect(fileComm?.nodes.length).toBe(300);
  });

  it('should handle empty graph', () => {
    const graph = buildCodeGraph([], [], 'Empty', '/', 0);

    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.communities).toEqual([]);
    expect(graph.godNodes).toEqual([]);
  });

  it('should handle isolated nodes (no edges)', () => {
    const nodes = [
      makeNode('a', 'A', 'function', 'src/a.ts'),
      makeNode('b', 'B', 'function', 'src/b.ts'),
    ];

    const graph = buildCodeGraph(nodes, [], 'P', '/', 2);

    expect(graph.nodes[0].degree).toBe(0);
    expect(graph.godNodes.length).toBe(1); // 10% of 2 = max(1, 0) = 1
  });
});
