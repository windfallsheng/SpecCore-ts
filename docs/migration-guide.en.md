# SpecCore Migration Guide: Shell v3.x → CLI v5.x

> Complete guide for migrating from Shell-based Speccore to the CLI version.

---

## Automatic Migration (Recommended)

```bash
# In your existing Speccore project directory
cd my-speccore-project
speccore migrate

# Preview mode (no changes)
speccore migrate --dry-run
```

`speccore migrate` automatically:
1. Detects Shell version
2. Counts existing iterations and tasks
3. Creates missing GLOBAL/ layer directories
4. Creates `.speccore/config/platforms.yaml`
5. Upgrades `context.json` to v5 format (preserves existing data)
6. Creates/updates `.gitignore`

---

## Manual Migration

### 1. Install CLI

```bash
npm install -g speccore
speccore --version   # Should show v5.x
```

### 2. Run Migration

```bash
cd your-speccore-project
speccore migrate
```

### 3. Verify

```bash
speccore validate
speccore global-status
```

### 4. Re-init (Optional)

```bash
speccore init --force
```

---

## Before vs After

| Aspect | Shell (v3.x) | CLI (v5.x) |
| :--- | :--- | :--- |
| Installation | git clone + PATH | `npm install -g speccore` |
| Commands | 3 scripts | 54 commands |
| Test coverage | None | 148 tests |
| Data model | None | Zod Schema |
| File operations | Direct writes | Transaction-protected |
| Internationalization | Chinese only | CN + EN |
| Multi-platform | Not supported | `--platforms=web,h5` |
| Code generation | Manual | execute generates code skeletons |

---

## FAQ

### Q: Will migration lose data?

A: No. The migrate command uses transaction protection. Use `--dry-run` first to preview.

### Q: Can Shell and CLI coexist?

A: Yes. CLI is backward-compatible with Shell directory structures.

### Q: Do I still need the Shell version after migration?

A: No. CLI includes all Shell functionality and more.
