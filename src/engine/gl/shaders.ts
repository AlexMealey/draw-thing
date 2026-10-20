/**
 * Instanced round dab. One instance = vec4(x, y, radius, alpha) in document px.
 * Coverage has an antialiased edge `u_aa` wide (1 doc px into textures, 1 screen px for overlays).
 */
export const DAB_VS = `#version 300 es
layout(location = 0) in vec2 a_corner; // -1..1
layout(location = 1) in vec4 a_dab;
uniform mat3 u_docToClip;
uniform float u_aa;
out vec2 v_local;
out float v_radius;
out float v_alpha;
void main() {
  float extent = a_dab.z + u_aa;
  v_local = a_corner * extent;
  v_radius = a_dab.z;
  v_alpha = a_dab.w;
  vec3 p = u_docToClip * vec3(a_dab.xy + v_local, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;

export const DAB_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in float v_radius;
in float v_alpha;
uniform vec4 u_color; // premultiplied
uniform float u_aa;
uniform bool u_ring;
out vec4 o;
void main() {
  float d = length(v_local);
  float coverage = u_ring
    ? clamp(1.0 - abs(d - v_radius) / u_aa, 0.0, 1.0)
    : clamp((v_radius - d) / u_aa + 0.5, 0.0, 1.0);
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
