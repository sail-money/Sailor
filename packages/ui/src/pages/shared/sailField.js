/*
 * Sail background — the landing page's living "square field".
 * A fixed, full-viewport WebGL grid of pixel squares animated by a composite
 * wave field (a slow swell + chop + roaming peaks) so faint figures form and
 * dissolve. Transparent except the lit squares, so your page background shows
 * through. Throttled to 30fps, DPR-capped, reduced-motion aware.
 *
 * Options (all optional):
 *   container : element to mount into            (default document.body)
 *   opacity   : canvas opacity                   (default 0.28 — the landing value)
 *   zIndex    : canvas z-index                   (default 0)
 *   fixed     : position:fixed full-viewport     (default true; false = fills container)
 *   grid      : square cell size in px           (default 17)
 *   fps       : frame cap                         (default 30)
 */
export default function createSailBackground(opts = {}) {
  const container = opts.container || document.body
  const opacity = opts.opacity != null ? opts.opacity : 0.28
  const zIndex = opts.zIndex != null ? opts.zIndex : 0
  const fixed = opts.fixed !== false
  const GRID = opts.grid || 17
  const FRAME = 1000 / (opts.fps || 30)

  const VERT = 'attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos,0.0,1.0); }'

  const FRAG_BODY = [
    'uniform float u_time;',
    'uniform vec2  u_res;',
    'uniform float u_grid;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }',
    '// Sharp crest, broad flat trough — the trochoidal silhouette of a real swell.',
    'float crest(float phase, float sharp){ return exp(sharp * (cos(phase) - 1.0)); }',
    'float composite(vec2 p, float t){',
    '  p.y += sin(t * 0.40) * 0.055;',
    '  p.x += sin(t * 0.31) * 0.022;',
    '  float c1 = dot(p, vec2(0.34, 0.94)) * 2.2 - t * 0.62 + sin(p.x * 1.0 + t * 0.12) * 0.75;',
    '  float c2 = dot(p, vec2(-0.22, 0.98)) * 4.4 - t * 1.00 + sin(p.x * 1.7 - t * 0.18) * 0.55;',
    '  float c3 = dot(p, vec2(0.48, 0.88)) * 8.0 - t * 1.45;',
    '  float r1 = crest(c1, 2.0);',
    '  float r2 = crest(c2, 3.0);',
    '  float r3 = crest(c3, 4.4);',
    '  float h = r1 + 0.50 * r2 + 0.26 * r3;',
    '  h += 0.40 * smoothstep(0.72, 1.0, r1);',
    '  for (int i = 0; i < 2; i++){',
    '    float fi = float(i);',
    '    vec2 ap = vec2(',
    '      sin(t * (0.09 + fi * 0.05) + fi * 2.1) * 0.82,',
    '      cos(t * (0.07 + fi * 0.04) + fi * 1.4) * 0.46',
    '    );',
    '    h += smoothstep(0.22, 0.0, length(p - ap)) * 0.20;',
    '  }',
    '  float weight = 0.5 + 0.5 * smoothstep(0.1, 1.05, length(p));',
    '  return clamp(h * weight, 0.0, 1.0);',
    '}',
    'void main(){',
    '  float grid = u_grid;',
    '  vec2 cell = floor(gl_FragCoord.xy / grid);',
    '  vec2 cc   = (cell + 0.5) * grid;',
    '  vec2 p    = (cc - u_res * 0.5) / min(u_res.x, u_res.y);',
    '  float inten = composite(p, u_time);',
    '  float seed = hash(cell);',
    '  float thr  = 0.60 + (seed - 0.5) * 0.22;',
    '  float on   = step(thr, inten);',
    '  vec2 f = fract(gl_FragCoord.xy / grid);',
    '  float gap = 0.2;',
    '  float sq = step(gap, f.x) * step(f.x, 1.0 - gap) * step(gap, f.y) * step(f.y, 1.0 - gap);',
    '  vec3 mid = vec3(0.098, 0.565, 1.0);',
    '  vec3 hi  = vec3(0.30, 0.67, 1.0);',
    '  float rad = smoothstep(0.15, 1.15, length(p));',
    '  vec3 col = mix(mid, hi, rad);',
    '  vec2 v = gl_FragCoord.xy / u_res - 0.5;',
    '  float vig = smoothstep(1.05, 0.2, length(v));',
    '  float a = on * sq * (0.55 + 0.45 * vig);',
    '  gl_FragColor = vec4(col * a, a);',
    '}',
  ].join('\n')

  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  const position = fixed
    ? 'position:fixed;inset:0;width:100vw;height:100vh;'
    : 'position:absolute;inset:0;width:100%;height:100%;'
  canvas.style.cssText = `${position}z-index:${zIndex};opacity:${opacity};pointer-events:none;display:block;`
  container.appendChild(canvas)

  // Explicit attrs: Safari composites a transparent WebGL canvas more reliably
  // when alpha + premultipliedAlpha are stated outright.
  const glOpts = { alpha: true, premultipliedAlpha: true, antialias: true, depth: false, stencil: false }
  const gl = canvas.getContext('webgl', glOpts) || canvas.getContext('experimental-webgl', glOpts)
  if (!gl) { console.warn('[sailField] WebGL unavailable'); return { canvas, destroy: () => canvas.remove() } }

  // Some GPUs (notably older iOS Safari) have no highp in fragment shaders, which
  // makes a highp shader fail to compile → blank canvas. Fall back to mediump.
  const hpf = gl.getShaderPrecisionFormat && gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)
  const FRAG = `precision ${hpf && hpf.precision > 0 ? 'highp' : 'mediump'} float;\n` + FRAG_BODY

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

  const compile = (type, src) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s))
    return s
  }
  const prog = gl.createProgram()
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(prog)
  gl.useProgram(prog)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'a_pos')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

  const uTime = gl.getUniformLocation(prog, 'u_time')
  const uRes = gl.getUniformLocation(prog, 'u_res')
  const uGrid = gl.getUniformLocation(prog, 'u_grid')

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25)
    const w = fixed ? window.innerWidth : container.clientWidth
    const h = fixed ? window.innerHeight : container.clientHeight
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    gl.viewport(0, 0, canvas.width, canvas.height)
  }
  resize()
  window.addEventListener('resize', resize)

  let animId
  let start = null
  let last = 0
  const draw = (ts) => {
    animId = requestAnimationFrame(draw)
    if (ts - last < FRAME) return
    last = ts
    if (!start) start = ts
    const t = reduce ? 6.0 : (ts - start) / 1000
    // Clear to transparent each frame — Safari can present a blank/garbage buffer
    // on the first frames without an explicit clear.
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform1f(uTime, t)
    gl.uniform2f(uRes, canvas.width, canvas.height)
    gl.uniform1f(uGrid, GRID)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    if (reduce) cancelAnimationFrame(animId) // single static frame
  }
  animId = requestAnimationFrame(draw)

  return {
    canvas,
    destroy: () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
      canvas.remove()
    },
  }
}