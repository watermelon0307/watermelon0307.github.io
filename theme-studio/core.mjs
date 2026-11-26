/* WARMTH Theme Studio — independent, typed theme runtime. No AI or editor dependency. */
export const SCHEMA_VERSION = 1;
export const TOKEN_TIERS = Object.freeze(['primitive', 'semantic', 'component']);
export const FORBIDDEN_KEYS = Object.freeze(['__proto__', 'prototype', 'constructor']);
export const DEFAULT_MATERIAL = Object.freeze({
  mode: 'auto', radius: [24, 24, 24, 24], bevelPx: 18, thicknessPx: 42, ior: 1.46,
  distortionPx: 14, maxDisplacementPx: 32, dispersionPx: 0.8, blurPx: 1.5,
  tint: '#FFFFFF', tintOpacity: 0.08, saturation: 1.06, edgeStrength: 0.82,
  edgeWidthPx: 0.62, lightAngleRad: 0, highlightStrength: 0.72,
  shadowOpacity: 0.18, quality: 'auto', refresh: 'auto'
});

const TYPE_DEFAULTS = Object.freeze({
  color: '#000000', number: 0, dimension: 0, boolean: false, enum: '', font: 'system-ui',
  typography: { family: 'system-ui', size: 16, weight: 400, lineHeight: 1.5 },
  gradient: { angle: 180, stops: [{ color: '#000000', at: 0 }, { color: '#FFFFFF', at: 1 }] },
  shadow: { x: 0, y: 8, blur: 24, spread: 0, color: '#00000033' },
  border: { width: 1, style: 'solid', color: '#00000026' }, material: DEFAULT_MATERIAL,
  motion: { durationMs: 160, easing: { kind: 'cubicBezier', x1: 0.2, y1: 0, x2: 0, y2: 1 } }, asset: null
});
const MATERIAL_LIMITS = Object.freeze({
  bevelPx: [1, 48], thicknessPx: [0, 80], ior: [1, 1.8], distortionPx: [-32, 32],
  maxDisplacementPx: [0, 48], dispersionPx: [0, 3], blurPx: [0, 24], tintOpacity: [0, 1],
  saturation: [0, 2], edgeStrength: [0, 2], edgeWidthPx: [0.1, 4],
  lightAngleRad: [-Math.PI, Math.PI], highlightStrength: [0, 1], shadowOpacity: [0, 1]
});
const CSS_KEYS = Object.freeze({
  'semantic.background.default': '--bg', 'semantic.background.elevated': '--bg-2',
  'semantic.surface.default': '--surface', 'semantic.surface.secondary': '--surface-2',
  'semantic.text.primary': '--ink', 'semantic.text.secondary': '--ink-2',
  'semantic.text.muted': '--ink-3', 'semantic.action.primary': '--accent',
  'semantic.action.secondary': '--accent-2', 'semantic.action.onPrimary': '--on-accent',
  'semantic.border.subtle': '--line', 'semantic.status.error': '--danger',
  'semantic.focus.ring': '--focus-ring', 'component.card.radius': '--card-radius',
  'component.card.shadow': '--card-shadow', 'component.chatBubble.incoming.fill': '--chat-incoming',
  'component.chatBubble.outgoing.fill': '--chat-outgoing'
});

export function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
export function safeClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}
export function assertSafeKey(key, path = '') {
  if (FORBIDDEN_KEYS.includes(key)) throw new ThemeValidationError([diagnostic('UNSAFE_KEY', path, `禁止的 key：${key}`)]);
}
export function diagnostic(code, path, message, severity = 'error', related) {
  return { code, path, message, severity, ...(related ? { related } : {}) };
}
export class ThemeValidationError extends Error {
  constructor(diagnostics) { super(diagnostics.map(d => `${d.path}: ${d.message}`).join('\n')); this.name = 'ThemeValidationError'; this.diagnostics = diagnostics; }
}
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}
export async function sha256(value) {
  const text = typeof value === 'string' ? value : stableStringify(value);
  const bytes = new TextEncoder().encode(text);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
  const m = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}
