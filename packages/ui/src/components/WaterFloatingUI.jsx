import { useEffect, useRef, useState } from 'react'
import InvestorsBanner from './InvestorsBanner'
import styles from './WaterFloatingUI.module.css'

const CURRENCY_SYMBOLS = ['$', '€']

const VERT = `
  attribute vec2 a_pos;
  void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

const FRAG = `
  precision highp float;
  uniform float u_time;
  uniform vec2  u_res;
  uniform float u_night; /* 1=night, 0=day — smoothly animated */

  const int   NUM_STEPS  = 6;
  const float PI         = 3.14159265;
  const int   ITER_GEO   = 3;
  const int   ITER_FRAG  = 4;
  const float SEA_HEIGHT = 0.6;
  const float SEA_CHOPPY = 4.0;
  const float SEA_SPEED  = 0.4;
  const float SEA_FREQ   = 0.16;
  const mat2  OCT_M      = mat2(1.6, 1.2, -1.2, 1.6);
  #define SEA_TIME (1.0 + u_time * SEA_SPEED)

  /* ── Helpers ────────────────────────────────────────────────────────── */
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return -1.0+2.0*mix(mix(hash(i),hash(i+vec2(1,0)),u.x),
                        mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
  }
  mat3 fromEuler(vec3 a) {
    vec2 s1=vec2(sin(a.x),cos(a.x)); vec2 s2=vec2(sin(a.y),cos(a.y)); vec2 s3=vec2(sin(a.z),cos(a.z));
    return mat3(s1.y*s3.y+s1.x*s2.x*s3.x, s1.y*s2.x*s3.x+s3.y*s1.x, -s2.y*s3.x,
                -s2.y*s1.x, s1.y*s2.y, s2.x,
                s3.y*s1.x*s2.x+s1.y*s3.x, s1.x*s3.x-s1.y*s3.y*s2.x, s2.y*s3.y);
  }

  /* ── Star field (night only) ────────────────────────────────────────── */
  float starField(vec3 dir) {
    if (dir.y < 0.01) return 0.0;
    float sc  = 130.0;
    vec2  uv  = vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0))) * sc;
    vec2  id  = floor(uv);
    vec2  f   = fract(uv) - 0.5;
    float h   = hash(id);
    if (h < 0.925) return 0.0;
    vec2 sp = (vec2(hash(id * 3.71 + 1.3), hash(id * 2.13 + 5.7)) - 0.5) * 0.65;
    float d  = length(f - sp);
    float br = max(0.0, 1.0 - d * 28.0);
    float tw = 0.75 + 0.25 * sin(u_time * (hash(id + 7.3) * 4.0 + 0.8) + hash(id * 1.7) * 6.28);
    return br * br * (h - 0.925) * 13.5 * tw;
  }

  /* ── Moon ───────────────────────────────────────────────────────────── */
  const vec3 MOON_DIR = vec3(0.38, 0.72, 0.58);
  vec3 moonContrib(vec3 dir) {
    float d      = dot(normalize(dir), normalize(MOON_DIR));
    float disc   = smoothstep(0.9990, 0.9997, d);
    float corona = pow(max(d, 0.0), 90.0) * 0.14;
    float glow   = pow(max(d, 0.0), 14.0) * 0.02;
    return disc   * vec3(0.96, 0.94, 0.88) * 2.2
         + corona * vec3(0.55, 0.62, 0.72)
         + glow   * vec3(0.18, 0.22, 0.35);
  }

  /* ── Day sky ────────────────────────────────────────────────────────── */
  vec3 daySkyColor(vec3 e) {
    e.y = max(e.y, 0.0)*0.8+0.2; e.y *= 0.8;
    return vec3(pow(1.0-e.y,2.0)*0.5, (1.0-e.y)*0.7, 0.8+(1.0-e.y)*0.2) * 1.1;
  }

  /* ── Night sky ──────────────────────────────────────────────────────── */
  vec3 nightSkyColor(vec3 e) {
    float y = clamp(e.y, 0.0, 1.0);
    vec3 sky = mix(
      vec3(0.055, 0.075, 0.18),
      vec3(0.012, 0.018, 0.055),
      pow(y, 0.45)
    );
    sky += vec3(0.06, 0.09, 0.24) * pow(1.0 - y, 6.0) * 0.5;
    sky += starField(e) * vec3(0.88, 0.92, 1.0);
    sky += moonContrib(e);
    return sky;
  }

  /* ── Blended sky ────────────────────────────────────────────────────── */
  vec3 skyColor(vec3 e) {
    return mix(daySkyColor(e), nightSkyColor(e), u_night);
  }

  /* ── Ocean ──────────────────────────────────────────────────────────── */
  float seaOctave(vec2 uv, float choppy) {
    uv += noise(uv);
    vec2 wv=1.0-abs(sin(uv)), sw=abs(cos(uv));
    wv=mix(wv,sw,wv);
    return pow(1.0-pow(wv.x*wv.y,0.65),choppy);
  }
  float seaHeight(vec2 p) {
    float freq=SEA_FREQ,amp=SEA_HEIGHT,choppy=SEA_CHOPPY,h=0.0;
    vec2 uv=p; uv.x*=0.75;
    for(int i=0;i<ITER_GEO;i++){
      float d=seaOctave((uv+SEA_TIME)*freq,choppy)+seaOctave((uv-SEA_TIME)*freq,choppy);
      h+=d*amp; uv*=OCT_M; freq*=1.9; amp*=0.22; choppy=mix(choppy,1.0,0.2);
    }
    return h;
  }
  float seaMap(vec3 p){ return p.y - seaHeight(p.xz); }
  float seaMapDetail(vec3 p) {
    float freq=SEA_FREQ,amp=SEA_HEIGHT,choppy=SEA_CHOPPY,h=0.0;
    vec2 uv=p.xz; uv.x*=0.75;
    for(int i=0;i<ITER_FRAG;i++){
      float d=seaOctave((uv+SEA_TIME)*freq,choppy)+seaOctave((uv-SEA_TIME)*freq,choppy);
      h+=d*amp; uv*=OCT_M; freq*=1.9; amp*=0.22; choppy=mix(choppy,1.0,0.2);
    }
    return p.y-h;
  }
  vec3 seaNormal(vec3 p, float eps) {
    vec3 n;
    n.y=seaMapDetail(p);
    n.x=seaMapDetail(vec3(p.x+eps,p.y,p.z))-n.y;
    n.z=seaMapDetail(vec3(p.x,p.y,p.z+eps))-n.y;
    n.y=eps; return normalize(n);
  }
  float traceSea(vec3 ori, vec3 dir, out vec3 p) {
    float tm=0.0,tx=1000.0,hx=seaMap(ori+dir*tx);
    if(hx>0.0){p=ori+dir*tx;return tx;}
    float hm=seaMap(ori+dir*tm),tmid=0.0;
    for(int i=0;i<NUM_STEPS;i++){
      tmid=mix(tm,tx,hm/(hm-hx)); p=ori+dir*tmid;
      float hmid=seaMap(p);
      if(hmid<0.0){tx=tmid;hx=hmid;}else{tm=tmid;hm=hmid;}
    }
    return tmid;
  }

  vec3 seaColor(vec3 p, vec3 n, vec3 l, vec3 eye, vec3 dist) {
    /* Blend day/night water palette */
    vec3 seaBase  = mix(vec3(0.005, 0.01, 0.08),  vec3(0.008, 0.014, 0.04),  u_night);
    vec3 seaWater = mix(vec3(0.02, 0.06, 0.22)*0.6, vec3(0.06, 0.12, 0.28), u_night);

    float fresnel = min(pow(clamp(1.0-dot(n,-eye),0.0,1.0),3.0), 0.16);
    vec3 refl     = skyColor(reflect(eye, n));
    vec3 refr     = seaBase + pow(dot(n,l)*0.4+0.6,80.0) * seaWater * 0.06;
    vec3 col      = mix(refr, refl, fresnel);
    col += seaWater * (p.y - SEA_HEIGHT) * 0.07 * max(1.0-dot(dist,dist)*0.001,0.0);

    /* Day: warm white specular / Night: cool silver specular */
    vec3 daySpec   = vec3(1.0,  1.0,  1.0 ) * pow(max(dot(reflect(eye,n),l),0.0),60.0) * (10.0/(PI*8.0));
    vec3 nightSpec = vec3(0.78, 0.88, 1.0 ) * pow(max(dot(reflect(eye,n),l),0.0),64.0) * (4.0/(PI*8.0));
    col += mix(daySpec, nightSpec, u_night);

    return col;
  }

  /* ── Main ───────────────────────────────────────────────────────────── */
  void main(){
    vec2 uv  = (gl_FragCoord.xy*2.0 - u_res) / u_res.y;
    float t  = u_time * 0.12;
    vec3 ang = vec3(sin(t*3.0)*0.1, sin(t)*0.2+0.3, t);
    vec3 ori = vec3(0.0, 3.5, t*2.0);
    vec3 dir = normalize(vec3(uv,-2.0));
    dir.z   += length(uv)*0.14;
    dir      = normalize(dir) * fromEuler(ang);

    /* Blend sun/moon light direction */
    vec3 sunLight  = normalize(vec3(0.0, 1.0, 0.8));
    vec3 moonLight = normalize(MOON_DIR);
    vec3 light     = normalize(mix(sunLight, moonLight, u_night));

    vec3 seaP;
    float tSea = traceSea(ori, dir, seaP);
    vec3 dist  = seaP - ori;
    vec3 n     = seaNormal(seaP, dot(dist,dist)*(0.1/u_res.x));
    vec3 col   = mix(
      skyColor(dir),
      seaColor(seaP, n, light, dir, dist),
      pow(smoothstep(0.0, -0.02, dir.y), 0.2)
    );

    /* Blend day/night gamma */
    float gamma  = mix(0.65, 0.68, u_night);
    float bright = mix(1.10, 1.10, u_night);
    col = pow(col, vec3(gamma)) * bright;
    gl_FragColor = vec4(col, 1.0);
  }
