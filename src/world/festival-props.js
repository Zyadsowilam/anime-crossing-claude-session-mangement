import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * The things standing around on a zone's deck: lantern posts, banners, stalls, barrels.
 *
 * This is the layer that does the most work per triangle in the whole fork, and the reason
 * is where it sits. Walk mode is the default, so most of the time you are at ground level
 * looking along a deck — and what fills that view is not the terrain, which is behind the
 * buildings, and not the sky, which is above the roofline. It is whatever is standing at
 * eye height a few metres away. The space version filled that band with cargo containers
 * and floodlights, and no amount of pink sky above them made the place read as anything but
 * a depot.
 *
 * Everything here is procedural for one reason: there is no anime prop pack to load, and
 * these shapes are simple enough that a handful of boxes and cylinders gets them. A paper
 * lantern is a barrelled cylinder. A nobori banner is a pole and a flat sheet. Neither
 * needs an artist, and both are unmistakable.
 *
 * **Two meshes come back, not one.** Anything made of paper with a candle behind it goes in
 * the `glow` batch, which is drawn unlit so the bloom pass finds it after dark; the rest
 * goes in `solid`. Splitting them here rather than at the call site is what lets a whole
 * zone's props be two draw calls regardless of how many there are.
 */

/** Paper, timber, cloth, stone. Kept small so a zone reads as one place. */
const PALETTE = {
  paper: 0xffe4b0,
  timber: 0x7a5236,
  timberDark: 0x4f3524,
  cloth: 0xd94f2b,
  clothPale: 0xf2ede0,
  stone: 0x8d8a80,
  rope: 0x6b5b45,
}

const solidColor = (geo, hex) => {
  const count = geo.attributes.position.count
  const c = new THREE.Color(hex)
  const arr = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  geo.deleteAttribute('uv')
  if (!geo.attributes.normal) geo.computeVertexNormals()
  return geo
}

/**
 * A paper lantern: a cylinder pinched at both ends, with the ribbing that makes it read as
 * paper over a frame rather than as a plastic pill.
 */
function lanternBody(r = 0.24, h = 0.42) {
  const g = new THREE.CylinderGeometry(r * 0.62, r * 0.62, h, 12, 3)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    // Barrel it: widest at the waist, pinched at the caps.
    const t = 1 - Math.pow(Math.abs(y) / (h / 2), 2)
    const swell = 1 + t * 0.55
    pos.setX(i, pos.getX(i) * swell)
    pos.setZ(i, pos.getZ(i) * swell)
  }
  pos.needsUpdate = true
  g.computeVertexNormals()
  return g
}

/**
 * Each prop returns `{ solid: [geo], glow: [geo] }` in its own local space, standing on
 * y = 0 and facing +Z, plus the ground radius it wants kept clear.
 */
