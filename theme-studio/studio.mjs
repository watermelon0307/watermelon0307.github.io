import { createOfficialThemes, forkTheme, updateToken, resolveTheme, compileTheme, DEFAULT_MATERIAL, safeClone, hexToRgb } from './core.mjs';
import { OwnedCanvasSceneProvider } from './materials/scene-provider.mjs';
import { GlassRuntime } from './glass-runtime.mjs';
import { ThemeRepository, DraftAutosaver } from './persistence.mjs';
import { exportWarmthTheme, inspectWarmthTheme, importWarmthTheme } from './package.mjs';
import { ActivationService, applyCompiledTheme } from './runtime-bridge.mjs';
import { CommandHistory, createSnapshot, diffDocuments } from './history.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icons = {
  undo: '<path d="M9 7 4 12l5 5M5 12h8a5 5 0 0 1 5 5"/>', redo: '<path d="m15 7 5 5-5 5m4-5h-8a5 5 0 0 0-5 5"/>',
  save: '<path d="M5 3h12l3 3v15H4V3h1Zm3 0v6h8V3M8 21v-7h8v7"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 18v3h16v-3"/>', upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 18v3h16v-3"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>', publish: '<path d="M12 21V9m-5 5 5-5 5 5M5 4h14"/>',
  layers: '<path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>', compare: '<path d="M12 3v18M3 5h6v14H3zM15 5h6v14h-6z"/>',
  panel: '<path d="M4 4h16v16H4zM4 9h16M9 9v11"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.panel}</svg>`;
