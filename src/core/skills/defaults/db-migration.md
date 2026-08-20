---
tags:
  - database
  - migration
  - schema
  - typeorm
  - prisma
---

# 数据库迁移技能

## 迁移原则

1. **向后兼容**：先加字段/表，后删字段/表，中间版本兼容
2. **可回滚**：每个迁移必须有 `up()` 和 `down()`
3. **数据安全**：生产环境迁移先备份
4. **分批执行**：大数据量迁移分批处理，避免锁表

## 迁移示例（TypeORM）

```typescript
export class AddUserProfile1672531200000 implements MigrationInterface {
  name = 'AddUserProfile1672531200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn('users', new TableColumn({
      name: 'avatar',
      type: 'varchar',
      length: '500',
      isNullable: true,
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'avatar');
  }
}
```

## 零停机迁移策略

1. **加字段**：ALTER TABLE ADD COLUMN（ nullable ）
2. **双写**：应用同时读写新旧字段
3. **回填**：批量回填历史数据
4. **切换**：应用切换到新字段
5. **删字段**：ALTER TABLE DROP COLUMN（下一个版本）
