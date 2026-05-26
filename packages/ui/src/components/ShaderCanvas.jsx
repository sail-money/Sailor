import { useEffect, useRef } from 'react'

/* ══ Vertex ════════════════════════════════════════════════════════════════ */
const SHADER_VERT = `
  attribute vec2 a_pos;
  void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

/* ══ Fragment ══════════════════════════════════════════════════════════════
   Halftone dot grid driven by a per-mode intensity field.
   Modes:
     0 — swirl (vortex, hollow center)
     1 — wave A (horizontal flowing bands)
     2 — wave B (cross-flow ripples)
     3 — concentric (radial pulsing rings)
     4 — vertical (vertical flowing bands)
*/
const SHADER_FRAG = `
  precision highp float;
  uniform float u_time;
  uniform vec2  u_res;
  uniform float u_seed;
  uniform float u_tilt;
  uniform float u_mode;

  float swirlIntensity(vec2 fragXY) {
    vec2 p = (fragXY - u_res * 0.5) / min(u_res.x, u_res.y);
    float t = u_time * 0.22 + u_seed;
    float r = length(p);
    float a = atan(p.y, p.x);

    float spiral = a * 2.0
                 + r * 5.5
                 + t * 1.0
                 + sin(r * 5.5 - t * 1.3) * 0.7
                 + u_tilt;

    float bands = sin(spiral * 2.0 - r * 6.5 - t * 0.9) * 0.5 + 0.5;
    bands = pow(bands, 1.5);

    float radial = smoothstep(0.16, 0.50, r) * smoothstep(1.45, 0.92, r);
    float outer  = smoothstep(0.68, 1.10, r) * 0.85;
    return clamp(bands * (radial + outer), 0.0, 1.0);
  }

  float waveIntensity(vec2 fragXY) {
    vec2 p = (fragXY - u_res * 0.5) / min(u_res.x, u_res.y);
    float t = u_time * 0.32 + u_seed;

    float w1 = sin(p.y * 6.0 + sin(p.x * 1.8 + t * 0.7) * 0.9 + t * 0.6);
    float w2 = sin(p.y * 3.0 - sin(p.x * 2.6 - t * 0.5) * 0.65 + t * 0.4);
    float w3 = sin((p.x * 1.4 + p.y * 0.4) * 2.2 + t * 0.85);

    float w = w1 * 0.55 + w2 * 0.30 + w3 * 0.15;
    w = pow(w * 0.5 + 0.5, 1.4);

    float radial = 0.55 + 0.45 * smoothstep(0.05, 0.85, length(p));
    return clamp(w * radial, 0.0, 1.0);
  }

  float rippleIntensity(vec2 fragXY) {
    vec2 p = (fragXY - u_res * 0.5) / min(u_res.x, u_res.y);
    float t = u_time * 0.28 + u_seed;

    vec2 src1 = vec2(-0.85, -0.55);
    vec2 src2 = vec2( 0.85,  0.55);
    float r1 = sin(length(p - src1) * 9.0 - t * 1.4);
    float r2 = sin(length(p - src2) * 7.0 - t * 1.0);
    float d1 = sin(( p.x * 1.5 - p.y * 2.5) * 1.6 + t * 0.6);
    float d2 = sin(( p.x * 2.6 + p.y * 1.2) * 1.6 - t * 0.5);

    float w = (r1 + r2) * 0.30 + (d1 + d2) * 0.20;
    w = pow(w * 0.5 + 0.5, 1.45);

    float radial = 0.55 + 0.45 * smoothstep(0.05, 0.85, length(p));
    return clamp(w * radial, 0.0, 1.0);
  }

  /* ── Mode 3 — Concentric rings (Managers) ──────────────────────────────── */
  float concentricIntensity(vec2 fragXY) {
    vec2 p = (fragXY - u_res * 0.5) / min(u_res.x, u_res.y);
    float t = u_time * 0.30 + u_seed;
    float r = length(p);

    float r1 = sin(r * 11.0 - t * 1.5);
    float r2 = sin(r * 5.5  + t * 0.9);
    float r3 = sin(r * 18.0 - t * 2.2);

    float w = r1 * 0.50 + r2 * 0.30 + r3 * 0.20;
    w = pow(w * 0.5 + 0.5, 1.5);

    /* Subtle angular ripple so it isn't a perfect target */
    float a = atan(p.y, p.x);
    w *= 0.85 + 0.15 * sin(a * 4.0 + t * 0.6 + u_tilt);

    float radial = 0.55 + 0.45 * smoothstep(0.05, 0.85, r);
    return clamp(w * radial, 0.0, 1.0);
  }

  /* ── Mode 4 — Vertical bands (Allocators) ─────────────────────────────── */
  float verticalIntensity(vec2 fragXY) {
    vec2 p = (fragXY - u_res * 0.5) / min(u_res.x, u_res.y);
    float t = u_time * 0.32 + u_seed;

    float b1 = sin(p.x * 6.0 + sin(p.y * 1.6 + t * 0.6) * 0.7 + t * 0.5);
    float b2 = sin(p.x * 3.0 - sin(p.y * 2.4 - t * 0.4) * 0.6 + t * 0.3);
    float b3 = sin((p.y * 1.4 + p.x * 0.4) * 2.0 + t * 0.7);

    float w = b1 * 0.55 + b2 * 0.30 + b3 * 0.15;
    w = pow(w * 0.5 + 0.5, 1.4);

    float radial = 0.55 + 0.45 * smoothstep(0.05, 0.85, length(p));
    return clamp(w * radial, 0.0, 1.0);
  }

  float intensityAt(vec2 fragXY) {
    if (u_mode > 3.5) return verticalIntensity(fragXY);
    if (u_mode > 2.5) return concentricIntensity(fragXY);
    if (u_mode > 1.5) return rippleIntensity(fragXY);
    if (u_mode > 0.5) return waveIntensity(fragXY);
    return swirlIntensity(fragXY);
  }

  void main() {
    float gridSize = 11.0;

    vec2 cell        = floor(gl_FragCoord.xy / gridSize);
    vec2 cellCenter  = (cell + 0.5) * gridSize;
    float intensity  = intensityAt(cellCenter);

    float dist       = length(gl_FragCoord.xy - cellCenter);

    float ditherSeed = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    float threshold  = 0.38 + (ditherSeed - 0.5) * 0.18;

    float showDot    = step(threshold, intensity);
    float dotRadius  = gridSize * 0.32;
    float dot        = step(dist, dotRadius) * showDot;

    vec3 bg  = vec3(0.012, 0.028, 0.070);
    vec3 mid = vec3(0.098, 0.565, 1.000);  /* #1990FF */
    vec3 hi  = vec3(0.400, 0.761, 1.000);  /* #66c2ff */

    vec2 cp = (cellCenter - u_res * 0.5) / min(u_res.x, u_res.y);
    float radialMix = smoothstep(0.35, 1.10, length(cp));
    vec3 dotColor = mix(mid, hi, radialMix);

    vec3 col = mix(bg, dotColor, dot);

    vec2 v = gl_FragCoord.xy / u_res.xy - 0.5;
    float vig = smoothstep(0.85, 0.25, length(v));
    col = mix(col * 0.82, col, vig);

    gl_FragColor = vec4(col, 1.0);
  }
