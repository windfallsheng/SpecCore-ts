/**
 * 计划存储 — 执行计划的历史记录和查询
 */
import { ensureDir, readJson, writeJson, pathExists } from 'fs-extra';

const PLANS_PATH = '.speccore/local/plans.json';

/** 单个执行计划 */
export interface ExecutionPlan {
  /** 唯一 ID */
  id: string;
  /** 计划名称 */
  name: string;
  /** 期次 */
  iteration: string;
  /** 任务列表（按执行顺序） */
  tasks: string[];
  /** 分批大小 */
  batchSize: number;
  /** 来源：manual=手动创建, auto=自动生成, schedule=调度触发 */
  source: 'manual' | 'auto' | 'schedule';
  /** 关联的 schedule ID */
  scheduleId?: string;
  /** 筛选条件快照 */
  filters: {
    assignee?: string;
    type?: string;
    priority?: string;
    platform?: string;
    backend?: boolean;
    frontend?: boolean;
  };
  /** 创建时间 */
  createdAt: string;
  /** 执行时间（null = 未执行） */
  executedAt: string | null;
  /** 执行结果摘要 */
  result: string | null;
  /** 计划状态 */
  status: 'active' | 'completed' | 'cancelled';
}

interface PlanStore {
  plans: ExecutionPlan[];
}

function gid(): string {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function load(): Promise<PlanStore> {
  if (!(await pathExists(PLANS_PATH))) return { plans: [] };
  return readJson(PLANS_PATH);
}

async function save(store: PlanStore): Promise<void> {
  await ensureDir('.speccore/local');
  await writeJson(PLANS_PATH, store, { spaces: 2 });
}

/** 保存新计划 */
export async function savePlan(plan: Omit<ExecutionPlan, 'id' | 'createdAt' | 'executedAt' | 'result' | 'status'>): Promise<ExecutionPlan> {
  const store = await load();
  const entry: ExecutionPlan = {
    ...plan,
    id: gid(),
    createdAt: new Date().toISOString(),
    executedAt: null,
    result: null,
    status: 'active',
  };
  store.plans.push(entry);
  await save(store);
  return entry;
}

/** 标记计划已执行 */
export async function markPlanExecuted(id: string, result: string): Promise<void> {
  const store = await load();
  const plan = store.plans.find(p => p.id === id);
  if (plan) {
    plan.executedAt = new Date().toISOString();
    plan.result = result;
    plan.status = 'completed';
  }
  await save(store);
}

/** 取消计划 */
export async function cancelPlan(id: string): Promise<boolean> {
  const store = await load();
  const plan = store.plans.find(p => p.id.startsWith(id));
  if (!plan) return false;
  plan.status = 'cancelled';
  await save(store);
  return true;
}

/** 查询计划列表 */
export async function listPlans(
  iteration?: string,
  limit = 20
): Promise<ExecutionPlan[]> {
  const store = await load();
  let plans = store.plans;
  if (iteration) plans = plans.filter(p => p.iteration === iteration);
  return plans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
}

/** 查询单个计划 */
export async function getPlan(id: string): Promise<ExecutionPlan | null> {
  const store = await load();
  return store.plans.find(p => p.id.startsWith(id)) || null;
}

/** 删除计划 */
export async function deletePlan(id: string): Promise<boolean> {
  const store = await load();
  const idx = store.plans.findIndex(p => p.id.startsWith(id));
  if (idx < 0) return false;
  store.plans.splice(idx, 1);
  await save(store);
  return true;
}
