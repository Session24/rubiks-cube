/**
 * GLSL for the scalable cube renderer.
 *
 * One shared program draws the six static faces and the six slab sides:
 *  - the colour index lives in an R8 texture (value = colour index 0..5),
 *  - cell borders, gaps and the sticker bevel are computed procedurally,
 *  - lighting is two directional lights + ambient + specular + rim.
 * The gap fades out when a cell gets close to a pixel wide, so a 1000×1000 cube
 * does not turn into shimmering noise.
 */

export const CUBE_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const CUBE_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uMap;
uniform float uN;
uniform float uDark;
uniform float uHideMode;
uniform float uHideAxis;
uniform float uHideMin;
uniform float uHideMax;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;
uniform vec3 uC5;
uniform vec3 uPlastic;

varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorldPos;

vec3 palette(float idx) {
  vec3 c = uC0;
  c = mix(c, uC1, step(0.5, idx));
  c = mix(c, uC2, step(1.5, idx));
  c = mix(c, uC3, step(2.5, idx));
  c = mix(c, uC4, step(3.5, idx));
  c = mix(c, uC5, step(4.5, idx));
  return c;
}

void main() {
  vec2 cell = vUv * uN;
  vec2 f = fract(cell);

  // region that the animated slab currently owns
  if (uHideMode > 0.5) {
    float c = uHideAxis < 0.5 ? cell.x : cell.y;
    if (c > uHideMin && c < uHideMax) discard;
  }

  vec2 idx = min(floor(cell), vec2(uN - 1.0));
  float colorIdx = uDark > 0.5
    ? 0.0
    : floor(texture2D(uMap, (idx + 0.5) / uN).r * 255.0 + 0.5);
  vec3 sticker = palette(colorIdx);

  vec2 d = min(f, 1.0 - f);
  float edge = min(d.x, d.y);

  // gap width in cell fractions, faded out once a cell approaches a pixel
  float cellsPerPixel = max(fwidth(cell.x), fwidth(cell.y));
  float cellPixels = 1.0 / max(cellsPerPixel, 1e-6);
  float gapScale = clamp((cellPixels - 1.5) / 3.0, 0.0, 1.0);
  float gap = 0.055 * gapScale;
  float aa = max(fwidth(edge), 1e-6) * 1.2;
  float solid = smoothstep(gap, gap + aa, edge);
  float bevel = smoothstep(gap, gap + 0.25, edge);

  vec3 albedo = mix(uPlastic, sticker, solid);
  albedo *= mix(1.0, mix(0.78, 1.0, bevel), solid);
  if (uDark > 0.5) albedo = uPlastic;

  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vWorldPos);
  vec3 l1 = normalize(vec3(0.45, 0.85, 0.55));
  vec3 l2 = normalize(vec3(-0.65, 0.15, -0.45));
  float d1 = max(dot(n, l1), 0.0);
  float d2 = max(dot(n, l2), 0.0);
  vec3 h = normalize(l1 + v);
  float spec = pow(max(dot(n, h), 0.0), 42.0);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.5);

  vec3 color = albedo * (0.42 + 0.60 * d1 + 0.22 * d2);
  color += vec3(1.0) * spec * 0.30 * mix(0.30, 1.0, solid);
  color += vec3(0.35, 0.45, 0.65) * rim * 0.10;

  gl_FragColor = vec4(color, 1.0);
}
`;
