/**
 * AI 浏览器验证 — 类型定义（v8.3.350+）
 *
 * 分工：CLI 只切片不解析语义——从 020-specs 的 UI_SPEC.md/TEST.md 按标题抓取
 * 原文段落组装成剧本，语义理解与页面操作交给宿主 AI（Browser 子代理）执行。
 */

/** 部署清单（deploy 成功后落盘 .speccore/local/deploy-manifest.json，支撑 --scope deployed） */
export interface DeployManifestPlatform {
  name: string;
  type?: string;
  git?: {
    branch?: string;
    commit?: string;
  };
}

export interface DeployManifest {
  env: string;
  time: string;
  platforms: DeployManifestPlatform[];
}

/** 范围解析结果：一个功能单元目录 */
export interface ScopeUnit {
  /** 功能单元目录名（如 订单管理 或 admin-web-01-yudingguanli） */
  name: string;
  /** 绝对路径 */
  path: string;
  /** 该单元下存在的端目录名列表 */
  platforms: string[];
}

/**
 * 剧本分层 ID（v8.3.351+）：
 *   common  = 公共能力层（入口可达性/登录态/全局导航，CLI 模板生成，先于模块层执行）
 *   modules = 模块层（各功能单元 UI_SPEC/TEST 切片场景，逐单元推进）
 */
export type AiVerifyGroupId = 'common' | 'modules';

/** 剧本分层：执行视角的分组视图（场景仍平铺在 plan.scenarios，按 scenarioId 对齐结果） */
export interface AiVerifyGroup {
  id: AiVerifyGroupId;
  /** 层显示名（公共能力层 / 模块层） */
  label: string;
  /** 该层是否启用（settings.tests.layered 控制；关闭时无场景但保留层头供审计） */
  enabled: boolean;
  /** 该层场景 */
  scenarios: AiVerifyScenario[];
  /** 层说明（执行协议提示） */
  note?: string;
}

/** 单个验证场景（剧本最小单元） */
export interface AiVerifyScenario {
  /** 场景 ID：{单元}__{端}__{序号}，执行结果按此对齐（公共层单元名为 common） */
  id: string;
  /** 所属分层 */
  group: AiVerifyGroupId;
  /** 功能单元目录名（公共层为 common） */
  unit: string;
  /** 端名（CONSTITUTION 标准端名） */
  platform: string;
  /** 入口 URL（environments/{env}.yaml 的 tests.base_urls） */
  entry: string;
  /** 账号引用（如 staging.admin），剧本不落密码；无账号时为空 */
  account?: string;
  /** 操作步骤原文切片（UI_SPEC 交互流程段） */
  steps: string[];
  /** 预期结果原文切片（TEST.md 用例段） */
  expected: string[];
  /** 场景标题（取源文档段落标题，无标题时用兜底描述） */
  title: string;
}

/** 跳过项：无地址/空模板等无法生成剧本的单元 */
export interface AiVerifySkipped {
  unit: string;
  platform?: string;
  reason: string;
}

/** 账号环境变量引用提示：password/username 形如 ${VAR} 时，执行 AI 需从环境变量取明文 */
export interface AccountEnvVarHint {
  /** 账号引用名（如 staging.admin） */
  ref: string;
  /** 使用环境变量的字段 */
  field: 'username' | 'password';
  /** 环境变量名 */
  varName: string;
  /** 剧本生成时该变量是否已设置（未设置时剧本仅提示，不阻断） */
  set: boolean;
}

/**
 * 登录验证码提示（v8.3.354+）：账号配置了 verification 时，剧本头集中声明取码说明。
 * 只落「取码通道指引」不落码本身——执行 AI 按 note 自行取码（短信网关/TOTP 工具/测试号平台）。
 */
export interface AccountVerificationHint {
  /** 账号引用名（如 staging.user） */
  ref: string;
  /** 验证码类型（sms/totp/graphic/email；仅供执行 AI 参考取码方式） */
  type: string;
  /** 取码说明（人写的通道指引，如「验证码发送至测试手机 138xxxx，从短信网关读取」） */
  note: string;
}

/** AI 验证剧本（机器可读，落盘 plan.json） */
export interface AiVerifyPlan {
  /** 生成版本号 */
  version: '1.0';
  /** 环境名 */
  env: string;
  /** 迭代名 */
  iteration: string;
  /** 生成时间 ISO */
  generatedAt: string;
  /** 账号兑底文件路径（绝对路径；权威源为环境文件 tests.accounts，见 accountSources） */
  accountsPath: string;
  /**
   * 账号来源说明（v8.3.351+ 账号收敛）：执行 AI 据此定位明文。
   * 如 ["environments/staging.yaml (tests.accounts)", "/abs/.speccore/tests/accounts.yaml"]；
   * 环境内嵌账号引用名为账号名（如 admin），accounts.yaml 兑底引用名为 {env}.{name}（如 staging.admin）。
   */
  accountSources?: string[];
  /** 场景列表（按端分组后的平铺，与结果按 scenarioId 对齐） */
  scenarios: AiVerifyScenario[];
  /** 分层视图（v8.3.351+）：公共能力层先行 → 模块层推进；执行 AI 按此顺序推进 */
  groups: AiVerifyGroup[];
  /** 跳过项 */
  skipped: AiVerifySkipped[];
  /** 账号环境变量引用提示（password/username 为 ${VAR} 形式时列出） */
  accountEnvVars?: AccountEnvVarHint[];
  /** 登录验证码提示（账号配置了 verification 时列出，执行 AI 据此取码） */
  accountVerifications?: AccountVerificationHint[];
  /**
   * 原型/设计稿素材（v8.3.355+）：010-requirements 下 assets/designs、assets/prototypes、
   * assets/screenshots、prototypes 目录中收集的图片/HTML 绝对路径；
   * 执行 AI 打开对照理解界面，复杂流程有了视觉参照物。
   */
  prototypeAssets?: string[];
  /** 输出目录（report.html / results.json / screenshots 落盘处） */
  outDir: string;
}

/** 执行通道：记录场景由哪个通道执行判定（报告展示 + 兜底链路审计） */
export type AiVerifyExecutor = 'browser-agent' | 'playwright-mcp' | 'visual-judge' | 'manual';

/** 单个场景执行结果（宿主 AI 写回） */
export interface AiVerifyResult {
  scenarioId: string;
  unit: string;
  platform: string;
  /** passed=false 且 skipped=true 表示跳过（验证码/支付等无法自动化） */
  passed: boolean;
  skipped?: boolean;
  /** 执行通道（默认 browser-agent） */
  executor?: AiVerifyExecutor;
  /**
   * 宿主 AI 是否已完成视觉判定。无多模态能力的宿主只截图不判定时写 false，
   * 交由 speccore verify --ai-judge 用视觉模型兜底判定（executor 会改写为 visual-judge）。
   */
  judged?: boolean;
  /** AI 判断理由（视觉检查 + 业务断言依据） */
  reason: string;
  /** 截图相对路径（相对 outDir） */
  screenshots?: string[];
}

/** 执行结果汇总（宿主 AI 写回 results.json） */
export interface AiVerifyResults {
  version: '1.0';
  env: string;
  executedAt: string;
  results: AiVerifyResult[];
}

/** 报告生成输入：剧本 + 结果 */
export interface AiVerifyReportContext {
  plan: AiVerifyPlan;
  results: AiVerifyResults;
  /** 结果中缺失的场景（未执行） */
  missing: string[];
}
