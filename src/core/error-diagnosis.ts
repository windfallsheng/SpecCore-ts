/**
 * Error Diagnosis — 错误自动诊断
 * v6.96.0: 分析常见错误模式，给出针对性修复建议
 */
import { logger } from '../utils/logger';

export interface DiagnosisResult {
  matched: boolean;
  category: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
  suggestions: string[];
}

interface ErrorPattern {
  category: string;
  severity: 'info' | 'warn' | 'error';
  patterns: RegExp[];
  message: string;
  suggestions: string[];
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    category: '迭代不存在',
    severity: 'error',
    patterns: [/No active iteration found/i, /迭代.*不存在/i, /Iteration.*not found/i],
    message: '当前没有活跃的迭代，或指定的迭代不存在',
    suggestions: [
      '运行 speccore iteration create <名称> 创建新迭代',
      '运行 speccore init 初始化项目',
      '使用 --iteration <名称> 指定已有迭代',
    ],
  },
  {
    category: '任务未找到',
    severity: 'warn',
    patterns: [/Task.*not found/i, /任务.*未找到/i, /没有找到.*任务/i],
    message: '指定的任务不存在或名称不匹配',
    suggestions: [
      '运行 speccore status 查看当前迭代的任务列表',
      '使用任务 ID 的完整形式（如 Task-001）',
      '检查是否已运行 speccore split 拆分任务',
    ],
  },
  {
    category: '锁冲突',
    severity: 'warn',
    patterns: [/锁已被.*持有/i, /lock.*held by/i, /acquireLock/i],
    message: '另一个进程或用户正在操作此迭代',
    suggestions: [
      '等待其他操作完成后重试',
      '使用 --force 强制获取锁（谨慎使用）',
      '运行 speccore status 查看当前锁持有者',
    ],
  },
  {
    category: '图谱缺失',
    severity: 'info',
    patterns: [/图谱不存在/i, /graph.*not found/i, /graph\.json.*不存在/i],
    message: '代码知识图谱尚未构建',
    suggestions: [
      '运行 speccore code-index --graph 构建代码知识图谱',
      '运行 speccore code-index --graph --incremental 增量更新',
    ],
  },
  {
    category: 'Git 错误',
    severity: 'warn',
    patterns: [/not a git repository/i, /git.*error/i, /protected branch/i, /冲突/i],
    message: 'Git 操作遇到问题',
    suggestions: [
      '确认当前目录是 Git 仓库',
      '检查是否在受保护分支上，切换到 feature 分支',
      '运行 git status 查看未提交的变更',
      '如果有冲突，先解决冲突再执行',
    ],
  },
  {
    category: '依赖缺失',
    severity: 'error',
    patterns: [/Cannot find module/i, /MODULE_NOT_FOUND/i, /ENOENT/i],
    message: '缺少必要的依赖或文件',
    suggestions: [
      '运行 npm install 安装依赖',
      '检查文件路径是否正确',
      '确认 .speccore/ 目录结构完整',
    ],
  },
  {
    category: 'Prompt 构建失败',
    severity: 'error',
    patterns: [/prompt-builder/i, /buildPrompt/i, /PromptContext/i],
    message: 'Prompt 构建过程中出现错误',
    suggestions: [
      '检查插件系统是否正常加载：speccore doctor',
      '查看 .speccore/local/ 目录权限',
      '尝试重启命令',
    ],
  },
  {
    category: '网络/超时',
    severity: 'warn',
    patterns: [/timeout/i, /ETIMEDOUT/i, /ECONNREFUSED/i, /网络/i],
    message: '网络连接超时或失败',
    suggestions: [
      '检查网络连接',
      '如果是 LLM API 调用，检查 API key 是否有效',
      '稍后重试',
    ],
  },
];

/**
 * 诊断错误信息，返回匹配结果和建议
 */
export function diagnoseError(error: unknown): DiagnosisResult {
  const errorStr = String(error);
  const errorMsg = error instanceof Error ? error.message : errorStr;

  for (const pattern of ERROR_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(errorMsg) || regex.test(errorStr)) {
        return {
          matched: true,
          category: pattern.category,
          severity: pattern.severity,
          message: pattern.message,
          suggestions: pattern.suggestions,
        };
      }
    }
  }

  return {
    matched: false,
    category: '未知错误',
    severity: 'error',
    message: errorMsg,
    suggestions: [
      '查看详细错误堆栈：添加 --verbose 或 DEBUG=* 环境变量',
      '运行 speccore doctor 检查项目健康度',
      '查阅文档: https://github.com/your-org/speccore#troubleshooting',
    ],
  };
}

/**
 * 打印诊断结果
 */
export function printDiagnosis(result: DiagnosisResult): void {
  const icon = result.severity === 'error' ? '❌' : result.severity === 'warn' ? '⚠️' : 'ℹ️';
  logger.info('');
  logger.info(`${icon} 错误诊断: ${result.category}`);
  logger.info(`   ${result.message}`);
  logger.info('');
  logger.info('💡 建议修复步骤:');
  for (let i = 0; i < result.suggestions.length; i++) {
    logger.info(`   ${i + 1}. ${result.suggestions[i]}`);
  }
  logger.info('');
}

/**
 * 包装函数：自动诊断并打印
 */
export function diagnoseAndPrint(error: unknown): DiagnosisResult {
  const result = diagnoseError(error);
  printDiagnosis(result);
  return result;
}
