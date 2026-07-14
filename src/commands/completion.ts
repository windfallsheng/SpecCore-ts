/**
 * completion — Shell 自动补全
 *
 * 生成 bash/zsh 补全脚本
 */

import { logger } from '../utils/logger';

const COMMANDS = [
  'init', 'import', 'validate', 'archive', 'progress', 'status', 'health',
  'report', 'config', 'iteration', 'task', 'plan', 'execute', 'spec',
  'goal', 'bugfix', 'research', 'change', 'sync', 'handover', 'retro',
  'template-add', 'help', 'demo', 'welcome', 'iteration-from-global',
  'sync-global', 'global-status', 'history', 'impact', 'baseline',
  'dashboard', 'audit', 'rename', 'new-task', 'platform-add', 'index-update',
  'context', 'migrate', 'completion', 'backup', 'hooks', 'current',
  'update', 'diff', 'trace', 'delete', 'search', 'watch',
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
