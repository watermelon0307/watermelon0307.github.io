import { DEFAULT_MATERIAL } from './core.mjs';
import { SharedGlassRenderer } from './materials/webgl-renderer.mjs';
import { DirtyScheduler } from './materials/scheduler.mjs';
import { AdaptiveQuality, selectInitialQuality } from './materials/quality.mjs';
import { SVGDisplacementAdapter } from './materials/svg-adapter.mjs';
export class GlassRuntime {
  constructor(canvas, provider, { onStatus = () => {}, quality = null, svgAdapter = null, preserveDrawingBuffer = false } = {}) {
    this.canvas = canvas; this.provider = provider; this.onStatus = onStatus; this.surfaces = new Map(); this.nextId = 1; this.frame = null; this.frameRevision = -1; this.disposed = false;
    this.quality = quality || new AdaptiveQuality({ initial: selectInitialQuality({ deviceMemory: navigator.deviceMemory || 4, hardwareConcurrency: navigator.hardwareConcurrency || 4, reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches }) });
    this.svg = svgAdapter || new SVGDisplacementAdapter(); this.renderer = null; this.rendererError = null;
    this.scheduler = new DirtyScheduler(reasons => this.render(reasons)); this.initializeRenderer();
  }
  initializeRenderer() {
    try {
      this.renderer = new SharedGlassRenderer(this.canvas, { preserveDrawingBuffer: false, onContextLost: () => { this.onStatus({ backend: 'css', reason: 'context-lost' }); this.applyFallbacks('context-lost'); }, onContextRestored: () => this.scheduler.invalidate('context-restored') });
      this.rendererError = null; for (const [id, surface] of this.surfaces) surface.rendererId = this.renderer.register(surface.target, surface.material, surface.options);
    } catch (error) { this.renderer = null; this.rendererError = error; this.onStatus({ backend: 'css', reason: error.message }); }
  }
  register(target, material = {}, options = {}) {
    const id = this.nextId++, surface = { target, material: { ...DEFAULT_MATERIAL, ...material }, options: { ...options }, rendererId: null, visible: true };
    this.surfaces.set(id, surface); if (this.renderer) surface.rendererId = this.renderer.register(target, surface.material, surface.options);
    this.observe(surface); this.scheduler.invalidate('surface-add'); return id;
  }
  observe(surface) {
    if (typeof IntersectionObserver === 'undefined' || !surface.target.addEventListener) return;
    surface.observer = new IntersectionObserver(entries => { surface.visible = entries[0]?.isIntersecting !== false; this.scheduler.invalidate('intersection'); }, { rootMargin: '80px' }); surface.observer.observe(surface.target);
  }
  update(id, patch) { const surface = this.surfaces.get(id); if (!surface) return false; surface.material = { ...surface.material, ...patch }; if (surface.rendererId) this.renderer?.update(surface.rendererId, surface.material); this.scheduler.invalidate('material'); return true; }
  unregister(id) { const surface = this.surfaces.get(id); if (!surface) return; surface.observer?.disconnect(); if (surface.rendererId) this.renderer?.unregister(surface.rendererId); this.svg.remove(surface.target); surface.target.removeAttribute?.('data-glass-backend'); this.surfaces.delete(id); this.scheduler.invalidate('surface-remove'); }
  setQuality(level) { this.quality.setLevel(level, 'user'); this.scheduler.invalidate('quality'); }
  invalidateScene(reason = 'scene') { this.provider.invalidate(reason); this.scheduler.invalidate(reason); }
  applyFallbacks(reason) {
    for (const surface of this.surfaces.values()) {
      const mode = surface.material.mode === 'solid' || this.quality.level === 'Safe' ? 'solid' : 'css';
      surface.target.dataset.glassBackend = mode; surface.target.dataset.glassReason = reason; surface.target.classList?.add(`warmth-glass-${mode}`); surface.target.classList?.remove(`warmth-glass-${mode === 'css' ? 'solid' : 'css'}`);
    }
  }
  prepareBackends() {
    let webglCount = 0;
    for (const surface of this.surfaces.values()) {
      const material = this.quality.material(surface.material), requested = material.mode;
      let backend = requested === 'auto' || requested === 'webgl' ? 'webgl' : requested;
      if (backend === 'webgl' && (!this.renderer || this.renderer.contextLost || !surface.visible || this.quality.level === 'Safe' || webglCount >= this.quality.settings.maxSurfaces)) backend = this.quality.level === 'Safe' ? 'solid' : 'css';
      if (backend === 'svg') { if (this.svg.verifiedBackdrop) { const result = this.svg.apply(surface.target, material, { verified: true }); backend = result.backend; } else backend = 'css'; }
      if (!['webgl', 'css', 'solid'].includes(backend)) backend = 'css';
      surface.target.classList?.toggle('warmth-glass-css', backend === 'css'); surface.target.classList?.toggle('warmth-glass-solid', backend === 'solid');
      surface.target.dataset.glassBackend = backend; surface.target.dataset.glassReason = backend === 'css' ? 'frosted fallback' : backend === 'solid' ? 'solid fallback' : '';
      if (surface.rendererId && this.renderer) this.renderer.surfaces.get(surface.rendererId).options.hidden = backend !== 'webgl';
      if (backend === 'webgl') { webglCount += 1; this.renderer.update(surface.rendererId, material); }
    }
    return webglCount;
  }
  render(reasons = ['manual']) {
    if (this.disposed) return null;
    const started = performance.now(), webglCount = this.prepareBackends(); let stats = { backend: webglCount ? 'webgl' : this.quality.level === 'Safe' ? 'solid' : 'css', drawn: 0, uploadCount: this.renderer?.textureUploadCount || 0 };
    try {
      if (webglCount) {
        if (!this.frame || this.frameRevision !== this.provider.revision) { this.frame = this.provider.capture(); this.frameRevision = this.provider.revision; }
        stats = this.renderer.render(this.frame, { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1, qualityScale: this.quality.settings.scale, blurQuality: this.quality.settings.blurQuality });
        stats = { ...stats, backend: 'webgl', sampling: this.frame.kind };
      } else this.applyFallbacks(this.quality.level === 'Safe' ? 'safe-quality' : 'backend-unavailable');
      this.lastStats = { ...stats, reasons, quality: this.quality.level, frameMs: performance.now() - started };
      if (reasons.includes('performance-sample')) this.quality.sample(this.lastStats.frameMs);
      this.onStatus(this.lastStats); return this.lastStats;
    } catch (error) {
      this.lastError = error; this.renderer?.dispose(); this.renderer = null; this.applyFallbacks('render-error');
      this.lastStats = { backend: 'css', reason: error.message, drawn: 0, error: true }; this.onStatus(this.lastStats); return this.lastStats;
    }
  }
  retry() { if (!this.renderer && !this.disposed) { this.initializeRenderer(); this.frame = null; this.frameRevision = -1; this.scheduler.invalidate('manual-retry'); } }
  dispose() { this.disposed = true; this.scheduler.dispose(); for (const surface of this.surfaces.values()) surface.observer?.disconnect(); this.renderer?.dispose(); this.svg.dispose(); this.surfaces.clear(); this.frame = null; }
}
