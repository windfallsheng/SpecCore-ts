import { describe, it, expect } from 'vitest';
import { generateGraphReport } from '../../../../src/core/code-graph/reporter';
import type { CodeGraph } from '../../../../src/core/code-graph/types';

function makeGraph(): CodeGraph {
  return {
    nodes: [
      { id: 'a', name: 'AuthService', type: 'class', filePath: 'src/auth.ts', line: 1, column: 1, degree: 5 },
      { id: 'b', name: 'UserDB', type: 'class', filePath: 'src/db.ts', line: 1, column: 1, degree: 3 },
      { id: 'c', name: 'Logger', type: 'function', filePath: 'src/log.ts', line: 1, column: 1, degree: 1 },
    ],
    edges: [
      { source: 'a', target: 'b', type: 'calls', confidence: 'EXTRACTED' },
      { source: 'a', target: 'c', type: 'calls', confidence: 'INFERRED' },
    ],
    communities: [
      { id: 0, label: 'src', nodes: ['a', 'b'], density: 0.5 },
    ],
    godNodes: ['a'],
    metadata: {
      projectName: 'TestProject',
      projectRoot: '/test',
      scannedFiles: 3,
      totalNodes: 3,
      totalEdges: 2,
      extractedEdges: 1,
      inferredEdges: 1,
      generatedAt: '2026-08-20T00:00:00.000Z',
    },
  };
}

describe('generateGraphReport', () => {
  it('should include project name in header', () => {
    const report = generateGraphReport(makeGraph());
    expect(report).toContain('TestProject');
    expect(report).toContain('Code Knowledge Graph Report');
  });

  it('should include metadata summary', () => {
    const report = generateGraphReport(makeGraph());
    expect(report).toContain('3 files');
    expect(report).toContain('3 nodes');
    expect(report).toContain('2 edges');
    expect(report).toContain('1 EXTRACTED');
    expect(report).toContain('1 INFERRED');
  });

  it('should list god nodes', () => {
    const report = generateGraphReport(makeGraph());
    expect(report).toContain('God Nodes');
    expect(report).toContain('AuthService');
  });

  it('should list communities', () => {
    const report = generateGraphReport(makeGraph());
    expect(report).toContain('Communities');
    expect(report).toContain('src');
  });

  it('should handle graph with no cross-community bridges', () => {
    const report = generateGraphReport(makeGraph());
    expect(report).toContain('Cross-Community Bridges');
    expect(report).toContain('No significant cross-community bridges');
  });

  it('should include suggested questions', () => {
    const report = generateGraphReport(makeGraph());
    expect(report).toContain('Suggested Questions');
  });
});
