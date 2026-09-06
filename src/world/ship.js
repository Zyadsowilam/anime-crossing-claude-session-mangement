import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * The Great Gate. Every character walks out from under it when a thread appears and back
 * through it when one is archived, so it is the world's one fixed piece of narrative
 * furniture.
 *
 * In the space version this was a lander, and the lander was the single object doing the
 * most to make the place read as science fiction — a white capsule on hydraulic legs in the
 * middle of everything. Swapping it for a torii does more for the setting than the terrain
 * and the sky put together, because it is the thing at the centre of the map that
 * everything else is arranged around, and because a gate carries exactly the meaning this
 * object needs anyway: a threshold that things arrive through and leave through.
 *
 * The construction is the real thing rather than two posts and a bar. A torii reads as a
 * torii because of the details in the silhouette — the pillars lean inward, the top rail
 * (*kasagi*) is deeper than the beam under it (*nuki*) and sweeps up at both ends, and there
 * is a short strut between the two in the middle. Get those three wrong and it is a rugby
 * post; get them right and it is unmistakable at any distance.
 *
 * The class keeps the lander's interface exactly — `shipDoor()`, `update()`, `ping()` — so
 * nothing downstream had to learn a new word for it.
 */

/** Vermilion, which is the colour these are painted, and the black the ends are capped in. */
const VERMILION = 0xd94f2b
const VERMILION_DARK = 0xa8371c
const BEAM_BLACK = 0x2b2118
const STONE = 0x8d8a80
const PAPER = 0xffdba8

/** Roughness / metalness per material, so lacquered timber reads differently to stone. */
const SURFACE = new Map([
  [VERMILION, [0.42, 0.0]],
  [VERMILION_DARK, [0.5, 0.0]],
  [BEAM_BLACK, [0.38, 0.05]],
  [STONE, [0.94, 0.0]],
  [PAPER, [0.72, 0.0]],
])
const DEFAULT_SURFACE = [0.6, 0.0]

/** How far apart the pillars stand, and how high the top rail sits. */
const SPAN = 3.5
const HEIGHT = 6.4

export class Ship {
  constructor(scene, position) {
    this.group = new THREE.Group()
    this.group.position.copy(position)
    // Turned so you walk through it toward the middle of the world.
    this.group.rotation.y = Math.atan2(-position.x, -position.z)
    this.group.name = 'gate'
    scene.add(this.group)
    this.scene = scene

    this.footRadius = SPAN * 0.75

    this._buildGate()
    this._buildPath() // sets doorLocal from where the path actually starts
    this._buildLights()

    this.traffic = 0 // the lanterns brighten while characters are coming through
  }

