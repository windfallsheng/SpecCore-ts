# Contributing to SpecCore

## Setup

```bash
git clone <repo>
cd ts-cli
npm install
npm run build
npm link  # or: npm install -g .
```

## Development Cycle

```bash
# 1. Write code
vim src/commands/new-feature.ts

# 2. Register CLI + add import
vim src/cli.ts

# 3. Type-check
npx tsc --noEmit

# 4. Test
npx vitest run

# 5. Build + global install for local testing
npm run build && npm install -g .
```

## Code Standards

- **Type safety**: zero `any` types, complete interfaces
- **Error handling**: try/catch all async IO operations
- **Logging**: use `logger.info/warn/error` from `utils/logger`, never `console.log`
- **File operations**: use `fs-extra`, never raw `fs`
- **Paths**: use `join()` from `path`, never string concatenation
- **CLI parameters**: register in `cli.ts` with `.option()`, match the interface in the command file
- **Documentation**: every new command needs an entry in `docs/命令参考.md`

## Adding a Command

1. Create `src/commands/my-command.ts`
2. Export the interface and async function
3. Import in `src/cli.ts`
4. Register with `.command() .alias() .description() .option() .action()`
5. Add to `src/core/next-steps.ts` stage guide
6. Add to `docs/命令参考.md`
7. Write tests in `tests/unit/commands/my-command.test.ts`

## Commit Convention

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation
- `test:` — tests
- `chore:` — tooling/build
- `refactor:` — code restructuring
