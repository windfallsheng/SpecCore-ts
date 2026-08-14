---
name: spec-reindex
description: 更新知识库 / 刷新索引 / 重建知识图谱。当用户说"更新知识库"、"刷新索引"、"重建图谱"、"索引过期了"等时触发。
triggers:
  - 更新知识库
  - 刷新索引
  - 重建图谱
  - 索引过期
  - reindex
  - 知识图谱
  - 一致性检查
---

# 知识库更新

当用户请求更新知识库时，执行以下命令：

```bash
speccore reindex
```

如果用户只想检查不想修复：

```bash
speccore reindex --check
```

如果用户指定了迭代：

```bash
speccore reindex -i <迭代名>
```

## 执行后告知用户

reindex 完成后，向用户展示：
1. 扫描到的文件数量
2. 知识图谱实体数和关系数
3. 是否有衰减/过期的知识
4. CONTEXT.md 已更新