  _buildGate() {
    const parts = []
    const colors = []
    const push = (geo, color, rot) => {
      if (rot) {
        if (rot.x) geo.rotateX(rot.x)
        if (rot.y) geo.rotateY(rot.y)
        if (rot.z) geo.rotateZ(rot.z)
      }
      parts.push(geo)
      colors.push(new THREE.Color(color))
    }

    for (const side of [-1, 1]) {
      // The pillars lean inward by about two degrees. It is a small angle and it is most of
      // why a real torii looks settled rather than assembled — parallel posts read as
      // scaffolding no matter how well they are painted.
      const lean = 0.035 * side
      const pillar = new THREE.CylinderGeometry(0.26, 0.32, HEIGHT, 20)
      pillar.translate(0, HEIGHT / 2, 0)
      pillar.rotateZ(-lean)
      pillar.translate(side * SPAN, 0, 0)
      push(pillar, VERMILION)

      // Stone footing, so the timber is not growing straight out of the grass.
      const foot = new THREE.CylinderGeometry(0.5, 0.58, 0.5, 20)
      foot.translate(side * SPAN, 0.2, 0)
      push(foot, STONE)

      // The wedge where the lower beam passes through the pillar.
      const collar = new THREE.BoxGeometry(0.62, 0.3, 0.5)
      collar.translate(side * SPAN, HEIGHT * 0.72, 0)
      push(collar, VERMILION_DARK)
    }

    // The nuki: the straight beam, which stops short of the kasagi above it and passes
    // *through* the pillars rather than resting on them.
    const nuki = new THREE.BoxGeometry(SPAN * 2 + 1.5, 0.34, 0.44)
    nuki.translate(0, HEIGHT * 0.72, 0)
    push(nuki, VERMILION)

    // The gakuzuka: the short strut between the two rails, in the middle. Small, and its
    // absence is instantly noticeable.
    const strut = new THREE.BoxGeometry(0.42, HEIGHT * 0.2, 0.3)
    strut.translate(0, HEIGHT * 0.855, 0)
    push(strut, VERMILION)

    // The plaque it carries. This is the gate's one sign, and it is what lights up.
    const plaque = new THREE.BoxGeometry(0.9, 0.72, 0.14)
    plaque.translate(0, HEIGHT * 0.85, 0.22)
    push(plaque, BEAM_BLACK)

    /**
     * The kasagi: the top rail. Built as a shallow arc of short segments rather than one
     * box, because the upward sweep at the ends is the silhouette people actually recognise
     * — a flat top rail reads as a doorway and a swept one reads as a shrine.
     */
    /**
     * Thirty-two short courses rather than fifteen, each overlapping its neighbour.
     *
     * The first version stepped visibly: fifteen boxes across a four-metre span is a
     * quarter-metre step at every joint, and because each is tilted a little more than the
     * last, the corners stick out along the whole curve. From the ground it read as a
     * staircase, which is exactly the "everything is blocks" complaint.
     *
     * Doubling the count halves each step, and — the part that actually matters —
     * overlapping each course by a third of its own length closes the joints entirely, so
     * the outside of the curve is continuous even though it is still made of boxes. The
     * ends are capped with a rounded piece, because the one place a beam genuinely is not
     * square is where it has been carved off.
     */
    const segments = 32
    const width = SPAN * 2 + 2.4
    const step = width / segments
    for (let i = 0; i < segments; i++) {
      const t = i / (segments - 1) - 0.5 // −0.5 … 0.5
      const x = t * width
      // A gentle parabola: nearly flat in the middle, lifting hard at the very ends.
      const rise = Math.pow(Math.abs(t) * 2, 2.6) * 0.85
      const tilt = -Math.sign(t) * Math.pow(Math.abs(t) * 2, 2.2) * 0.42

      const seg = new THREE.BoxGeometry(step * 1.45, 0.4, 0.72)
      seg.rotateZ(tilt)
      seg.translate(x, HEIGHT + rise, 0)
      push(seg, BEAM_BLACK)

      // The shimaki — a thinner rail tucked under the kasagi, in vermilion, which is what
      // gives the top of the gate its two-tone banding.
      const under = new THREE.BoxGeometry(step * 1.45, 0.22, 0.56)
      under.rotateZ(tilt)
      under.translate(x, HEIGHT - 0.3 + rise * 0.92, 0)
      push(under, VERMILION)
    }

    // The carved ends of the top rail, and the caps on the lower beam.
    for (const side of [-1, 1]) {
      const endRise = Math.pow(1, 2.6) * 0.85
      const cap = new THREE.CylinderGeometry(0.21, 0.21, 0.74, 12)
      cap.rotateX(Math.PI / 2)
      cap.translate(side * (width / 2), HEIGHT + endRise, 0)
      push(cap, BEAM_BLACK)

      const nukiCap = new THREE.CylinderGeometry(0.17, 0.17, 0.46, 10)
      nukiCap.rotateX(Math.PI / 2)
      nukiCap.translate(side * (SPAN + 0.75), HEIGHT * 0.72, 0)
      push(nukiCap, VERMILION)
    }

    const mesh = new THREE.Mesh(mergeWithColors(parts, colors), hullMaterial())
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
    this.gate = mesh
  }

