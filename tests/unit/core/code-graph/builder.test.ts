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

  it('should detect communities by directory + connectivity', () => {
    const nodes = [
      makeNode('a1', 'A1', 'function', 'src/core/a.ts'),
      makeNode('a2', 'A2', 'function', 'src/core/b.ts'),
      makeNode('b1', 'B1', 'function', 'src/utils/c.ts'),
      makeNode('b2', 'B2', 'function', 'src/utils/d.ts'),
    ];
    // Two disconnected clusters
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