const PROPS = {
  /** A tall post with a paper lantern hanging off a short arm. The workhorse. */
  lanternPost() {
    const solid = []
    const glow = []
    const post = new THREE.CylinderGeometry(0.07, 0.09, 2.5, 8)
    post.translate(0, 1.25, 0)
    solid.push(solidColor(post, PALETTE.timber))

    const arm = new THREE.BoxGeometry(0.06, 0.06, 0.5)
    arm.translate(0, 2.4, 0.22)
    solid.push(solidColor(arm, PALETTE.timberDark))

    const cap = new THREE.CylinderGeometry(0.1, 0.1, 0.06, 8)
    cap.translate(0, 2.16, 0.44)
    solid.push(solidColor(cap, PALETTE.timberDark))

    const body = lanternBody(0.26, 0.46)
    body.translate(0, 1.88, 0.44)
    glow.push(solidColor(body, PALETTE.paper))
    return { solid, glow, radius: 0.5 }
  },

  /** Nobori: the tall narrow banner on a pole, outside every stall in the country. */
  banner() {
    const solid = []
    const pole = new THREE.CylinderGeometry(0.05, 0.06, 3.0, 7)
    pole.translate(0, 1.5, 0)
    solid.push(solidColor(pole, PALETTE.timber))

    // The cloth: a thin slab, hung off one side, with a crossbar at the top.
    const cloth = new THREE.BoxGeometry(0.03, 1.9, 0.62)
    cloth.translate(0, 1.85, 0.36)
    solid.push(solidColor(cloth, PALETTE.cloth))

    const bar = new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6)
    bar.rotateX(Math.PI / 2)
    bar.translate(0, 2.8, 0.34)
    solid.push(solidColor(bar, PALETTE.timberDark))
    return { solid, glow: [], radius: 0.45 }
  },

  /** A festival stall: counter, posts, and a striped awning over the top. */
  stall() {
    const solid = []
    const glow = []
    const counter = new THREE.BoxGeometry(2.2, 0.85, 1.0)
    counter.translate(0, 0.42, 0)
    solid.push(solidColor(counter, PALETTE.timber))

    const top = new THREE.BoxGeometry(2.35, 0.1, 1.15)
    top.translate(0, 0.9, 0)
    solid.push(solidColor(top, PALETTE.timberDark))

    for (const sx of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6)
      leg.translate(sx * 1.05, 1.1, -0.42)
      solid.push(solidColor(leg, PALETTE.timberDark))
    }

    // The awning, pitched forward so it reads as shelter rather than as a lid.
    const awning = new THREE.BoxGeometry(2.6, 0.08, 1.5)
    awning.rotateX(-0.22)
    awning.translate(0, 2.16, 0.12)
    solid.push(solidColor(awning, PALETTE.clothPale))

    // The valance hanging off its front edge — the striped scallop that says "festival".
    const valance = new THREE.BoxGeometry(2.6, 0.34, 0.05)
    valance.translate(0, 1.96, 0.86)
    solid.push(solidColor(valance, PALETTE.cloth))

    // Two small lanterns on the awning corners.
    for (const sx of [-1, 1]) {
      const l = lanternBody(0.17, 0.3)
      l.translate(sx * 1.1, 1.82, 0.66)
      glow.push(solidColor(l, PALETTE.paper))
    }
    return { solid, glow, radius: 1.35 }
  },

  /** A stack of sake barrels — the kagami-biraki wall you see at every shrine. */
  barrels() {
    const solid = []
    const place = (x, y, z, r) => {
      const b = new THREE.CylinderGeometry(r, r, r * 1.5, 10)
      b.rotateX(Math.PI / 2)
      b.translate(x, y, z)
      solid.push(solidColor(b, PALETTE.clothPale))
      // The rope band round the middle, which is most of what makes it a sake barrel.
      const band = new THREE.TorusGeometry(r * 1.02, r * 0.09, 5, 12)
      band.translate(x, y, z)
      solid.push(solidColor(band, PALETTE.rope))
    }
    place(-0.34, 0.3, 0, 0.3)
    place(0.34, 0.3, 0, 0.3)
    place(0, 0.86, 0, 0.3)
    return { solid, glow: [], radius: 0.8 }
  },

  /** The stone lantern that stands beside a path. Quiet, and it lights up at night. */
  stoneLantern() {
    const solid = []
    const glow = []
    const base = new THREE.CylinderGeometry(0.24, 0.32, 0.5, 8)
    base.translate(0, 0.25, 0)
    solid.push(solidColor(base, PALETTE.stone))

    const shaft = new THREE.CylinderGeometry(0.13, 0.15, 0.5, 8)
    shaft.translate(0, 0.72, 0)
    solid.push(solidColor(shaft, PALETTE.stone))

    const box = new THREE.BoxGeometry(0.42, 0.4, 0.42)
    box.translate(0, 1.16, 0)
    glow.push(solidColor(box, PALETTE.paper))

    const roof = new THREE.ConeGeometry(0.42, 0.32, 6)
    roof.translate(0, 1.52, 0)
    solid.push(solidColor(roof, PALETTE.stone))

    const finial = new THREE.SphereGeometry(0.09, 8, 6)
    finial.translate(0, 1.72, 0)
    solid.push(solidColor(finial, PALETTE.stone))
    return { solid, glow, radius: 0.42 }
  },

  /** A small wayside torii, echoing the big one at the centre. */
  miniTorii() {
    const solid = []
    const span = 0.72
    const h = 1.9
    for (const sx of [-1, 1]) {
      const p = new THREE.CylinderGeometry(0.075, 0.09, h, 8)
      p.translate(sx * span, h / 2, 0)
      solid.push(solidColor(p, PALETTE.cloth))
    }
    const nuki = new THREE.BoxGeometry(span * 2 + 0.4, 0.11, 0.14)
    nuki.translate(0, h * 0.74, 0)
    solid.push(solidColor(nuki, PALETTE.cloth))

    const kasagi = new THREE.BoxGeometry(span * 2 + 0.75, 0.14, 0.22)
    kasagi.translate(0, h, 0)
    solid.push(solidColor(kasagi, PALETTE.timberDark))
    return { solid, glow: [], radius: 0.55 }
  },
}

export const PROP_NAMES = Object.keys(PROPS)

/**
 * Build one prop, placed and turned. Returns its geometries already in plot space, plus the
 * ground radius the navigation grid should keep clear.
 */
export function buildFestivalProp(name, { x = 0, y = 0, z = 0, yaw = 0, scale = 1 } = {}) {
  const make = PROPS[name] || PROPS.lanternPost
  const { solid, glow, radius } = make()
  for (const g of [...solid, ...glow]) {
    if (scale !== 1) g.scale(scale, scale, scale)
    if (yaw) g.rotateY(yaw)
    g.translate(x, y, z)
  }
  return { solid, glow, radius: radius * scale }
}

/** Merge a batch, or hand back null when nothing went into it. */
export function mergeProps(parts) {
  if (!parts.length) return null
  const merged = BufferGeometryUtils.mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  return merged
}

/** Painted timber and cloth: vertex-coloured, matte, no map. */
export function propMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.0 })
}

/**
 * Lantern paper. Unlit and vertex-coloured, so it is the thing the bloom pass picks out
 * after dark — and so a deck full of lanterns costs exactly one more draw call than a deck
 * with none.
 */
export function glowMaterial() {
  return new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true })
}
