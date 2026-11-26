import { safeClone, stableStringify, validateDocument, SCHEMA_VERSION } from './core.mjs';
import { ThemeStorageError } from './persistence.mjs';
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const PACKAGE_LIMITS = Object.freeze({ entries: 100, compressedBytes: 8 * 1024 * 1024, uncompressedBytes: 24 * 1024 * 1024, entryBytes: 6 * 1024 * 1024, jsonDepth: 32 });
const DOCUMENT_KEYS = new Set(['schemaVersion', 'id', 'name', 'version', 'revision', 'defaultMode', 'parent', 'tokens', 'modes', 'overrides', 'nodes', 'artboards', 'components', 'assets', 'motions', 'rules', 'metadata', 'createdAt', 'updatedAt']);
const crcTable = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
function crc32(data) { let crc = 0xFFFFFFFF; for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xFFFFFFFF) >>> 0; }
function u16(value) { const out = new Uint8Array(2); new DataView(out.buffer).setUint16(0, value, true); return out; }
function u32(value) { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value >>> 0, true); return out; }
function concat(parts) { const size = parts.reduce((sum, part) => sum + part.length, 0), out = new Uint8Array(size); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out; }
function safeEntryName(name) {
  if (typeof name !== 'string' || !name || name.length > 240 || name.includes('\\') || name.startsWith('/') || /^[a-z]:\//i.test(name)) throw new Error('不安全的 ZIP entry 路徑');
  const parts = name.split('/'); if (parts.some(part => part === '..' || part === '.')) throw new Error('拒絕 zip slip');
  return name;
}
export function createZip(entries) {
  if (!Array.isArray(entries) || entries.length > PACKAGE_LIMITS.entries) throw new Error('ZIP entry 數量超限');
  const names = new Set(), localParts = [], centralParts = []; let offset = 0, total = 0;
  for (const entry of entries) {
    const name = safeEntryName(entry.name); if (names.has(name)) throw new Error('重複 ZIP entry'); names.add(name);
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data); if (data.length > PACKAGE_LIMITS.entryBytes) throw new Error('ZIP entry 過大'); total += data.length;
    const filename = encoder.encode(name), crc = crc32(data), local = concat([u32(0x04034B50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(filename.length), u16(0), filename, data]);
    localParts.push(local);
    centralParts.push(concat([u32(0x02014B50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(filename.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), filename]));
    offset += local.length;
  }
  if (total > PACKAGE_LIMITS.uncompressedBytes) throw new Error('ZIP 解壓總大小超限');
  const central = concat(centralParts), locals = concat(localParts), end = concat([u32(0x06054B50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(locals.length), u16(0)]);
  return concat([locals, central, end]);
}
export function readZip(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); if (data.length > PACKAGE_LIMITS.compressedBytes) throw new Error('封裝超過壓縮大小上限');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength); let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) if (view.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是有效 ZIP'); if (view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true)) throw new Error('不支援多片 ZIP');
  const count = view.getUint16(eocd + 10, true), centralSize = view.getUint32(eocd + 12, true), centralOffset = view.getUint32(eocd + 16, true);
  if (!count || count > PACKAGE_LIMITS.entries || centralOffset + centralSize > data.length) throw new Error('ZIP entry 數量或 central directory 無效');
  const entries = new Map(); let cursor = centralOffset, total = 0;
  for (let index = 0; index < count; index++) {
    if (view.getUint32(cursor, true) !== 0x02014B50) throw new Error('中央目錄毀損');
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true), crc = view.getUint32(cursor + 16, true), compressed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true), external = view.getUint32(cursor + 38, true), localOffset = view.getUint32(cursor + 42, true);
    if (flags & 1 || flags & 8 || method !== 0) throw new Error('僅接受未加密、無 data descriptor 的 stored ZIP');
    if (((external >>> 16) & 0xF000) === 0xA000) throw new Error('拒絕 symlink entry');
    const name = safeEntryName(decoder.decode(data.subarray(cursor + 46, cursor + 46 + nameLength))); if (entries.has(name)) throw new Error('重複 ZIP entry');
    if (localOffset >= data.length || view.getUint32(localOffset, true) !== 0x04034B50) throw new Error('local header 毀損');
    const localName = view.getUint16(localOffset + 26, true), localExtra = view.getUint16(localOffset + 28, true), start = localOffset + 30 + localName + localExtra;
    if (compressed !== size || start + compressed > data.length || size > PACKAGE_LIMITS.entryBytes) throw new Error('ZIP entry 長度無效'); total += size; if (total > PACKAGE_LIMITS.uncompressedBytes) throw new Error('ZIP 解壓總大小超限');
    const content = data.slice(start, start + size); if (crc32(content) !== crc) throw new Error(`entry CRC 不符：${name}`);
    entries.set(name, content); cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
function assertJSONDepth(bytes) {
  const text = decoder.decode(bytes); let depth = 0, string = false, escaped = false;
  for (const char of text) {
    if (string) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') string = false; continue; }
    if (char === '"') string = true; else if (char === '{' || char === '[') { if (++depth > PACKAGE_LIMITS.jsonDepth) throw new Error('JSON 深度超限'); } else if (char === '}' || char === ']') depth--;
  }
  return JSON.parse(text);
}
async function hashBytes(data) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(b => b.toString(16).padStart(2, '0')).join(''); }
export function visualDocument(document) {
  if (!document || typeof document !== 'object') throw new Error('主題文件無效');
  for (const key of Object.keys(document)) if (!DOCUMENT_KEYS.has(key)) throw new Error(`非視覺或未知欄位：${key}`);
  const clone = safeClone(document); delete clone.official; return clone;
}
function assertNoExecutableValues(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(script|html|cssText|javascript|on[a-z]+)$/i.test(key)) throw new Error(`封裝包含可執行欄位：${path}.${key}`);
    if (typeof child === 'string' && /^\s*(?:javascript:|data:text\/html)/i.test(child)) throw new Error(`封裝包含危險 URL：${path}.${key}`);
    assertNoExecutableValues(child, `${path}.${key}`);
  }
}
export async function exportThemeJSON(document) { const visual = visualDocument(document), report = validateDocument(visual); if (!report.valid) throw new Error('主題驗證失敗，無法匯出'); const bytes = encoder.encode(stableStringify(visual)); return { bytes, hash: await hashBytes(bytes), document: visual }; }
export async function exportWarmthTheme(document, { assets = {}, license = 'User theme; no third-party assets declared', minAppVersion = '1.0.0' } = {}) {
  const exported = await exportThemeJSON(document), entries = [], assetManifest = [];
  for (const [name, value] of Object.entries(assets)) {
    safeEntryName(name); const data = value instanceof Uint8Array ? value : new Uint8Array(value); if (data.length > PACKAGE_LIMITS.entryBytes) throw new Error('素材過大');
    const hash = await hashBytes(data); if (!/^assets\/[\w.-]+\.(png|jpe?g|webp)$/i.test(name)) throw new Error('素材路徑或 MIME 白名單不符');
    entries.push({ name, data }); assetManifest.push({ path: name, hash, length: data.length });
  }
  const manifest = { schemaVersion: SCHEMA_VERSION, themeId: document.id, version: document.version, minAppVersion, license, hashes: { 'theme.json': exported.hash }, assets: assetManifest };
  entries.push({ name: 'theme.json', data: exported.bytes }, { name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest, null, 2)) }, { name: 'licenses/NOTICE.txt', data: encoder.encode(license) });
  return { bytes: createZip(entries), manifest, document: exported.document };
}
export async function inspectWarmthTheme(bytes, { themes = null } = {}) {
  const entries = readZip(bytes); for (const name of entries.keys()) if (!['theme.json', 'manifest.json'].includes(name) && !/^assets\/[\w.-]+\.(png|jpe?g|webp)$/i.test(name) && !/^licenses\/[\w.-]+\.txt$/i.test(name)) throw new Error(`未知封裝 entry：${name}`);
  if (!entries.has('theme.json') || !entries.has('manifest.json')) throw new Error('封裝缺少 theme.json 或 manifest.json');
  const manifest = assertJSONDepth(entries.get('manifest.json')), document = assertJSONDepth(entries.get('theme.json'));
  if (manifest.schemaVersion !== SCHEMA_VERSION || document.schemaVersion !== SCHEMA_VERSION) throw new Error('未知或不相容 schema');
  const themeHash = await hashBytes(entries.get('theme.json')); if (manifest.hashes?.['theme.json'] !== themeHash) throw new Error('theme.json SHA-256 不符');
  if (manifest.themeId !== document.id) throw new Error('manifest 與主題 ID 不符');
  const visual = visualDocument(document); assertNoExecutableValues(visual);
  for (const asset of manifest.assets || []) { const data = entries.get(asset.path); if (!data || data.length !== asset.length || await hashBytes(data) !== asset.hash) throw new Error(`素材 hash 或長度不符：${asset.path}`); }
  const report = validateDocument(visual, { themes }); if (!report.valid) { const error = new Error('主題 schema 驗證失敗'); error.diagnostics = report.diagnostics; throw error; }
  return { document: visual, manifest, diagnostics: report.diagnostics, assets: Object.fromEntries([...entries].filter(([name]) => name.startsWith('assets/'))) };
}
export async function importWarmthTheme(repository, bytes, { confirmed = false, conflict = 'error', themes = null } = {}) {
  const inspected = await inspectWarmthTheme(bytes, { themes }); if (!confirmed) return { ...inspected, committed: false };
  let document = inspected.document, previous = await repository.getDraft(document.id);
  if (previous && conflict === 'error') throw new ThemeStorageError('CONFLICT', '主題 ID 已存在；請選擇建立副本或明確更新');
  if (previous && conflict === 'copy') { document = { ...document, id: `${document.id}-copy-${Date.now().toString(36)}`, name: `${document.name}（副本）`, revision: 1, updatedAt: new Date().toISOString() }; previous = null; }
  if (previous && conflict === 'update') document = { ...document, revision: previous.revision + 1, updatedAt: new Date().toISOString() };
  const saved = await repository.saveDraft(document, { expectedRevision: previous?.revision ?? 0, source: 'import' }); return { ...inspected, document: saved, committed: true };
}
