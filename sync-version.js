#!/usr/bin/env node
// sync-version.js — Sync package.json version into all static HTML files
const fs = require('fs');
const path = require('path');
const { version } = require('./package.json');

const htmlFiles = [
  'speccore-about.html',
  'speccore-dev.html',
  'speccore-ask-onboarding.html',
  'speccore-ask-result.html',
  'welcome-project-SpecCore.html',
  'dashboard-project-SpecCore.html',
  'dashboard-iteration-Q2.html',
  'templates/html/speccore-ask-explain.html',
  'templates/html/speccore-ask-guide.html',
  'templates/html/speccore-ask-match.html',
  'templates/html/speccore-ask-pipeline.html',
  'templates/html/speccore-ask-result.html',
  'templates/html/speccore-demo.html',
  'templates/html/speccore-dev.html',
  'templates/html/speccore-help.html',
  'templates/html/speccore-retro-T-001.html',
  'templates/html/speccore-welcome.html',
];

let updated = 0;
for (const file of htmlFiles) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');
  const before = content;
  // Match "v" followed by version-like pattern
  content = content.replace(/v\d+\.\d+\.\d+/g, `v${version}`);
  if (content !== before) {
    fs.writeFileSync(file, content);
    updated++;
    console.log(`  ✓ ${file} → v${version}`);
  }
}
console.log(`Synced ${updated} HTML files to v${version}`);
