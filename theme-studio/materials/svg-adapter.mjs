import { makeCanvas } from './scene-provider.mjs';

function radiusAt(x, y, radii) { return x < 0 ? (y < 0 ? radii[0] : radii[3]) : (y < 0 ? radii[1] : radii[2]); }
export function roundedBoxSDF(x, y, width, height, radii) {
  const halfX = width / 2, halfY = height / 2, r = Math.max(0, Math.min(radiusAt(x, y, radii), halfX, halfY));
  const qx = Math.abs(x) - halfX + r, qy = Math.abs(y) - halfY + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}
export function createDisplacementMap(width, height, material, { scale = 1 } = {}) {
  width = Math.max(1, Math.round(width * scale)); height = Math.max(1, Math.round(height * scale));
  if (width * height > 4_194_304) throw new Error('SVG displacement map 超過像素預算');
  const canvas = makeCanvas(width, height), context = canvas.getContext('2d');
  if (!context) throw new Error('無法建立 SVG displacement map');
  const image = context.createImageData(width, height), data = image.data, epsilon = 0.75;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = (x + 0.5) / scale - width / scale / 2, py = (y + 0.5) / scale - height / scale / 2;
    const sdf = point => roundedBoxSDF(point.x, point.y, width / scale, height / scale, material.radius);
    const dx = sdf({ x: px + epsilon, y: py }) - sdf({ x: px - epsilon, y: py });
    const dy = sdf({ x: px, y: py + epsilon }) - sdf({ x: px, y: py - epsilon });
    const length = Math.hypot(dx, dy), nx = length > 1e-6 ? dx / length : 0, ny = length > 1e-6 ? dy / length : 0;
    const d = sdf({ x: px, y: py }), t = Math.max(0, Math.min(1, (d + material.bevelPx) / material.bevelPx));
    const index = (y * width + x) * 4;
    data[index] = Math.round((0.5 + nx * t * 0.5) * 255); data[index + 1] = Math.round((0.5 + ny * t * 0.5) * 255);
    data[index + 2] = 128; data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0); return canvas;
}
export class SVGDisplacementAdapter {
  constructor({ documentRef = globalThis.document } = {}) { this.document = documentRef; this.filters = new Map(); this.nextId = 1; this.verifiedBackdrop = false; }
  setBackdropVerification(verified) { this.verifiedBackdrop = verified === true; }
  createFilter(mapURL, width, height, material) {
    if (!this.document?.createElementNS) throw new Error('SVG 不可用');
    const id = `warmth-glass-${this.nextId++}`, svg = this.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
    const filter = this.document.createElementNS('http://www.w3.org/2000/svg', 'filter'); filter.id = id;
    filter.setAttribute('filterUnits', 'userSpaceOnUse'); filter.setAttribute('x', '0'); filter.setAttribute('y', '0'); filter.setAttribute('width', String(width)); filter.setAttribute('height', String(height));
    const image = this.document.createElementNS('http://www.w3.org/2000/svg', 'feImage'); image.setAttribute('href', mapURL); image.setAttribute('result', 'lens');
    const displacement = this.document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
    displacement.setAttribute('in', 'SourceGraphic'); displacement.setAttribute('in2', 'lens'); displacement.setAttribute('scale', String(material.distortionPx));
    displacement.setAttribute('xChannelSelector', 'R'); displacement.setAttribute('yChannelSelector', 'G');
    filter.append(image, displacement); svg.append(filter); (this.document.body || this.document.documentElement).append(svg);
    return { id, svg, filter };
  }
  apply(element, material, { verified = this.verifiedBackdrop } = {}) {
    if (!verified) return { backend: 'svg-candidate', verified: false, reason: '需要實際 backdrop 畫面 probe' };
    const rect = element.getBoundingClientRect(), canvas = createDisplacementMap(rect.width, rect.height, material, { scale: 0.5 });
    const url = canvas.toDataURL('image/png'), filter = this.createFilter(url, rect.width, rect.height, material);
    const previous = this.filters.get(element); previous?.svg.remove(); this.filters.set(element, filter);
    element.style.backdropFilter = `url(#${filter.id})${material.blurPx ? ` blur(${material.blurPx}px)` : ''}`;
    element.dataset.glassBackend = 'svg'; return { backend: 'svg', verified: true };
  }
  remove(element) { const filter = this.filters.get(element); filter?.svg.remove(); this.filters.delete(element); element.style.backdropFilter = ''; delete element.dataset.glassBackend; }
  dispose() { for (const filter of this.filters.values()) filter.svg.remove(); this.filters.clear(); }
}
export async function probeSVGEngine({ documentRef = globalThis.document } = {}) {
  if (!documentRef?.createElementNS || typeof Image === 'undefined') return { verified: false, reason: 'SVG/Image 環境不可用' };
  const namespace = 'http://www.w3.org/2000/svg';
  const render = filtered => new Promise((resolve, reject) => {
    const svg = documentRef.createElementNS(namespace, 'svg'); svg.setAttribute('width', '64'); svg.setAttribute('height', '64');
    svg.innerHTML = `<defs><pattern id="p" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#fff"/><rect width="8" height="8" fill="#000"/><rect x="8" y="8" width="8" height="8" fill="#000"/></pattern><filter id="f"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="1" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="18"/></filter></defs><rect width="64" height="64" fill="url(#p)"${filtered ? ' filter="url(#f)"' : ''}/>`;
    const image = new Image(); image.onload = () => { const canvas = makeCanvas(64, 64), ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); resolve(ctx.getImageData(0, 0, 64, 64).data); };
    image.onerror = reject; image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  });
  try {
    const plain = await render(false), displaced = await render(true); let changedPixels = 0;
    for (let i = 0; i < plain.length; i += 4) if (plain[i] !== displaced[i] || plain[i + 1] !== displaced[i + 1] || plain[i + 2] !== displaced[i + 2]) changedPixels += 1;
    return { verified: changedPixels > 20, changedPixels, scope: 'svg-scene-not-html-backdrop' };
  } catch (error) { return { verified: false, reason: error.message }; }
}
