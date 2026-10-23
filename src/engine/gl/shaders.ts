/**
 * Instanced brush dab. Per instance: vec4(x, y, radius, alpha) + angle, in document px / radians.
 * The tip is an ellipse (roundness) with a hardness falloff and an antialiased edge `u_aa` wide
 * (1 doc px into textures, 1 screen px for overlays). Grain multiplies coverage, sampled either in
 * document space ("moving": fixed to the paper) or in tip space ("texturized": stamped per dab).
 */
export const DAB_VS = `#version 300 es
layout(location = 0) in vec2 a_corner; // -1..1
layout(location = 1) in vec4 a_dab;
layout(location = 2) in float a_angle;
uniform mat3 u_docToClip;
uniform float u_aa;
out vec2 v_local;
out vec2 v_tip;
out vec2 v_doc;
out float v_radius;
out float v_alpha;
void main() {
  float extent = a_dab.z + u_aa;
  vec2 local = a_corner * extent;
  float c = cos(a_angle);
  float s = sin(a_angle);
  v_local = local;
  v_tip = vec2(c * local.x + s * local.y, -s * local.x + c * local.y); // rotate by -angle
  v_doc = a_dab.xy + local;
  v_radius = a_dab.z;
  v_alpha = a_dab.w;
  vec3 p = u_docToClip * vec3(v_doc, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;

export const DAB_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec2 v_tip;
in vec2 v_doc;
in float v_radius;
in float v_alpha;
uniform vec4 u_color; // premultiplied
uniform float u_aa;
uniform bool u_ring;
uniform float u_hardness;
uniform float u_roundness;
uniform sampler2D u_grain;
uniform int u_grainMode; // 0 none, 1 moving, 2 texturized
uniform float u_grainPeriod; // document px per grain tile
uniform float u_grainDepth;
out vec4 o;
void main() {
  if (u_ring) {
    float ring = clamp(1.0 - abs(length(v_local) - v_radius) / u_aa, 0.0, 1.0);
    o = u_color * ring;
    return;
  }
  float d = length(vec2(v_tip.x, v_tip.y / u_roundness)) / v_radius;
  float aa = u_aa / v_radius;
  float inner = min(u_hardness, 1.0 - aa);
  float coverage = 1.0 - smoothstep(inner, 1.0 + 0.5 * aa, d);
  if (u_grainMode > 0) {
    vec2 uv = (u_grainMode == 1 ? v_doc : v_tip) / u_grainPeriod;
    coverage *= mix(1.0, texture(u_grain, uv).r, u_grainDepth);
  }
  o = u_color * (coverage * v_alpha);
}`;

