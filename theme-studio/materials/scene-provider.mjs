/* Actual-sampling SceneProvider. DOM elements are deliberately not CanvasImageSource. */
export const SCENE_KINDS = Object.freeze(['owned-scene', 'wallpaper-only']);
export class SceneProviderError extends Error {
  constructor(code, message, cause) { super(message); this.name = 'SceneProviderError'; this.code = code; this.cause = cause; }
}
export function finiteRect(rect, name = 'rect') {
  if (!rect || !['left', 'top', 'width', 'height'].every(k => Number.isFinite(rect[k])) || rect.width <= 0 || rect.height <= 0) throw new SceneProviderError('INVALID_RECT', `${name} 必須是正值、finite 的 viewport CSS rect`);
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}
export function isCanvasImageSource(source) {
  if (!source) return false;
  const names = ['HTMLCanvasElement', 'OffscreenCanvas', 'ImageBitmap', 'HTMLImageElement', 'HTMLVideoElement', 'VideoFrame'];
  return names.some(name => typeof globalThis[name] !== 'undefined' && source instanceof globalThis[name]);
}
export function sourcePixelSize(source) {
  if (!isCanvasImageSource(source)) throw new SceneProviderError('INVALID_SOURCE', 'SceneProvider 只接受合法 CanvasImageSource，不接受 HTMLElement');
  const width = source.pixelWidth ?? source.naturalWidth ?? source.videoWidth ?? source.displayWidth ?? source.width;
  const height = source.pixelHeight ?? source.naturalHeight ?? source.videoHeight ?? source.displayHeight ?? source.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new SceneProviderError('SOURCE_NOT_READY', '背景來源尚未就緒或像素尺寸無效');
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement && source.readyState < 2) throw new SceneProviderError('SOURCE_NOT_READY', '影片尚未有可讀 frame');
  return { width, height };
}
export function computeSourceRect(cssRect, frame, pad = 0) {
  const rect = finiteRect(cssRect), bounds = finiteRect(frame.bounds, 'frame.bounds');
  if (!Number.isFinite(pad) || pad < 0) throw new SceneProviderError('INVALID_PADDING', '取樣 padding 無效');
  if (!Number.isFinite(frame.pixelWidth) || !Number.isFinite(frame.pixelHeight) || frame.pixelWidth <= 0 || frame.pixelHeight <= 0) throw new SceneProviderError('INVALID_FRAME', '來源像素尺寸無效');
  const x = rect.left - pad, y = rect.top - pad, width = rect.width + pad * 2, height = rect.height + pad * 2;
  return {
    css: { left: x, top: y, width, height },
    source: {
      x: (x - bounds.left) * frame.pixelWidth / bounds.width,
      y: (y - bounds.top) * frame.pixelHeight / bounds.height,
      width: width * frame.pixelWidth / bounds.width,
      height: height * frame.pixelHeight / bounds.height
    }
  };
}
export function samplingUV(rect, frame) {
  const value = computeSourceRect(rect, frame, 0).source;
  return { x: value.x / frame.pixelWidth, y: value.y / frame.pixelHeight, width: value.width / frame.pixelWidth, height: value.height / frame.pixelHeight };
}
export function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; }
  throw new SceneProviderError('NO_CANVAS', '此環境沒有 Canvas');
}
export function assertReadableSource(source) {
  const { width, height } = sourcePixelSize(source);
  const probe = makeCanvas(1, 1), context = probe.getContext('2d');
  if (!context) throw new SceneProviderError('NO_2D_CONTEXT', '無法建立 2D 取樣 context');
  try {
    context.drawImage(source, 0, 0, Math.min(width, 2), Math.min(height, 2), 0, 0, 1, 1);
    context.getImageData(0, 0, 1, 1);
  } catch (error) { throw new SceneProviderError('SOURCE_SECURITY', '背景來源不可讀或受跨來源限制', error); }
  return true;
}
export function sampleFrameToCanvas(frame, cssRect, output, { pad = 0, renderScale = 1, fallbackColor = '#000000' } = {}) {
  assertReadableSource(frame.source);
  const { source } = computeSourceRect(cssRect, frame, pad);
  const cssWidth = cssRect.width + pad * 2, cssHeight = cssRect.height + pad * 2;
  if (!Number.isFinite(renderScale) || renderScale <= 0 || renderScale > 4) throw new SceneProviderError('INVALID_SCALE', 'renderScale 必須介於 0–4');
  const width = Math.max(1, Math.ceil(cssWidth * renderScale)), height = Math.max(1, Math.ceil(cssHeight * renderScale));
  if (width * height > 16_777_216) throw new SceneProviderError('PIXEL_BUDGET', '取樣畫面超過像素預算');
  output.width = width; output.height = height;
  const context = output.getContext('2d');
  if (!context) throw new SceneProviderError('NO_2D_CONTEXT', '無法建立 scratch canvas');
  context.clearRect(0, 0, width, height); context.fillStyle = fallbackColor; context.fillRect(0, 0, width, height);
  try { context.drawImage(frame.source, source.x, source.y, source.width, source.height, 0, 0, width, height); }
  catch (error) { throw new SceneProviderError('DRAW_FAILED', '背景取樣失敗', error); }
  return { canvas: output, width, height, sourceRect: source };
}
export class CanvasSceneProvider {
  constructor(source, { bounds = { left: 0, top: 0, width: 1, height: 1 }, kind = 'owned-scene', maxPixels = 16_777_216 } = {}) {
    if (!SCENE_KINDS.includes(kind)) throw new SceneProviderError('INVALID_KIND', '未知場景類型');
    this.source = source; this.bounds = finiteRect(bounds, 'bounds'); this.kind = kind; this.maxPixels = maxPixels;
    this.revision = 0; this.dirtyReason = 'initial'; this.disposed = false;
  }
  setSource(source, reason = 'source') { this.source = source; this.invalidate(reason); }
  setBounds(bounds, reason = 'bounds') { this.bounds = finiteRect(bounds, 'bounds'); this.invalidate(reason); }
  invalidate(reason = 'scene') { this.revision += 1; this.dirtyReason = reason; }
  capture() {
    if (this.disposed) throw new SceneProviderError('DISPOSED', 'SceneProvider 已 dispose');
    const { width, height } = sourcePixelSize(this.source);
    if (width * height > this.maxPixels) throw new SceneProviderError('PIXEL_BUDGET', '共享場景 texture 超過像素預算');
    assertReadableSource(this.source);
    return Object.freeze({ source: this.source, pixelWidth: width, pixelHeight: height, bounds: { ...this.bounds }, revision: this.revision, dirtyReason: this.dirtyReason, kind: this.kind });
  }
  dispose() { this.disposed = true; this.source = null; }
}
export class OwnedCanvasSceneProvider extends CanvasSceneProvider {
  constructor(width, height, draw, options = {}) {
    const canvas = makeCanvas(width, height);
    super(canvas, { ...options, kind: 'owned-scene', bounds: options.bounds || { left: 0, top: 0, width, height } });
    this.draw = draw; this.pixelRatio = options.pixelRatio || 1; this.cssWidth = width; this.cssHeight = height;
  }
  resize(width, height, pixelRatio = this.pixelRatio) {
    if (![width, height, pixelRatio].every(Number.isFinite) || width <= 0 || height <= 0 || pixelRatio <= 0 || pixelRatio > 4) throw new SceneProviderError('INVALID_SIZE', 'owned scene 尺寸無效');
    this.cssWidth = width; this.cssHeight = height; this.pixelRatio = pixelRatio;
    this.source.width = Math.ceil(width * pixelRatio); this.source.height = Math.ceil(height * pixelRatio);
    this.bounds = { left: 0, top: 0, width, height }; this.invalidate('resize');
  }
  capture() {
    const context = this.source.getContext('2d');
    if (!context) throw new SceneProviderError('NO_2D_CONTEXT', 'owned scene 沒有 2D context');
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0); context.clearRect(0, 0, this.cssWidth, this.cssHeight);
    if (this.draw) this.draw(context, { width: this.cssWidth, height: this.cssHeight, revision: this.revision });
    return super.capture();
  }
}
export class WallpaperSceneProvider extends CanvasSceneProvider {
  constructor(source, options = {}) { super(source, { ...options, kind: 'wallpaper-only' }); }
}
