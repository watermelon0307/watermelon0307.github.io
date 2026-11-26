export const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = vec2(aPosition.x * 0.5 + 0.5, 0.5 - aPosition.y * 0.5);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

export const SDF_GLSL = `
float cornerRadius(vec2 p, vec4 r) {
  if (p.x < 0.0) return p.y < 0.0 ? r.x : r.w;
  return p.y < 0.0 ? r.y : r.z;
}
float sdRoundedBox(vec2 p, vec2 halfSize, vec4 radii) {
  float r = clamp(cornerRadius(p, radii), 0.0, min(halfSize.x, halfSize.y));
  vec2 q = abs(p) - halfSize + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}
float angleDelta(float a, float b) { return atan(sin(a - b), cos(a - b)); }
float gaussian(float x) { return exp(-(x * x)); }
vec2 safeNormalize(vec2 value) {
  float lengthSquared = dot(value, value);
  return lengthSquared > 0.000001 ? value * inversesqrt(lengthSquared) : vec2(0.0);
}`;

export const FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uSceneOrigin;
uniform vec2 uSceneCssSize;
uniform vec4 uRect;
uniform vec4 uRadius;
uniform vec3 uFallback;
uniform vec4 uTint;
uniform float uBevel;
uniform float uThickness;
uniform float uIor;
uniform float uDistortion;
uniform float uMaxDisplacement;
uniform float uDispersion;
uniform float uBlur;
uniform float uSaturation;
uniform float uEdgeStrength;
uniform float uEdgeWidth;
uniform float uLightAngle;
uniform float uHighlight;
uniform float uBlurQuality;
${SDF_GLSL}
vec2 sceneUV(vec2 cssPoint) { return (cssPoint - uSceneOrigin) / max(uSceneCssSize, vec2(1.0)); }
vec2 clampUV(vec2 uv) { return clamp(uv, vec2(0.0), vec2(1.0)); }
vec3 sampleBlur(vec2 uv, vec2 blurStep) {
  vec3 color = texture2D(uScene, clampUV(uv)).rgb * 0.28;
  color += texture2D(uScene, clampUV(uv + vec2(blurStep.x, 0.0))).rgb * 0.12;
  color += texture2D(uScene, clampUV(uv - vec2(blurStep.x, 0.0))).rgb * 0.12;
  color += texture2D(uScene, clampUV(uv + vec2(0.0, blurStep.y))).rgb * 0.12;
  color += texture2D(uScene, clampUV(uv - vec2(0.0, blurStep.y))).rgb * 0.12;
  if (uBlurQuality > 0.5) {
    color += texture2D(uScene, clampUV(uv + blurStep)).rgb * 0.06;
    color += texture2D(uScene, clampUV(uv - blurStep)).rgb * 0.06;
    color += texture2D(uScene, clampUV(uv + vec2(blurStep.x, -blurStep.y))).rgb * 0.06;
    color += texture2D(uScene, clampUV(uv + vec2(-blurStep.x, blurStep.y))).rgb * 0.06;
  } else {
    color += texture2D(uScene, clampUV(uv)).rgb * 0.24;
  }
  return color;
}
void main() {
  vec2 size = uRect.zw;
  vec2 p = (vUv - 0.5) * size;
  vec2 halfSize = size * 0.5;
  float d = sdRoundedBox(p, halfSize, uRadius);
  float coverage = 1.0 - smoothstep(-0.72, 0.72, d);
  if (coverage <= 0.001) discard;
  float epsilon = 0.72;
  float dx = sdRoundedBox(p + vec2(epsilon, 0.0), halfSize, uRadius) - sdRoundedBox(p - vec2(epsilon, 0.0), halfSize, uRadius);
  float dy = sdRoundedBox(p + vec2(0.0, epsilon), halfSize, uRadius) - sdRoundedBox(p - vec2(0.0, epsilon), halfSize, uRadius);
  vec2 normal = safeNormalize(vec2(dx, dy));
  float bevelMask = smoothstep(-max(uBevel, 1.0), 0.0, d) * (1.0 - smoothstep(0.0, 1.0, d));
  float opticalScale = clamp(uThickness / max(uIor, 1.0) * 0.035, 0.15, 1.5);
  vec2 displacement = normal * uDistortion * opticalScale * bevelMask;
  float displacementLength = length(displacement);
  if (displacementLength > uMaxDisplacement) displacement *= uMaxDisplacement / max(displacementLength, 0.0001);
  vec2 basePoint = uRect.xy + vUv * size;
  vec2 uv = sceneUV(basePoint + displacement);
  vec2 blurStep = vec2(uBlur) / max(uSceneCssSize, vec2(1.0));
  vec3 color = sampleBlur(uv, blurStep);
  vec2 chromatic = normal * uDispersion * bevelMask / max(uSceneCssSize, vec2(1.0));
  if (uDispersion > 0.001) {
    color.r = texture2D(uScene, clampUV(uv + chromatic)).r;
    color.b = texture2D(uScene, clampUV(uv - chromatic)).b;
  }
  vec2 rawUV = sceneUV(basePoint + displacement);
  float inSource = step(0.0, rawUV.x) * step(0.0, rawUV.y) * step(rawUV.x, 1.0) * step(rawUV.y, 1.0);
  color = mix(uFallback, color, inSource);
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luminance), color, uSaturation);
  color = mix(color, uTint.rgb, uTint.a);
  float angle = atan(normal.y, normal.x);
  float hairline = gaussian((d + 0.55) / max(uEdgeWidth, 0.1));
  float upperLeft = gaussian(angleDelta(angle, -2.38 + uLightAngle) / 0.60);
  float lowerRight = gaussian(angleDelta(angle, 0.76 + uLightAngle) / 0.62);
  float edgeGlint = hairline * (upperLeft * 0.66 + lowerRight * 0.48) * uEdgeStrength;
  color = mix(color, vec3(1.0), clamp(edgeGlint, 0.0, 0.76));
  float directional = pow(max(0.0, dot(normal, vec2(cos(uLightAngle - 2.38), sin(uLightAngle - 2.38)))), 3.0);
  color += vec3(directional * bevelMask * uHighlight * 0.12);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), coverage);
}`;

export function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('無法建立 WebGL shader');
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || '未知 shader 錯誤'; gl.deleteShader(shader); throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}
export function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER), fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error('無法建立 WebGL program');
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || '未知 link 錯誤'; gl.deleteProgram(program); throw new Error(`Shader link failed: ${log}`);
  }
  return program;
}
