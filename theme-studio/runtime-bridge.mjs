import { createSafeDocument, resolveTheme, compileTheme, validateDocument, safeClone } from './core.mjs';
export class ActivationError extends Error { constructor(code, message, cause) { super(message); this.name = 'ActivationError'; this.code = code; this.cause = cause; } }
export function applyCompiledTheme(compiled, target = globalThis.document?.documentElement, { themeId = null, mode = null } = {}) {
  if (!target?.style) throw new ActivationError('NO_TARGET', '沒有可套用主題的 DOM root');
  const previous = target.__warmthThemeVariables || [];
  for (const key of previous) if (!Object.hasOwn(compiled.variables, key)) target.style.removeProperty(key);
  for (const [key, value] of Object.entries(compiled.variables)) target.style.setProperty(key, value);
  target.__warmthThemeVariables = Object.keys(compiled.variables);
  if (themeId) target.dataset.warmthTheme = themeId; if (mode) target.dataset.warmthMode = mode;
  return Object.keys(compiled.variables).length;
}
export class ActivationService {
  constructor(repository, { themes = {}, apply = applyCompiledTheme, healthCheck = null, context = { mode: 'light', app: 'warmth' } } = {}) {
    this.repository = repository; this.themes = themes; this.apply = apply; this.healthCheck = healthCheck; this.context = context; this.queue = Promise.resolve(); this.controller = null; this.active = null;
  }
  async prepare(document, activationId, signal) {
    if (signal?.aborted) throw new ActivationError('ABORTED', '啟用已被較新的請求取代');
    const report = validateDocument(document, { themes: this.themes }); if (!report.valid) throw new ActivationError('VALIDATION', '主題驗證失敗');
    const resolved = resolveTheme(document, { ...this.context, themeRevision: document.revision }, { themes: this.themes });
    if (resolved.diagnostics.some(item => item.severity === 'error')) throw new ActivationError('RESOLVE', '主題解析失敗');
    const compiled = compileTheme(resolved); if (signal?.aborted) throw new ActivationError('ABORTED', '啟用已取消');
    return { activationId, document: safeClone(document), resolved, compiled };
  }
  activate(document) {
    this.controller?.abort(); const controller = new AbortController(); this.controller = controller;
    const activationId = crypto.randomUUID?.() || `activation-${Date.now()}-${Math.random()}`;
    const run = async () => {
      const previous = this.active || await this.repository.getSetting('active');
      await this.repository.saveSetting('pending', { activationId, document: safeClone(document), startedAt: new Date().toISOString() });
      try {
        const prepared = await this.prepare(document, activationId, controller.signal);
        if (controller.signal.aborted) throw new ActivationError('ABORTED', '啟用已取消');
        await this.apply(prepared.compiled, undefined, { themeId: document.id, mode: prepared.resolved.mode });
        if (this.healthCheck && !await this.healthCheck(prepared)) throw new ActivationError('HEALTH_CHECK', '主題健康檢查失敗');
        if (controller.signal.aborted) throw new ActivationError('ABORTED', '啟用已取消');
        const active = { document: prepared.document, activationId, activatedAt: new Date().toISOString() };
        await this.repository.commitActivation({ activationId, active, lastKnownGood: active }); this.active = active; return active;
      } catch (error) {
        if (previous?.document) {
          try { const fallback = await this.prepare(previous.document, previous.activationId, null); await this.apply(fallback.compiled, undefined, { themeId: previous.document.id, mode: fallback.resolved.mode }); this.active = previous; await this.repository.commitActivation({ activationId: previous.activationId, active: previous, lastKnownGood: previous }); }
          catch (rollbackError) { throw new ActivationError('ROLLBACK_FAILED', `啟用及還原均失敗：${rollbackError.message}`, error); }
        }
        throw error;
      }
    };
    this.queue = this.queue.then(run, run); return this.queue;
  }
  async recover() {
    const pending = await this.repository.getSetting('pending'), lkg = await this.repository.getSetting('lastKnownGood');
    if (!pending && this.active) return this.active;
    const document = lkg?.document || createSafeDocument();
    const prepared = await this.prepare(document, lkg?.activationId || 'safe-recovery', null);
    await this.apply(prepared.compiled, undefined, { themeId: document.id, mode: prepared.resolved.mode });
    const active = lkg || { document: prepared.document, activationId: 'safe-recovery', activatedAt: new Date().toISOString() };
    await this.repository.commitActivation({ activationId: active.activationId, active, lastKnownGood: active }); this.active = active; return active;
  }
}
