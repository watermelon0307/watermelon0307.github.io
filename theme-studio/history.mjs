import { safeClone, stableStringify, validateDocument, deepFreeze, sha256 } from './core.mjs';
function canonical(document) { const clone = safeClone(document); delete clone.revision; delete clone.updatedAt; return stableStringify(clone); }
export class CommandHistory {
  constructor(document, { limit = 100, byteBudget = 8_000_000 } = {}) { this.limit = limit; this.byteBudget = byteBudget; this.reset(document); }
  reset(document) { this.current = safeClone(document); this.entries = []; this.cursor = 0; this.bytes = 0; }
  execute(label, next, { affectedIds = [], timestamp = new Date().toISOString() } = {}) {
    if (!next || next.revision !== this.current.revision + 1) throw new Error('REVISION_CONFLICT：command 必須基於目前 draft');
    const report = validateDocument(next); if (!report.valid) throw new Error('命令產生無效文件');
    if (canonical(next) === canonical(this.current)) return this.current;
    if (this.cursor < this.entries.length) { const removed = this.entries.splice(this.cursor); this.bytes -= removed.reduce((sum, entry) => sum + entry.bytes, 0); }
    const before = safeClone(this.current), after = safeClone(next), bytes = stableStringify(before).length + stableStringify(after).length;
    const entry = { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, label, baseRevision: this.current.revision, affectedIds, timestamp, before, after, bytes };
    this.entries.push(entry); this.cursor += 1; this.bytes += bytes; this.current = safeClone(next); this.trim(); return safeClone(this.current);
  }
  trim() { while (this.entries.length > this.limit || this.bytes > this.byteBudget) { if (this.cursor === 0) break; const removed = this.entries.shift(); this.bytes -= removed.bytes; this.cursor -= 1; } }
  undo() { if (!this.canUndo) throw new Error('沒有可 undo 的命令'); const entry = this.entries[this.cursor - 1], restored = safeClone(entry.before); restored.revision = this.current.revision + 1; restored.updatedAt = new Date().toISOString(); this.cursor -= 1; this.current = safeClone(restored); return safeClone(restored); }
  redo() { if (!this.canRedo) throw new Error('沒有可 redo 的命令'); const entry = this.entries[this.cursor], restored = safeClone(entry.after); restored.revision = this.current.revision + 1; restored.updatedAt = new Date().toISOString(); this.cursor += 1; this.current = safeClone(restored); return safeClone(restored); }
  get canUndo() { return this.cursor > 0; } get canRedo() { return this.cursor < this.entries.length; }
  list() { return this.entries.map((entry, index) => ({ id: entry.id, label: entry.label, timestamp: entry.timestamp, affectedIds: [...entry.affectedIds], active: index < this.cursor })); }
}
export async function createSnapshot(document, { releaseNotes = '', validationReport = null } = {}) {
  const copy = safeClone(document); copy.official = false;
  const versionId = crypto.randomUUID?.() || `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const hash = await sha256({ document: copy, releaseNotes });
  return deepFreeze({ versionId, parentRevision: document.revision, schemaVersion: document.schemaVersion, hash, createdAt: new Date().toISOString(), releaseNotes, assetReferences: Object.values(copy.assets || {}).map(asset => asset.hash).filter(Boolean), validationReport: validationReport || validateDocument(copy), document: copy, immutable: true });
}
export function diffDocuments(before, after) {
  const changes = [];
  const walk = (a, b, path, category) => {
    if (stableStringify(a) === stableStringify(b)) return;
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const key of keys) {
      const next = path ? `${path}.${key}` : key;
      if (!(key in (a || {}))) changes.push({ kind: 'added', category, path: next, after: safeClone(b[key]) });
      else if (!(key in (b || {}))) changes.push({ kind: 'removed', category, path: next, before: safeClone(a[key]) });
      else if (a[key] && b[key] && typeof a[key] === 'object' && typeof b[key] === 'object') walk(a[key], b[key], next, category);
      else if (stableStringify(a[key]) !== stableStringify(b[key])) changes.push({ kind: 'changed', category, path: next, before: safeClone(a[key]), after: safeClone(b[key]) });
    }
  };
  for (const key of ['tokens', 'nodes', 'components', 'assets', 'motions', 'rules']) walk(before[key], after[key], key, key);
  return changes;
}