`

export default function ShaderCanvas({ seed = 0, tilt = 0, mode = 0 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (!gl) return

    const compile = (type, src) => {
      const s = gl.createShader(type)
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s))
      return s
    }
    const prog = gl.createProgram()
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, SHADER_VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, SHADER_FRAG))
    gl.linkProgram(prog)
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const uTime = gl.getUniformLocation(prog, 'u_time')
    const uRes  = gl.getUniformLocation(prog, 'u_res')
    const uSeed = gl.getUniformLocation(prog, 'u_seed')
    const uTilt = gl.getUniformLocation(prog, 'u_tilt')
    const uMode = gl.getUniformLocation(prog, 'u_mode')

    let animId, start = null, lastFrame = 0, visible = true
    const FRAME_MS = 1000 / 30

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25)
      canvas.width  = Math.floor(canvas.offsetWidth  * dpr)
      canvas.height = Math.floor(canvas.offsetHeight * dpr)
      gl.viewport(0, 0, canvas.width, canvas.height)
    }

    const draw = (ts) => {
      animId = requestAnimationFrame(draw)
      if (!visible) return
      if (ts - lastFrame < FRAME_MS) return
      lastFrame = ts
      if (!start) start = ts
      gl.uniform1f(uTime, (ts - start) / 1000)
      gl.uniform2f(uRes,  canvas.width, canvas.height)
      gl.uniform1f(uSeed, seed)
      gl.uniform1f(uTilt, tilt)
      gl.uniform1f(uMode, mode)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    const observer = new IntersectionObserver(
      ([entry]) => { visible = entry.isIntersecting },
      { threshold: 0 }
    )
    observer.observe(canvas)

    window.addEventListener('resize', resize)
    resize()
    animId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animId)
      observer.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [seed, tilt, mode])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}
