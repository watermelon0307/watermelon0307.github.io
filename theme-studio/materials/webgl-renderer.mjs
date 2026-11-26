import { DEFAULT_MATERIAL, hexToRgb } from '../core.mjs';
import { createProgram } from './shaders.mjs';

const UNIFORMS = ['uScene', 'uSceneOrigin', 'uSceneCssSize', 'uRect', 'uRadius', 'uFallback', 'uTint', 'uBevel', 'uThickness', 'uIor', 'uDistortion', 'uMaxDisplacement', 'uDispersion', 'uBlur', 'uSaturation', 'uEdgeStrength', 'uEdgeWidth', 'uLightAngle', 'uHighlight', 'uBlurQuality'];
function normalizedRect(rect) {
  if (!rect || !['left', 'top', 'right', 'bottom', 'width', 'height'].every(key => Number.isFinite(rect[key])) || rect.width <= 0 || rect.height <= 0) return null;
  return rect;
}
function colorVector(hex, fallback = { r: 0, g: 0, b: 0, a: 1 }) { const c = hexToRgb(hex) || fallback; return [c.r / 255, c.g / 255, c.b / 255, c.a]; }
export class SharedGlassRenderer {
  constructor(canvas, { maxTexturePixels = 16_777_216, onContextLost = null, onContextRestored = null, preserveDrawingBuffer = false } = {}) {
    if (!canvas?.getContext) throw new TypeError('SharedGlassRenderer 需要 canvas');
    this.canvas = canvas; this.maxTexturePixels = maxTexturePixels; this.surfaces = new Map(); this.nextId = 1;
    this.onContextLost = onContextLost; this.onContextRestored = onContextRestored; this.preserveDrawingBuffer = preserveDrawingBuffer;
    this.textureUploadCount = 0; this.textureAllocationCount = 0; this.drawCount = 0; this.lastFrameKey = null;
    this.disposed = false; this.contextLost = false; this.viewport = null;
    this.handleLost = event => { event.preventDefault(); this.contextLost = true; this.onContextLost?.(); };
    this.handleRestored = () => { try { this.initialize(); this.contextLost = false; this.lastFrameKey = null; this.onContextRestored?.(); } catch (error) { this.onContextLost?.(error); } };
    canvas.addEventListener?.('webglcontextlost', this.handleLost, false);
    canvas.addEventListener?.('webglcontextrestored', this.handleRestored, false);
    this.initialize();
  }
  initialize() {
    const gl = this.canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: this.preserveDrawingBuffer, powerPreference: 'low-power' });
    if (!gl) throw new Error('WebGL 不可用');
    this.gl = gl; this.program = createProgram(gl); this.uniforms = Object.fromEntries(UNIFORMS.map(name => [name, gl.getUniformLocation(this.program, name)]));
    this.positionLocation = gl.getAttribLocation(this.program, 'aPosition');
    this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.texture = gl.createTexture(); this.textureSize = null;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  register(target, material = {}, options = {}) {
    if (this.disposed) throw new Error('renderer 已 dispose');
    if (!target || (typeof target.getBoundingClientRect !== 'function' && !target.rect)) throw new TypeError('surface 需要 element 或 rect provider');
    const id = this.nextId++; this.surfaces.set(id, { target, material: { ...DEFAULT_MATERIAL, ...material }, options }); return id;
  }
  update(id, patch) { const surface = this.surfaces.get(id); if (!surface) return false; surface.material = { ...surface.material, ...patch }; return true; }
  unregister(id) { const surface = this.surfaces.get(id); if (!surface) return false; surface.options.dispose?.(); return this.surfaces.delete(id); }
  resize(width, height, scale) {
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    if (w * h > this.maxTexturePixels) throw new Error(' compositor 超過像素預算');
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.viewport = { width, height, scale };
  }
  uploadScene(frame) {
    if (!frame?.source || !Number.isFinite(frame.pixelWidth) || !Number.isFinite(frame.pixelHeight) || frame.pixelWidth <= 0 || frame.pixelHeight <= 0) throw new Error('無效場景 frame');
    if (frame.pixelWidth * frame.pixelHeight > this.maxTexturePixels) throw new Error('場景 texture 超過像素預算');
    const key = `${frame.kind}:${frame.revision}:${frame.pixelWidth}x${frame.pixelHeight}`;
    if (key === this.lastFrameKey) return false;
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const allocationChanged = this.textureSize?.width !== frame.pixelWidth || this.textureSize?.height !== frame.pixelHeight;
    try {
      if (allocationChanged) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame.source); this.textureAllocationCount += 1; }
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame.source);
    } catch (error) { throw new Error(`場景 texture 上傳失敗：${error.message}`); }
    this.textureSize = { width: frame.pixelWidth, height: frame.pixelHeight }; this.lastFrameKey = key; this.textureUploadCount += 1; return true;
  }
  render(frame, { width, height, dpr = 1, qualityScale = 1, blurQuality = 1 } = {}) {
    if (this.disposed || this.contextLost) return { backend: 'unavailable', drawn: 0, skipped: this.surfaces.size };
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('viewport 尺寸無效');
    const scale = Math.max(0.25, Math.min(4, dpr * qualityScale)); this.resize(width, height, scale);
    const uploaded = this.uploadScene(frame), gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.enable(gl.SCISSOR_TEST);
    gl.useProgram(this.program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.enableVertexAttribArray(this.positionLocation); gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture); gl.uniform1i(this.uniforms.uScene, 0);
    gl.uniform2f(this.uniforms.uSceneOrigin, frame.bounds.left, frame.bounds.top); gl.uniform2f(this.uniforms.uSceneCssSize, frame.bounds.width, frame.bounds.height);
    gl.uniform1f(this.uniforms.uBlurQuality, blurQuality > 0.5 ? 1 : 0);
    let drawn = 0, skipped = 0;
    for (const surface of this.surfaces.values()) {
      const rect = normalizedRect(surface.options.rect?.() || surface.target.rect?.() || surface.target.getBoundingClientRect?.());
      if (!rect || surface.options.hidden || rect.right <= 0 || rect.bottom <= 0 || rect.left >= width || rect.top >= height || surface.options.axisAligned === false) { skipped += 1; continue; }
      const x = Math.max(0, Math.floor(rect.left * scale)), y = Math.max(0, Math.floor(this.canvas.height - rect.bottom * scale));
      const right = Math.min(this.canvas.width, Math.ceil(rect.right * scale)), bottom = Math.min(this.canvas.height, Math.ceil(this.canvas.height - rect.top * scale));
      const w = right - x, h = bottom - y; if (w <= 0 || h <= 0) { skipped += 1; continue; }
      const m = { ...DEFAULT_MATERIAL, ...surface.material }, u = this.uniforms;
      gl.viewport(x, y, w, h); gl.scissor(x, y, w, h);
      gl.uniform4f(u.uRect, rect.left, rect.top, rect.width, rect.height);
      gl.uniform4f(u.uRadius, ...m.radius.map(value => Math.max(0, Math.min(value, Math.min(rect.width, rect.height) / 2))));
      const fallback = colorVector(surface.options.fallbackColor || '#000000'); gl.uniform3f(u.uFallback, fallback[0], fallback[1], fallback[2]);
      const tint = colorVector(m.tint, { r: 255, g: 255, b: 255, a: 1 }); gl.uniform4f(u.uTint, tint[0], tint[1], tint[2], Math.max(0, Math.min(1, m.tintOpacity)));
      gl.uniform1f(u.uBevel, m.bevelPx); gl.uniform1f(u.uThickness, m.thicknessPx); gl.uniform1f(u.uIor, m.ior);
      gl.uniform1f(u.uDistortion, m.distortionPx); gl.uniform1f(u.uMaxDisplacement, m.maxDisplacementPx);
      gl.uniform1f(u.uDispersion, m.dispersionPx); gl.uniform1f(u.uBlur, m.blurPx); gl.uniform1f(u.uSaturation, m.saturation);
      gl.uniform1f(u.uEdgeStrength, m.edgeStrength); gl.uniform1f(u.uEdgeWidth, m.edgeWidthPx);
      gl.uniform1f(u.uLightAngle, m.lightAngleRad); gl.uniform1f(u.uHighlight, m.highlightStrength);
      gl.drawArrays(gl.TRIANGLES, 0, 3); drawn += 1; this.drawCount += 1;
    }
    gl.disable(gl.SCISSOR_TEST);
    return { backend: 'webgl', sampling: frame.kind, drawn, skipped, uploaded, uploadCount: this.textureUploadCount, allocationCount: this.textureAllocationCount, scale };
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.canvas.removeEventListener?.('webglcontextlost', this.handleLost); this.canvas.removeEventListener?.('webglcontextrestored', this.handleRestored);
    const gl = this.gl;
    if (gl && !this.contextLost) { if (this.texture) gl.deleteTexture(this.texture); if (this.buffer) gl.deleteBuffer(this.buffer); if (this.program) gl.deleteProgram(this.program); }
    this.surfaces.clear(); this.gl = null; this.program = null; this.texture = null; this.buffer = null;
  }
}
