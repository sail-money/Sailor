import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import styles from './SailboatScene.module.css'

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function buildHullGeo() {
  const geo = new THREE.SphereGeometry(1, 52, 26)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    x *= 2.25; y *= 0.37; z *= 0.70
    if (x < 0) {
      const t = Math.pow(-x / 2.25, 1.3)
      z *= 1 - t * 0.58
      if (y > 0) y *= Math.max(0.30, 1 - t * 0.35)
    }
    if (y < 0) y *= 0.62
    pos.setXYZ(i, x, y, z)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

function buildSailGeo(bl, br, tl, tr, billowZ, nx = 14, ny = 14) {
  const W = nx + 1, H = ny + 1
  const verts = new Float32Array(W * H * 3)
  const uvs   = new Float32Array(W * H * 2)
  const idx   = []
  const bot = new THREE.Vector3(), top = new THREE.Vector3(), tmp = new THREE.Vector3()
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const u = i / nx, v = j / ny
      bot.lerpVectors(bl, br, u); top.lerpVectors(tl, tr, u); tmp.lerpVectors(bot, top, v)
      tmp.z += Math.sin(u * Math.PI) * billowZ * (0.25 + v * 0.75)
      const b3 = (j * W + i) * 3
      verts[b3] = tmp.x; verts[b3+1] = tmp.y; verts[b3+2] = tmp.z
      const b2 = (j * W + i) * 2
      uvs[b2] = u; uvs[b2+1] = v
    }
  }
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j*W+i, b=a+1, c=(j+1)*W+i, d=c+1
      idx.push(a,b,d, a,d,c)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  g.setAttribute('uv',       new THREE.BufferAttribute(uvs,   2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function makeCyl(r0, r1, h, mat, segs = 8) {
  return new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, segs), mat)
}

function addRig(a, b, mat, parent) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  if (len < 0.001) return
  const m = makeCyl(0.007, 0.007, len, mat, 4)
  m.position.copy(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5))
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  parent.add(m)
}

const V = (x, y, z) => new THREE.Vector3(x, y, z)

// ─── Component ────────────────────────────────────────────────────────────────

