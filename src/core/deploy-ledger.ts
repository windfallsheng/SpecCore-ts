/**
 * deploy-ledger — 部署问题账本（v8.3.352+）
 *
 * post-deploy 测试失败 / 部署后健康检查失败等「已上线不可逆」的问题，
 * 追加到 .speccore/local/deploy-ledger.md（迭代无关、跨迭代保留），
 * 避免流水线里的失败只在终端日志里一闪而过，下次部署前可作风险清单。
 *
 * 幂等追加：重复执行只新增行，不覆盖历史条目。
 */
import { join } from 'path';
import { ensureDir, pathExists, readFile, writeFile } from 'fs-extra';
import { findProjectRoot } from '../utils/task-utils';

export interface DeployLedgerEntry {
  kind: 'post-deploy-test' | 'health-check';
  platform: string;
  env: string;
  /** 测试类型 / 部署类型（可空） */
  type?: string;
  /** 严重度（可空，如 critical / major / minor） */
  severity?: string;
  message: string;
}

export async function appendDeployLedger(entry: DeployLedgerEntry): Promise<void> {
  const projectRoot = findProjectRoot() || process.cwd();
  const localDir = join(projectRoot, '.speccore', 'local');
  await ensureDir(localDir);
  const ledgerPath = join(localDir, 'deploy-ledger.md');

  const esc = (s: string) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const row =
    `| ${new Date().toISOString()} | ${esc(entry.kind)} | ${esc(entry.platform)} | ${esc(entry.env)} | ` +
    `${esc(entry.type || '-')} | ${esc(entry.severity || '-')} | ${esc(entry.message).slice(0, 300)} |`;

  const header =
    `# 部署问题账本（deploy-ledger）\n\n` +
    `> 自动生成：post-deploy 测试失败 / 部署后健康检查失败等「已上线不可逆」问题在此留痕。\n` +
    `> 修复后可删除对应行；本文件跨迭代保留，是下次部署前的风险清单。\n\n` +
    `| 时间 | 类型 | 端 | 环境 | 测试类型 | 严重度 | 摘要 |\n` +
    `|:---|:---|:---|:---|:---|:---|:---|\n`;

  let content = header;
  if (await pathExists(ledgerPath)) {
    content = (await readFile(ledgerPath, 'utf-8')).replace(/\s*$/, '\n');
  }
  await writeFile(ledgerPath, `${content}${row}\n`, 'utf-8');
}