`

/* ── WebGL canvas ───────────────────────────────────────────────────────── */
function SeaCanvas({ nightValRef }) {
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
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const uTime  = gl.getUniformLocation(prog, 'u_time')
    const uRes   = gl.getUniformLocation(prog, 'u_res')
    const uNight = gl.getUniformLocation(prog, 'u_night')

    let animId, start = null, lastFrame = 0
    let visible = true
    const FRAME_MS = 1000 / 30  // 30 fps cap

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25)
      canvas.width  = Math.floor(canvas.offsetWidth  * dpr)
      canvas.height = Math.floor(canvas.offsetHeight * dpr)
      gl.viewport(0, 0, canvas.width, canvas.height)
    }

    const draw = (ts) => {
      animId = requestAnimationFrame(draw)
      if (!visible) return                   // paused — off screen
      if (ts - lastFrame < FRAME_MS) return  // throttle to 30 fps
      lastFrame = ts
      if (!start) start = ts

      nightValRef.current += (nightValRef.nightTarget - nightValRef.current) * 0.025
      gl.uniform1f(uTime,  (ts - start) / 1000)
      gl.uniform2f(uRes,   canvas.width, canvas.height)
      gl.uniform1f(uNight, nightValRef.current)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    // Pause when the hero is scrolled out of view
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
  }, [nightValRef])

  return <canvas ref={canvasRef} className={styles.canvas} />
}

/* ── Icons ──────────────────────────────────────────────────────────────── */
function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}
function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <path d="M8 2a4 4 0 0 0 6 6 6 6 0 1 1-6-6z"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

/* ── Looping typewriter for hero title ───────────────────────────────────── */
const HERO_WORDS = ['DeFi', 'Agents']

function TypewriterLoop() {
  const [text, setText] = useState('')
  const [wordIndex, setWordIndex] = useState(0)
  const [phase, setPhase] = useState('typing') // 'typing' | 'holding' | 'deleting'

  useEffect(() => {
    const word = HERO_WORDS[wordIndex]
    let timer

    if (phase === 'typing') {
      if (text.length < word.length) {
        timer = setTimeout(() => setText(word.slice(0, text.length + 1)), 90)
      } else {
        timer = setTimeout(() => setPhase('holding'), 1500)
      }
    } else if (phase === 'holding') {
      timer = setTimeout(() => setPhase('deleting'), 250)
    } else if (phase === 'deleting') {
      if (text.length > 0) {
        timer = setTimeout(() => setText(text.slice(0, -1)), 45)
      } else {
        setWordIndex(i => (i + 1) % HERO_WORDS.length)
        setPhase('typing')
      }
    }

    return () => clearTimeout(timer)
  }, [text, phase, wordIndex])

  return (
    <span className={styles.typeWrap}>
      <span className={styles.typeText}>{text}</span>
      <span className={styles.typeCaret} aria-hidden="true" />
    </span>
  )
}

/* ── Rotating currency symbol ────────────────────────────────────────────── */
function TypewriterText() {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const pause = setTimeout(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex(i => (i + 1) % CURRENCY_SYMBOLS.length)
        setVisible(true)
      }, 300)
    }, 2400)
    return () => clearTimeout(pause)
  }, [index])

  return (
    <span className={styles.placeholder}>
      Up to <span className={styles.symbolVisible}>20%</span>{' '}APY on
      <span className={visible ? styles.symbolVisible : styles.symbolHidden}>
        {CURRENCY_SYMBOLS[index]}
      </span>
    </span>
  )
}

/* ── Main component ─────────────────────────────────────────────────────── */
export default function WaterFloatingUI({ onContact }) {
  const contentRef = useRef(null)

  /* Day mode is locked — animation always renders day. */
  const nightValRef = useRef({ current: 0.0, nightTarget: 0.0 })

  useEffect(() => {
    const onScroll = () => {
      const el = contentRef.current
      if (!el) return
      const progress = Math.min(window.scrollY / window.innerHeight, 1)
      el.style.opacity   = 1 - progress * 1.8
      el.style.transform = `translateY(${window.scrollY * 0.25}px)`
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className={styles.section}>
      <SeaCanvas nightValRef={nightValRef.current} />

      {/* Soft focus blur — sits over the canvas, beneath text. Center-weighted
          so the horizon stays vivid at the edges. */}
      <div className={styles.heroBlur} aria-hidden="true" />

      <div className={styles.heroContent} ref={contentRef}>
        <div className={styles.floatWrap}>
          <button className={`${styles.pill} ${styles.pillBtn}`}>
            <span className={styles.pillLeadIcon} aria-hidden="true">
              <span className={styles.pillLeadDot} />
              <svg viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="6.2" stroke="currentColor" strokeWidth="1.4" />
                <path d="M9 5.5v3.6l2.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </span>
            <span className={styles.pillLabel}>For stablecoin yield agent users</span>
            <span className={styles.pillArrow} aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor"
                  strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        </div>
        <h1 className={styles.title}>
          Onchain Separately Managed Accounts.
          <em className={styles.titleAccent}>Enforced by code, run by agents.</em>
        </h1>
        <div className={styles.cta}>
          <button
            type="button"
            className={styles.managerBtn}
            onClick={onContact}
          >
            Start as a manager
            <svg className={styles.managerArrow} viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.allocateBtn}
            onClick={onContact}
          >
            Allocate capital
          </button>
        </div>
      </div>

      {/* Backed by / Trusted by — anchored at bottom of hero */}
      <div className={styles.heroInvestors}>
        <InvestorsBanner />
      </div>
    </div>
  )
}