const fixtureContent = {
  chat: { eyebrow: 'CHAT / GLASS SURFACE 01', title: '晚安，今天想聊什麼？', body: '短訊息、長訊息與語音預覽使用獨立 fixture，不讀取私人聊天。', bubble: '這是一段實際折射背景上的訊息。', action: '預覽按鈕' },
  desktop: { eyebrow: 'DESKTOP / WIDGET', title: '今日桌面', body: '桌面與小工具只改變視覺 token，不修改 widget 資料。', bubble: '專注  28 min', action: '開啟預覽' },
  social: { eyebrow: 'SOCIAL / LONG POST', title: '城市裡的慢速散步', body: '長貼文、空狀態與錯誤狀態都在同一 renderer 驗證。', bubble: '沒有公開發佈任何內容。', action: '檢視貼文' },
  story: { eyebrow: 'STORY / DIALOGUE', title: '雨停之後，霓虹仍然溫熱。', body: '劇情字幕 fixture 與遊戲存檔完全隔離。', bubble: '旁白：下一站，往河堤。', action: '繼續預覽' }
};
function templateMarkup() {
  return `<div class="warmth-theme-studio bottom-collapsed" data-theme-studio>
    <canvas class="ts-scene" aria-hidden="true"></canvas><canvas class="ts-compositor" aria-hidden="true"></canvas>
    <header class="ts-top ts-chrome">
      <button class="ts-icon-button ts-mobile-toggle" data-action="toggle-library" aria-label="開啟模板庫">${icon('layers')}</button>
      <div class="ts-brand"><span class="ts-mark">W/</span><div><div class="ts-title">WARMTH Theme Studio</div><div class="ts-subtitle">THEME ENGINE · MATERIAL LAB · LOCAL WORKSPACE</div></div></div>
      <div class="ts-top-actions">
        <button class="ts-icon-button ts-mobile-actions" data-action="toggle-actions" title="更多操作" aria-label="更多操作" aria-expanded="false">${icon('more')}</button>
        <button class="ts-icon-button" data-action="undo" title="Undo" aria-label="Undo">${icon('undo')}</button><button class="ts-icon-button" data-action="redo" title="Redo" aria-label="Redo">${icon('redo')}</button><span class="ts-divider"></span>
        <button class="ts-tool" data-action="compare" title="A/B 對照">${icon('compare')}<span class="label">A/B</span></button>
        <button class="ts-tool" data-action="save" title="保存草稿">${icon('save')}<span class="label">保存</span></button>
        <button class="ts-tool" data-action="export" title="匯出 .warmththeme">${icon('download')}<span class="label">匯出</span></button>
        <button class="ts-tool" data-action="import" title="匯入主題">${icon('upload')}<span class="label">匯入</span></button>
        <button class="ts-tool" data-action="publish" title="本地正式版本">${icon('publish')}<span class="label">Publish</span></button>
        <button class="ts-tool primary" data-action="apply" title="驗證並啟用">${icon('play')}<span class="label">啟用</span></button>
        <button class="ts-icon-button" data-action="close" title="返回 WARMTH" aria-label="返回 WARMTH">${icon('close')}</button>
      </div>
    </header>
    <nav class="ts-mobile-action-sheet ts-chrome" aria-label="手機版編輯操作">
      <button class="ts-tool" data-action="undo">${icon('undo')}<span>Undo</span></button>
      <button class="ts-tool" data-action="redo">${icon('redo')}<span>Redo</span></button>
      <button class="ts-tool" data-action="save">${icon('save')}<span>保存草稿</span></button>
      <button class="ts-tool" data-action="publish">${icon('publish')}<span>本地 Publish</span></button>
    </nav>
    <aside class="ts-library ts-chrome"><div class="ts-panel-head"><span>模板與草稿</span><small>LOCAL / IDB</small></div><div class="ts-panel-scroll" data-library></div></aside>
    <section class="ts-fixture" aria-label="實際主題預覽">
      <div class="ts-surface ts-card-a" data-surface="a"></div><div class="ts-surface ts-card-b" data-surface="b"></div><div class="ts-surface ts-card-c" data-surface="c"></div><div class="ts-surface ts-card-a ts-compare-b" data-surface="compare"></div>
      <article class="ts-copy ts-card-a" data-copy="main"></article><article class="ts-copy ts-card-b"><span class="eyebrow">DEVICE / WIDGET</span><h2>場景取樣</h2><p>Checkerboard · Text · Direction</p><div class="ts-widget-grid"><span>08:24</span><span>24°</span><span>72%</span></div><div class="ts-action">Actual sampling</div></article>
      <article class="ts-copy ts-card-c"><span class="eyebrow">FOREGROUND / SAFE CONTENT</span><h2>玻璃之後，文字仍然清晰。</h2><p>前景互動不進入背景 texture； renderer 不擋點擊。</p></article><article class="ts-copy ts-card-a ts-compare-b" data-copy="compare"></article>
    </section>
    <aside class="ts-inspector ts-chrome"><div class="ts-panel-head" data-action="toggle-inspector"><span>Inspector</span><small data-draft-status>UNSAVED</small></div><div class="ts-tabs"><button class="ts-tab active" data-inspector-tab="material">材質</button><button class="ts-tab" data-inspector-tab="tokens">Tokens</button><button class="ts-tab" data-inspector-tab="layers">圖層</button><button class="ts-tab" data-inspector-tab="settings">場景</button></div><div class="ts-inspector-body" data-inspector></div></aside>
    <section class="ts-bottom ts-chrome"><div class="ts-tabs"><button class="ts-tab active" data-bottom-tab="performance">Performance</button><button class="ts-tab" data-bottom-tab="source">Source map</button><button class="ts-tab" data-bottom-tab="history">History</button><button class="ts-tab" data-bottom-tab="diagnostics">Diagnostics</button><button class="ts-icon-button ts-bottom-close" data-action="toggle-bottom" aria-label="收合底部面板">−</button></div><div class="ts-bottom-content" data-bottom></div></section>
    <footer class="ts-status"><span data-save-state>UNSAVED</span><span data-backend>INITIALIZING</span><span class="hide-small" data-sampling></span><span class="status-right" style="margin-left:auto" data-stats></span></footer>
    <input type="file" accept=".warmththeme,.zip" data-file hidden><div class="ts-toast" role="status" aria-live="polite"></div><div data-modal></div>
  </div>`;
}
const materialControls = [
  ['bevelPx', 'Bevel', 1, 48, 1, 'px'], ['thicknessPx', 'Thickness', 0, 80, 1, 'px'], ['ior', 'IOR', 1, 1.8, .01, ''],
  ['distortionPx', 'Distortion', 0, 32, 1, 'px'], ['maxDisplacementPx', 'Max displacement', 0, 48, 1, 'px'], ['dispersionPx', 'RGB dispersion', 0, 3, .1, 'px'],
  ['blurPx', 'Sampling blur', 0, 24, .5, 'px'], ['tintOpacity', 'Tint opacity', 0, 1, .01, ''], ['saturation', 'Saturation', 0, 2, .01, ''],
  ['edgeStrength', 'Edge glint', 0, 2, .01, ''], ['edgeWidthPx', 'Glint width', .1, 4, .1, 'px'], ['lightAngleRad', 'Light angle', -3.1416, 3.1416, .01, 'rad'],
  ['highlightStrength', 'Highlight', 0, 1, .01, ''], ['shadowOpacity', 'Shadow opacity', 0, 1, .01, '']
];
function materialMarkup(material) {
  return `<details open><summary>Optical geometry</summary><div class="ts-control"><div class="ts-control-label"><span>Backend</span><code>single renderer</code></div><select data-material="mode" aria-label="材質 backend">${['auto', 'webgl', 'svg', 'css', 'solid'].map(value => `<option value="${value}"${material.mode === value ? ' selected' : ''}>${value === 'auto' ? 'Auto / probe' : value.toUpperCase()}</option>`).join('')}</select></div>
  <div class="ts-control"><div class="ts-control-label"><span>Corner radii</span><code>TL · TR · BR · BL</code></div><div class="ts-control-row four">${material.radius.map((value, index) => `<input type="number" min="0" max="200" step="1" value="${value}" data-radius="${index}" aria-label="圓角 ${index + 1}">`).join('')}</div></div>
  ${materialControls.slice(0, 3).map(control => rangeMarkup(control, material)).join('')}</details>
  <details open><summary>Refraction & dispersion</summary>${materialControls.slice(3, 7).map(control => rangeMarkup(control, material)).join('')}</details>
  <details open><summary>Tint & directional glint</summary><div class="ts-control"><div class="ts-control-label"><span>Glass tint</span><code>HEX</code></div><div class="ts-control-row color"><input type="color" value="${material.tint.slice(0, 7)}" data-material="tint" aria-label="玻璃 tint"><input type="text" value="${material.tint}" data-material-hex="tint" aria-label="玻璃 tint HEX"></div></div>${materialControls.slice(7).map(control => rangeMarkup(control, material)).join('')}</details>
  <div class="ts-select-row" style="padding:12px 0"><button class="ts-tool" data-action="discard-preview">還原未提交</button><button class="ts-tool" data-action="reset-material">恢復官方材質</button></div><p style="color:var(--ts-muted);font-size:10px">WebGL / SVG 是折射路徑；CSS 只標示 frosted fallback。IOR 與 thickness 為藝術近似。</p>`;
}
function rangeMarkup([key, label, min, max, step, unit], material) { const value = material[key]; return `<div class="ts-control"><div class="ts-control-label"><label for="ts-${key}">${label}</label><code>${value}${unit}</code></div><div class="ts-control-row"><input id="ts-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-material="${key}"><input type="number" min="${min}" max="${max}" step="${step}" value="${value}" data-material-number="${key}" aria-label="${label} 數值"></div></div>`; }

