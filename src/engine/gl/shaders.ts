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

/** Paper + layer + in-progress stroke (painted over, or erasing) → opaque screen pixel. */
export const PRESENT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_layer;
uniform sampler2D u_stroke;
uniform float u_strokeOpacity;
uniform bool u_erase;
uniform vec3 u_paper;
out vec4 o;
void main() {
  vec4 layer = texture(u_layer, v_uv);
  vec4 s = texture(u_stroke, v_uv) * u_strokeOpacity;
  vec4 c = u_erase ? layer * (1.0 - s.a) : s + layer * (1.0 - s.a);
  o = vec4(c.rgb + u_paper * (1.0 - c.a), 1.0);
}`;
