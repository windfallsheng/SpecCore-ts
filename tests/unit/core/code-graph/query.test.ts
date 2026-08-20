import { describe, it, expect } from 'vitest';
import { explainNode, findPath, queryGraph } from '../../../../src/core/code-graph/query';
import type { CodeGraph, CodeNode, CodeEdge } from '../../../../src/core/code-graph/types';

function makeGraph(nodes: CodeNode[], edges: CodeEdge[]): CodeGraph {
  return {
    nodes,
    edges,
    communities: [],
    godNodes: [],
    metadata: {
      projectName: 'Test',
      projectRoot: '/',
      scannedFiles: 1,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      extractedEdges: edges.filter(e => e.confidence === 'EXTRACTED').length,
      inferredEdges: edges.filter(e => e.confidence === 'INFERRED').length,
      generatedAt: new Date().toISOString(),
    },
  };
}

describe('explainNode', () => {
  it('should return related nodes and edges for a target node', () => {
    const nodes: CodeNode[] = [
      { id: 'a', name: 'Auth', type: 'class', filePath: 'src/auth.ts', line: 1, column: 1 },
      { id: 'b', name: 'UserDB', type: 'class', filePath: 'src/db.ts', line: 1, column: 1 },
      { id: 'c', name: 'Logger', type: 'class', filePath: 'src/log.ts', line: 1, column: 1 },
    ];
    const edges: CodeEdge[] = [
      { source: 'a', target: 'b', type: 'calls', confidence: 'EXTRACTED' },
      { source: 'c', target: 'b', type: 'calls', confidence: 'EXTRACTED' },
    ];
    const graph = makeGraph(nodes, edges);

    const result = explainNode(graph, 'Auth');

    expect(result.nodes.map(n => n.id)).toContain('a');
    expect(result.nodes.map(n => n.id)).toContain('b');
    expect(result.nodes.map(n => n.id)).not.toContain('c');
    expect(result.edges.length).toBe(1);
  });

  it('should find node by id as fallback', () => {
    const nodes: CodeNode[] = [
      { id: 'x', name: 'Foo', type: 'function', filePath: 'src/f.ts', line: 1, column: 1 },
    ];
    const graph = makeGraph(nodes, []);

    const result = explainNode(graph, 'x');

    expect(result.nodes.length).toBe(1);
  });

  it('should return empty result for non-existent node', () => {
    const graph = makeGraph([], []);

    const result = explainNode(graph, 'nonexistent');

    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});

describe('findPath', () => {
  it('should find shortest path between two nodes', () => {
    const nodes: CodeNode[] = [
      { id: 'a', name: 'A', type: 'function', filePath: 'src/a.ts', line: 1, column: 1 },
      { id: 'b', name: 'B', type: 'function', filePath: 'src/b.ts', line: 1, column: 1 },
      { id: 'c', name: 'C', type: 'function', filePath: 'src/c.ts', line: 1, column: 1 },
    ];
    const edges: CodeEdge[] = [
      { source: 'a', target: 'b', type: 'calls', confidence: 'EXTRACTED' },
      { source: 'b', target: 'c', type: 'calls', confidence: 'EXTRACTED' },
    ];
    const graph = makeGraph(nodes, edges);

    const result = findPath(graph, 'A', 'C');

    expect(result.path).toEqual(['a', 'b', 'c']);
    expect(result.nodes.length).toBe(3);
    expect(result.edges.length).toBe(2);
  });

  it('should return direct nodes when no path exists', () => {
    const nodes: CodeNode[] = [
      { id: 'a', name: 'A', type: 'function', filePath: 'src/a.ts', line: 1, column: 1 },
      { id: 'b', name: 'B', type: 'function', filePath: 'src/b.ts', line: 1, column: 1 },
    ];
    const graph = makeGraph(nodes, []);

    const result = findPath(graph, 'A', 'B');

    expect(result.nodes.length).toBe(2);
    expect(result.edges.length).toBe(0);
  });

  it('should return empty for non-existent start or end', () => {
    const graph = makeGraph([], []);

    const result = findPath(graph, 'A', 'B');

    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('should handle same start and end', () => {
    const nodes: CodeNode[] = [
      { id: 'a', name: 'A', type: 'function', filePath: 'src/a.ts', line: 1, column: 1 },
    ];
    const graph = makeGraph(nodes, []);

    const result = findPath(graph, 'A', 'A');

    expect(result.path).toEqual(['a']);
  });
});

describe('queryGraph', () => {
  it('should match nodes by name with higher score', () => {
    const nodes: CodeNode[] = [
      { id: 'a', name: 'AuthService', type: 'class', filePath: 'src/auth.ts', line: 1, column: 1 },
      { id: 'b', name: 'UserService', type: 'class', filePath: 'src/user.ts', line: 1, column: 1 },
      { id: 'c', name: 'PaymentGateway', type: 'class', filePath: 'src/pay.ts', line: 1, column: 1 },
    ];
    const graph = makeGraph(nodes, []);

    const result = queryGraph(graph, 'auth service');

    expect(result.nodes.map(n => n.id)).toContain('a');
  });

  it('should include first-order neighbors', () => {
    const nodes: CodeNode[] = [
      { id: 'a', name: 'Auth', type: 'function', filePath: 'src/auth.ts', line: 1, column: 1 },
      { id: 'b', name: 'UserDB', type: 'function', filePath: 'src/db.ts', line: 1, column: 1 },
    ];
    const edges: CodeEdge[] = [
      { source: 'a', target: 'b', type: 'calls', confidence: 'EXTRACTED' },
    ];
    const graph = makeGraph(nodes, edges);

    const result = queryGraph(graph, 'auth');

    expect(result.nodes.map(n => n.id)).toContain('a');
    expect(result.nodes.map(n => n.id)).toContain('b');
    expect(result.edges.length).toBe(1);
  });

  it('should return empty for no match', () => {
    const nodes: CodeNode[] = [
      { id: 'a', name: 'Foo', type: 'function', filePath: 'src/f.ts', line: 1, column: 1 },
    ];
    const graph = makeGraph(nodes, []);

    const result = queryGraph(graph, 'xyz123');

    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('should handle empty question', () => {
    const graph = makeGraph([], []);

    const result = queryGraph(graph, '');

    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});