export function rgbToHex({ r, g, b, a = 1 }) {
  const part = n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}${a < 1 ? part(a * 255) : ''}`.toUpperCase();
}
export function mixColor(a, b, amount) {
  const x = hexToRgb(a), y = hexToRgb(b);
  if (!x || !y) throw new Error('mixColor 只接受 HEX 色碼');
  return rgbToHex({ r: x.r + (y.r - x.r) * amount, g: x.g + (y.g - x.g) * amount, b: x.b + (y.b - x.b) * amount });
}
export function relativeLuminance(color) {
  const c = hexToRgb(color); if (!c) return 0;
  const channel = v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}
export function contrastRatio(a, b) {
  const x = relativeLuminance(a), y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function bestTextColor(background, light = '#FFFCF8', dark = '#231F29') {
  return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark;
}

function token(type, value) { return { type, value }; }
function alias(type, ref) { return { type, ref }; }
function alternatePalette(entry, mode) {
  const dark = entry.defaultMode === 'dark';
  if ((mode === 'dark') === dark) return null;
  if (mode === 'dark') {
    const background = mixColor(entry.background, '#111525', 0.86);
    const surface = mixColor(entry.surface, '#1D2030', 0.82);
    const text = mixColor(entry.text, '#F4F0EA', 0.9);
    return { background, surface, text, muted: mixColor(text, surface, 0.34) };
  }
  const background = mixColor(entry.background, '#F4F0EA', 0.86);
  const surface = mixColor(entry.surface, '#FFFCF8', 0.88);
  const text = mixColor(entry.text, '#231F29', 0.88);
  return { background, surface, text, muted: mixColor(text, background, 0.38) };
}
function modeTokens(palette) {
  return {
    'background.default': token('color', palette.background),
    'background.elevated': token('color', mixColor(palette.background, palette.surface, 0.55)),
    'surface.default': token('color', palette.surface),
    'surface.secondary': token('color', mixColor(palette.surface, palette.background, 0.2)),
    'text.primary': token('color', palette.text), 'text.secondary': token('color', palette.muted),
    'text.muted': token('color', mixColor(palette.muted, palette.surface, 0.22)),
    'action.onPrimary': token('color', bestTextColor(palette.accent || '#8178F5')),
    'border.subtle': token('color', mixColor(palette.text, palette.surface, 0.84))
  };
}

export function createOfficialDocument(entry) {
  const muted = mixColor(entry.text, entry.background, 0.36);
  const base = { background: entry.background, surface: entry.surface, text: entry.text, muted, accent: entry.accent };
  const doc = {
    schemaVersion: SCHEMA_VERSION, id: entry.id, name: entry.name, version: entry.version,
    official: true, revision: 1, defaultMode: entry.defaultMode,
    parent: entry.fallbackThemeId ? { id: entry.fallbackThemeId, version: '1.0.0' } : undefined,
    tokens: {
      primitive: {
        'color.bg': token('color', entry.background), 'color.surface': token('color', entry.surface),
        'color.accent': token('color', entry.accent), 'color.text': token('color', entry.text),
        'color.muted': token('color', muted), 'color.danger': token('color', entry.defaultMode === 'dark' ? '#FF8E9E' : '#A43146'),
        'space.1': token('dimension', 8), 'space.2': token('dimension', 16), 'space.3': token('dimension', 24),
        'radius.sm': token('dimension', 12), 'radius.md': token('dimension', 20), 'radius.lg': token('dimension', 28),
        'font.body': token('font', 'ui-rounded, "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif'),
        'material.default': token('material', { ...DEFAULT_MATERIAL, tint: entry.surface })
      },
      semantic: {
        'background.default': alias('color', 'primitive.color.bg'), 'background.elevated': token('color', mixColor(entry.background, entry.surface, 0.55)),
        'surface.default': alias('color', 'primitive.color.surface'), 'surface.secondary': token('color', mixColor(entry.surface, entry.background, 0.2)),
        'text.primary': alias('color', 'primitive.color.text'), 'text.secondary': alias('color', 'primitive.color.muted'),
        'text.muted': token('color', mixColor(muted, entry.surface, 0.22)),
        'action.primary': alias('color', 'primitive.color.accent'), 'action.secondary': token('color', mixColor(entry.accent, entry.surface, 0.28)),
        'action.onPrimary': token('color', bestTextColor(entry.accent)), 'status.error': alias('color', 'primitive.color.danger'),
        'focus.ring': token('color', mixColor(entry.accent, '#FFFFFF', 0.18)), 'border.subtle': token('color', mixColor(entry.text, entry.surface, 0.84)),
        'material.glass': alias('material', 'primitive.material.default')
      },
      component: {
        'button.primary.fill': alias('color', 'semantic.action.primary'), 'button.primary.text': alias('color', 'semantic.action.onPrimary'),
        'button.primary.radius': alias('dimension', 'primitive.radius.md'), 'button.primary.padding': alias('dimension', 'primitive.space.2'),
        'chatBubble.incoming.fill': alias('color', 'semantic.surface.default'), 'chatBubble.incoming.text': alias('color', 'semantic.text.primary'),
        'chatBubble.outgoing.fill': alias('color', 'semantic.action.primary'), 'chatBubble.outgoing.text': alias('color', 'semantic.action.onPrimary'),
        'chatBubble.radius': alias('dimension', 'primitive.radius.md'), 'card.fill': alias('color', 'semantic.surface.default'),
        'card.text': alias('color', 'semantic.text.primary'), 'card.radius': alias('dimension', 'primitive.radius.lg'),
        'card.shadow': token('shadow', { x: 0, y: 12, blur: 32, spread: -8, color: mixColor(entry.text, '#000000', 0.45) + '2E' }),
        'tab.active.fill': alias('color', 'semantic.action.primary'), 'tab.active.text': alias('color', 'semantic.action.onPrimary'),
        'material.surface': alias('material', 'semantic.material.glass')
      }
    },
    modes: {}, overrides: { global: {}, worlds: {}, locations: {}, apps: {}, pages: {}, components: {}, instances: {}, states: {}, rules: [], locks: {}, accessibility: {} },
    nodes: {}, artboards: [], components: {}, assets: {}, motions: {}, rules: [],
    metadata: { registryVersion: entry.version, materialFamily: entry.material, tags: [...entry.tags] }
  };
  for (const mode of ['light', 'dark']) {
    const palette = alternatePalette(entry, mode);
    if (palette) doc.modes[mode] = { tokens: { semantic: modeTokens({ ...palette, accent: entry.accent }) } };
  }
  return deepFreeze(doc);
}
export function createOfficialThemes(registry) {
  if (!registry || !Array.isArray(registry.themes)) throw new Error('官方主題登錄格式錯誤');
  const themes = {};
  for (const entry of registry.themes) {
    if (themes[entry.id]) throw new Error(`重複主題 ID：${entry.id}`);
    themes[entry.id] = createOfficialDocument(entry);
  }
  return Object.freeze(themes);
}
export function forkTheme(official, id, name) {
  if (!official?.official) throw new Error('只能從官方模板建立私人草稿');
  const doc = safeClone(official);
  delete doc.official;
  doc.id = id; doc.name = name || `${official.name} — 我的版本`;
  doc.parent = { id: official.id, version: official.version }; doc.revision = 1; doc.createdAt = new Date().toISOString(); doc.updatedAt = doc.createdAt;
  return doc;
}


// ---- Validation, dependency graph and atomic document commands ----------------
const DIMENSION_RE = /^-?(?:\d+\.?\d*|\.\d+)(px|rem|em|%|vw|vh|vmin|vmax)$/;
const SAFE_FONT_RE = /^[\w\s\-'",.()\/]+$/u;
const SCOPE_NAMES = Object.freeze(['global', 'worlds', 'locations', 'apps', 'pages', 'components', 'instances', 'states']);
const STATE_PRIORITY = Object.freeze(['hover', 'pressed', 'selected', 'focus-visible', 'loading', 'error', 'success', 'disabled', 'safe']);

function walkUnsafe(value, path = '', diagnostics = [], depth = 0, seen = new Set()) {
  if (depth > 40) { diagnostics.push(diagnostic('MAX_DEPTH', path, '文件巢狀深度超過 40')); return diagnostics; }
  if (!value || typeof value !== 'object') return diagnostics;
  if (seen.has(value)) { diagnostics.push(diagnostic('CYCLIC_DOCUMENT', path, '文件不可包含 JavaScript 循環物件')); return diagnostics; }
  seen.add(value);
  for (const key of Object.keys(value)) {
    const at = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEYS.includes(key)) diagnostics.push(diagnostic('UNSAFE_KEY', at, `禁止的 key：${key}`));
    for (const segment of key.split('.')) {
      if (FORBIDDEN_KEYS.includes(segment)) diagnostics.push(diagnostic('UNSAFE_KEY', at, `禁止的 namespace segment：${segment}`));
    }
    walkUnsafe(value[key], at, diagnostics, depth + 1, seen);
  }
  seen.delete(value);
  return diagnostics;
}
function finiteNumbers(value, path, diagnostics) {
  if (typeof value === 'number' && !Number.isFinite(value)) diagnostics.push(diagnostic('NON_FINITE', path, '數值必須為 finite number'));
  if (value && typeof value === 'object') for (const key of Object.keys(value)) finiteNumbers(value[key], `${path}.${key}`, diagnostics);
}
function parsePath(path) {
  if (typeof path !== 'string') return null;
  const parts = path.split('.');
  if (parts.length < 2 || !TOKEN_TIERS.includes(parts[0]) || parts.some(p => !p || FORBIDDEN_KEYS.includes(p))) return null;
  return { tier: parts[0], key: parts.slice(1).join('.'), parts };
}
function validateTokenValue(type, value, path, diagnostics) {
  const fail = (code, message) => diagnostics.push(diagnostic(code, path, message));
  finiteNumbers(value, path, diagnostics);
  switch (type) {
    case 'color': if (typeof value !== 'string' || !hexToRgb(value)) fail('INVALID_COLOR', '顏色僅接受 #RRGGBB 或 #RRGGBBAA'); break;
    case 'number': if (typeof value !== 'number' || !Number.isFinite(value)) fail('INVALID_NUMBER', '必須為 finite number'); break;
    case 'dimension':
      if (!((typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && DIMENSION_RE.test(value)))) fail('INVALID_UNIT', '尺寸僅接受 finite number（px）或白名單 CSS 單位');
      break;
    case 'boolean': if (typeof value !== 'boolean') fail('INVALID_BOOLEAN', '必須為 boolean'); break;
    case 'enum': if (typeof value !== 'string' || !value || /[;{}<>]/.test(value)) fail('INVALID_ENUM', 'enum 必須為安全字串'); break;
    case 'font': if (typeof value !== 'string' || !value || !SAFE_FONT_RE.test(value) || /url|expression|@import/i.test(value)) fail('INVALID_FONT', '字體只接受字型名稱與 fallback list'); break;
    case 'asset':
      if (value !== null && (!isPlainObject(value) || typeof value.hash !== 'string' || !/^[\da-f]{64}$/i.test(value.hash))) fail('INVALID_ASSET', '素材僅接受 null 或內容 hash 引用');
      break;
    case 'typography':
      if (!isPlainObject(value) || typeof value.family !== 'string' || !SAFE_FONT_RE.test(value.family)) fail('INVALID_TYPOGRAPHY', ' typography.family 無效');
      break;
    case 'gradient':
      if (!isPlainObject(value) || !Array.isArray(value.stops) || value.stops.length < 2 || value.stops.some(s => !hexToRgb(s.color) || !Number.isFinite(s.at) || s.at < 0 || s.at > 1)) fail('INVALID_GRADIENT', '漸層至少需要兩個合法色標');
      break;
    case 'shadow':
      if (!isPlainObject(value) || !hexToRgb(value.color)) fail('INVALID_SHADOW', '陰影顏色無效');
      break;
    case 'border':
      if (!isPlainObject(value) || !hexToRgb(value.color) || !['solid', 'dashed', 'dotted'].includes(value.style)) fail('INVALID_BORDER', '邊框型別或顏色無效');
      break;
    case 'material':
      if (!isPlainObject(value)) { fail('INVALID_MATERIAL', '材質必須為物件'); break; }
      if (!['auto', 'webgl', 'svg', 'css', 'solid'].includes(value.mode)) fail('INVALID_MATERIAL_MODE', '未知材質 backend');
      if (!Array.isArray(value.radius) || value.radius.length !== 4 || value.radius.some(n => !Number.isFinite(n) || n < 0 || n > 200)) fail('INVALID_RADIUS', '材質圓角必須為四個 0–200 的數值');
      for (const [key, [min, max]] of Object.entries(MATERIAL_LIMITS)) if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) fail('MATERIAL_RANGE', `${key} 必須介於 ${min}–${max}`);
      if (!hexToRgb(value.tint)) fail('INVALID_COLOR', '材質 tint 無效');
      break;
    case 'motion':
      if (!isPlainObject(value) || !Number.isFinite(value.durationMs) || value.durationMs < 0 || value.durationMs > 60000) fail('INVALID_MOTION', '動畫 durationMs 必須為 0–60000');
      break;
    default: fail('UNKNOWN_TOKEN_TYPE', `未知 token type：${type}`);
  }
}
function collectTokenBuckets(document) {
  const buckets = [];
  const add = (tokens, layer) => {
    if (!tokens) return;
    for (const tier of TOKEN_TIERS) if (tokens[tier]) buckets.push({ tokens: tokens[tier], tier, layer });
  };
  add(document.tokens, 'base');
  for (const mode of ['light', 'dark']) add(document.modes?.[mode]?.tokens, `mode:${mode}`);
  const walkOverrides = (overrides, prefix) => {
    if (!overrides) return;
    for (const [scope, value] of Object.entries(overrides)) {
      if (scope === 'rules') continue;
      if (scope === 'global') { add(value.tokens, `${prefix}:global`); for (const mode of ['light', 'dark']) add(value.modes?.[mode]?.tokens, `${prefix}:global:${mode}`); continue; }
      if (['locks', 'accessibility'].includes(scope)) {
        add(value.tokens, `${prefix}:${scope}`);
        for (const [key, layer] of Object.entries(value)) if (isPlainObject(layer)) add(layer.tokens, `${prefix}:${scope}:${key}`);
        continue;
      }
      if (!isPlainObject(value)) continue;
      for (const [key, layer] of Object.entries(value)) {
        if (!isPlainObject(layer)) continue;
        add(layer.tokens, `${prefix}:${scope}:${key}`);
        for (const mode of ['light', 'dark']) add(layer.modes?.[mode]?.tokens, `${prefix}:${scope}:${key}:${mode}`);
      }
    }
  };
  walkOverrides(document.overrides, 'override');
  return buckets;
}
export function createDependencyIndex(document) {
  const nodes = new Map(), dependents = new Map(), locations = new Map();
  const addDependent = (ref, path) => {
    if (!dependents.has(ref)) dependents.set(ref, new Set());
    dependents.get(ref).add(path);
  };
  for (const bucket of collectTokenBuckets(document)) {
    for (const [key, entry] of Object.entries(bucket.tokens)) {
      const path = `${bucket.tier}.${key}`;
      if (!nodes.has(path)) nodes.set(path, entry);
      if (!locations.has(path)) locations.set(path, []);
      locations.get(path).push({ layer: bucket.layer, entry });
      if (entry?.ref) addDependent(entry.ref, path);
    }
  }
  const transitive = path => {
    const found = new Set(), queue = [path];
    while (queue.length) {
      const current = queue.shift();
      for (const next of dependents.get(current) || []) if (!found.has(next)) { found.add(next); queue.push(next); }
    }
    return found;
  };
  return { nodes, dependents, locations, transitive };
}
export function validateDocument(document, { throwOnError = false, themes = null } = {}) {
  const diagnostics = [];
  if (!isPlainObject(document)) diagnostics.push(diagnostic('INVALID_DOCUMENT', '$', '主題文件必須為 plain object'));
  else {
    walkUnsafe(document, '$', diagnostics);
    if (document.schemaVersion !== SCHEMA_VERSION) diagnostics.push(diagnostic('SCHEMA_VERSION', 'schemaVersion', `僅支援 schema ${SCHEMA_VERSION}`));
    if (typeof document.id !== 'string' || !/^[\w-]{1,80}$/.test(document.id)) diagnostics.push(diagnostic('INVALID_ID', 'id', '主題 ID 格式錯誤'));
    if (!isPlainObject(document.tokens)) diagnostics.push(diagnostic('TOKENS_REQUIRED', 'tokens', '缺少三層 tokens'));
  }
  const graph = isPlainObject(document) ? createDependencyIndex(document) : null;
  if (graph) {
    for (const bucket of collectTokenBuckets(document)) {
      for (const [key, entry] of Object.entries(bucket.tokens)) {
        const path = `${bucket.tier}.${key}`, at = `${bucket.layer}.${path}`;
        if (!parsePath(path)) diagnostics.push(diagnostic('INVALID_TOKEN_PATH', at, 'token namespace 無效'));
        if (!isPlainObject(entry) || typeof entry.type !== 'string') { diagnostics.push(diagnostic('INVALID_TOKEN', at, 'token 必須包含 type 及 value/ref')); continue; }
        if (typeof entry.ref === 'string') {
          const target = parsePath(entry.ref);
          if (!target) diagnostics.push(diagnostic('INVALID_ALIAS', at, 'alias 必須是完整 token namespace'));
          else {
            if (bucket.tier === 'primitive' && target.tier !== 'primitive') diagnostics.push(diagnostic('TIER_DEPENDENCY', at, 'Primitive 不得依賴上層 token'));
            if (bucket.tier === 'semantic' && target.tier === 'component') diagnostics.push(diagnostic('TIER_DEPENDENCY', at, 'Semantic 不得依賴 Component'));
            const targetEntry = graph.nodes.get(entry.ref);
            if (!targetEntry) diagnostics.push(diagnostic('MISSING_TOKEN', at, `缺少引用：${entry.ref}`, 'warning'));
            else if (targetEntry.type !== entry.type) diagnostics.push(diagnostic('TYPE_MISMATCH', at, `${entry.type} 不得引用 ${targetEntry.type}`));
          }
        } else validateTokenValue(entry.type, entry.value, at, diagnostics);
      }
    }
    for (const path of graph.nodes.keys()) {
      const seen = new Set(), chain = [];
      let current = path;
      while (current && graph.nodes.get(current)?.ref && !seen.has(current)) {
        seen.add(current); chain.push(current); current = graph.nodes.get(current).ref;
      }
      if (current && seen.has(current)) diagnostics.push(diagnostic('ALIAS_CYCLE', path, `alias 循環：${[...chain, current].join(' → ')}`));
    }
  }
  if (themes && document?.parent) {
    const visited = new Set([document.id]); let cursor = document;
    while (cursor?.parent) {
      const { id, version } = cursor.parent;
      if (visited.has(id)) { diagnostics.push(diagnostic('PARENT_CYCLE', 'parent', `父主題循環：${id}`)); break; }
      visited.add(id);
      const parent = themes[id];
      if (!parent) { diagnostics.push(diagnostic('MISSING_PARENT', 'parent', `找不到父主題：${id}`, 'warning')); break; }
      if (version && parent.version !== version) diagnostics.push(diagnostic('PARENT_VERSION', 'parent', `父主題版本不相容：需要 ${version}，實際 ${parent.version}`));
      cursor = parent;
    }
  }
  const report = { valid: !diagnostics.some(d => d.severity === 'error'), diagnostics };
  if (throwOnError && !report.valid) throw new ThemeValidationError(diagnostics);
  return report;
}
export function assertValidDocument(document, options = {}) {
  const report = validateDocument(document, options);
  if (!report.valid) throw new ThemeValidationError(report.diagnostics);
  return report;
}
export function searchTokens(document, query = '') {
  const q = String(query).toLowerCase();
  return [...createDependencyIndex(document).nodes.entries()].filter(([path, entry]) => !q || path.toLowerCase().includes(q) || String(entry.value ?? '').toLowerCase().includes(q)).map(([path, token]) => ({ path, token: safeClone(token) }));
}
export function findReferences(document, path) {
  const graph = createDependencyIndex(document);
  return [...(graph.dependents.get(path) || [])].map(dependent => ({ path: dependent, locations: graph.locations.get(dependent) || [] }));
}
function nextRevision(document, expectedRevision) {
  if (expectedRevision != null && document.revision !== expectedRevision) throw new ThemeValidationError([diagnostic('REVISION_CONFLICT', 'revision', `預期 revision ${expectedRevision}，實際 ${document.revision}`)]);
  const copy = safeClone(document);
  copy.revision = (Number(document.revision) || 0) + 1;
  copy.updatedAt = new Date().toISOString();
  return copy;
}
export function updateTokens(document, updates, { expectedRevision = null, themes = null } = {}) {
  if (!Array.isArray(updates) || !updates.length) throw new ThemeValidationError([diagnostic('EMPTY_UPDATE', '$', '至少需要一項 token 更新')]);
  const copy = nextRevision(document, expectedRevision);
  const graph = createDependencyIndex(copy);
  for (const { path, token: next } of updates) {
    const parsed = parsePath(path);
    if (!parsed || !graph.nodes.has(path) || !isPlainObject(next)) throw new ThemeValidationError([diagnostic('INVALID_UPDATE', path, '更新路徑或 token 無效')]);
    copy.tokens[parsed.tier][parsed.key] = safeClone(next);
  }
  assertValidDocument(copy, { themes });
  return copy;
}
export function updateToken(document, path, token, options = {}) { return updateTokens(document, [{ path, token }], options); }
function renameInTokens(tokens, oldKey, newKey, tier) {
  if (!tokens?.[tier] || !Object.hasOwn(tokens[tier], oldKey)) return;
  if (Object.hasOwn(tokens[tier], newKey)) throw new ThemeValidationError([diagnostic('DUPLICATE_TOKEN', `${tier}.${newKey}`, '重新命名目標已存在')]);
  const entries = Object.entries(tokens[tier]).map(([key, value]) => [key === oldKey ? newKey : key, value]);
  tokens[tier] = Object.fromEntries(entries);
}
function renameTokenBuckets(document, oldPath, newPath) {
  const from = parsePath(oldPath), to = parsePath(newPath);
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.tokens) renameInTokens(value.tokens, from.key, to.key, from.tier);
    for (const key of Object.keys(value)) visit(value[key]);
  };
  visit(document.tokens ? { tokens: document.tokens } : {});
  visit(document.modes || {}); visit(document.overrides || {});
  const rewriteRefs = value => {
    if (!value || typeof value !== 'object') return;
    if (value.ref === oldPath) value.ref = newPath;
    for (const key of Object.keys(value)) rewriteRefs(value[key]);
  };
  rewriteRefs(document.tokens); rewriteRefs(document.modes); rewriteRefs(document.overrides);
}
export function renameToken(document, oldPath, newPath, { expectedRevision = null, themes = null } = {}) {
  const from = parsePath(oldPath), to = parsePath(newPath);
  if (!from || !to || from.tier !== to.tier) throw new ThemeValidationError([diagnostic('INVALID_RENAME', oldPath, '新舊路徑必須位於同一 token tier')]);
  if (!createDependencyIndex(document).nodes.has(oldPath)) throw new ThemeValidationError([diagnostic('MISSING_TOKEN', oldPath, '找不到要重新命名的 token')]);
  const copy = nextRevision(document, expectedRevision);
  renameTokenBuckets(copy, oldPath, newPath);
  assertValidDocument(copy, { themes });
  return copy;
}
export function setOverride(document, scope, key, path, entry, { mode = null, expectedRevision = null, themes = null } = {}) {
  if (!SCOPE_NAMES.includes(scope) || !parsePath(path)) throw new ThemeValidationError([diagnostic('INVALID_OVERRIDE', path, 'override scope 或 token path 無效')]);
  const copy = nextRevision(document, expectedRevision), parsed = parsePath(path);
  copy.overrides ||= {};
  let layer;
  if (scope === 'global') layer = copy.overrides.global ||= {};
  else {
    if (typeof key !== 'string' || !key || key.split('.').some(k => FORBIDDEN_KEYS.includes(k))) throw new ThemeValidationError([diagnostic('UNSAFE_KEY', String(key), 'override key 無效')]);
    copy.overrides[scope] ||= {};
    layer = copy.overrides[scope][key] ||= {};
  }
  const tokens = mode ? ((layer.modes ||= {})[mode] ||= {}).tokens ||= {} : layer.tokens ||= {};
  tokens[parsed.tier] ||= {};
  if (entry === undefined) {
    delete tokens[parsed.tier][parsed.key];
    if (!Object.keys(tokens[parsed.tier]).length) delete tokens[parsed.tier];
  } else tokens[parsed.tier][parsed.key] = safeClone(entry);
  assertValidDocument(copy, { themes });
  return copy;
}


// ---- Deterministic scoped resolver, source maps and safe CSS compiler ---------
const SAFE_ENTRY = Object.freeze({ id: 'warmth-original', version: '1.0.0', name: 'WARMTH Safe', tags: [], background: '#F4F0EA', surface: '#FFFCF8', accent: '#AE8275', text: '#453C39', material: 'paper', defaultMode: 'light', fallbackThemeId: null });
let safeDocumentCache;
export function createSafeDocument() { return safeClone(safeDocumentCache ||= createOfficialDocument(SAFE_ENTRY)); }
function flattenTokens(tokens, layer, output = []) {
  if (!tokens) return output;
  for (const tier of TOKEN_TIERS) for (const [key, entry] of Object.entries(tokens[tier] || {})) output.push({ path: `${tier}.${key}`, entry, source: { ...layer } });
  return output;
}
function contextStates(context) {
  const states = Array.isArray(context.state) ? context.state : context.state ? [context.state] : [];
  return [...new Set(states)].sort((a, b) => (STATE_PRIORITY.indexOf(a) < 0 ? 0 : STATE_PRIORITY.indexOf(a)) - (STATE_PRIORITY.indexOf(b) < 0 ? 0 : STATE_PRIORITY.indexOf(b)) || a.localeCompare(b));
}
function resolverContextKey(context) {
  return stableStringify({
    mode: context.mode, world: context.world || null, location: context.location || null,
    app: context.app || null, page: context.page || null, component: context.component || null,
    variant: context.variant || null, instance: context.instance || null, state: contextStates(context),
    viewportWidth: context.viewportWidth ?? null, containerWidth: context.containerWidth ?? null,
    accessibility: context.accessibility || {}, locks: context.locks || {}
  });
}
function parentChain(document, themes, diagnostics) {
  if (!document.parent) return [];
  const byId = themes && typeof themes === 'object' ? themes : {};
  const chain = [], visited = new Set([document.id]);
  let cursor = document;
  while (cursor.parent) {
    const { id, version } = cursor.parent;
    if (visited.has(id)) { diagnostics.push(diagnostic('PARENT_CYCLE', 'parent', `父主題循環：${id}`)); break; }
    visited.add(id);
    const parent = byId[id];
    if (!parent) { diagnostics.push(diagnostic('MISSING_PARENT', 'parent', `缺少父主題 ${id}；使用安全預設`, 'warning')); break; }
    if (version && parent.version !== version) { diagnostics.push(diagnostic('PARENT_VERSION', 'parent', `父主題 ${id} 版本不相容`)); break; }
    if (parent.schemaVersion !== SCHEMA_VERSION) { diagnostics.push(diagnostic('PARENT_SCHEMA', 'parent', `父主題 ${id} schema 不相容`)); break; }
    chain.unshift(parent); cursor = parent;
  }
  return chain;
}
function addDocumentLayers(layers, document, documentId, kind, mode) {
  flattenTokens(document.tokens, { documentId, layer: `${kind}:base`, scope: 'base', mode: null }, layers);
  flattenTokens(document.modes?.[mode]?.tokens, { documentId, layer: `${kind}:mode:${mode}`, scope: 'mode', mode }, layers);
}
function buildLayers(document, context, options, diagnostics) {
  const mode = context.mode === 'dark' ? 'dark' : context.mode === 'light' ? 'light' : document.defaultMode === 'dark' ? 'dark' : 'light';
  const safe = safeDocumentCache ||= createOfficialDocument(SAFE_ENTRY);
  const layers = [];
  addDocumentLayers(layers, safe, safe.id, 'safe', mode);
  const parents = parentChain(document, options.themes, diagnostics);
  for (const parent of parents) addDocumentLayers(layers, parent, parent.id, 'parent', mode);
  addDocumentLayers(layers, document, document.id, 'document', mode);
  const overrides = document.overrides || {};
  const addScope = (scope, key, layer) => {
    if (!layer) return;
    const label = key == null ? scope : `${scope}:${key}`;
    flattenTokens(layer.tokens, { documentId: document.id, layer: label, scope, key: key ?? null, mode: null }, layers);
    flattenTokens(layer.modes?.[mode]?.tokens, { documentId: document.id, layer: `${label}:mode:${mode}`, scope, key: key ?? null, mode }, layers);
  };
  addScope('global', null, overrides.global);
  addScope('world', context.world, overrides.worlds?.[context.world]);
  addScope('location', context.location, overrides.locations?.[context.location]);
  addScope('app', context.app, overrides.apps?.[context.app]);
  addScope('page', context.page, overrides.pages?.[context.page]);
  addScope('component', context.component, overrides.components?.[context.component]);
  if (context.variant) addScope('variant', `${context.component || ''}:${context.variant}`, overrides.components?.[`${context.component || ''}:${context.variant}`]);
  addScope('instance', context.instance, overrides.instances?.[context.instance]);
  for (const state of contextStates(context)) addScope('state', state, overrides.states?.[state]);
  addScope('locks', null, overrides.locks);
  const accessibility = context.accessibility || {};
  for (const flag of ['highContrast', 'reducedTransparency', 'reducedMotion']) if (accessibility[flag]) addScope('accessibility', flag, overrides.accessibility?.[flag]);
  return { layers, mode, parents };
}
function safeLiteral(path, expectedType, seen = new Set()) {
  const safe = safeDocumentCache ||= createOfficialDocument(SAFE_ENTRY);
  if (seen.has(path)) return { value: safeClone(TYPE_DEFAULTS[expectedType] ?? null), type: expectedType || 'unknown', finalSource: { documentId: safe.id, layer: 'safe:default', scope: 'safe' } };
  seen.add(path);
  const parsed = parsePath(path), entry = parsed && safe.tokens[parsed.tier]?.[parsed.key];
  if (!entry) return { value: safeClone(TYPE_DEFAULTS[expectedType] ?? null), type: expectedType || 'unknown', finalSource: { documentId: safe.id, layer: 'safe:default', scope: 'safe' } };
  if (entry.ref) return safeLiteral(entry.ref, entry.type, seen);
  return { value: safeClone(entry.value), type: entry.type, finalSource: { documentId: safe.id, layer: 'safe:base', scope: 'safe' } };
}
function resolveLayers(document, context, options, cache = null) {
  const diagnostics = [], { layers, mode, parents } = buildLayers(document, context, options, diagnostics);
  const definitions = new Map(), paths = new Set();
  for (const item of layers) { definitions.set(item.path, item); paths.add(item.path); }
  const diagnosticsKeys = new Set();
  const report = d => { const key = stableStringify(d); if (!diagnosticsKeys.has(key)) { diagnosticsKeys.add(key); diagnostics.push(d); } };
  const scopeKey = `${options.documentFingerprint || stableStringify(document)}|${stableStringify(parents.map(p => [p.id, p.version, p.revision, p.tokens, p.modes]))}|${resolverContextKey({ ...context, mode })}`;
  const resolvePath = (path, stack = [], expectedType = null) => {
    const cacheKey = `${scopeKey}|${path}`;
    if (cache?.has(cacheKey)) return cache.get(cacheKey).result;
    const definition = definitions.get(path);
    if (!definition) {
      report(diagnostic('MISSING_TOKEN', path, '缺少 token；已使用安全值', 'warning', expectedType ? { expectedType } : undefined));
      const missing = { ...safeLiteral(path, expectedType), sourceMap: { origin: null, finalSource: safeLiteral(path, expectedType).finalSource, aliasChain: [], overridden: false } };
      cache?.set(cacheKey, { path, result: missing }); return missing;
    }
    const { entry, source } = definition;
    if (stack.includes(path)) {
      report(diagnostic('ALIAS_CYCLE', path, `alias 循環：${[...stack, path].join(' → ')}`));
      const fallback = safeLiteral(path, entry.type);
      const cycled = { ...fallback, sourceMap: { origin: source, finalSource: fallback.finalSource, aliasChain: [], overridden: source.scope !== 'base' } };
      cache?.set(cacheKey, { path, result: cycled }); return cycled;
    }
    let result;
    if (typeof entry.ref === 'string') {
      const target = definitions.get(entry.ref);
      if (!target) report(diagnostic('MISSING_TOKEN', path, `缺少引用 ${entry.ref}；已使用安全值`, 'warning'));
      else if (target.entry.type !== entry.type) report(diagnostic('TYPE_MISMATCH', path, `${entry.type} 不得引用 ${target.entry.type}`));
      if (!target || target.entry.type !== entry.type) {
        const fallback = safeLiteral(path, entry.type);
        result = { ...fallback, sourceMap: { origin: source, finalSource: fallback.finalSource, aliasChain: [{ path, ref: entry.ref, source }], overridden: source.scope !== 'base' } };
      } else {
        const resolvedTarget = resolvePath(entry.ref, [...stack, path], entry.type);
        result = { value: safeClone(resolvedTarget.value), type: entry.type, sourceMap: {
          origin: source, finalSource: resolvedTarget.sourceMap.finalSource,
          aliasChain: [{ path, ref: entry.ref, source }, ...(resolvedTarget.sourceMap.aliasChain || [])],
          parentSource: source.scope === 'parent' ? source : resolvedTarget.sourceMap.parentSource,
          overridden: source.scope !== 'base' && source.scope !== 'mode' || resolvedTarget.sourceMap.overridden
        } };
      }
    } else {
      const valueDiagnostics = []; validateTokenValue(entry.type, entry.value, path, valueDiagnostics);
      for (const d of valueDiagnostics) report(d);
      const valid = !valueDiagnostics.some(d => d.severity === 'error');
      const literal = valid ? { value: safeClone(entry.value), type: entry.type, finalSource: source } : safeLiteral(path, entry.type);
      result = { ...literal, sourceMap: { origin: source, finalSource: literal.finalSource, aliasChain: [], overridden: source.scope !== 'base' && source.scope !== 'mode' } };
    }
    cache?.set(cacheKey, { path, result }); return result;
  };
  const tokens = {}, sourceMap = {};
  for (const path of [...paths].sort()) {
    const result = resolvePath(path); tokens[path] = result.value; sourceMap[path] = result.sourceMap;
  }
  const accessibility = context.accessibility || {};
  if (accessibility.reducedMotion || accessibility.reducedTransparency) {
    for (const path of Object.keys(tokens)) {
      const parsed = parsePath(path); if (!parsed) continue;
      const definition = definitions.get(path), type = definition?.entry.type;
      if (accessibility.reducedMotion && type === 'motion') { tokens[path] = { ...tokens[path], durationMs: 0 }; sourceMap[path] = { ...sourceMap[path], systemProtection: 'reducedMotion' }; }
      if (accessibility.reducedTransparency && type === 'material') { tokens[path] = { ...tokens[path], mode: 'solid', tintOpacity: 0 }; sourceMap[path] = { ...sourceMap[path], systemProtection: 'reducedTransparency' }; }
    }
  }
  const themeRevision = context.themeRevision ?? document.revision;
  const cacheKey = stableStringify({ document: options.documentFingerprint || stableStringify(document), parents: parents.map(p => [p.id, p.version, p.revision, p.tokens, p.modes]), themeRevision, context: resolverContextKey({ ...context, mode }) });
  return deepFreeze({ id: document.id, revision: document.revision, themeRevision, mode, context: { ...safeClone(context), mode }, tokens, sourceMap, diagnostics, cacheKey });
}
export function resolveTheme(document, context = {}, options = {}) { return resolveLayers(document, context, options); }
export class ThemeResolver {
  constructor() { this.documentFingerprint = ''; this.graph = null; this.tokenCache = new Map(); this.resultCache = new Map(); this.lastInvalidation = []; }
  sync(document) {
    const fingerprint = stableStringify(document);
    if (fingerprint === this.documentFingerprint) return;
    const previous = this.graph;
    const next = createDependencyIndex(document), changed = new Set();
    const paths = new Set([...(previous?.nodes.keys() || []), ...next.nodes.keys()]);
    for (const path of paths) if (stableStringify(previous?.nodes.get(path)) !== stableStringify(next.nodes.get(path))) changed.add(path);
    const affected = new Set(changed);
    for (const path of changed) {
      for (const item of previous?.transitive(path) || []) affected.add(item);
      for (const item of next.transitive(path)) affected.add(item);
    }
    for (const [key, record] of this.tokenCache) if (affected.has(record.path)) this.tokenCache.delete(key);
    this.resultCache.clear(); this.documentFingerprint = fingerprint; this.graph = next; this.lastInvalidation = [...affected].sort();
    if (this.tokenCache.size > 1000) this.tokenCache.clear();
    if (this.resultCache.size > 100) this.resultCache.clear();
  }
  resolve(document, context = {}, options = {}) {
    this.sync(document);
    const key = stableStringify([document.id, context, options.themes ? Object.fromEntries(Object.entries(options.themes).map(([id, d]) => [id, d.version, d.revision, d.tokens, d.modes])) : null]);
    if (this.resultCache.has(key)) return this.resultCache.get(key);
    const result = resolveLayers(document, context, { ...options, documentFingerprint: this.documentFingerprint }, this.tokenCache);
    this.resultCache.set(key, result); return result;
  }
  getStats() { return { tokenCache: this.tokenCache.size, resultCache: this.resultCache.size, lastInvalidation: [...this.lastInvalidation] }; }
  clear() { this.tokenCache.clear(); this.resultCache.clear(); this.documentFingerprint = ''; this.graph = null; }
}
function variableName(path) { return `--warmth-${path.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/\./g, '-').toLowerCase()}`; }
function cssValue(type, value) {
  if (value == null) return null;
  if (type === 'dimension') return typeof value === 'number' ? `${value}px` : value;
  if (['color', 'font', 'enum'].includes(type)) return String(value);
  if (['number', 'boolean'].includes(type)) return String(value);
  if (type === 'shadow') return `${value.x}px ${value.y}px ${value.blur}px ${value.spread}px ${value.color}`;
  if (type === 'border') return `${value.width}px ${value.style} ${value.color}`;
  if (type === 'gradient') return `linear-gradient(${value.angle}deg, ${value.stops.map(s => `${s.color} ${s.at * 100}%`).join(', ')})`;
  if (type === 'typography') return `${value.weight} ${value.size}px/${value.lineHeight} ${value.family}`;
  return null;
}
export function compileTheme(resolved, { selector = ':root' } = {}) {
  if (!resolved?.tokens || !resolved?.sourceMap) throw new TypeError('compileTheme 需要 resolveTheme 的結果');
  const variables = {}, definitions = resolved.tokens;
  for (const [path, value] of Object.entries(definitions)) {
    const source = resolved.sourceMap[path], definitionType = source?.type || null;
    let type = definitionType;
    if (!type) {
      if (typeof value === 'string' && hexToRgb(value)) type = 'color';
      else if (typeof value === 'number') type = path.includes('radius') || path.includes('space') || path.includes('padding') ? 'dimension' : 'number';
      else if (isPlainObject(value) && 'durationMs' in value) type = 'motion';
      else if (isPlainObject(value) && 'stops' in value) type = 'gradient';
      else if (isPlainObject(value) && 'family' in value) type = 'typography';
      else if (isPlainObject(value) && 'blur' in value) type = 'shadow';
      else if (isPlainObject(value) && 'style' in value) type = 'border';
    }
    const serialized = cssValue(type, value);
    if (serialized != null) {
      variables[variableName(path)] = serialized;
      if (CSS_KEYS[path]) variables[CSS_KEYS[path]] = serialized;
    }
    if (isPlainObject(value) && 'radius' in value && 'ior' in value) {
      const prefix = variableName(path);
      variables[`${prefix}-radius`] = value.radius.map(n => `${n}px`).join(' ');
      for (const key of ['bevelPx', 'thicknessPx', 'distortionPx', 'dispersionPx', 'blurPx']) variables[`${prefix}-${key.replace(/Px$/, '').toLowerCase()}`] = `${value[key]}px`;
      for (const key of ['ior', 'tintOpacity', 'saturation', 'edgeStrength', 'highlightStrength']) variables[`${prefix}-${key.toLowerCase()}`] = String(value[key]);
      variables[`${prefix}-tint`] = value.tint;
    }
    if (isPlainObject(value) && 'durationMs' in value) variables[variableName(path)] = `${value.durationMs}ms`;
  }
  const cssText = `${selector}{${Object.entries(variables).map(([key, value]) => `${key}:${value};`).join('')}}`;
  return { variables, cssText, diagnostics: resolved.diagnostics, sourceMap: resolved.sourceMap, cacheKey: resolved.cacheKey };
}