class ThemeStudio {
  constructor(container, registry) {
    this.container = container; this.registry = registry; this.official = createOfficialThemes(registry); this.root = null; this.draft = null; this.history = null;
    this.transientDraft = null; this.inspectorTab = 'material'; this.bottomTab = 'performance'; this.context = { mode: 'light', app: 'studio', page: 'preview', viewportWidth: innerWidth };
    this.fixture = 'chat'; this.compare = false; this.disposed = false; this.surfaceIds = {}; this.projects = []; this.lastStats = null; this.selectedPath = 'component.material.surface';
    this.repository = new ThemeRepository(); this.activation = new ActivationService(this.repository, { themes: this.official, healthCheck: async prepared => Object.keys(prepared.compiled.variables).length > 10 });
    this.handleClick = event => this.onClick(event); this.handleInput = event => this.onInput(event, false); this.handleChange = event => this.onInput(event, true);
    this.handleFile = event => this.onFile(event); this.handleResize = () => this.resize(); this.handleKey = event => this.onKey(event);
  }
  async init() {
    this.container.innerHTML = templateMarkup(); this.root = this.container.querySelector('[data-theme-studio]');
    this.root.addEventListener('click', this.handleClick); this.root.addEventListener('input', this.handleInput); this.root.addEventListener('change', this.handleChange);
    this.root.querySelector('[data-file]').addEventListener('change', this.handleFile); window.addEventListener('resize', this.handleResize); window.addEventListener('keydown', this.handleKey);
    this.projects = await this.repository.listProjects(); let document = null;
    const latest = [...this.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]; if (latest) document = await this.repository.getDraft(latest.id);
    this.setDocument(document || forkTheme(this.official['liquid-aurora'], `my-theme-${Date.now().toString(36)}`, '我的 Liquid Aurora'), { save: !document });
    this.setupScene(); this.renderLibrary(); this.renderInspector(); this.renderBottom(); this.refreshPreview(); this.resize();
    this.unsubscribe = this.repository.onChange(change => {
      if (change.projectId === this.draft?.id && change.source !== this.autosaver?.source && change.revision > (this.autosaver?.savedRevision || 0)) {
        this.toast(`另一分頁已保存 revision ${change.revision}；目前草稿未自動覆寫，請先匯出或重新載入。`, true); this.setSaveStatus('conflict');
      }
    });
    return this;
  }
  setDocument(document, { save = false } = {}) {
    this.draft = safeClone(document); this.transientDraft = null; this.history = new CommandHistory(this.draft); this.autosaver?.dispose();
    this.autosaver = new DraftAutosaver(this.repository, { onStatus: (status, detail) => this.setSaveStatus(status, detail) });
    if (save) this.autosaver.schedule(this.draft); this.refreshPreview?.(); this.renderInspector?.(); this.renderBottom?.();
  }
  setupScene() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.provider = new OwnedCanvasSceneProvider(innerWidth, innerHeight, (ctx, size) => this.drawScene(ctx, size), { pixelRatio: dpr });
    this.sceneCanvas = this.root.querySelector('.ts-scene'); this.sceneContext = this.sceneCanvas.getContext('2d');
    this.runtime = new GlassRuntime(this.root.querySelector('.ts-compositor'), this.provider, { onStatus: stats => this.onGlassStatus(stats) });
    for (const name of ['a', 'b', 'c', 'compare']) this.surfaceIds[name] = this.runtime.register(this.root.querySelector(`[data-surface="${name}"]`), this.material(), { fallbackColor: '#F4F0EA' });
    this.provider.capture(); this.drawVisibleScene();
  }
  material(document = this.transientDraft || this.draft) {
    if (!document) return { ...DEFAULT_MATERIAL };
    const resolved = resolveTheme(document, this.context, { themes: this.official }); return { ...DEFAULT_MATERIAL, ...resolved.tokens['primitive.material.default'] };
  }
  drawScene(ctx, { width, height }) {
    const resolved = this.resolved || resolveTheme(this.draft, this.context, { themes: this.official }), t = resolved.tokens;
    const background = t['semantic.background.default'], surface = t['semantic.surface.default'], accent = t['semantic.action.primary'], ink = t['semantic.text.primary'];
    const gradient = ctx.createLinearGradient(0, 0, width, height); gradient.addColorStop(0, background); gradient.addColorStop(.58, surface); gradient.addColorStop(1, background); ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    const cell = Math.max(34, Math.round(Math.min(width, height) / 13));
    ctx.save(); ctx.globalAlpha = .16; for (let y = 0; y < height; y += cell) for (let x = 0; x < width; x += cell) if ((x / cell + y / cell) % 2 === 0) { ctx.fillStyle = ink; ctx.fillRect(x, y, cell, cell); } ctx.restore();
    ctx.save(); ctx.globalAlpha = .75; ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(width * .79, height * .14, Math.min(width, height) * .18, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = .18; ctx.beginPath(); ctx.arc(width * .19, height * .86, Math.min(width, height) * .28, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.fillStyle = ink; ctx.globalAlpha = .16; ctx.font = `600 ${Math.max(70, width * .095)}px Inter, system-ui`; ctx.fillText('WARMTH', width * .035, height * .27); ctx.globalAlpha = 1;
    ctx.font = '12px ui-monospace, monospace'; ctx.fillText('ACTUAL OWNED SCENE / CHECKERBOARD / TEXT / DIRECTION →', 28, height - 30);
    ctx.strokeStyle = accent; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(width - 92, height * .52); ctx.lineTo(width - 42, height * .52 - 35); ctx.lineTo(width - 42, height * .52 + 35); ctx.closePath(); ctx.stroke();
  }
  drawVisibleScene() {
    if (!this.provider?.source || !this.sceneContext) return;
    if (this.sceneCanvas.width !== this.provider.source.width) this.sceneCanvas.width = this.provider.source.width;
    if (this.sceneCanvas.height !== this.provider.source.height) this.sceneCanvas.height = this.provider.source.height;
    this.sceneContext.setTransform(1, 0, 0, 1, 0, 0); this.sceneContext.clearRect(0, 0, this.sceneCanvas.width, this.sceneCanvas.height); this.sceneContext.drawImage(this.provider.source, 0, 0);
  }
  resize() {
    if (this.disposed || !this.provider) return; const dpr = Math.min(devicePixelRatio || 1, 2); this.provider.resize(innerWidth, innerHeight, dpr); this.context.viewportWidth = innerWidth;
    this.runtime.invalidateScene('viewport-resize'); this.refreshPreview(false);
  }
  onGlassStatus(stats) { this.lastStats = stats; this.drawVisibleScene(); this.renderStatus(); if (this.bottomTab === 'performance') this.renderBottom(); }
  refreshPreview(renderNow = true) {
    if (!this.draft || !this.runtime) return;
    const document = this.transientDraft || this.draft; this.resolved = resolveTheme(document, this.context, { themes: this.official });
    const baseline = resolveTheme(this.official[document.parent?.id] || this.official['liquid-aurora'], this.context, { themes: this.official }); this.baselineResolved = baseline;
    this.root.querySelectorAll('.ts-copy,.ts-surface').forEach(copy => { const compiled = compileTheme(copy.dataset.copy === 'compare' || copy.dataset.surface === 'compare' ? baseline : this.resolved); for (const [key, value] of Object.entries(compiled.variables)) copy.style.setProperty(key, value); });
    const content = fixtureContent[this.fixture]; for (const element of this.root.querySelectorAll('[data-copy="main"],[data-copy="compare"]')) element.innerHTML = `<span class="eyebrow">${esc(content.eyebrow)}${element.dataset.copy === 'compare' ? ' / BASELINE' : ''}</span><h2>${esc(content.title)}</h2><p>${esc(content.body)}</p><div class="ts-chat-line"><span class="ts-avatar"></span><span class="ts-bubble">${esc(content.bubble)}</span></div><span class="ts-action">${esc(content.action)}</span>`;
    this.runtime.update(this.surfaceIds.a, this.resolved.tokens['primitive.material.default']); this.runtime.update(this.surfaceIds.b, this.resolved.tokens['primitive.material.default']); this.runtime.update(this.surfaceIds.c, this.resolved.tokens['primitive.material.default']);
    this.runtime.update(this.surfaceIds.compare, baseline.tokens['primitive.material.default']); this.provider.invalidate('theme'); if (renderNow) this.runtime.render(['theme', 'fixture']); else this.runtime.scheduler.invalidate('theme');
    this.renderStatus();
  }
  commit(next, label) {
    try { const document = this.history.execute(label, next, { affectedIds: [this.draft.id] }); this.draft = document; this.transientDraft = null; this.autosaver.schedule(document); this.refreshPreview(); this.renderInspector(); this.renderBottom(); this.renderLibrary(); return true; }
    catch (error) { this.toast(error.message, true); return false; }
  }
  setSaveStatus(status, detail) {
    const labels = { unsaved: 'UNSAVED', saving: 'SAVING…', saved: 'SAVED / LOCAL', error: 'SAVE ERROR', conflict: 'CONFLICT' }, text = labels[status] || status.toUpperCase();
    const draft = this.root?.querySelector('[data-draft-status]'), save = this.root?.querySelector('[data-save-state]'); if (draft) draft.textContent = text; if (save) { save.textContent = text; save.className = status === 'error' || status === 'conflict' ? 'error' : status === 'saved' ? 'live' : ''; }
    if (status === 'error') this.toast(`保存失敗：${detail?.message || '未知錯誤'}；已嘗試保留救援副本。`, true);
  }
  renderStatus() {
    if (!this.root) return; const stats = this.lastStats, backend = this.root.querySelector('[data-backend]'), sampling = this.root.querySelector('[data-sampling]'), numbers = this.root.querySelector('[data-stats]');
    const actual = stats?.backend === 'webgl'; backend.textContent = actual ? 'WEBGL / REFRACTION' : stats?.backend === 'solid' ? 'SOLID FALLBACK' : 'CSS / FROSTED FALLBACK'; backend.className = actual ? 'live' : stats?.error ? 'error' : '';
    sampling.textContent = stats?.sampling === 'owned-scene' ? 'ACTUAL SCENE SAMPLING' : stats?.sampling === 'wallpaper-only' ? 'WALLPAPER ONLY' : 'NO SCENE TEXTURE';
    numbers.textContent = stats ? `${stats.quality || '—'} · DRAW ${stats.drawn || 0} · UPLOAD ${stats.uploadCount || 0} · ${(stats.frameMs || 0).toFixed(1)} ms` : '';
  }
  toast(message, error = false) { const element = this.root.querySelector('.ts-toast'); element.textContent = message; element.classList.toggle('error', error); element.classList.add('show'); clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => element.classList.remove('show'), error ? 6500 : 2800); }

  async renderLibrary() {
    const library = this.root?.querySelector('[data-library]'); if (!library) return;
    const officialRows = Object.values(this.official).map(doc => `<button class="ts-template${this.draft?.parent?.id === doc.id && !this.projects.some(p => p.id === this.draft?.id) ? ' active' : ''}" data-official="${doc.id}"><span class="ts-swatch" style="background:${doc.tokens.primitive['color.bg'].value}"><i style="background:${doc.tokens.primitive['color.accent'].value}"></i></span><span><strong>${esc(doc.name)}</strong><code>${doc.id}</code></span><span class="ts-mode">${doc.defaultMode}</span></button>`).join('');
    const drafts = [...this.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(project => `<button class="ts-template${project.id === this.draft?.id ? ' active' : ''}" data-draft="${esc(project.id)}"><span class="ts-swatch" style="background:#1e1e24"><i style="background:#00aaff"></i></span><span><strong>${esc(project.name)}</strong><code>rev ${project.revision} · ${esc(project.id)}</code></span><span class="ts-mode">draft</span></button>`).join('');
    library.innerHTML = `<div class="ts-section-label">Official templates · 8</div>${officialRows}<div class="ts-section-label">Private drafts · ${drafts.length}</div>${drafts || '<div class="ts-empty">編輯官方模板會建立私人草稿。</div>'}`;
  }
  renderInspector() {
    if (!this.root || !this.draft) return;
    this.root.querySelectorAll('[data-inspector-tab]').forEach(button => button.classList.toggle('active', button.dataset.inspectorTab === this.inspectorTab));
    const body = this.root.querySelector('[data-inspector]');
    if (this.inspectorTab === 'material') body.innerHTML = materialMarkup(this.material());
    else if (this.inspectorTab === 'tokens') body.innerHTML = this.tokensMarkup();
    else if (this.inspectorTab === 'layers') body.innerHTML = this.layersMarkup();
    else body.innerHTML = this.settingsMarkup();
  }
  tokensMarkup() {
    const doc = this.transientDraft || this.draft, resolved = resolveTheme(doc, this.context, { themes: this.official });
    const fields = [['primitive.color.bg', 'Background'], ['primitive.color.surface', 'Surface'], ['primitive.color.accent', 'Accent'], ['primitive.color.text', 'Text'], ['primitive.color.muted', 'Muted']];
    return `<details open><summary>Primitive color tokens</summary>${fields.map(([path, label]) => { const value = doc.tokens.primitive[path.replace('primitive.', '')].value; return `<div class="ts-control"><div class="ts-control-label"><span>${label}</span><code>${path}</code></div><div class="ts-control-row color"><input type="color" value="${value}" data-token-color="${path}" aria-label="${label}"><input type="text" value="${value}" data-token-hex="${path}" aria-label="${label} HEX"></div></div>`; }).join('')}</details>
    <details open><summary>Spacing & shape</summary>${['radius.sm', 'radius.md', 'radius.lg', 'space.1', 'space.2', 'space.3'].map(key => { const value = doc.tokens.primitive[key].value; return `<div class="ts-control"><div class="ts-control-label"><span>${key}</span><code>px</code></div><input type="number" min="0" max="128" step="1" value="${value}" data-dimension="primitive.${key}"></div>`; }).join('')}</details>
    <details><summary>Resolved aliases</summary><div class="ts-control"><label class="ts-control-label">Source token</label><select data-source-token>${Object.keys(resolved.tokens).filter(path => /button|chatBubble|card|material/.test(path)).map(path => `<option${path === this.selectedPath ? ' selected' : ''}>${path}</option>`).join('')}</select></div><p style="color:var(--ts-muted);font-size:10px">三層 alias 會保留；重新命名與缺值診斷可在 Source map 查看。</p></details>`;
  }
  layersMarkup() {
    const layers = [['scene', 'Owned scene / background'], ['a', 'Glass / primary preview'], ['b', 'Glass / widget'], ['c', 'Glass / foreground'], ['compare', 'Glass / A/B baseline']];
    return `<details open><summary>Preview layers</summary>${layers.map(([id, label]) => `<div class="ts-layer-row"><code>${label}</code><button data-layer="${id}" aria-pressed="${this.root.querySelector(`[data-surface="${id}"]`)?.style.display !== 'none'}" aria-label="切換 ${label} 可見度">◉</button></div>`).join('')}</details><details open><summary>Layer information</summary><p style="color:var(--ts-muted);font-size:10px">這些是實際 renderer surfaces。眼睛控制會同時改變 DOM 與 draw/culling；正式多畫板 node graph 屬後續 V2 gate，未標完成。</p></details>`;
  }
  settingsMarkup() {
    return `<details open><summary>Preview context</summary><div class="ts-control"><div class="ts-control-label"><span>Fixture</span><code>synthetic data</code></div><select data-context="fixture">${Object.keys(fixtureContent).map(value => `<option value="${value}"${this.fixture === value ? ' selected' : ''}>${value}</option>`).join('')}</select></div><div class="ts-control"><div class="ts-control-label"><span>Color mode</span><code>resolver context</code></div><select data-context="mode"><option value="light"${this.context.mode === 'light' ? ' selected' : ''}>Light</option><option value="dark"${this.context.mode === 'dark' ? ' selected' : ''}>Dark</option></select></div><div class="ts-control"><div class="ts-control-label"><span>Device preview</span><code>viewport CSS</code></div><select data-context="device"><option value="full">Full workspace</option><option value="tablet">Tablet / 768px</option><option value="phone">Phone / 390px</option></select></div></details>
    <details open><summary>Adaptive quality</summary><div class="ts-control"><div class="ts-control-label"><span>Quality tier</span><code>${this.runtime?.quality.level || 'initializing'}</code></div><select data-context="quality">${['Ultra', 'High', 'Balanced', 'Low', 'Safe'].map(value => `<option${this.runtime?.quality.level === value ? ' selected' : ''}>${value}</option>`).join('')}</select></div><div class="ts-control"><button class="ts-tool" data-action="retry-gpu">重建 WebGL context</button></div></details>
    <details><summary>Data boundary</summary><p style="color:var(--ts-muted);font-size:10px">僅 IndexedDB 本機保存，不是雲端同步。不儲存 API key、私人對話、遊戲存檔或帳號資料。</p></details>`;
  }
  renderBottom() {
    if (!this.root || !this.draft) return; this.root.querySelectorAll('[data-bottom-tab]').forEach(button => button.classList.toggle('active', button.dataset.bottomTab === this.bottomTab));
    const body = this.root.querySelector('[data-bottom]');
    if (this.bottomTab === 'performance') {
      const s = this.lastStats || {}; body.innerHTML = `<div class="ts-kpi"><span>Backend</span><b>${esc(s.backend || 'initializing')}</b><span>Sampling</span><b>${esc(s.sampling || 'none')}</b><span>Quality</span><b>${esc(s.quality || this.runtime?.quality.level)}</b><span>Draw / skipped</span><b>${s.drawn || 0} / ${s.skipped || 0}</b><span>Texture uploads</span><b>${s.uploadCount || 0}</b><span>Allocations</span><b>${s.allocationCount || 0}</b><span>Frame CPU time</span><b>${(s.frameMs || 0).toFixed(2)} ms</b><span>Dirty reasons</span><b>${esc((s.reasons || []).join(', '))}</b></div>`;
    } else if (this.bottomTab === 'source') {
      const source = this.resolved?.sourceMap[this.selectedPath]; body.innerHTML = `<div class="ts-source">${esc(this.selectedPath)}\n\n${esc(JSON.stringify({ value: this.resolved?.tokens[this.selectedPath], source }, null, 2))}</div>`;
    } else if (this.bottomTab === 'history') {
      const list = this.history.list(); body.innerHTML = list.length ? list.map(item => `<div class="ts-history-row"><span>${esc(item.label)} · ${esc(item.timestamp)}</span><span>${item.active ? 'APPLIED' : 'REDO'}</span></div>`).join('') : '<div class="ts-empty">尚無編輯命令。</div>';
    } else {
      const diagnostics = this.resolved?.diagnostics || []; body.innerHTML = diagnostics.length ? diagnostics.map(item => `<div class="ts-diagnostic ${item.severity}"><b>${esc(item.code)}</b> · ${esc(item.path)}<br>${esc(item.message)}</div>`).join('') : '<div class="ts-empty">目前 resolver 無錯誤或警告。WebGL / SVG / 真機狀態仍依各自 QA 證據。</div>';
    }
  }
  async onClick(event) {
    const button = event.target.closest('button,[data-action="toggle-inspector"]'); if (!button) return;
    if (button.dataset.official) { this.setDocument(forkTheme(this.official[button.dataset.official], `my-${button.dataset.official}-${Date.now().toString(36)}`, `${this.official[button.dataset.official].name} — 我的版本`), { save: true }); this.renderLibrary(); this.toast('已從不可變官方模板建立私人草稿'); return; }
    if (button.dataset.draft) { try { const doc = await this.repository.getDraft(button.dataset.draft); if (doc) { this.setDocument(doc); this.renderLibrary(); this.toast(`已載入 revision ${doc.revision}`); } } catch (error) { this.toast(error.message, true); } return; }
    if (button.dataset.inspectorTab) { this.inspectorTab = button.dataset.inspectorTab; this.renderInspector(); if (innerWidth <= 820) this.root.classList.add('show-inspector'); return; }
    if (button.dataset.bottomTab) { this.bottomTab = button.dataset.bottomTab; this.root.classList.remove('bottom-collapsed'); this.renderBottom(); return; }
    if (button.dataset.layer) { const id = button.dataset.layer, elements = id === 'scene' ? [this.sceneCanvas] : [...this.root.querySelectorAll(`[data-surface="${id}"]`)].concat(id === 'a' || id === 'compare' ? [...this.root.querySelectorAll(id === 'a' ? '[data-copy="main"]' : '[data-copy="compare"]')] : []); const visible = button.getAttribute('aria-pressed') !== 'true'; for (const element of elements) element.style.display = visible ? '' : 'none'; button.setAttribute('aria-pressed', String(visible)); this.runtime.scheduler.invalidate('layer-visibility'); return; }
    const action = button.dataset.action; if (!action) return;
    if (action === 'toggle-actions') {
      const open = this.root.classList.toggle('show-actions');
      button.setAttribute('aria-expanded', String(open));
      this.root.classList.remove('show-library', 'show-inspector');
      return;
    }
    this.root.classList.remove('show-actions');
    this.root.querySelector('[data-action="toggle-actions"]')?.setAttribute('aria-expanded', 'false');
    try {
      if (action === 'close') location.hash = '#/me';
      else if (action === 'undo' && this.history.canUndo) { this.draft = this.history.undo(); this.transientDraft = null; this.autosaver.schedule(this.draft); this.refreshPreview(); this.renderInspector(); this.renderBottom(); }
      else if (action === 'redo' && this.history.canRedo) { this.draft = this.history.redo(); this.transientDraft = null; this.autosaver.schedule(this.draft); this.refreshPreview(); this.renderInspector(); this.renderBottom(); }
      else if (action === 'save') { await this.autosaver.flush(); this.projects = await this.repository.listProjects(); await this.renderLibrary(); this.toast('草稿已保存到本機 IndexedDB'); }
      else if (action === 'compare') { this.compare = !this.compare; this.root.classList.toggle('is-compare', this.compare); this.runtime.scheduler.invalidate('compare-layout'); }
      else if (action === 'export') await this.export();
      else if (action === 'import') this.root.querySelector('[data-file]').click();
      else if (action === 'apply') await this.applyTheme();
      else if (action === 'publish') await this.publish();
      else if (action === 'toggle-bottom') this.root.classList.toggle('bottom-collapsed');
      else if (action === 'toggle-library') this.root.classList.toggle('show-library');
      else if (action === 'toggle-inspector' && innerWidth <= 820) this.root.classList.toggle('show-inspector');
      else if (action === 'discard-preview') { this.transientDraft = null; this.refreshPreview(); this.renderInspector(); }
      else if (action === 'reset-material') this.resetMaterial();
      else if (action === 'retry-gpu') { this.runtime.retry(); this.toast('已提交一次 GPU 重建；不會無限重試'); }
      else if (action === 'close-modal') this.closeModal();
    } catch (error) { this.toast(error.message, true); }
  }

  onInput(event, commit) {
    const target = event.target;
    if (target.dataset.context) {
      if (!commit) return; const key = target.dataset.context, value = target.value;
      if (key === 'fixture') this.fixture = value;
      else if (key === 'mode') this.context.mode = value;
      else if (key === 'quality') { this.runtime.setQuality(value); this.renderInspector(); return; }
      else if (key === 'device') { const fixture = this.root.querySelector('.ts-fixture'); fixture.style.left = value === 'phone' ? 'calc(50% - 195px)' : value === 'tablet' ? 'calc(50% - 384px)' : ''; fixture.style.right = value === 'phone' ? 'calc(50% - 195px)' : value === 'tablet' ? 'calc(50% - 384px)' : ''; this.runtime.scheduler.invalidate('device-preview'); return; }
      this.repository.saveSetting('studio-preview-context', { fixture: this.fixture, mode: this.context.mode }).catch(() => {}); this.refreshPreview(); return;
    }
    if (target.dataset.sourceToken) { this.selectedPath = target.value; this.bottomTab = 'source'; this.renderBottom(); return; }
    const materialKey = target.dataset.material || target.dataset.materialNumber;
    if (materialKey) {
      const current = this.material(), value = target.type === 'color' || target.dataset.material === 'mode' ? target.value : Number(target.value);
      if (typeof value === 'number' && !Number.isFinite(value)) { if (commit) this.renderInspector(); return; }
      const nextMaterial = { ...current, [materialKey]: value };
      if (materialKey === 'tint' && !hexToRgb(value)) return;
      try { this.transientDraft = updateToken(this.draft, 'primitive.material.default', { type: 'material', value: nextMaterial }); this.refreshPreview(!commit); if (commit) this.commit(this.transientDraft, `Material ${materialKey}`); else this.updateControlEcho(materialKey, value); }
      catch (error) { if (commit) { this.toast(error.message, true); this.transientDraft = null; this.renderInspector(); this.refreshPreview(); } }
      return;
    }
    if (target.dataset.radius != null) {
      const index = Number(target.dataset.radius), current = this.material(), radius = [...current.radius], value = Number(target.value); if (!Number.isFinite(value)) return; radius[index] = value;
      try { this.transientDraft = updateToken(this.draft, 'primitive.material.default', { type: 'material', value: { ...current, radius } }); if (commit) this.commit(this.transientDraft, `Radius ${index + 1}`); else this.refreshPreview(false); } catch (error) { if (commit) { this.toast(error.message, true); this.renderInspector(); } }
      return;
    }
    if (target.dataset.materialHex) {
      if (!commit) return; const key = target.dataset.materialHex, value = target.value.trim(); if (!hexToRgb(value)) { this.toast('HEX 必須是 #RRGGBB 或 #RRGGBBAA', true); this.renderInspector(); return; }
      const next = { ...this.material(), [key]: value }; this.commit(updateToken(this.draft, 'primitive.material.default', { type: 'material', value: next }), `Material ${key}`); return;
    }
    const colorPath = target.dataset.tokenColor || target.dataset.tokenHex;
    if (colorPath) {
      const value = target.value.trim(); if (!hexToRgb(value)) { if (commit) { this.toast('顏色格式無效；已保留最後合法樣式', true); this.renderInspector(); } return; }
      const parsed = colorPath.split('.'), key = parsed.slice(2).join('.');
      try { this.transientDraft = updateToken(this.draft, colorPath, { type: 'color', value }); if (commit || target.dataset.tokenHex) this.commit(this.transientDraft, `Token ${key}`); else { this.refreshPreview(false); this.updateTokenEcho(colorPath, value); } } catch (error) { if (commit) this.toast(error.message, true); }
      return;
    }
    if (target.dataset.dimension && commit) {
      const value = Number(target.value); if (!Number.isFinite(value)) { this.toast('尺寸必須是 finite number', true); this.renderInspector(); return; }
      this.commit(updateToken(this.draft, target.dataset.dimension, { type: 'dimension', value }), `Token ${target.dataset.dimension}`);
    }
  }
  updateControlEcho(key, value) { const control = this.root.querySelector(`[data-material="${key}"]`)?.closest('.ts-control'); control?.querySelector('.ts-control-label code') && (control.querySelector('.ts-control-label code').textContent = value); const number = this.root.querySelector(`[data-material-number="${key}"]`); if (number && number !== document.activeElement) number.value = value; }
  updateTokenEcho(path, value) { const hex = this.root.querySelector(`[data-token-hex="${path}"]`); if (hex) hex.value = value; }
  resetMaterial() { const parent = this.official[this.draft.parent?.id] || this.official['liquid-aurora']; const value = parent.tokens.primitive['material.default'].value; this.commit(updateToken(this.draft, 'primitive.material.default', { type: 'material', value: safeClone(value) }), 'Reset official material'); }
  async applyTheme() {
    this.toast('正在驗證、解析並執行健康檢查…'); await this.autosaver.flush();
    const active = await this.activation.activate(this.draft); this.projects = await this.repository.listProjects(); await this.renderLibrary(); this.toast(`已啟用 ${active.document.name}；LKG 已保存，本機核心資料未改變`);
  }
  async export() {
    const packed = await exportWarmthTheme(this.draft), blob = new Blob([packed.bytes], { type: 'application/x-warmththeme+zip' }), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${this.draft.id}.warmththeme`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); this.toast(`已匯出 ${packed.bytes.length.toLocaleString()} bytes；SHA-256 已寫入 manifest`);
  }
  async onFile(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('封裝超過 8 MiB 上限'); const bytes = new Uint8Array(await file.arrayBuffer()), inspected = await inspectWarmthTheme(bytes, { themes: this.official }); this.pendingImport = { bytes, inspected, fileName: file.name };
      const existing = await this.repository.getDraft(inspected.document.id); this.showModal(`<h2>匯入預覽</h2><p>僅完成驗證，尚未寫入。確認後會${existing ? '建立副本，不覆寫現有草稿' : '建立新的私人草稿'}。</p><dl><dt>File</dt><dd>${esc(file.name)}</dd><dt>Theme</dt><dd>${esc(inspected.document.name)}</dd><dt>ID</dt><dd>${esc(inspected.document.id)}</dd><dt>Revision</dt><dd>${inspected.document.revision}</dd><dt>Diagnostics</dt><dd>${inspected.diagnostics.length}</dd><dt>Assets</dt><dd>${Object.keys(inspected.assets).length}</dd></dl><div class="ts-modal-actions"><button class="ts-tool" data-action="close-modal">取消</button><button class="ts-tool primary" data-confirm-import>確認匯入${existing ? '副本' : ''}</button></div>`);
      this.root.querySelector('[data-confirm-import]').onclick = () => this.confirmImport();
    } catch (error) { this.toast(`匯入驗證失敗：${error.message}`, true); }
  }
  async confirmImport() {
    const button = this.root.querySelector('[data-confirm-import]'); if (button) button.disabled = true;
    try { const result = await importWarmthTheme(this.repository, this.pendingImport.bytes, { confirmed: true, conflict: 'copy', themes: this.official }); this.closeModal(); this.projects = await this.repository.listProjects(); this.setDocument(result.document); await this.renderLibrary(); this.toast('主題已交易式匯入；未從網路下載任何依賴'); }
    catch (error) { this.toast(`匯入未完成：${error.message}`, true); if (button) button.disabled = false; }
  }
  async publish() {
    const snapshot = await createSnapshot(this.draft, { releaseNotes: 'WARMTH Studio local release' }); await this.repository.saveVersion(this.draft.id, snapshot);
    this.showModal(`<h2>本地正式版本已建立</h2><p>此 Publish 是不可變本機快照，不是公開商城或雲端發佈。後續草稿編輯不會改變此版本。</p><dl><dt>Version ID</dt><dd>${snapshot.versionId}</dd><dt>SHA-256</dt><dd>${snapshot.hash}</dd><dt>Changes</dt><dd>${diffDocuments(this.official[this.draft.parent?.id] || this.draft, this.draft).length}</dd></dl><div class="ts-modal-actions"><button class="ts-tool primary" data-action="close-modal">完成</button></div>`);
  }
  showModal(content) { this.root.querySelector('[data-modal]').innerHTML = `<div class="ts-modal-backdrop" role="presentation"><section class="ts-modal ts-chrome" role="dialog" aria-modal="true">${content}</section></div>`; this.root.querySelector('.ts-modal button')?.focus(); }
  closeModal() { this.root.querySelector('[data-modal]').innerHTML = ''; this.pendingImport = null; }
  onKey(event) {
    if (event.key === 'Escape') { if (this.root.querySelector('.ts-modal-backdrop')) this.closeModal(); else { this.transientDraft = null; this.root.classList.remove('show-library', 'show-inspector', 'show-actions'); this.root.querySelector('[data-action="toggle-actions"]')?.setAttribute('aria-expanded', 'false'); this.refreshPreview(); } return; }
    const editing = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName); if (editing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); this.root.querySelector(`[data-action="${event.shiftKey ? 'redo' : 'undo'}"]`)?.click(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); this.root.querySelector('[data-action="save"]')?.click(); }
  }
  async dispose() {
    if (this.disposed) return; this.disposed = true; clearTimeout(this.toastTimer); this.unsubscribe?.(); await this.autosaver?.flush().catch(() => {}); await this.autosaver?.dispose();
    this.runtime?.dispose(); this.root?.removeEventListener('click', this.handleClick); this.root?.removeEventListener('input', this.handleInput); this.root?.removeEventListener('change', this.handleChange); window.removeEventListener('resize', this.handleResize); window.removeEventListener('keydown', this.handleKey);
    this.activation.controller?.abort(); this.repository.dispose(); this.container.innerHTML = ''; this.root = null;
  }
}
let cssPromise;
function ensureCSS() { if (document.querySelector('link[data-warmth-studio]')) return Promise.resolve(); cssPromise ||= new Promise((resolve, reject) => { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('./studio.css', import.meta.url).href; link.dataset.warmthStudio = 'true'; link.onload = resolve; link.onerror = () => reject(new Error('Studio CSS 載入失敗')); document.head.append(link); }); return cssPromise; }
export async function mountThemeStudio(container, { registryURL = new URL('../design-system/theme-index.json', import.meta.url) } = {}) {
  if (!container) throw new Error('找不到 Theme Studio route container'); await ensureCSS();
  const response = await fetch(registryURL); if (!response.ok) throw new Error(`主題 registry 載入失敗：${response.status}`); const registry = await response.json();
  const studio = new ThemeStudio(container, registry); return studio.init();
}
