import { safeClone, validateDocument } from './core.mjs';
export const DB_NAME = 'warmth-theme-studio';
export class ThemeStorageError extends Error {
  constructor(code, message, cause) { super(message); this.name = 'ThemeStorageError'; this.code = code; this.cause = cause; }
}
function request(result) { return new Promise((resolve, reject) => { result.onsuccess = () => resolve(result.result); result.onerror = () => reject(result.error); }); }
function transactionDone(tx) { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('transaction aborted')); }); }
function storageError(error, operation) {
  const name = error?.name || '';
  const code = name === 'QuotaExceededError' ? 'QUOTA' : name === 'InvalidStateError' ? 'PRIVATE_MODE' : name === 'ConstraintError' ? 'CONFLICT' : 'STORAGE';
  return new ThemeStorageError(code, `${operation} 失敗：${error?.message || 'IndexedDB 無法完成'}`, error);
}
export class ThemeRepository {
  constructor({ indexedDB: idb = globalThis.indexedDB, BroadcastChannel: Channel = globalThis.BroadcastChannel, channelName = `${DB_NAME}:changes` } = {}) {
    if (!idb) throw new ThemeStorageError('UNSUPPORTED', '此瀏覽器沒有 IndexedDB；可先匯出救援 JSON');
    this.idb = idb; this.db = null; this.channel = Channel ? new Channel(channelName) : null; this.listeners = new Set(); this.openPromise = null;
    if (this.channel) this.channel.onmessage = event => { for (const listener of this.listeners) listener(event.data); };
  }
  open() {
    if (this.db) return Promise.resolve(this.db); if (this.openPromise) return this.openPromise;
    this.openPromise = new Promise((resolve, reject) => {
      let settled = false; const req = this.idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) { const store = db.createObjectStore('projects', { keyPath: 'id' }); store.createIndex('updatedAt', 'updatedAt'); }
        if (!db.objectStoreNames.contains('drafts')) { const store = db.createObjectStore('drafts', { keyPath: 'projectId' }); store.createIndex('updatedAt', 'updatedAt'); }
        if (!db.objectStoreNames.contains('versions')) { const store = db.createObjectStore('versions', { keyPath: ['projectId', 'versionId'] }); store.createIndex('projectId', 'projectId'); }
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'hash' });
        if (!db.objectStoreNames.contains('assignments')) db.createObjectStore('assignments', { keyPath: 'scopeKey' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('recovery')) db.createObjectStore('recovery', { keyPath: 'key' });
      };
      req.onsuccess = () => { settled = true; this.db = req.result; this.db.onversionchange = () => this.close(); resolve(this.db); };
      req.onerror = () => { settled = true; reject(storageError(req.error, '開啟資料庫')); };
      req.onblocked = () => { if (!settled) reject(new ThemeStorageError('BLOCKED', '資料庫升級被另一分頁阻擋，請關閉舊分頁後重試')); };
    }).finally(() => { this.openPromise = null; });
    return this.openPromise;
  }
  async tx(names, mode, operation, work) {
    try { await this.open(); const tx = this.db.transaction(names, mode); const result = await work(tx); await transactionDone(tx); return result; }
    catch (error) { throw error instanceof ThemeStorageError ? error : storageError(error, operation); }
  }
  async saveDraft(document, { expectedRevision = null, source = 'local' } = {}) {
    const report = validateDocument(document); if (!report.valid) throw new ThemeStorageError('VALIDATION', '草稿驗證失敗，未寫入');
    const result = await this.tx(['drafts', 'projects'], 'readwrite', '保存草稿', async tx => {
      const store = tx.objectStore('drafts'), previous = await request(store.get(document.id));
      if (expectedRevision != null && (previous?.document.revision ?? 0) !== expectedRevision) throw new ThemeStorageError('CONFLICT', `revision 衝突：儲存版本為 ${previous?.document.revision ?? 0}`);
      const record = { projectId: document.id, document: safeClone(document), updatedAt: new Date().toISOString() };
      await request(store.put(record));
      await request(tx.objectStore('projects').put({ id: document.id, name: document.name, revision: document.revision, updatedAt: record.updatedAt, schemaVersion: document.schemaVersion }));
      return record;
    });
    this.channel?.postMessage({ type: 'draft', projectId: document.id, revision: document.revision, source }); return safeClone(result.document);
  }
  async getDraft(id) { const record = await this.tx(['drafts'], 'readonly', '讀取草稿', tx => request(tx.objectStore('drafts').get(id))); return record ? safeClone(record.document) : null; }
  async listProjects() { return this.tx(['projects'], 'readonly', '列出專案', tx => request(tx.objectStore('projects').getAll())); }
  async deleteDraft(id) { await this.tx(['drafts', 'projects'], 'readwrite', '刪除草稿', async tx => { await request(tx.objectStore('drafts').delete(id)); await request(tx.objectStore('projects').delete(id)); }); this.channel?.postMessage({ type: 'delete', projectId: id }); }
  async saveSetting(key, value) { await this.tx(['settings'], 'readwrite', '保存設定', tx => request(tx.objectStore('settings').put({ key, value: safeClone(value), updatedAt: new Date().toISOString() }))); }
  async getSetting(key) { const record = await this.tx(['settings'], 'readonly', '讀取設定', tx => request(tx.objectStore('settings').get(key))); return record?.value ?? null; }
  async saveRecovery(key, document, reason) { await this.tx(['recovery'], 'readwrite', '保存救援副本', tx => request(tx.objectStore('recovery').put({ key, document: safeClone(document), reason, updatedAt: new Date().toISOString() }))); }
  async getRecovery(key) { return this.tx(['recovery'], 'readonly', '讀取救援副本', tx => request(tx.objectStore('recovery').get(key))); }
  async saveVersion(projectId, version) {
    if (!version?.versionId || !version?.hash || !version?.document) throw new ThemeStorageError('VALIDATION', '版本快照資料不完整');
    return this.tx(['versions'], 'readwrite', '保存不可變版本', async tx => {
      const store = tx.objectStore('versions'), key = [projectId, version.versionId], existing = await request(store.get(key));
      if (existing) throw new ThemeStorageError('IMMUTABLE', '已存在版本不可覆寫');
      await request(store.add({ ...safeClone(version), projectId, immutable: true })); return version;
    });
  }
  async listVersions(projectId) { return this.tx(['versions'], 'readonly', '列出版本', tx => request(tx.objectStore('versions').index('projectId').getAll(projectId))); }
  async putAsset(blob) {
    if (!(blob instanceof Blob)) throw new ThemeStorageError('VALIDATION', '素材必須為 Blob');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
    await this.tx(['assets'], 'readwrite', '保存素材', tx => request(tx.objectStore('assets').put({ hash, blob, type: blob.type, length: blob.size }))); return hash;
  }
  async getAsset(hash) { return this.tx(['assets'], 'readonly', '讀取素材', tx => request(tx.objectStore('assets').get(hash))); }
  async commitActivation({ activationId, active, lastKnownGood }) {
    return this.tx(['settings'], 'readwrite', '提交主題啟用', async tx => {
      const store = tx.objectStore('settings'), now = new Date().toISOString();
      await request(store.put({ key: 'active', value: safeClone(active), activationId, updatedAt: now }));
      await request(store.put({ key: 'lastKnownGood', value: safeClone(lastKnownGood), activationId, updatedAt: now }));
      await request(store.delete('pending')); return active;
    });
  }
  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close() { this.db?.close(); this.db = null; }
  dispose() { this.close(); this.channel?.close(); this.listeners.clear(); }
}
export class DraftAutosaver {
  constructor(repository, { delay = 600, onStatus = () => {}, source = `tab-${Math.random().toString(36).slice(2)}` } = {}) { this.repository = repository; this.delay = delay; this.onStatus = onStatus; this.source = source; this.timer = null; this.pending = null; this.savedRevision = null; this.disposed = false; }
  schedule(document) {
    if (this.disposed) return; this.savedRevision ??= document.revision - 1; this.pending = safeClone(document); this.onStatus('unsaved'); clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch(() => {}), this.delay);
  }
  async flush() {
    clearTimeout(this.timer); this.timer = null; if (!this.pending || this.disposed) return null;
    const document = this.pending; this.pending = null; this.onStatus('saving');
    try { const saved = await this.repository.saveDraft(document, { expectedRevision: this.savedRevision, source: this.source }); this.savedRevision = saved.revision; this.onStatus('saved', saved); return saved; }
    catch (error) { this.pending ||= document; await this.repository.saveRecovery(`rescue:${document.id}`, document, error.code).catch(() => {}); this.onStatus('error', error); throw error; }
  }
  async dispose() { this.disposed = true; clearTimeout(this.timer); this.timer = null; }
}
