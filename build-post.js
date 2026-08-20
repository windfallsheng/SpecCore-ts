/**
 * Post-build script: copy default .md assets to dist/
 * v6.89.0+: AGENTS / RULES / COMMANDS / SKILLS / HOOKS defaults
 */
const { copySync, pathExistsSync, ensureDirSync } = require('fs-extra');
const { join } = require('path');

const srcDir = join(__dirname, 'src', 'core');
const distDir = join(__dirname, 'dist', 'core');

const dirs = [
  'agents/defaults',
  'rules/defaults',
  'commands/defaults',
  'skills/defaults',
  'hooks/defaults',
];

for (const dir of dirs) {
  const src = join(srcDir, dir);
  const dest = join(distDir, dir);
  if (pathExistsSync(src)) {
    ensureDirSync(dest);
    copySync(src, dest, { overwrite: true });
    console.log(`  ✅ Copied ${dir}`);
  } else {
    console.log(`  ⚠️  Skipped ${dir} (source not found)`);
  }
}

console.log('Post-build copy complete.');