  /**
   * The approach: a short run of flagstones through the gate, and the point on it where
   * characters appear and vanish.
   */
  _buildPath() {
    const stones = []
    const stoneColors = []
    const steps = 7
    for (let i = 0; i < steps; i++) {
      const z = 0.9 + i * 0.95
      const w = 2.6 - i * 0.12
      const slab = new THREE.CylinderGeometry(w * 0.5, w * 0.5, 0.12, 6)
      slab.rotateY(Math.PI / 6)
      slab.translate(0, 0.06, z)
      stones.push(slab)
      stoneColors.push(new THREE.Color(STONE))
    }
    const path = new THREE.Mesh(mergeWithColors(stones, stoneColors), hullMaterial())
    path.receiveShadow = true
    this.group.add(path)

    // Two low stone lanterns flanking the path, which is where the ground light comes from
    // after dark.
    const posts = []
    const postColors = []
    for (const side of [-1, 1]) {
      const base = new THREE.CylinderGeometry(0.2, 0.26, 0.7, 8)
      base.translate(side * 2.3, 0.35, 3.2)
      posts.push(base)
      postColors.push(new THREE.Color(STONE))
      const cap = new THREE.ConeGeometry(0.42, 0.34, 6)
      cap.translate(side * 2.3, 1.28, 3.2)
      posts.push(cap)
      postColors.push(new THREE.Color(BEAM_BLACK))
    }
    const postMesh = new THREE.Mesh(mergeWithColors(posts, postColors), hullMaterial())
    postMesh.castShadow = true
    this.group.add(postMesh)

    // The lit box of each stone lantern. Unlit material, so it is what the bloom pass finds.
    const boxes = []
    const boxColors = []
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.42, 0.42, 0.42)
      g.translate(side * 2.3, 0.95, 3.2)
      boxes.push(g)
      boxColors.push(new THREE.Color(PAPER))
    }
    this.stripMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true })
    this.strips = new THREE.Mesh(mergeWithColors(boxes, boxColors), this.stripMaterial)
    this.group.add(this.strips)

    // Characters appear and vanish under the gate itself, a step onto the path.
    this.doorLocal = new THREE.Vector3(0, 0, 3.4)
  }

  _buildLights() {
    // The plaque, lit from within like a shrine sign.
    this.beaconMaterial = new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: true })
    this.beacon = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.56), this.beaconMaterial)
    this.beacon.position.set(0, HEIGHT * 0.85, 0.3)
    this.group.add(this.beacon)

    // A row of paper lanterns strung under the lower beam. These are the gate's landing
    // lights: they are what tells you, from across the map, where arrivals happen.
    const lanterns = []
    const lanternColors = []
    this.lanternCount = 7
    for (let i = 0; i < this.lanternCount; i++) {
      const t = i / (this.lanternCount - 1) - 0.5
      const g = new THREE.CylinderGeometry(0.2, 0.2, 0.34, 10)
      // Slightly barrelled, the way a paper lantern is.
      g.scale(1, 1, 1)
      g.translate(t * (SPAN * 2 - 0.4), HEIGHT * 0.72 - 0.42, 0)
      lanterns.push(g)
      lanternColors.push(new THREE.Color(PAPER))
    }
    this.padMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true })
    this.padLights = new THREE.Mesh(mergeWithColors(lanterns, lanternColors), this.padMaterial)
    this.group.add(this.padLights)

    /**
     * `glassMaterial` exists because `update` paints it and the lander had glass. Here it is
     * the thin wash of light on the ground under the gate — the same job, and keeping the
     * name means the update loop did not have to change at all.
     */
    this.glassMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    })
    const glow = new THREE.Mesh(new THREE.CircleGeometry(SPAN * 1.5, 28), this.glassMaterial)
    glow.rotation.x = -Math.PI / 2
    glow.position.set(0, 0.04, 1.6)
    this.group.add(glow)
  }

  /** World position under the gate — where characters appear and vanish. */
  shipDoor(out = new THREE.Vector3()) {
    return out.copy(this.doorLocal).applyMatrix4(this.group.matrixWorld)
  }

  update(dt, elapsed, night) {
    // The plaque breathes rather than strobing. A gate is not an aircraft.
    const breathe = 0.72 + 0.28 * Math.sin(elapsed * 1.3)
    const plaque = (0.5 + night * 1.6) * breathe
    this.beaconMaterial.color.setRGB(2.4 * plaque, 1.35 * plaque, 0.5 * plaque)

    const gain = 0.3 + night * 2.0
    this.padMaterial.color.setRGB(1.15 * gain, 0.82 * gain, 0.45 * gain)
    // The wash on the ground only exists after dark; by day it would be a grey disc.
    this.glassMaterial.opacity = night * 0.28
    this.glassMaterial.color.setRGB(0.5 * gain, 0.34 * gain, 0.16 * gain)

    // The stone lanterns flare while anyone is coming through.
    this.traffic = Math.max(0, this.traffic - dt * 1.5)
    const busy = Math.min(1, this.traffic)
    const pulse = 0.6 + 0.4 * Math.sin(elapsed * 4)
    const s = (0.45 + night * 1.3) * (1 + busy * pulse * 1.6)
    this.stripMaterial.color.setRGB(1.2 * s, 0.72 * s, 0.34 * s)
  }

  /** Called when a character uses the gate, so the lanterns react. */
  ping() {
    this.traffic = Math.min(2.5, this.traffic + 1)
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose()
        o.material.dispose()
      }
    })
    this.scene.remove(this.group)
  }
}

/**
 * Merge a set of geometries, baking one flat colour per part into vertex colours — plus the
 * roughness and metalness that colour implies, so a single merged gate can hold lacquered
 * timber, bare stone and paper and have each behave correctly under the environment map.
 */
function mergeWithColors(parts, colors) {
  parts.forEach((geo, i) => {
    const count = geo.attributes.position.count
    const arr = new Float32Array(count * 3)
    const surf = new Float32Array(count * 2)
    const c = colors[i]
    const s = SURFACE.get(colors[i].getHex()) || DEFAULT_SURFACE
    for (let k = 0; k < count; k++) {
      arr[k * 3] = c.r
      arr[k * 3 + 1] = c.g
      arr[k * 3 + 2] = c.b
      surf[k * 2] = s[0]
      surf[k * 2 + 1] = s[1]
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    geo.setAttribute('aSurface', new THREE.BufferAttribute(surf, 2))
    geo.deleteAttribute('uv')
    if (!geo.attributes.normal) geo.computeVertexNormals()
  })
  const merged = BufferGeometryUtils.mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  return merged
}

/** Per-vertex PBR, double-sided so the open tubes show their insides instead of vanishing. */
function hullMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.0,
    side: THREE.DoubleSide,
    shadowSide: THREE.BackSide,
  })
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n attribute vec2 aSurface;\n varying vec2 vSurface;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n vSurface = aSurface;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n varying vec2 vSurface;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurface.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurface.y;')
  }
  return mat
}