/** Unit quad (0..1) stretched over the document; uv = corner since texture rows are top-down. */
export const QUAD_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
uniform mat3 u_docToClip;
uniform vec2 u_docSize;
out vec2 v_uv;
void main() {
  v_uv = a_corner;
  vec3 p = u_docToClip * vec3(a_corner * u_docSize, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;

export const COPY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform float u_opacity;
out vec4 o;
void main() {
  o = texture(u_src, v_uv) * u_opacity;
}`;

/**
 * Layer blend modes (W3C Compositing Level 1 separable modes) on premultiplied inputs.
 * `u_dst` is a snapshot of the backdrop; the result replaces it.
 */
export const BLEND_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform sampler2D u_dst;
uniform float u_opacity;
uniform int u_mode;
out vec4 o;

vec3 B(vec3 b, vec3 s) {
  switch (u_mode) {
    case 1: return b * s;                                                              // multiply
    case 2: return b + s - b * s;                                                      // screen
    case 3: return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));  // overlay
    case 4: return min(b, s);                                                          // darken
    case 5: return max(b, s);                                                          // lighten
    case 6: return mix(min(vec3(1.0), b / max(1.0 - s, vec3(1e-5))), vec3(0.0), step(b, vec3(0.0)));   // color-dodge
    case 7: return mix(1.0 - min(vec3(1.0), (1.0 - b) / max(s, vec3(1e-5))), vec3(1.0), step(1.0, b)); // color-burn
    case 8: return min(b + s, vec3(1.0));                                              // add
    default: return s;
  }
}

void main() {
  vec4 s = texture(u_src, v_uv) * u_opacity;
  vec4 d = texture(u_dst, v_uv);
  vec3 Cs = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
  vec3 Cb = d.a > 0.0 ? d.rgb / d.a : vec3(0.0);
  vec3 co = s.rgb * (1.0 - d.a) + d.rgb * (1.0 - s.a) + s.a * d.a * B(Cb, Cs);
  o = vec4(co, s.a + d.a * (1.0 - s.a));
}`;

/** The composited document → screen. Transparent areas (background hidden) show a checkerboard. */
export const PRESENT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_image;
out vec4 o;
void main() {
  vec4 c = texture(u_image, v_uv);
  float k = mod(floor(gl_FragCoord.x / 12.0) + floor(gl_FragCoord.y / 12.0), 2.0);
  vec3 checker = mix(vec3(1.0), vec3(0.82), k);
  o = vec4(c.rgb + checker * (1.0 - c.a), 1.0);
}`;

/**
 * Color adjustments on premultiplied pixels (alpha is kept): hue rotation, saturation, brightness
 * and contrast. Neutral values: 0, 0, 0 and a contrast factor of 1.
 */
export const ADJUST_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform float u_hue;        // turns
uniform float u_saturation; // -1..1
uniform float u_brightness; // -1..1
uniform float u_contrast;   // factor around mid-gray
out vec4 o;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
  vec4 px = texture(u_src, v_uv);
  if (px.a <= 0.0) {
    o = vec4(0.0);
    return;
  }
  vec3 hsv = rgb2hsv(px.rgb / px.a);
  hsv.x = fract(hsv.x + u_hue);
  hsv.y = clamp(hsv.y * (1.0 + u_saturation), 0.0, 1.0);
  vec3 c = hsv2rgb(hsv);
  c = u_brightness >= 0.0 ? mix(c, vec3(1.0), u_brightness) : c * (1.0 + u_brightness);
  c = clamp((c - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  o = vec4(c * px.a, px.a);
}`;

/**
 * One direction of a separable Gaussian blur, on premultiplied pixels. `u_step` is the uv offset
 * between taps (wider than a pixel for big radii; bilinear sampling fills in), `u_sigma` is in taps.
 */
export const GAUSS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_step;
uniform float u_sigma;
uniform int u_taps;
out vec4 o;
// Alpha-locked layers keep their own alpha: blurring only moves color around inside it.
uniform bool u_keepAlpha;
uniform sampler2D u_alpha;
vec4 keepAlpha(vec4 f) {
  if (!u_keepAlpha) return f;
  float a = texture(u_alpha, v_uv).a;
  return vec4((f.a > 0.0 ? f.rgb / f.a : vec3(0.0)) * a, a);
}
void main() {
  vec4 sum = texture(u_src, v_uv);
  float total = 1.0;
  for (int i = 1; i <= 64; i++) {
    if (i > u_taps) break;
    float x = float(i);
    float w = exp(-0.5 * x * x / (u_sigma * u_sigma));
    sum += (texture(u_src, v_uv + u_step * x) + texture(u_src, v_uv - u_step * x)) * w;
    total += 2.0 * w;
  }
  o = keepAlpha(sum / total);
}`;

/** Box blur along a line: `u_span` is the whole line in uv, centered on the pixel. */
export const MOTION_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_span;
uniform int u_samples;
out vec4 o;
// Alpha-locked layers keep their own alpha: blurring only moves color around inside it.
uniform bool u_keepAlpha;
uniform sampler2D u_alpha;
vec4 keepAlpha(vec4 f) {
  if (!u_keepAlpha) return f;
  float a = texture(u_alpha, v_uv).a;
  return vec4((f.a > 0.0 ? f.rgb / f.a : vec3(0.0)) * a, a);
}
void main() {
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= u_samples) break;
    sum += texture(u_src, v_uv + u_span * ((float(i) + 0.5) / float(u_samples) - 0.5));
  }
  o = keepAlpha(sum / float(u_samples));
}`;
