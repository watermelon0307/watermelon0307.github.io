export const QUALITY_LEVELS = Object.freeze({
  Ultra: Object.freeze({ scale: 1, blurQuality: 1, dispersion: 1, maxSurfaces: 32, refreshHz: 60 }),
  High: Object.freeze({ scale: 0.85, blurQuality: 1, dispersion: 1, maxSurfaces: 24, refreshHz: 45 }),
  Balanced: Object.freeze({ scale: 0.7, blurQuality: 0, dispersion: 0.65, maxSurfaces: 16, refreshHz: 30 }),
  Low: Object.freeze({ scale: 0.55, blurQuality: 0, dispersion: 0, maxSurfaces: 8, refreshHz: 20 }),
  Safe: Object.freeze({ scale: 0.5, blurQuality: 0, dispersion: 0, maxSurfaces: 0, refreshHz: 0 })
});
const ORDER = ['Safe', 'Low', 'Balanced', 'High', 'Ultra'];
export class AdaptiveQuality {
  constructor({ initial = 'High', badFrameMs = 24, goodFrameMs = 15, badFrames = 12, goodFrames = 90, cooldownMs = 2500, now = () => performance.now() } = {}) {
    if (!ORDER.includes(initial)) throw new Error('未知 quality level');
    this.level = initial; this.badFrameMs = badFrameMs; this.goodFrameMs = goodFrameMs; this.badLimit = badFrames; this.goodLimit = goodFrames;
    this.cooldownMs = cooldownMs; this.now = now; this.bad = 0; this.good = 0; this.lastChange = -Infinity; this.history = [];
  }
  sample(frameMs) {
    if (!Number.isFinite(frameMs) || frameMs < 0) return this.level;
    if (frameMs > this.badFrameMs) { this.bad += 1; this.good = 0; }
    else if (frameMs < this.goodFrameMs) { this.good += 1; this.bad = 0; }
    else { this.bad = 0; this.good = 0; }
    const now = this.now(); if (now - this.lastChange < this.cooldownMs) return this.level;
    const index = ORDER.indexOf(this.level);
    if (this.bad >= this.badLimit && index > 0) this.setLevel(ORDER[index - 1], 'frame-budget', now);
    else if (this.good >= this.goodLimit && index < ORDER.length - 1) this.setLevel(ORDER[index + 1], 'headroom', now);
    return this.level;
  }
  setLevel(level, reason = 'manual', now = this.now()) {
    if (!ORDER.includes(level)) throw new Error('未知 quality level');
    if (level === this.level) return;
    this.history.push({ from: this.level, to: level, reason, at: now }); this.level = level; this.lastChange = now; this.bad = 0; this.good = 0;
  }
  get settings() { return QUALITY_LEVELS[this.level]; }
  material(material) { const settings = this.settings; return { ...material, dispersionPx: material.dispersionPx * settings.dispersion, blurPx: settings.blurQuality ? material.blurPx : Math.min(material.blurPx, 2) }; }
}
export function selectInitialQuality({ deviceMemory = 8, hardwareConcurrency = 8, reducedTransparency = false, webgl = true } = {}) {
  if (reducedTransparency || !webgl) return 'Safe';
  if (deviceMemory <= 2 || hardwareConcurrency <= 2) return 'Low';
  if (deviceMemory <= 4 || hardwareConcurrency <= 4) return 'Balanced';
  if (deviceMemory >= 8 && hardwareConcurrency >= 8) return 'High';
  return 'Balanced';
}
