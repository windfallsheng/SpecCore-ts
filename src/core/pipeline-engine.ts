/**
 * Pipeline Engine - 通用流水线执行引擎
 * 
 * 设计目标:
 * 1. 支持多步骤流水线,每步等待 AI 通过 --apply 写回
 * 2. 支持条件分支(如多端才执行 Phase 2)
 * 3. 支持断点续跑(--resume)
 * 4. 支持错误恢复和重试
 * 
 * @since v6.68.0
 */

import { logger } from '../utils/logger';

export interface PipelineStep {
  /** 步骤名称(用于日志和断点恢复) */
  name: string;
  
  /** 该步骤的 prompt */
  prompt: string;
  
  /** apply 处理器:接收 AI 生成的内容并写入文件 */
  applyHandler: (data: any) => Promise<void>;
  
  /** 完成后回调:返回 true 继续下一步,false 停止流水线 */
  onComplete?: () => Promise<boolean>;
  
  /** 是否可选步骤(失败不中断流水线) */
  optional?: boolean;
}

export interface PipelineOptions {
  /** 迭代名称 */
  iteration: string;
  
  /** 是否启用断点续跑 */
  resume?: boolean;
  
  /** 最大重试次数 */
  maxRetries?: number;
  
  /** 步骤间延迟(毫秒) */
  stepDelay?: number;
}

export class PipelineEngine {
  private options: PipelineOptions;
  private executedSteps: Set<string> = new Set();
  private checkpointFile: string;

  constructor(options: PipelineOptions) {
    this.options = {
      maxRetries: 3,
      stepDelay: 1000,
      ...options,
    };
    
    // 断点文件路径
    this.checkpointFile = `.speccore/local/.pipeline-${options.iteration}.json`;
  }

  /**
   * 执行流水线
   */
  async execute(steps: PipelineStep[]): Promise<void> {
    logger.info('');
    logger.info(`🚀 启动 Pipeline 引擎 (${steps.length} 个步骤)`);
    logger.info('');

    // 加载断点信息
    if (this.options.resume) {
      await this.loadCheckpoint();
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      
      // 检查是否已执行(断点续跑)
      if (this.executedSteps.has(step.name)) {
        logger.info(`⏭️  跳过已完成的步骤: ${step.name}`);
        continue;
      }

      logger.info(`▶️  执行步骤 ${i + 1}/${steps.length}: ${step.name}`);
      
      try {
        // 执行步骤
        await this.executeStep(step);
        
        // 标记为已执行
        this.executedSteps.add(step.name);
        await this.saveCheckpoint();
        
        // 检查是否继续
        if (step.onComplete) {
          const shouldContinue = await step.onComplete();
          if (!shouldContinue) {
            logger.info(`⏹️  步骤 ${step.name} 决定停止流水线`);
            break;
          }
        }
        
        // 步骤间延迟
        if (i < steps.length - 1 && this.options.stepDelay) {
          await this.sleep(this.options.stepDelay);
        }
        
        logger.success(`✅ 步骤 ${step.name} 完成`);
        logger.info('');
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (step.optional) {
          logger.warn(`⚠️  可选步骤 ${step.name} 失败,继续执行: ${errorMessage}`);
        } else {
          logger.error(`❌ 步骤 ${step.name} 失败: ${errorMessage}`);
          throw error;
        }
      }
    }

    logger.success('🎉 Pipeline 执行完成!');
    logger.info('');
    
    // 清理断点文件
    await this.clearCheckpoint();
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(step: PipelineStep): Promise<void> {
    let retries = 0;
    const maxRetries = this.options.maxRetries || 3;

    while (retries < maxRetries) {
      try {
        // 输出 prompt
        process.stdout.write(`[SPECCORE_PROMPT]\n${step.prompt}`);
        process.exitCode = 10;
        
        // 等待 AI 通过 --apply 写回
        // 注意: 这里假设 CLI 会在下一次调用时进入 apply 模式
        // 实际实现需要在 analyze.ts 中配合
        
        return; // 成功退出
        
      } catch (error) {
        retries++;
        if (retries >= maxRetries) {
          throw error;
        }
        
        logger.warn(`⚠️  步骤 ${step.name} 第 ${retries} 次重试...`);
        await this.sleep(2000 * retries); // 指数退避
      }
    }
  }

  /**
   * 保存断点信息
   */
  private async saveCheckpoint(): Promise<void> {
    const fs = await import('fs/promises');
    const data = {
      iteration: this.options.iteration,
      executedSteps: Array.from(this.executedSteps),
      timestamp: new Date().toISOString(),
    };
    
    await fs.writeFile(this.checkpointFile, JSON.stringify(data, null, 2));
  }

  /**
   * 加载断点信息
   */
  private async loadCheckpoint(): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    try {
      const checkpointPath = path.join(process.cwd(), this.checkpointFile);
      const data = await fs.readFile(checkpointPath, 'utf-8');
      const parsed = JSON.parse(data);
      
      this.executedSteps = new Set(parsed.executedSteps || []);
      logger.info(`📌 恢复断点: 已执行 ${this.executedSteps.size} 个步骤`);
    } catch (error) {
      logger.debug('无断点信息,从头开始执行');
    }
  }

  /**
   * 清理断点文件
   */
  private async clearCheckpoint(): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    try {
      const checkpointPath = path.join(process.cwd(), this.checkpointFile);
      await fs.unlink(checkpointPath);
    } catch (error) {
      // 忽略错误
    }
  }

  /**
   * 睡眠工具函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 创建 Pipeline 实例的工厂函数
 */
export function createPipeline(iteration: string, options?: Partial<PipelineOptions>): PipelineEngine {
  return new PipelineEngine({
    iteration,
    ...options,
  });
}
