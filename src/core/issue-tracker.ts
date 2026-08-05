/**
 * issue-tracker — 任务执行过程中记录问题和错误
 * 写入任务目录下的 ISSUES.md，retro 时自动汇总
 */
import { join } from 'path';
import { pathExists, readFile, writeFile, ensureDir } from 'fs-extra';

export interface IssueEntry {
  time: string;
  type: 'error' | 'requirement' | 'technical' | 'other';
  severity: 'critical' | 'warning' | 'info';
  summary: string;
  detail: string;
  resolved: boolean;
}

export async function logIssue(taskDir: string, entry: Omit<IssueEntry, 'time' | 'resolved'>): Promise<void> {
  await ensureDir(taskDir);
  const issuesFile = join(taskDir, 'ISSUES.md');
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const line = [
    `- [ ] **${now}** | ${entry.type} | ${entry.severity}`,
    `  - ${entry.summary}`,
    entry.detail ? `  - ${entry.detail}` : '',
  ].filter(Boolean).join('\n') + '\n';

  let content = '';
  if (await pathExists(issuesFile)) {
    content = await readFile(issuesFile, 'utf-8');
  } else {
    content = '# 问题记录\n\n';
  }

  await writeFile(issuesFile, content + line);
}

export async function getIssues(taskDir: string): Promise<{ total: number; unresolved: IssueEntry[] }> {
  const issuesFile = join(taskDir, 'ISSUES.md');
  if (!(await pathExists(issuesFile))) return { total: 0, unresolved: [] };

  const content = await readFile(issuesFile, 'utf-8');
  const lines = content.split('\n');
  const entries: IssueEntry[] = [];
  let current: Partial<IssueEntry> | null = null;

  for (const line of lines) {
    const m = line.match(/- \[(.)\] \*\*(.+?)\*\* \| (.+?) \| (.+)/);
    if (m) {
      if (current) entries.push(current as IssueEntry);
      current = { time: m[2], type: m[3] as any, severity: m[4] as any, summary: '', detail: '', resolved: m[1] === 'x' };
    } else if (current && line.includes('-')) {
      const text = line.replace(/^\s+-\s*/, '');
      if (!current.summary) current.summary = text;
      else if (!current.detail) current.detail = text;
    }
  }
  if (current) entries.push(current as IssueEntry);

  return {
    total: entries.length,
    unresolved: entries.filter(e => !e.resolved),
  };
}
