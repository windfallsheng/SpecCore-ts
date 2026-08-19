# PATTERNS — 可复用模式库

> 全局分析时从源码中沉淀的可复用设计模式。跨迭代、跨工程复用的核心资产。

---

## 目录结构

```
PATTERNS/
├── architecture/          ← 跨端通用架构模式
├── data-model/            ← 跨端通用数据模型模式
├── api-contract/          ← 跨端通用 API 契约模式
├── security/              ← 跨端通用安全模式
├── performance/           ← 跨端通用性能模式
├── {端名}/                ← 端专属模式（如 backend/ h5/ admin/）
│   ├── architecture/
│   ├── data-model/
│   ├── api-contract/
│   ├── security/
│   └── performance/
└── TEMPLATES/             ← 写作模板
```

## 分类说明

| 分类 | 存放内容 | 示例 |
|:---|:---|:---|
| **architecture** | 项目结构、模块划分、服务拓扑、分层架构 | 微服务网关模式、DDD 聚合根设计 |
| **data-model** | 表设计、字段命名、关联关系、索引策略 | 软删除通用字段、多租户数据隔离 |
| **api-contract** | 接口规范、错误码体系、响应格式、版本策略 | 统一分页响应、标准错误包装 |
| **security** | 鉴权、授权、输入校验、敏感数据处理 | JWT 鉴权中间件、RBAC 权限模型 |
| **performance** | 缓存策略、批量处理、异步化、限流降级 | 多级缓存设计、接口批量查询 |

## 文件命名

- **通用模式**: `{分类}/{kebab-case模式名}.md`
  - 例: `architecture/microservice-gateway.md`
- **端专属模式**: `{端名}/{分类}/{kebab-case模式名}.md`
  - 例: `backend/security/jwt-auth.md`

## 文件内容格式

每个模式文件必须包含以下章节：

```markdown
# {模式名}

> 来源: {工程名} | 端: {端名或"跨端"} | 发现时间: YYYY-MM-DD
> 分类: {architecture|data-model|api-contract|security|performance}

## 适用场景
什么情况下应该使用这个模式。

## 核心实现
```{语言}
// 最小可复用的代码片段（不是完整文件）
```

## 使用示例
如何在实际场景中应用这个模式。

## 注意事项
- 边界条件、限制、依赖
- 与相似模式的区别

## 反例
不要这样用（常见错误写法）。
```

## 更新规则

- **追加不覆盖**: 同一模式的新变体在文件末尾追加，用 `---` 分隔
- **手动编辑允许**: 支持人工补充、修正、合并
- **自动发现**: 全局分析时自动从源码中识别并生成
