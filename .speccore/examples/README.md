# SpecCore 示例目录

> 本目录存放各类配置示例，供用户仿照修改。
> 这些文件仅供人类参考，AI 不会读取。

## 目录结构

```
examples/
├── README.md                    ← 本文件
├── config/                      ← 配置文件示例
│   ├── CONSTITUTION-EXAMPLE.md  ← CONSTITUTION.md 完整示例（多工程）
│   ├── PROJECT-EXAMPLE.yaml     ← PROJECT.yaml 完整示例（多工程）
│   ├── SPECCORE-YML-EXAMPLE.yml ← .speccore.yml 主配置完整示例（v8.3.296+）
│   ├── GIT-CONFIG-EXAMPLE.txt   ← 子任务 .meta/git-config 格式示例
│   ├── BUSINESS-RULES-EXAMPLE/  ← 业务规则示例目录（通用 + 端级规则）
│   ├── API-DESIGN-EXAMPLE.md    ← API 设计规范示例（RESTful + 鉴权 + 版本）
│   ├── DATABASE-EXAMPLE.md      ← 数据库设计规范示例（命名 + 索引 + 分表）
│   ├── SECURITY-EXAMPLE.md      ← 安全规范示例（OWASP + 加密 + 审计）
│   ├── DEPLOY-EXAMPLE.yaml      ← 部署配置示例（speccore deploy 使用）
│   └── VERIFY-EXAMPLE.yaml      ← 测试验证配置示例（speccore verify 使用）
├── ci/                          ← CI/CD 配置示例（v8.3.296+）
│   └── github-actions.yml       ← GitHub Actions 校验流水线（validate 阶段）
└── project/                     ← 完整项目示例（预留，未来扩展）
```

## 使用方式

1. 查看 `config/CONSTITUTION-EXAMPLE.md`，仿照修改你的 `.speccore/CONSTITUTION.md`
2. 查看 `config/PROJECT-EXAMPLE.yaml`，了解 YAML 结构和字段对应关系
3. 查看 `config/GIT-CONFIG-EXAMPLE.txt`，了解子任务级 Git 配置格式
4. 查看 `config/BUSINESS-RULES-EXAMPLE/`，了解业务规则写法。通用规则复制到 `.speccore/GLOBAL/BUSINESS_RULES/`，端级规则按端名单文件存放
5. 查看 `config/API-DESIGN-EXAMPLE.md`，了解 API 设计规范，可作为 `.speccore/RULES/api-design.md` 素材
6. 查看 `config/DATABASE-EXAMPLE.md`，了解数据库设计规范，可作为 `.speccore/RULES/database.md` 素材
7. 查看 `config/SECURITY-EXAMPLE.md`，了解安全规范，可作为 `.speccore/RULES/security.md` 素材
8. 查看 `config/DEPLOY-EXAMPLE.yaml`，了解部署配置格式（用于 `speccore deploy`）
9. 查看 `config/VERIFY-EXAMPLE.yaml`，了解测试验证配置格式（用于 `speccore verify --config`）
10. 查看 `config/SPECCORE-YML-EXAMPLE.yml`，了解主配置 .speccore.yml 全部字段（质量门禁/冒烟三时机/流水线/AI provider）
11. 查看 `ci/github-actions.yml`，复制到 `.github/workflows/` 启用 CI 校验
12. 修改后运行 `speccore update` 自动同步到 PROJECT.yaml

## 注意事项

- 示例文件中的值为演示用途，请根据实际项目修改
- 示例文件更新随 CLI 版本升级，如需最新示例可重新运行 `speccore init`