function SailboatScene() {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const W = mount.clientWidth  || window.innerWidth
    const H = mount.clientHeight || 620

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.outputColorSpace  = THREE.SRGBColorSpace
    renderer.toneMapping       = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.6
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap

    renderer.setSize(W, H, false)
    const canvas = renderer.domElement
    canvas.style.position = 'absolute'
    canvas.style.top = '0'; canvas.style.left = '0'
    canvas.style.width = '100%'; canvas.style.height = '100%'
    mount.appendChild(canvas)

    const scene = new THREE.Scene()
    // No background — canvas is transparent so page background shows through
    // The boat is lit to glow amber against the dark page

    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100)
    camera.position.set(4.8, 2.4, 5.8)
    camera.lookAt(0, 1.0, 0)

    // ── Environment ──
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture
    pmrem.dispose()

    // ── Materials — NO transmission, amber color + emissive glow ──────────────
    // Hull: solid amber glass using clearcoat + emissive inner warmth
    const amberGlass = new THREE.MeshPhysicalMaterial({
      color:           new THREE.Color('#d4920a'),
      emissive:        new THREE.Color('#5a3000'),
      emissiveIntensity: 0.4,
      metalness:       0.0,
      roughness:       0.04,
      transparent:     true,
      opacity:         0.90,
      envMapIntensity: 3.5,
      clearcoat:       1.0,
      clearcoatRoughness: 0.04,
    })

    // Sails: thinner amber glass — lighter and more emissive
    const sailMat = new THREE.MeshPhysicalMaterial({
      color:           new THREE.Color('#e8a820'),
      emissive:        new THREE.Color('#7a4400'),
      emissiveIntensity: 0.5,
      metalness:       0.0,
      roughness:       0.06,
      transparent:     true,
      opacity:         0.78,
      envMapIntensity: 2.5,
      clearcoat:       0.8,
      clearcoatRoughness: 0.08,
      side:            THREE.DoubleSide,
    })

    // Rigging: white frosted acrylic
    const riggingMat = new THREE.MeshPhysicalMaterial({
      color:           new THREE.Color('#e8eef8'),
      emissive:        new THREE.Color('#303050'),
      emissiveIntensity: 0.15,
      metalness:       0.1,
      roughness:       0.12,
      transparent:     true,
      opacity:         0.92,
      envMapIntensity: 2.0,
    })

    // Deck
    const deckMat = new THREE.MeshPhysicalMaterial({
      color:           new THREE.Color('#c07808'),
      emissive:        new THREE.Color('#401800'),
      emissiveIntensity: 0.3,
      metalness:       0.0,
      roughness:       0.12,
      transparent:     true,
      opacity:         0.88,
      envMapIntensity: 2.5,
    })

    // ── Boat ──
    const boat = new THREE.Group()
    scene.add(boat)

    const hull = new THREE.Mesh(buildHullGeo(), amberGlass)
    hull.position.y = 0.08; hull.castShadow = true
    boat.add(hull)

    const deck = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 1.18), deckMat)
    deck.rotation.x = -Math.PI / 2; deck.position.y = 0.41
    boat.add(deck)

    // Masts
    ;[{ x: -0.82, h: 2.80 }, { x: 0.24, h: 3.20 }, { x: 1.08, h: 2.35 }].forEach(({ x, h }) => {
      const m = makeCyl(0.022, 0.032, h, riggingMat)
      m.position.set(x, 0.41 + h/2, 0); boat.add(m)
    })

    const bowsprit = makeCyl(0.018, 0.028, 1.35, riggingMat)
    bowsprit.rotation.z = -Math.PI * 0.21; bowsprit.position.set(-1.88, 0.76, 0)
    boat.add(bowsprit)

    // Sails
    boat.add(new THREE.Mesh(buildSailGeo(V(-2.20,0.50,0.06),V(-0.82,0.44,0.06),V(-2.02,0.80,0.06),V(-0.82,3.18,0.06),0.20), sailMat))
    boat.add(new THREE.Mesh(buildSailGeo(V(-0.82,0.44,0.04),V(0.24,0.44,0.04),V(-0.82,3.18,0.04),V(0.24,3.56,0.04),0.40), sailMat))
    boat.add(new THREE.Mesh(buildSailGeo(V(0.24,0.44,0.04),V(1.08,0.44,0.04),V(0.24,3.56,0.04),V(1.08,2.70,0.04),0.26), sailMat))

    // Rigging
    addRig(V(-2.15,0.80,0),    V(-0.82,3.18,0.05), riggingMat, boat)
    addRig(V(-0.82,3.18,0),    V( 0.24,3.56,0),    riggingMat, boat)
    addRig(V( 0.24,3.56,0),    V( 1.08,2.70,0),    riggingMat, boat)
    addRig(V(-0.82,3.18,0),    V(-0.82,0.42, 0.58), riggingMat, boat)
    addRig(V(-0.82,3.18,0),    V(-0.82,0.42,-0.58), riggingMat, boat)
    addRig(V( 0.24,3.56,0),    V( 0.24,0.42, 0.58), riggingMat, boat)
    addRig(V( 0.24,3.56,0),    V( 0.24,0.42,-0.58), riggingMat, boat)
    addRig(V( 1.08,2.70,0),    V( 1.42,0.42, 0.52), riggingMat, boat)
    addRig(V( 1.08,2.70,0),    V( 1.42,0.42,-0.52), riggingMat, boat)
    addRig(V(-0.82,2.00,-0.38),V(-0.82,2.00, 0.38), riggingMat, boat)
    addRig(V( 0.24,2.20,-0.38),V( 0.24,2.20, 0.38), riggingMat, boat)

    // Helm
    const helmGroup = new THREE.Group()
    helmGroup.add(new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.022, 8, 20), riggingMat))
    for (let i = 0; i < 8; i++) {
      const spoke = makeCyl(0.009, 0.009, 0.38, riggingMat, 4)
      spoke.rotation.z = (i / 8) * Math.PI; helmGroup.add(spoke)
    }
    helmGroup.position.set(1.06, 0.84, 0.35); helmGroup.rotation.y = 0.42
    boat.add(helmGroup)

    // Bollards
    const bollardGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.13, 8)
    const bollardMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#e8a010'), emissive: new THREE.Color('#4a2800'),
      emissiveIntensity: 0.3, metalness: 0.2, roughness: 0.1,
    })
    ;[[-1.30,0.42,0.32],[-1.30,0.42,-0.32],[0.70,0.42,0.32],[0.70,0.42,-0.32]].forEach(([x,y,z]) => {
      const b = new THREE.Mesh(bollardGeo, bollardMat); b.position.set(x,y,z); boat.add(b)
    })

    boat.rotation.y = -0.32; boat.rotation.z = 0.04

    // Warm glow disc under the hull (like the reflection in the reference image)
    const glowGeo = new THREE.CircleGeometry(2.5, 32)
    const glowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#c07000'),
      transparent: true, opacity: 0.12,
    })
    const glow = new THREE.Mesh(glowGeo, glowMat)
    glow.rotation.x = -Math.PI / 2; glow.position.y = -0.22
    scene.add(glow)

    // ── Lights ──
    // Soft ambient so the boat isn't pitch black
    scene.add(new THREE.AmbientLight(0xffeedd, 0.5))

    // Key light — slightly warm, from upper right front
    const key = new THREE.DirectionalLight(0xfff5e0, 3.0)
    key.position.set(5, 8, 6)
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024)
    scene.add(key)

    // Fill — cool blue to contrast
    const fill = new THREE.DirectionalLight(0x8090d0, 0.6)
    fill.position.set(-4, 1, -1)
    scene.add(fill)

    // ★ Back-rim from behind: punches warm amber light THROUGH the glass sails
    const rim1 = new THREE.DirectionalLight(0xffa030, 3.5)
    rim1.position.set(-1, 2, -6)
    scene.add(rim1)

    // Secondary rim (from below-back) — bounced light under hull
    const rim2 = new THREE.DirectionalLight(0xff8000, 1.2)
    rim2.position.set(0, -1, -4)
    scene.add(rim2)

    // Top-down gold — illuminates top edges of sails
    const top = new THREE.DirectionalLight(0xffd080, 1.5)
    top.position.set(0, 10, 2)
    scene.add(top)

    // ── Mouse parallax ──
    let mx = 0, my = 0
    const onMouse = (e) => {
      const r = mount.getBoundingClientRect()
      mx = ((e.clientX-r.left)/r.width - 0.5)*2
      my = -((e.clientY-r.top)/r.height - 0.5)*2
    }
    mount.addEventListener('mousemove', onMouse)

    // ── ResizeObserver ──
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    })
    ro.observe(mount)

    // ── Animation ──
    let raf
    const clock = new THREE.Clock()
    const animate = () => {
      raf = requestAnimationFrame(animate)
      const t = clock.getElapsedTime()
      boat.position.y = Math.sin(t * 0.72) * 0.048
      boat.rotation.z = 0.04 + Math.sin(t * 0.57) * 0.027
      boat.rotation.y = -0.32 + Math.sin(t * 0.11) * 0.10 + mx * 0.14
      boat.rotation.x = my * 0.046
      helmGroup.rotation.z = t * 0.22
      // Glow disc pulses subtly
      glow.material.opacity = 0.10 + Math.sin(t * 0.5) * 0.04
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mount.removeEventListener('mousemove', onMouse)
      if (mount.contains(canvas)) mount.removeChild(canvas)
      renderer.dispose()
    }
  }, [])

  return <div ref={mountRef} className={styles.scene} aria-hidden="true" />
}

export default SailboatScene
