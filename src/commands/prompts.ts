/**
 * prompts - 提示词库管理命令
 * 提供预置提示词模板和用户自定义提示词，支持搜索、分类、CRUD、复制
 */

import { logger } from '../utils/logger';
import { writeFile, ensureDir, readFile, pathExists, readdir } from 'fs-extra';
import { join } from 'path';

export interface PromptsOptions {
  web?: boolean;
  output?: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  prompt: string;
  command?: string;
  env?: 'cli' | 'both' | 'ai';
  tags?: string[];
  params: PromptParam[];
  builtin: boolean;
  sort: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PromptParam {
  key: string;
  placeholder: string;
  required: boolean;
}

export async function promptsCommand(options: PromptsOptions): Promise<void> {
  try {
    // 收集所有提示词数据
    const presets = await loadPresets();
    const userPrompts = await loadUserPrompts();
    const allPrompts = [...presets, ...userPrompts];

    // 生成 HTML 页面
    const html = generatePromptsHtml(allPrompts);
    const outputPath = options.output || join(process.cwd(), 'outputs', 'speccore-prompts.html');
    await ensureDir(join(process.cwd(), 'outputs'));
    await writeFile(outputPath, html);

    logger.info('');
    logger.success('✅ 提示词库页面已生成！');
    process.stdout.write(`✅ 页面已生成: file://${outputPath}\n`);
    process.stdout.write(`[SPECCORE_PROMPTS: ${outputPath}]\n`);
  } catch (error) {
    logger.error(`生成提示词库失败: ${error}`);
  }
}

async function loadPresets(): Promise<PromptTemplate[]> {
  const presetsDir = join(process.cwd(), '.speccore', 'prompts', 'presets');
  const presets: PromptTemplate[] = [];

  if (!(await pathExists(presetsDir))) return presets;

  try {
    const files = await readdir(presetsDir);
    for (const file of files.filter(f => f.endsWith('.json'))) {
      const content = await readFile(join(presetsDir, file), 'utf-8');
      const items = JSON.parse(content);
      presets.push(...items);
    }
  } catch {}

  return presets.sort((a, b) => (a.sort || 99) - (b.sort || 99));
}

async function loadUserPrompts(): Promise<PromptTemplate[]> {
  const userDir = join(process.cwd(), '.speccore', 'prompts', 'user');
  const prompts: PromptTemplate[] = [];

  if (!(await pathExists(userDir))) return prompts;

  try {
    const files = await readdir(userDir);
    for (const file of files.filter(f => f.endsWith('.json'))) {
      const content = await readFile(join(userDir, file), 'utf-8');
      const items = JSON.parse(content);
      prompts.push(...items.map((p: any) => ({ ...p, builtin: false })));
    }
  } catch {}

  return prompts.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function generatePromptsHtml(prompts: PromptTemplate[]): string {
  const categories = [...new Set(prompts.map(p => p.category))];
  const categoryLabels: Record<string, string> = {
    workflow: '核心流程',
    iteration: '迭代管理',
    analysis: '分析文档',
    execute: '开发执行',
    custom: '我的'
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SpecCore 提示词库</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .toolbar {
      padding: 20px 30px;
      background: #f8f9fa;
      border-bottom: 1px solid #e9ecef;
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    .search-box {
      flex: 1;
      min-width: 200px;
      padding: 10px 16px;
      border: 2px solid #e9ecef;
      border-radius: 8px;
      font-size: 14px;
      transition: all 0.2s;
    }
    .search-box:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }
    .category-tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .tab {
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s;
      background: white;
      border: 1px solid #e9ecef;
    }
    .tab:hover { background: #f1f3f5; }
    .tab.active {
      background: #667eea;
      color: white;
      border-color: #667eea;
    }
    .btn {
      padding: 10px 20px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    }
    .btn-primary {
      background: #667eea;
      color: white;
    }
    .btn-primary:hover { background: #5568d3; }
    .btn-secondary {
      background: #e9ecef;
      color: #495057;
    }
    .btn-secondary:hover { background: #dee2e6; }
    .content {
      padding: 30px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
      color: #495057;
    }
    .prompt-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
      margin-bottom: 30px;
      align-items: stretch;
    }
    .prompt-card {
      background: white;
      border: 1px solid #e9ecef;
      border-radius: 12px;
      padding: 20px;
      transition: all 0.2s;
      cursor: pointer;
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .prompt-card:hover {
      border-color: #667eea;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
      transform: translateY(-2px);
    }
    .prompt-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }
    .prompt-icon {
      font-size: 24px;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f8f9fa;
      border-radius: 8px;
    }
    .prompt-title {
      flex: 1;
    }
    .prompt-title h3 {
      font-size: 15px;
      font-weight: 600;
      color: #212529;
      margin-bottom: 4px;
    }
    .prompt-title p {
      font-size: 12px;
      color: #868e96;
    }
    .prompt-preview {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 12px;
      font-size: 13px;
      color: #495057;
      margin-bottom: 12px;
      font-family: 'SF Mono', Monaco, monospace;
      line-height: 1.5;
      max-height: 80px;
      overflow: hidden;
      position: relative;
      flex: 1;
    }
    .prompt-preview::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 30px;
      background: linear-gradient(transparent, #f8f9fa);
    }
    .prompt-section {
      font-size: 11px;
      font-weight: 600;
      color: #868e96;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .prompt-say {
      background: #e7f5ff;
      border-radius: 8px;
      padding: 12px;
      font-size: 13px;
      color: #1864ab;
      margin-bottom: 12px;
      line-height: 1.5;
      border-left: 3px solid #339af0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .prompt-cmd {
      background: #212529;
      border-radius: 8px;
      padding: 12px;
      font-size: 12px;
      color: #69db7c;
      margin-bottom: 12px;
      line-height: 1.6;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .prompt-cmd code {
      color: #69db7c;
      font-family: inherit;
    }
    .prompt-actions {
      display: flex;
      gap: 8px;
    }
    .prompt-actions .btn {
      flex: 1;
      padding: 8px 12px;
      font-size: 13px;
    }
    .btn-say {
      background: #e7f5ff;
      color: #1864ab;
      border: 1px solid #74c0fc;
    }
    .btn-say:hover { background: #d0ebff; }
    .btn-cmd {
      background: #212529;
      color: #69db7c;
      border: 1px solid #495057;
    }
    .btn-cmd:hover { background: #343a40; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
    }
    .badge-builtin {
      background: #e7f5ff;
      color: #1971c2;
    }
    .badge-custom {
      background: #fff3bf;
      color: #e67700;
    }
    .env-hint {
      font-size: 11px;
      color: #868e96;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .env-hint.cli {
      color: #2b8a3e;
    }
    .env-hint.ai {
      color: #1971c2;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #868e96;
    }
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    .modal.active { display: flex; }
    .modal-content {
      background: white;
      border-radius: 12px;
      width: 90%;
      max-width: 600px;
      max-height: 90vh;
      overflow-y: auto;
    }
    .modal-header {
      padding: 20px;
      border-bottom: 1px solid #e9ecef;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .modal-header h2 { font-size: 18px; }
    .modal-close {
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #868e96;
    }
    .modal-body { padding: 20px; }
    .form-group { margin-bottom: 16px; }
    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 6px;
      color: #495057;
    }
    .form-group input,
    .form-group textarea,
    .form-group select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #e9ecef;
      border-radius: 6px;
      font-size: 14px;
    }
    .form-group textarea {
      resize: vertical;
      min-height: 100px;
      font-family: 'SF Mono', Monaco, monospace;
    }
    .modal-footer {
      padding: 20px;
      border-top: 1px solid #e9ecef;
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    /* ═══ 场景快捷入口 ═══ */
    .scene-bar {
      padding: 16px 30px;
      background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
      border-bottom: 1px solid #dee2e6;
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    .scene-label {
      font-size: 12px;
      font-weight: 600;
      color: #868e96;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-right: 4px;
    }
    .scene-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      background: white;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      color: #495057;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .scene-card:hover {
      border-color: #667eea;
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.12);
      transform: translateY(-1px);
    }
    .scene-card.active {
      background: #667eea;
      color: white;
      border-color: #667eea;
    }
    .scene-card .scene-icon {
      font-size: 16px;
    }
    /* ═══ 标签云 ═══ */
    .tag-cloud {
      padding: 12px 30px;
      background: #f8f9fa;
      border-bottom: 1px solid #e9ecef;
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      transition: max-height 0.3s ease;
      overflow: hidden;
    }
    .tag-cloud.collapsed {
      max-height: 48px;
    }
    .tag-cloud.expanded {
      max-height: 500px;
    }
    .tag-toggle-bar {
      text-align: center;
      padding: 0 30px 10px;
      background: #f8f9fa;
      border-bottom: 1px solid #e9ecef;
    }
    .tag-toggle {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 14px;
      background: #e9ecef;
      border: 1px solid #dee2e6;
      border-radius: 20px;
      font-size: 12px;
      color: #495057;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .tag-toggle:hover {
      background: #dee2e6;
    }
    .tag-cloud-label {
      font-size: 12px;
      font-weight: 600;
      color: #868e96;
      margin-right: 4px;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      background: white;
      border: 1px solid #e9ecef;
      border-radius: 20px;
      font-size: 12px;
      color: #495057;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tag:hover {
      border-color: #667eea;
      color: #667eea;
    }
    .tag.active {
      background: #667eea;
      color: white;
      border-color: #667eea;
    }
    .tag .tag-count {
      font-size: 10px;
      background: #f1f3f5;
      color: #868e96;
      padding: 1px 5px;
      border-radius: 10px;
    }
    .tag.active .tag-count {
      background: rgba(255,255,255,0.25);
      color: white;
    }
    /* ═══ 卡片标签 ═══ */
    .prompt-tags {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .prompt-tag {
      display: inline-block;
      padding: 2px 8px;
      background: #f1f3f5;
      border-radius: 4px;
      font-size: 11px;
      color: #868e96;
    }
    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #212529;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 2000;
      animation: slideIn 0.3s ease;
    }
    @keyframes slideIn {
      from { transform: translateY(100px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📋 SpecCore 提示词库</h1>
      <p>预置模板 + 自定义提示词，一键复制，高效开发</p>
    </div>

    <!-- 常用场景快捷入口 -->
    <div class="scene-bar" id="sceneBar">
      <span class="scene-label">常用场景</span>
      <div class="scene-card" data-scene="init" onclick="filterByScene('init')">
        <span class="scene-icon">🆕</span><span>首次使用</span>
      </div>
      <div class="scene-card" data-scene="analyze" onclick="filterByScene('analyze')">
        <span class="scene-icon">🔍</span><span>开始分析</span>
      </div>
      <div class="scene-card" data-scene="dev" onclick="filterByScene('dev')">
        <span class="scene-icon">▶️</span><span>开始开发</span>
      </div>
      <div class="scene-card" data-scene="finish" onclick="filterByScene('finish')">
        <span class="scene-icon">✅</span><span>任务收尾</span>
      </div>
      <div class="scene-card" data-scene="daily" onclick="filterByScene('daily')">
        <span class="scene-icon">📅</span><span>日常运维</span>
      </div>
      <div class="scene-card" data-scene="change" onclick="filterByScene('change')">
        <span class="scene-icon">🔧</span><span>需求变更</span>
      </div>
    </div>

    <div class="toolbar">
      <input type="text" class="search-box" id="searchBox" placeholder="搜索提示词名称或内容...">
      <div class="category-tabs">
        <div class="tab active" data-category="all">全部</div>
        ${categories.map(c => `<div class="tab" data-category="${c}">${categoryLabels[c] || c}</div>`).join('')}
      </div>
      <button class="btn btn-primary" onclick="openCreateModal()">+ 新建</button>
    </div>

    <!-- 标签云 -->
    <div class="tag-cloud collapsed" id="tagCloud">
      <span class="tag-cloud-label">🏷️ 标签</span>
    </div>
    <div class="tag-toggle-bar" id="tagToggleBar"></div>

    <div class="content" id="content">
      <!-- 动态渲染 -->
    </div>
  </div>

  <!-- 创建/编辑弹窗 -->
  <div class="modal" id="editModal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="modalTitle">新建提示词</h2>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>名称 *</label>
          <input type="text" id="editName" placeholder="例如：周会汇报">
        </div>
        <div class="form-group">
          <label>分类</label>
          <select id="editCategory">
            <option value="custom">我的</option>
            <option value="iteration">迭代</option>
            <option value="analysis">分析</option>
            <option value="execute">执行</option>
            <option value="change">变更</option>
          </select>
        </div>
        <div class="form-group">
          <label>图标</label>
          <input type="text" id="editIcon" placeholder="例如：📝" value="📝">
        </div>
        <div class="form-group">
          <label>描述</label>
          <input type="text" id="editDescription" placeholder="简短描述这个提示词的用途">
        </div>
        <div class="form-group">
          <label>提示词内容 *</label>
          <textarea id="editPrompt" placeholder="输入提示词内容，使用 {参数名} 作为占位符"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="savePrompt()">保存</button>
      </div>
    </div>
  </div>

  <script>
    const prompts = ${JSON.stringify(prompts, null, 2)};
    let currentCategory = 'all';
    let searchQuery = '';
    let editingId = null;
    let currentScene = null;
    let activeTag = null;
    let tagCloudExpanded = false;

    // 场景 → 标签映射
    const sceneMap = {
      init: ['首次使用', '初始化'],
      analyze: ['分析阶段'],
      dev: ['开发阶段'],
      finish: ['收尾阶段'],
      daily: ['日常', '进度追踪'],
      change: ['变更阶段', '需求调整']
    };

    // 收集所有标签
    function collectTags() {
      const counts = {};
      prompts.forEach(p => {
        (p.tags || []).forEach(tag => {
          counts[tag] = (counts[tag] || 0) + 1;
        });
      });
      return Object.entries(counts).sort((a, b) => b[1] - a[1]);
    }

    // 渲染标签云
    function renderTagCloud() {
      const tags = collectTags();
      const container = document.getElementById('tagCloud');
      const toggleBar = document.getElementById('tagToggleBar');
      if (!container) return;

      const needsToggle = tags.length > 6;
      container.className = 'tag-cloud ' + (tagCloudExpanded || !needsToggle ? 'expanded' : 'collapsed');

      let html = '<span class="tag-cloud-label">🏷️ 标签</span>';
      html += '<span class="tag' + (activeTag ? '' : ' active') + '" onclick="filterByTag(null)">全部</span>';
      tags.forEach(([tag, count]) => {
        const isActive = activeTag === tag;
        html += \`<span class="tag \${isActive ? 'active' : ''}" onclick="filterByTag('\${tag}')">\${tag}<span class="tag-count">\${count}</span></span>\`;
      });
      container.innerHTML = html;

      if (toggleBar) {
        toggleBar.innerHTML = needsToggle
          ? \`<span class="tag-toggle" onclick="toggleTagCloud()">\${tagCloudExpanded ? '▲ 收起' : '▼ 展开更多标签'}</span>\`
          : '';
        toggleBar.style.display = needsToggle ? 'block' : 'none';
      }
    }

    function toggleTagCloud() {
      tagCloudExpanded = !tagCloudExpanded;
      renderTagCloud();
    }

    // 初始化
    document.addEventListener('DOMContentLoaded', () => {
      renderTagCloud();
      render();
      document.getElementById('searchBox').addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        render();
      });
      document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          currentCategory = tab.dataset.category;
          render();
        });
      });
    });

    function filterByScene(scene) {
      if (currentScene === scene) {
        currentScene = null;
      } else {
        currentScene = scene;
      }
      document.querySelectorAll('.scene-card').forEach(c => {
        c.classList.toggle('active', c.dataset.scene === currentScene);
      });
      render();
    }

    function filterByTag(tag) {
      activeTag = tag;
      renderTagCloud();
      render();
    }

    function render() {
      const filtered = prompts.filter(p => {
        const matchCategory = currentCategory === 'all' || p.category === currentCategory;
        const matchSearch = !searchQuery ||
          p.name.toLowerCase().includes(searchQuery) ||
          p.description.toLowerCase().includes(searchQuery) ||
          p.prompt.toLowerCase().includes(searchQuery);
        const matchScene = !currentScene || (p.tags || []).some(t => sceneMap[currentScene].includes(t));
        const matchTag = !activeTag || (p.tags || []).includes(activeTag);
        return matchCategory && matchSearch && matchScene && matchTag;
      });

      const builtin = filtered.filter(p => p.builtin);
      const custom = filtered.filter(p => !p.builtin);

      let html = '';

      if (builtin.length > 0) {
        html += '<h2 class="section-title">📌 预置模板</h2>';
        html += '<div class="prompt-grid">';
        html += builtin.map(p => renderCard(p)).join('');
        html += '</div>';
      }

      if (custom.length > 0) {
        html += '<h2 class="section-title">✏️ 我的提示词</h2>';
        html += '<div class="prompt-grid">';
        html += custom.map(p => renderCard(p)).join('');
        html += '</div>';
      }

      if (filtered.length === 0) {
        html = '<div class="empty-state"><div class="empty-state-icon">🔍</div><p>没有找到匹配的提示词</p></div>';
      }

      document.getElementById('content').innerHTML = html;
    }

    function renderCard(p) {
      const badge = p.builtin
        ? '<span class="badge badge-builtin">预置</span>'
        : '<span class="badge badge-custom">自定义</span>';

      const hasCommand = p.command && p.command.trim();
      const cmdBlock = hasCommand
        ? \`<div class="prompt-section">⌨️ 触发命令</div><div class="prompt-cmd">\${escapeHtml(p.command)}</div>\`
        : '';

      const copyCmdBtn = hasCommand
        ? \`<button class="btn btn-cmd" onclick="copyCommand('\${p.id}')">⌨️ 复制命令</button>\`
        : '';

      const tagsHtml = (p.tags || []).length > 0
        ? \`<div class="prompt-tags">\${p.tags.map(t => \`<span class="prompt-tag">\${t}</span>\`).join('')}</div>\`
        : '';

      const env = p.env || (hasCommand ? 'both' : 'ai');
      const envHintMap = {
        cli: \`<div class="env-hint cli">💡 纯终端命令，即时生效（无 AI 参与）</div>\`,
        both: \`<div class="env-hint cli">💡 终端触发，AI 自动执行</div>\`,
        ai: \`<div class="env-hint ai">💡 建议在 AI 对话框中使用</div>\`
      };
      const envHint = envHintMap[env] || envHintMap.ai;

      return \`
        <div class="prompt-card">
          <div class="prompt-header">
            <div class="prompt-icon">\${p.icon || '📝'}</div>
            <div class="prompt-title">
              <h3>\${p.name} \${badge}</h3>
              <p>\${p.description || ''}</p>
            </div>
          </div>
          \${tagsHtml}
          \${envHint}
          <div class="prompt-section">💬 AI 说法</div>
          <div class="prompt-say">\${escapeHtml(p.prompt)}</div>
          \${cmdBlock}
          <div class="prompt-actions">
            <button class="btn btn-say" onclick="copyPrompt('\${p.id}')">💬 复制说法</button>
            \${copyCmdBtn}
            \${!p.builtin ? \`
              <button class="btn btn-secondary" onclick="editPrompt('\${p.id}')">编辑</button>
              <button class="btn btn-secondary" onclick="deletePrompt('\${p.id}')">删除</button>
            \` : ''}
          </div>
        </div>
      \`;
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function copyPrompt(id) {
      const p = prompts.find(x => x.id === id);
      if (!p) return;
      
      if (p.params && p.params.length > 0) {
        showParamModal(p, 'say');
      } else {
        const text = '/spec-ask "' + p.prompt + '"';
        copyToClipboard(text, '💬 AI 说法已复制');
      }
    }

    function copyCommand(id) {
      const p = prompts.find(x => x.id === id);
      if (!p || !p.command) return;
      
      if (p.params && p.params.length > 0) {
        showParamModal(p, 'cmd');
      } else {
        copyToClipboard(p.command, '⌨️ 命令已复制');
      }
    }

    function showParamModal(p, mode) {
      const isSay = mode === 'say';
      const modal = document.createElement('div');
      modal.className = 'modal active';
      modal.dataset.mode = mode;
      modal.innerHTML = \`
        <div class="modal-content" style="max-width: 600px;">
          <div class="modal-header">
            <h2>\${p.icon || '📝'} \${p.name}</h2>
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
          </div>
          <div class="modal-body">
            <p style="color: #868e96; font-size: 13px; margin-bottom: 16px;">\${p.description || '请填写以下参数'}</p>
            \${p.params.map(param => \`
              <div class="form-group">
                <label>\${param.key} \${param.required ? '<span style="color: #e03131;">*</span>' : ''}</label>
                <input type="text" id="param-\${param.key}" placeholder="\${param.placeholder || ''}" value="\${param.placeholder || ''}" oninput="updatePreview('\${p.id}', '\${mode}')">
              </div>
            \`).join('')}
            <div class="form-group" style="margin-top: 20px;">
              <label style="font-weight: 600; color: #495057;">\${isSay ? '💬 预览（AI 说法）' : '⌨️ 预览（触发命令）'}</label>
              <div id="preview-box" style="\${isSay
                ? 'background: #e7f5ff; border-radius: 8px; padding: 12px; font-size: 13px; color: #1864ab; line-height: 1.6; min-height: 60px; border: 1px solid #74c0fc;'
                : 'background: #212529; border-radius: 8px; padding: 12px; font-size: 12px; color: #69db7c; line-height: 1.6; min-height: 60px; border: 1px solid #495057; font-family: monospace;'
              }">
                \${escapeHtml(isSay ? p.prompt : (p.command || ''))}
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">取消</button>
            <button class="btn \${isSay ? 'btn-say' : 'btn-cmd'}" onclick="submitParams('\${p.id}', '\${mode}')">\${isSay ? '💬 复制说法' : '⌨️ 复制命令'}</button>
          </div>
        </div>
      \`;
      document.body.appendChild(modal);
      
      setTimeout(() => {
        const firstInput = modal.querySelector('input');
        if (firstInput) firstInput.focus();
      }, 100);
    }

    function updatePreview(id, mode) {
      const p = prompts.find(x => x.id === id);
      if (!p) return;
      
      const isSay = mode === 'say';
      let text = isSay ? p.prompt : (p.command || '');
      
      p.params.forEach(param => {
        const input = document.getElementById('param-' + param.key);
        const value = input ? input.value.trim() : '';
        if (value) {
          text = text.replace(new RegExp('\\{' + param.key + '\\}', 'g'), value);
        }
      });
      
      const previewBox = document.getElementById('preview-box');
      if (previewBox) {
        if (isSay) {
          previewBox.innerHTML = '<strong>/spec-ask "</strong>' + escapeHtml(text) + '<strong>"</strong>';
        } else {
          previewBox.textContent = text;
        }
      }
    }

    function submitParams(id, mode) {
      const p = prompts.find(x => x.id === id);
      if (!p) return;
      
      const isSay = mode === 'say';
      let text = isSay ? p.prompt : (p.command || '');
      let allFilled = true;
      
      p.params.forEach(param => {
        const input = document.getElementById('param-' + param.key);
        const value = input ? input.value.trim() : '';
        
        if (param.required && !value) {
          allFilled = false;
          input.style.borderColor = '#e03131';
        } else {
          input.style.borderColor = '#e9ecef';
          text = text.replace(new RegExp('\\{' + param.key + '\\}', 'g'), value);
        }
      });
      
      if (!allFilled) {
        showToast('⚠️ 请填写必填参数');
        return;
      }
      
      const modal = document.querySelector('.modal.active');
      if (modal) modal.remove();
      
      const finalText = isSay ? ('/spec-ask "' + text + '"') : text;
      copyToClipboard(finalText, isSay ? '💬 AI 说法已复制' : '⌨️ 命令已复制');
    }

    function copyToClipboard(text, msg) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(msg || '✅ 已复制到剪贴板');
      }).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast(msg || '✅ 已复制到剪贴板');
      });
    }

    function openCreateModal() {
      editingId = null;
      document.getElementById('modalTitle').textContent = '新建提示词';
      document.getElementById('editName').value = '';
      document.getElementById('editCategory').value = 'custom';
      document.getElementById('editIcon').value = '📝';
      document.getElementById('editDescription').value = '';
      document.getElementById('editPrompt').value = '';
      document.getElementById('editModal').classList.add('active');
    }

    function editPrompt(id) {
      const p = prompts.find(x => x.id === id);
      if (!p || p.builtin) return;
      
      editingId = id;
      document.getElementById('modalTitle').textContent = '编辑提示词';
      document.getElementById('editName').value = p.name;
      document.getElementById('editCategory').value = p.category;
      document.getElementById('editIcon').value = p.icon || '📝';
      document.getElementById('editDescription').value = p.description || '';
      document.getElementById('editPrompt').value = p.prompt;
      document.getElementById('editModal').classList.add('active');
    }

    function closeModal() {
      document.getElementById('editModal').classList.remove('active');
    }

    function savePrompt() {
      const name = document.getElementById('editName').value.trim();
      const prompt = document.getElementById('editPrompt').value.trim();
      
      if (!name || !prompt) {
        alert('请填写名称和提示词内容');
        return;
      }

      const data = {
        id: editingId || 'custom-' + Date.now(),
        name,
        category: document.getElementById('editCategory').value,
        icon: document.getElementById('editIcon').value || '📝',
        description: document.getElementById('editDescription').value.trim(),
        prompt,
        params: extractParams(prompt),
        builtin: false,
        sort: 99,
        createdAt: editingId ? undefined : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // 保存到 localStorage
      const stored = JSON.parse(localStorage.getItem('speccore-user-prompts') || '[]');
      if (editingId) {
        const idx = stored.findIndex(p => p.id === editingId);
        if (idx >= 0) stored[idx] = { ...stored[idx], ...data };
      } else {
        stored.push(data);
      }
      localStorage.setItem('speccore-user-prompts', JSON.stringify(stored));

      // 更新内存数据
      if (editingId) {
        const idx = prompts.findIndex(p => p.id === editingId);
        if (idx >= 0) prompts[idx] = { ...prompts[idx], ...data };
      } else {
        prompts.push(data);
      }

      closeModal();
      render();
      showToast(editingId ? '✅ 已更新' : '✅ 已创建');
    }

    function deletePrompt(id) {
      if (!confirm('确定要删除这个提示词吗？')) return;
      
      const idx = prompts.findIndex(p => p.id === id);
      if (idx >= 0) prompts.splice(idx, 1);
      
      const stored = JSON.parse(localStorage.getItem('speccore-user-prompts') || '[]');
      const filtered = stored.filter(p => p.id !== id);
      localStorage.setItem('speccore-user-prompts', JSON.stringify(filtered));
      
      render();
      showToast('✅ 已删除');
    }

    function extractParams(text) {
      const matches = text.match(/\{([^}]+)\}/g) || [];
      return matches.map(m => ({
        key: m.slice(1, -1),
        placeholder: '',
        required: false
      }));
    }

    function showToast(msg) {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.textContent = msg;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    }

    // 加载 localStorage 中的用户提示词
    const userStored = JSON.parse(localStorage.getItem('speccore-user-prompts') || '[]');
    userStored.forEach(p => {
      if (!prompts.find(x => x.id === p.id)) prompts.push(p);
    });
  </script>
</body>
</html>`;
}
