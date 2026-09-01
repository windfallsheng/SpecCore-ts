# 需求文档目录规范

> 本目录存放本期迭代的全部需求相关文档与素材

## 目录结构

```
010-requirements/
├── README.md              ← 本文件
├── INDEX.md               ← 需求文档索引（自动生成/维护）
├── sources/               ← [只读] 原始 PRD/Word/PDF，任何人不得修改
│   └── README.md
├── converted/             ← [自动生成] doc2spec 转换后的 Markdown 规格
│   └── *.md
├── features/              ← [手动维护] feature 型：按功能模块组织（子目录）
│   └── {module}/
│       └── README.md
├── bugs/                  ← [手动维护] bugfix 型：扁平文件
│   └── {bug-slug}.md
├── refactors/             ← [手动维护] refactor 型：扁平文件
│   └── {refactor-slug}.md
├── research/              ← [手动维护] research 型：扁平文件
│   └── {topic-slug}.md
├── prototypes/          ← 原型（HTML/图片/链接，内容不限）
└── assets/
    └── extracted/         ← doc2spec 提取的图片/媒体文件
```

## 使用规范

1. **sources/** — 放产品提供的原始文档，不要直接编辑
2. **converted/** — doc2spec 命令自动输出转换后的 MD，人工不修改
3. **features/** — feature 型任务：按功能模块手动补充需求细节，每个模块一个**子目录**
4. **bugs/** — bugfix 型任务：每个 bug 一个扁平 MD 文件（如 `login-timeout.md`）
5. **refactors/** — refactor 型任务：每个重构目标一个扁平 MD 文件
6. **research/** — research 型任务：每个研究主题一个扁平 MD 文件
7. **prototypes/** — 原型文件，HTML/图片/链接均可，需求文档中链接到原型的会被主动读取
8. **assets/extracted/** — doc2spec 自动提取的图片，人工不修改

## AI 读取规则

> 运行 `speccore analyze` 时，AI 会按以下规则自动读取本文档：

### 会被 AI 读到的目录 ✅

| 目录 | 读取范围 | 用途建议 |
|:---|:---|:---|
| `INDEX.md` | 整文件 | 登记所有需求文档清单，AI 先读它了解全貌 |
| `converted/*.md` | 全部 .md 文件 | doc2spec 转换后的核心规格，AI 分析的主要依据 |
| `features/*/README.md` | 每个子目录的 README.md | feature 型：按功能模块组织的需求补充 |
| `bugs/*.md` | 全部 .md 文件 | bugfix 型：bug 描述与影响分析 |
| `refactors/*.md` | 全部 .md 文件 | refactor 型：重构目标与方案 |
| `research/*.md` | 全部 .md 文件 | research 型：研究主题与对比 |
| `prototypes/` | 原型文件 | 原型（HTML/图片/链接），需求文档链接过来会被主动读取 |

### 不会被 AI 读到的目录 ❌

| 目录 | 说明 |
|:---|:---|
| `sources/` | 只存放原始 PRD/Word/PDF，AI 不直接读取 |
| `020-specs/` | analyze 的**输出**目录，存放分析结果 |
| `030-tasks/` | 开发任务目录，execute 阶段使用 |
| `030-tasks/*/10-backend/*/` | 后端子任务目录（execute 阶段使用） |

### 如何让 AI 读到你手写的文档？

**feature 型：** 在 `features/` 下按功能模块创建子目录：

```
features/
  支付模块/
    README.md    (AI 会读到)
  订单模块/
    README.md    (AI 会读到)
```

**bugfix / refactor / research 型：** 直接在对应目录放扁平 MD 文件：

```
bugs/
  login-timeout.md         (AI 会读到)
  payment-callback-error.md
refactors/
  db-connection-pool.md    (AI 会读到)
research/
  websocket-comparison.md  (AI 会读到)
```

然后在 `INDEX.md` 中登记这些文档，AI 第一步就会从索引中发现它们。

**注意：** `converted/` 也可以放手写文档，但这个目录的语义是「doc2spec 自动转换产出」，建议优先使用类型对应的目录。
