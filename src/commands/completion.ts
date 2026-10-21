/**
 * completion — Shell 自动补全
 *
 * 生成 bash/zsh 补全脚本
 */

import { logger } from '../utils/logger';

// v8.3.257: 与 cli.ts 实际注册命令对齐，移除已删命令（import/health/goal/bugfix/research/
// template-add/demo/sync-global/global-status/new-task/platform-add/backup/hooks/current/trace/watch）
// v8.3.341: 移除图谱/索引/基线/AI 辅助等边缘命令（graph/knowledge/rag-index/code-index/refresh/
// baseline/diff/rollback/merge-check/audit/verdict/impact/history/handover/workspace/notify/recommend/track）
const COMMANDS = [
  'init', 'doc2spec', 'unitize', 'taskify', 'analyze', 'global', 'spec-from-source',
  'validate', 'plan', 'execute', 'run', 'pipeline', 'verify', 'pr', 'done',
  'status', 'progress', 'dashboard', 'doctor', 'report', 'archive',
  'config', 'constitution', 'iteration', 'task', 'change', 'sync',
  'search', 'pattern',
  'rename', 'retro', 'req-doc', 'iteration-from-global',
  'context', 'update', 'migrate', 'delete', 'cleanup',
  'reindex',
  'prompts', 'next',
  'help', 'about', 'welcome', 'ask', 'completion',
];

/**
 * 生成 bash 补全脚本
 */
function generateBashCompletion(): string {
  return `# Speccore bash completion
_speccore_completion() {
  local cur prev opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  # Complete subcommands
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    opts="${COMMANDS.join(' ')} --help --version --lang"
    COMPREPLY=( $(compgen -W "\${opts}" -- \${cur}) )
    return 0
  fi

  # Common options
  opts="--task --iteration --force --dry-run --all --assignee --type --priority --status --platform --format --help"
  COMPREPLY=( $(compgen -W "\${opts}" -- \${cur}) )
}
complete -F _speccore_completion speccore
`;
}

/**
 * 生成 zsh 补全脚本
 */
function generateZshCompletion(): string {
  return `# Speccore zsh completion
#compdef speccore

_speccore() {
  local -a commands
  commands=(
${COMMANDS.map(c => `    '${c}:Speccore ${c} command'`).join('\n')}
  )

  _arguments \\
    '--lang[Language: zh-CN or en-US]:locale:(zh-CN en-US)' \\
    '--version[Show version]' \\
    '--help[Show help]' \\
    '*::command:->command'

  case $state in
    command)
      _describe 'command' commands
      ;;
  esac
}

_speccore
`;
}

export function completionCommand(shell?: string): void {
  const s = shell || 'bash';

  if (s === 'zsh') {
    console.log(generateZshCompletion());
  } else {
    console.log(generateBashCompletion());
  }

  logger.info('');
  if (s === 'zsh') {
    logger.info('# Add to ~/.zshrc:');
    logger.info('#   source <(speccore completion zsh)');
  } else {
    logger.info('# Install:');
    logger.info('#   speccore completion bash > /usr/local/etc/bash_completion.d/speccore');
    logger.info('#   source ~/.bashrc');
  }
}
