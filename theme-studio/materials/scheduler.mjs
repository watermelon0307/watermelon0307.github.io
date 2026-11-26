export class DirtyScheduler {
  constructor(callback, { windowRef = globalThis.window, documentRef = globalThis.document, autoEvents = true } = {}) {
    if (typeof callback !== 'function') throw new TypeError('DirtyScheduler 需要 callback');
    this.callback = callback; this.window = windowRef; this.document = documentRef; this.reasons = new Set(); this.frame = null;
    this.disposed = false; this.callbackCount = 0; this.coalescedCount = 0; this.lastError = null;
    this.tick = () => { this.frame = null; if (this.disposed || this.document?.hidden) return; const reasons = [...this.reasons].sort(); this.reasons.clear(); this.callbackCount += 1; try { this.callback(Object.freeze(reasons)); } catch (error) { this.lastError = error; } };
    this.onVisibility = () => { if (!this.document?.hidden) this.invalidate('visibility'); };
    this.onScroll = () => this.invalidate('scroll'); this.onResize = () => { this.invalidate('resize'); this.watchDPR(); };
    this.onDPR = () => this.invalidate('dpr');
    if (autoEvents) this.attach();
  }
  attach() {
    this.document?.addEventListener?.('visibilitychange', this.onVisibility);
    this.window?.addEventListener?.('scroll', this.onScroll, true); this.window?.addEventListener?.('resize', this.onResize);
    this.window?.visualViewport?.addEventListener?.('scroll', this.onScroll); this.window?.visualViewport?.addEventListener?.('resize', this.onResize);
    this.watchDPR();
  }
  watchDPR() {
    this.dprQuery?.removeEventListener?.('change', this.onDPR);
    const ratio = this.window?.devicePixelRatio || 1;
    this.dprQuery = this.window?.matchMedia?.(`(resolution: ${ratio}dppx)`) || null;
    this.dprQuery?.addEventListener?.('change', this.onDPR, { once: true });
  }
  invalidate(reason = 'dirty') {
    if (this.disposed) return false;
    if (this.document?.hidden) { this.reasons.add(reason); return false; }
    this.reasons.add(reason);
    if (this.frame != null) { this.coalescedCount += 1; return false; }
    const raf = this.window?.requestAnimationFrame?.bind(this.window) || (fn => setTimeout(fn, 16));
    this.frame = raf(this.tick); return true;
  }
  flush() { if (this.frame != null) { this.window?.cancelAnimationFrame?.(this.frame); clearTimeout(this.frame); this.frame = null; } this.tick(); }
  dispose() {
    this.disposed = true; this.reasons.clear();
    if (this.frame != null) { this.window?.cancelAnimationFrame?.(this.frame); clearTimeout(this.frame); this.frame = null; }
    this.document?.removeEventListener?.('visibilitychange', this.onVisibility);
    this.window?.removeEventListener?.('scroll', this.onScroll, true); this.window?.removeEventListener?.('resize', this.onResize);
    this.window?.visualViewport?.removeEventListener?.('scroll', this.onScroll); this.window?.visualViewport?.removeEventListener?.('resize', this.onResize);
    this.dprQuery?.removeEventListener?.('change', this.onDPR);
  }
}
