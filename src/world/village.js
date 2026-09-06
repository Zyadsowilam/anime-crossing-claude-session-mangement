import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * The buildings: a hidden-village street rather than a moon base.
 *
 * These were the last thing in the world still made of the space kit, and they were the
 * loudest: a zone is a ring of buildings around a deck, so whatever they are made of is
 * what the place *is*. Pink sky over solar arrays is pink sky over solar arrays.
 *
 * There is no anime building pack to load, so this is procedural — which turns out to suit
 * the subject. Japanese vernacular architecture is unusually *composable*: nearly every
 * building in a village is some arrangement of four elements — a plaster-and-timber box, a
 * deep tiled roof, a raised veranda, and a sign or curtain — and once those four exist as
 * functions, a townhouse, a teahouse, a storehouse and a village tower are different calls
 * rather than different models.
 *
 * **The roof is the whole job.** Everything else can be a box and the building still reads
 * correctly, and the roof can be perfect over boxes and it still works. What makes a roof
 * read as this rather than as a shed is three things together: a shallow pitch, eaves that
 * overhang a long way past the wall, and a slightly *concave* slope so the line dips before
 * it reaches the eave. Each is cheap; the combination is the entire silhouette.
 *
 * Everything here returns vertex-coloured geometry in a building-local space standing on
 * y = 0, to be merged into one mesh per building by `buildings.js`.
 */

/** The village palette. Small on purpose — a street reads as a street when it agrees. */
export const V = {
  plaster: 0xe8e0d0,
  plasterWarm: 0xdccdb4,
  timber: 0x6b4630,
  timberDark: 0x3f2a1d,
  roofTile: 0x3f4a52,
  roofTileWarm: 0x4a4038,
  roofRidge: 0x2b3238,
  stone: 0x8d8a80,
  paper: 0xf7e6c4,
  cloth: 0xc4392b,
  green: 0x4f6b3a,
}

/** Roughness and metalness per colour, so plaster, tile and lacquer behave differently. */
export const V_SURFACE = new Map([
  [V.plaster, [0.92, 0.0]],
  [V.plasterWarm, [0.92, 0.0]],
  [V.timber, [0.74, 0.0]],
  [V.timberDark, [0.7, 0.0]],
  [V.roofTile, [0.55, 0.05]],
  [V.roofTileWarm, [0.6, 0.03]],
  [V.roofRidge, [0.5, 0.06]],
  [V.stone, [0.95, 0.0]],
  [V.paper, [0.8, 0.0]],
  [V.cloth, [0.86, 0.0]],
  [V.green, [0.88, 0.0]],
])

// ── the four elements ──────────────────────────────────────────────────────────────────

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d)

function at(geo, x, y, z, ry = 0) {
  if (ry) geo.rotateY(ry)
  geo.translate(x, y, z)
  return geo
}

/**
 * A part is geometry, the flat colour it is painted, and whether it is *roof*.
 *
 * That last flag exists so buildings can be opened up. Walking into a house means lifting
 * its roof off, and lifting a roof off means the vertex shader has to know which vertices
 * belong to it — the whole building is one merged mesh, so there is no object to move. The
 * flag rides through the merge as an attribute and comes out the other side as one number
 * per vertex.
 */
const part = (geo, color, roof = false) => ({ geo, color, roof })

/** Mark a set of parts as roof. Used by every generator that puts a lid on something. */
function asRoof(parts) {
  for (const p of parts) p.roof = true
  return parts
}

/**
 * A tiled roof.
 *
 * Built as a stack of courses from eave to ridge, each shorter and higher than the last.
 * A single tapered box would give the pitch but not the *curve*, and the curve is the thing
 * — the exponent below is what makes the slope shallow at the ridge and steep at the eave,
 * which is the profile the eye recognises. Stacking courses also gives the stepped tile
 * texture for free, which at this size does the work a normal map would.
 *
 * `gable` false makes it a hip — sloping on all four sides — which is what most of these
 * want; true leaves the ends vertical, for a townhouse in a terrace.
 */
function tiledRoof(w, d, height, { overhang = 0.42, courses = 7, gable = false, color = V.roofTile } = {}) {
  const parts = []
  const ridgeW = gable ? w + overhang * 2 : w * 0.34
  for (let i = 0; i < courses; i++) {
    const t = i / (courses - 1)
    // Concave: rises slowly at first, steeply near the ridge. `pow` under 1 would bulge the
    // roof outward, which reads as a circus tent.
    const y = Math.pow(t, 1.55) * height
    const cw = THREE.MathUtils.lerp(w + overhang * 2, ridgeW, t)
    // The hip closes to a short ridge rather than to a point: a roof that tapers to nothing
    // is a pyramid, and a pyramid on a house reads as a tent.
    const cd = THREE.MathUtils.lerp(d + overhang * 2, d * 0.3, t)
    const course = box(cw, height / courses + 0.06, gable ? d + overhang * 2 : cd)
    parts.push(part(at(course, 0, y, 0), i === courses - 1 ? V.roofRidge : color))
  }
  // The ridge beam along the top, which is always a different colour to the tiles.
  parts.push(part(at(box(gable ? w + overhang * 2 : w * 0.3, 0.16, 0.26), 0, height + 0.06, 0), V.roofRidge))
  return parts
}

/**
 * Lift a set of parts by `y`. Trivial, and it exists because the alternative was counting.
 *
 * The first version of this file put roofs on walls with `parts.slice(-9)` — take the last
 * nine entries, which is however many `tiledRoof` happened to return, and move them up. That
 * is correct exactly until a roof is built with a different number of courses, at which
 * point it silently lifts a wall panel into the air along with the tiles, or leaves a course
 * of tiles sitting on the ground. Passing the roof around as its own array cannot go wrong.
 */
function raise(parts, y) {
  for (const p of parts) p.geo.translate(0, y, 0)
  return parts
}

/** Raise a roof onto a wall and flag it as roof in one go, since it is always both. */
const roofOn = (parts, y) => asRoof(raise(parts, y))

/** A plaster wall panel with the exposed timber frame that goes with it. */
function framedWall(w, h, d, { color = V.plaster, posts = true } = {}) {
  const parts = [part(at(box(w, h, d), 0, h / 2, 0), color)]
  if (!posts) return parts
  // Corner posts and a sill beam. Timber over plaster is the single most recognisable wall
  // in the vernacular, and it costs four boxes.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(part(at(box(0.16, h, 0.16), sx * (w / 2 - 0.06), h / 2, sz * (d / 2 - 0.06)), V.timber))
    }
  }
  parts.push(part(at(box(w + 0.06, 0.14, d + 0.06), 0, 0.07, 0), V.timberDark))
  return parts
}

/** The raised veranda that runs along the front of almost everything. */
function veranda(w, d, y, { posts = 3 } = {}) {
  const parts = [part(at(box(w, 0.14, d), 0, y, 0), V.timber)]
  for (let i = 0; i < posts; i++) {
    const x = (i / (posts - 1) - 0.5) * (w - 0.3)
    parts.push(part(at(box(0.12, y, 0.12), x, y / 2, d / 2 - 0.1), V.timberDark))
  }
  return parts
}

/** A noren — the split curtain hung in a doorway. Says "this is open" at a glance. */
function noren(w, h, x, y, z, color = V.cloth) {
  const parts = []
  const panels = 3
  for (let i = 0; i < panels; i++) {
    const px = x + (i / (panels - 1) - 0.5) * (w - w / panels)
    parts.push(part(at(box(w / panels - 0.04, h, 0.04), px, y - h / 2, z), color))
  }
  parts.push(part(at(box(w, 0.07, 0.07), x, y, z), V.timberDark))
  return parts
}

/** A hanging sign board beside a door. */
function signboard(x, y, z, ry = 0) {
  return [
    part(at(box(0.1, 1.1, 0.1), x, y - 0.55, z, ry), V.timberDark),
    part(at(box(0.62, 0.5, 0.08), x, y, z, ry), V.paper),
  ]
}

// ── the buildings ──────────────────────────────────────────────────────────────────────

/**
 * Each generator returns `{ parts, height, footprint, label }`. `footprint` is the radius
 * the navigation grid should keep clear, and it is measured rather than guessed — a wide
 * roof that nobody can walk under is worse than one they clip through.
 */
export const VILLAGE_KINDS = {
  /** The townhouse. The commonest thing on the street, so it has the most variation. */
  house(rand) {
    /**
     * The commonest building on the street, and therefore the one that must not repeat.
     *
     * The first version varied width, depth and height by about a fifth each and gable by a
     * coin flip, which sounds like variety and is not: at a glance every house was the same
     * house, because the things that were changing are the things the eye is worst at
     * comparing. What actually distinguishes two buildings in a row is **silhouette** — how
     * many storeys, whether there is a lean-to on the side, where the roof ridge runs, how
     * far the eaves come out — and those are what vary here.
     *
     * The roof tile colour varies too, over a narrow range. A street of identically coloured
     * roofs reads as a texture; a street where each is a slightly different firing of the
     * same clay reads as a street.
     */
    const w = 2.3 + rand() * 1.3
    const d = 2.0 + rand() * 0.9
    const storeys = rand() > 0.66 ? 2 : 1
    const storeyH = 1.55 + rand() * 0.35
    const h = storeyH * storeys

    // A narrow range of firings, keyed off this building's own seed.
    const tile = [V.roofTile, V.roofTileWarm, V.roofTile, V.roofRidge][Math.floor(rand() * 4)]
    const wall = rand() > 0.5 ? V.plaster : V.plasterWarm

    const parts = [...framedWall(w, h, d, { color: wall })]

    // An upper storey gets its own band and a little balcony rail, which is most of what
    // makes two floors read as two floors rather than as one tall box.
    if (storeys === 2) {
      parts.push(part(at(box(w + 0.12, 0.14, d + 0.12), 0, storeyH, 0), V.timberDark))
      parts.push(part(at(box(w * 0.92, 0.09, 0.5), 0, storeyH + 0.06, d / 2 + 0.2), V.timber))
      for (let i = 0; i < 5; i++) {
        const bx = (i / 4 - 0.5) * w * 0.86
        parts.push(part(at(box(0.06, 0.42, 0.06), bx, storeyH + 0.3, d / 2 + 0.42), V.timberDark))
      }
      parts.push(part(at(box(w * 0.9, 0.07, 0.07), 0, storeyH + 0.52, d / 2 + 0.42), V.timber))
    }

    const gable = rand() > 0.45
    const eaves = 0.34 + rand() * 0.26
    parts.push(...roofOn(tiledRoof(w, d, 0.75 + rand() * 0.45, { gable, overhang: eaves, color: tile }), h))

    // A lean-to on one side, on about a third of them. One extra box and one extra roof,
    // and it breaks the row's rhythm more than any amount of resizing does.
    if (rand() > 0.62) {
      const side = rand() > 0.5 ? 1 : -1
      const lw = w * 0.42
      const lh = h * 0.62
      const lx = side * (w / 2 + lw / 2 - 0.06)
      for (const pt of framedWall(lw, lh, d * 0.7, { color: wall, posts: false })) {
        pt.geo.translate(lx, 0, 0)
        parts.push(pt)
      }
      const lean = tiledRoof(lw, d * 0.7, 0.4, { gable: true, overhang: 0.26, color: tile })
      for (const pt of lean) pt.geo.translate(lx, lh, 0)
      parts.push(...asRoof(lean))
    }

    parts.push(...veranda(w * 0.9, 0.8, 0.42, { posts: 3 }).map((pt) => (pt.geo.translate(0, 0, d / 2 + 0.3), pt)))
    parts.push(...noren(1.1, 0.62, 0, Math.min(h, storeyH) * 0.78, d / 2 + 0.03))
    if (rand() > 0.5) parts.push(...signboard(w / 2 - 0.25, storeyH * 0.8, d / 2 + 0.5))
    // A window on the front, lit from within after dark like every other paper panel.
    parts.push(part(at(box(w * 0.34, 0.5, 0.07), -w * 0.24, storeyH * 0.55, d / 2 + 0.02), V.paper))

    return {
      parts,
      height: h + 1.4,
      footprint: Math.max(w, d) * 0.5 + 0.4,
      label: storeys === 2 ? 'Townhouse' : 'House',
      room: { w, d, h: storeyH, y: 0, door: d / 2 },
    }
  },

  /** A shopfront: wider, lower, with an awning and a lot of signage. */
  shop(rand) {
    const w = 2.7 + rand() * 1.0
    const d = 1.9 + rand() * 0.6
    const h = 1.5 + rand() * 0.45
    const parts = [
      ...framedWall(w, h, d, { color: V.plasterWarm }),
      ...roofOn(tiledRoof(w, d, 0.72, { gable: true, overhang: 0.55 }), h),
    ]
    // The awning over the front, pitched forward.
    const awn = box(w + 0.3, 0.09, 1.1)
    awn.rotateX(-0.24)
    parts.push(part(at(awn, 0, h * 0.82, d / 2 + 0.45), V.cloth))
    for (const sx of [-1, 1]) {
      parts.push(part(at(box(0.1, h * 0.75, 0.1), sx * (w / 2 - 0.1), h * 0.37, d / 2 + 0.9), V.timberDark))
    }
    parts.push(...noren(w * 0.55, 0.7, 0, h * 0.7, d / 2 + 0.03))
    parts.push(...signboard(-w / 2 + 0.3, h * 0.95, d / 2 + 0.55))
    // The goods on display. A shop with an empty counter is a shed with a sign on it, and
    // the crates are what make a row of these read as a market street.
    const crates = 2 + Math.floor(rand() * 3)
    for (let i = 0; i < crates; i++) {
      const cx = (i / Math.max(1, crates - 1) - 0.5) * w * 0.7
      const ch = 0.22 + rand() * 0.16
      parts.push(part(at(box(0.44, ch, 0.4), cx, ch / 2, d / 2 + 0.55), V.timber))
      parts.push(part(at(box(0.38, 0.08, 0.34), cx, ch + 0.04, d / 2 + 0.55), rand() > 0.5 ? V.cloth : V.green))
    }
    // A lit window band along the frontage.
    parts.push(part(at(box(w * 0.62, 0.34, 0.06), 0, h * 0.52, d / 2 + 0.02), V.paper))
    return {
      parts,
      height: h + 1.1,
      footprint: Math.max(w, d) * 0.5 + 0.5,
      label: 'Shop',
      room: { w, d, h, y: 0, door: d / 2 },
    }
  },

  /**
   * The village tower — the round administrative building with the conical roof that every
   * hidden village has one of. The only silhouette here that breaks the skyline.
   */
  tower(rand) {
    const r = 1.5
    const h = 3.4 + rand() * 0.9
    const parts = []
    const drum = new THREE.CylinderGeometry(r, r * 1.06, h, 16)
    parts.push(part(at(drum, 0, h / 2, 0), V.plaster))
    // A band of windows, and the balcony that rings it.
    parts.push(part(at(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.45, 16), 0, h * 0.62, 0), V.timberDark))
    parts.push(part(at(new THREE.CylinderGeometry(r * 1.34, r * 1.34, 0.12, 16), 0, h * 0.8, 0), V.timber))
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      parts.push(
        part(at(box(0.09, 0.34, 0.09), Math.cos(a) * r * 1.28, h * 0.88, Math.sin(a) * r * 1.28), V.timberDark)
      )
    }
    // Conical tiled roof, in courses like the others so the profile matches the street.
    const courses = 7
    for (let i = 0; i < courses; i++) {
      const t = i / (courses - 1)
      const y = h + Math.pow(t, 1.5) * 1.3
      const cr = THREE.MathUtils.lerp(r * 1.55, r * 0.12, t)
      parts.push(part(at(new THREE.CylinderGeometry(cr, cr * 1.1, 0.22, 16), 0, y, 0), V.roofTile, true))
    }
    parts.push(part(at(new THREE.SphereGeometry(0.2, 10, 8), 0, h + 1.45, 0), V.roofRidge, true))
    return { parts, height: h + 1.6, footprint: r * 1.6, label: 'Village tower' }
  },

  /** The dojo: long, low, one enormous roof, a veranda down the whole front. */
  dojo(rand) {
    const w = 4.2
    const d = 2.6
    const h = 1.8
    const parts = [
      ...framedWall(w, h, d, { color: V.plaster }),
      ...roofOn(tiledRoof(w, d, 1.0, { overhang: 0.7, courses: 8 }), h),
    ]
    parts.push(...veranda(w, 1.0, 0.46, { posts: 5 }).map((p) => (p.geo.translate(0, 0, d / 2 + 0.4), p)))
    // Sliding screens along the front, which is what a dojo has instead of a wall.
    for (let i = 0; i < 4; i++) {
      const x = (i / 3 - 0.5) * (w - 0.6)
      parts.push(part(at(box(w / 4.6, h * 0.8, 0.07), x, h * 0.45, d / 2 + 0.02), V.paper))
    }
    return {
      parts,
      height: h + 1.5,
      footprint: Math.max(w, d) * 0.5 + 0.5,
      label: 'Dojo',
      room: { w, d, h, y: 0, door: d / 2 },
    }
  },

  /** A pagoda: the same roof three times, each smaller. Pure vertical punctuation. */
  pagoda(rand) {
    const tiers = 3
    const parts = []
    let y = 0
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers
      const w = 2.4 - t * 0.9
      const storey = 1.15
      parts.push(...framedWall(w, storey, w, { color: V.plasterWarm, posts: true }).map((p) => (p.geo.translate(0, y, 0), p)))
      // Only the topmost tier's roof lifts; the ones below are structural, and lifting all
      // three would take the building apart rather than open it.
      const roof = tiledRoof(w, w, 0.46, { overhang: 0.5, courses: 5 })
      for (const p of roof) p.geo.translate(0, y + storey, 0)
      if (i === tiers - 1) asRoof(roof)
      parts.push(...roof)
      y += storey + 0.5
    }
    parts.push(part(at(new THREE.CylinderGeometry(0.06, 0.08, 0.9, 6), 0, y + 0.35, 0), V.roofRidge))
    return { parts, height: y + 0.9, footprint: 1.7, label: 'Pagoda' }
  },

  /** The kura: a white plaster storehouse with heavy black eaves and almost no windows. */
  kura(rand) {
    const w = 2.2
    const d = 2.0
    const h = 2.4
    const parts = [
      ...framedWall(w, h, d, { color: V.plaster, posts: false }),
      ...roofOn(tiledRoof(w, d, 0.66, { overhang: 0.34, gable: true }), h),
    ]
    // The black skirt round the base and the single heavy door.
    parts.push(part(at(box(w + 0.14, 0.55, d + 0.14), 0, 0.27, 0), V.timberDark))
    parts.push(part(at(box(0.9, 1.2, 0.1), 0, 0.75, d / 2 + 0.04), V.timberDark))
    return {
      parts,
      height: h + 1.0,
      footprint: Math.max(w, d) * 0.5 + 0.3,
      label: 'Storehouse',
      room: { w, d, h, y: 0, door: d / 2 },
    }
  },

  /** A teahouse: small, with a veranda, lanterns and a lot of paper. */
  teahouse(rand) {
    const w = 2.0
    const d = 1.8
    const h = 1.5
    const parts = [
      ...framedWall(w, h, d, { color: V.plasterWarm }),
      ...roofOn(tiledRoof(w, d, 0.66, { overhang: 0.52 }), h),
    ]
    parts.push(...veranda(w * 1.1, 0.9, 0.4, { posts: 3 }).map((p) => (p.geo.translate(0, 0, d / 2 + 0.35), p)))
    for (const sx of [-1, 1]) {
      parts.push(part(at(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 10), sx * w * 0.42, h * 0.88, d / 2 + 0.5), V.paper))
    }
    parts.push(...noren(0.9, 0.55, 0, h * 0.72, d / 2 + 0.03, V.green))
    return {
      parts,
      height: h + 1.1,
      footprint: Math.max(w, d) * 0.5 + 0.45,
      label: 'Teahouse',
      room: { w, d, h, y: 0, door: d / 2 },
    }
  },

  /**
   * A narrow concrete block, three or four storeys, with a vertical sign down one side.
   * The Neo-Akihabara workhorse: what a street of these gives you is a skyline.
   */
  blockTower(rand) {
    const w = 1.9 + rand() * 0.4
    const d = 1.8 + rand() * 0.4
    const storeys = 3 + Math.floor(rand() * 2)
    const storey = 1.05
    const h = storeys * storey
    const parts = [part(at(box(w, h, d), 0, h / 2, 0), V.plaster)]

    // A window band per storey. Painted `paper`, which is the colour the building shader
    // lights from within after dark — so a tower is dark by day and a grid of lit windows
    // at night, without a second material or a single extra draw call.
    for (let i = 0; i < storeys; i++) {
      const y = i * storey + storey * 0.62
      parts.push(part(at(box(w * 1.01, 0.4, d * 0.86), 0, y, 0), V.paper))
      parts.push(part(at(box(w * 0.86, 0.4, d * 1.01), 0, y, 0), V.paper))
      // The floor slab between storeys, which is what stops it reading as one striped box.
      parts.push(part(at(box(w * 1.06, 0.1, d * 1.06), 0, i * storey, 0), V.timberDark))
    }

    // Parapet and roof clutter — the water tank and the aircon that every one of these has.
    parts.push(part(at(box(w * 1.06, 0.26, d * 1.06), 0, h + 0.1, 0), V.timberDark))
    parts.push(part(at(box(0.5, 0.4, 0.5), w * 0.2, h + 0.4, -d * 0.2), V.stone))
    if (rand() > 0.5) parts.push(part(at(box(0.34, 0.3, 0.34), -w * 0.24, h + 0.36, d * 0.18), V.stone))

    // The vertical sign, in the zone's own colour.
    parts.push(part(at(box(0.16, h * 0.62, 0.5), w / 2 + 0.06, h * 0.55, d * 0.2), V.cloth))
    return { parts, height: h + 0.7, footprint: Math.max(w, d) * 0.5 + 0.35, label: 'Block' }
  },

  /** Low, wide, and mostly signage. The arcade or the ramen place under the tracks. */
  arcade(rand) {
    const w = 3.2 + rand() * 0.5
    const d = 2.0
    const h = 1.9
    const parts = [part(at(box(w, h, d), 0, h / 2, 0), V.plaster)]
    // The shopfront: one long lit window across the whole frontage.
    parts.push(part(at(box(w * 0.92, 0.9, 0.12), 0, h * 0.45, d / 2 + 0.02), V.paper))
    // A horizontal sign board above it, and a smaller one hanging off the end.
    parts.push(part(at(box(w * 1.02, 0.62, 0.18), 0, h * 0.92, d / 2 + 0.08), V.cloth))
    parts.push(part(at(box(0.18, 0.9, 0.62), w / 2 + 0.06, h * 0.62, d * 0.1), V.cloth))
    // Flat roof, parapet, and a duct.
    parts.push(part(at(box(w * 1.04, 0.2, d * 1.04), 0, h + 0.08, 0), V.timberDark))
    parts.push(part(at(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 10), w * 0.22, h + 0.4, 0), V.stone))
    return { parts, height: h + 0.75, footprint: Math.max(w, d) * 0.5 + 0.4, label: 'Arcade' }
  },

  /**
   * A stone cottage under a steep terracotta roof. The seaside-town silhouette: no eaves to
   * speak of, a chimney, and a gable facing the street.
   */
  cottage(rand) {
    const w = 2.3 + rand() * 0.5
    const d = 2.4 + rand() * 0.4
    const h = 1.9 + rand() * 0.4
    const parts = [...framedWall(w, h, d, { color: V.plaster, posts: false })]
    // Steep and gabled, with almost no overhang — the opposite of the tiled roof next door,
    // and the difference is most of why the two worlds do not look like each other.
    parts.push(...roofOn(tiledRoof(w, d, 1.5, { overhang: 0.16, gable: true, courses: 8 }), h))
    parts.push(part(at(box(0.5, 1.5, 0.5), w * 0.28, h + 0.9, -d * 0.2), V.stone))
    parts.push(part(at(box(0.62, 0.16, 0.62), w * 0.28, h + 1.68, -d * 0.2), V.timberDark))
    // Shutters either side of a lit window.
    parts.push(part(at(box(0.62, 0.7, 0.1), 0, h * 0.6, d / 2 + 0.03), V.paper))
    for (const sx of [-1, 1]) {
      parts.push(part(at(box(0.18, 0.74, 0.09), sx * 0.44, h * 0.6, d / 2 + 0.05), V.cloth))
    }
    return {
      parts,
      height: h + 1.8,
      footprint: Math.max(w, d) * 0.5 + 0.3,
      label: 'Cottage',
      room: { w, d, h, y: 0, door: d / 2 },
    }
  },

  /** A small shrine, with its own torii on the approach. */
  shrine(rand) {
    const w = 1.7
    const d = 1.6
    const h = 1.3
    // The shrine body sits half a metre off the ground on posts, so its roof goes up with
    // it — and the body is built once, here, rather than twice as it was before.
    const parts = [
      ...raise(framedWall(w, h, d, { color: V.cloth, posts: false }), 0.5),
      ...roofOn(tiledRoof(w, d, 0.7, { overhang: 0.56, courses: 6, color: V.roofTileWarm }), h + 0.5),
    ]
    // Shrines stand up off the ground on posts, always.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(part(at(box(0.14, 0.5, 0.14), sx * (w / 2 - 0.15), 0.25, sz * (d / 2 - 0.15)), V.timberDark))
      }
    }
    // Steps, and the little torii in front of them.
    parts.push(part(at(box(w * 0.6, 0.16, 0.5), 0, 0.42, d / 2 + 0.24), V.stone))
    const span = 0.62
    for (const sx of [-1, 1]) {
      parts.push(part(at(new THREE.CylinderGeometry(0.07, 0.08, 1.5, 8), sx * span, 0.75, d / 2 + 1.0), V.cloth))
    }
    parts.push(part(at(box(span * 2 + 0.32, 0.09, 0.12), 0, 1.28, d / 2 + 1.0), V.cloth))
    parts.push(part(at(box(span * 2 + 0.6, 0.12, 0.2), 0, 1.5, d / 2 + 1.0), V.timberDark))
    return {
      parts,
      height: h + 1.8,
      footprint: Math.max(w, d) * 0.5 + 0.7,
      label: 'Shrine',
      // A shrine stands half a metre up on its posts, so its floor — and its furniture — go
      // up with it.
      room: { w, d, h, y: 0.5, door: d / 2 },
    }
  },
}

export const VILLAGE_KIND_IDS = Object.keys(VILLAGE_KINDS)

/**
 * What is inside.
 *
 * One room, and everything in it means something about the thread that lives there. This is
 * the same rule the rest of the project runs on — nothing decorative that could be mistaken
 * for data — applied to furniture:
 *
 * - The **stack of scrolls** is as tall as the transcript is long. A thread you have talked
 *   to for a week has a pile up the wall; one from this morning has two on the desk.
 * - The **desk lamp** is lit only while the thread is actually running.
 * - The **wall scroll** carries the zone's colour, so you can tell whose house you are in
 *   from the inside.
 *
 * It is built in the same local space as the shell, so it needs no placement of its own —
 * and it is a separate mesh from the building because it is hidden until the roof comes off,
 * and a hidden mesh costs nothing while a hidden set of triangles inside a visible mesh
 * costs everything.
 */
export function buildInterior(w, d, h, { fill = 0.6 } = {}) {
  const parts = []
  /**
   * The room matches the house, and that is the right answer.
   *
   * It was briefly built larger than the shell — the standard "bigger on the inside" trick,
   * on the theory that a two-unit room is a cupboard. That fails here for a reason specific
   * to this world: the shell is *solid and visible from outside*, and a room larger than it
   * puts the player beyond the shell's walls while nominally indoors, so you stand in a
   * field looking at the little house you are supposedly inside.
   *
   * And the premise was wrong anyway. A character is about 1.25 units tall, so a unit is
   * roughly a metre and a half; a 2.2-unit room is three metres across, which is a small
   * room rather than a cupboard. What made the first attempt unreadable was not the size,
   * it was that the shell's single-sided walls are invisible from within — so the room
   * brings its own, below.
   */
  const iw = w - 0.24
  const id = d - 0.24

  /**
   * Inner wall faces, and the reason they exist.
   *
   * The building shell is drawn single-sided — it has to be, because these are stacks of
   * closed boxes and a floor sharing a plane with the ceiling below it z-fights horribly
   * when both halves rasterise. The consequence only appears once you can get inside: from
   * in here every back face is culled, so the walls are simply *not there* and you stand in
   * a roofless open-sided box looking out at the village through where the house should be.
   *
   * Rather than make the whole shell double-sided and take the z-fighting back, the room
   * brings its own walls — thin panels a hair inside the shell's, on the interior mesh,
   * which is double-sided already because half of what is in a room faces away from you.
   *
   * The front wall is two panels with a gap between them: that gap is the doorway, and
   * being able to see out of it is most of what stops a room feeling like a box.
   */
  const wallH = h - 0.1
  const inner = (wd, ht, dp, x, y, z) => parts.push(part(at(box(wd, ht, dp), x, y, z), V.plasterWarm))
  inner(iw, wallH, 0.06, 0, wallH / 2, -id / 2) // back
  for (const sx of [-1, 1]) inner(0.06, wallH, id, sx * (iw / 2), wallH / 2, 0) // sides
  /**
   * No front wall. This is the cutaway, and it is the whole reason you can see in.
   *
   * A doll's house has three walls, and so does this: a fourth one is exactly what stands
   * between the camera and the room. The first version built it — with a doorway gap in the
   * middle — and because the interior is drawn double-sided, that wall was visible *from
   * outside* and filled the frame with plaster the moment you opened the building.
   *
   * The shell's own front wall is dealt with separately, in the building shader: everything
   * that is not roof stops drawing once the lid is off, so what is left standing is this
   * room and the roof floating above it.
   */
  const sill = 0.14
  inner(iw, sill, 0.06, 0, sill / 2, id / 2)

  // Floor: tatami, laid in strips the way it actually is.
  const mats = 3
  for (let i = 0; i < mats; i++) {
    const z = (i / (mats - 1) - 0.5) * (id - 0.2)
    parts.push(part(at(box(iw - 0.1, 0.06, id / mats - 0.08), 0, 0.06, z), V.green))
  }
  // A dark border round the mats, which is what makes them read as tatami and not as lawn.
  parts.push(part(at(box(iw, 0.05, id), 0, 0.04, 0), V.timberDark))

  // The low table, and a cushion behind it.
  parts.push(part(at(box(iw * 0.42, 0.07, id * 0.3), 0, 0.36, -id * 0.08), V.timber))
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(
        part(at(box(0.07, 0.32, 0.07), sx * iw * 0.17, 0.17, -id * 0.08 + sz * id * 0.11), V.timberDark)
      )
    }
  }
  parts.push(part(at(box(0.42, 0.1, 0.42), 0, 0.11, -id * 0.32), V.cloth))

  /**
   * The scroll stack. Its height is the thread's transcript on the same log scale the rest
   * of the app uses, so a long conversation is physically a tall pile — the one piece of
   * furniture here that is a reading rather than a prop.
   */
  const scrolls = Math.max(1, Math.round(fill * 9))
  for (let i = 0; i < scrolls; i++) {
    const y = 0.12 + i * 0.075
    const sc = new THREE.CylinderGeometry(0.055, 0.055, iw * 0.3, 8)
    sc.rotateZ(Math.PI / 2)
    parts.push(part(at(sc, iw * 0.26, y, id * 0.26 - (i % 2) * 0.05), V.paper))
  }

  // A shelf on the back wall, and the wall scroll above the table.
  parts.push(part(at(box(iw * 0.7, 0.06, 0.2), 0, h * 0.62, -id / 2 + 0.12), V.timber))
  parts.push(part(at(box(iw * 0.34, h * 0.4, 0.05), -iw * 0.2, h * 0.5, -id / 2 + 0.06), V.cloth))

  // The lamp on the desk. `paper` is what the building shader lights from within, so this
  // glows exactly when the rest of the thread's windows do.
  parts.push(part(at(new THREE.CylinderGeometry(0.1, 0.12, 0.22, 10), iw * 0.3, 0.47, -id * 0.2), V.paper))
  parts.push(part(at(box(0.05, 0.3, 0.05), iw * 0.3, 0.3, -id * 0.2), V.timberDark))

  return parts
}

/**
 * What the buildings are made of, per world.
 *
 * Every part in this file is painted with one of a dozen named colours from `V`, and that
 * turns out to be the whole mechanism: a style is a *remap* of those names plus a list of
 * which building kinds the world is allowed to use. Six worlds of architecture therefore
 * cost six palettes and six lists rather than six sets of models, and a seventh is a data
 * change — which is the same bargain the world presets themselves make.
 *
 * The kind list does more work than the palette. Recolouring alone gives you the same
 * village in different paint; it is swapping a pagoda for a concrete block, or a deep-eaved
 * hip roof for a steep gable with no overhang, that makes two worlds read as two places.
 */
export const VILLAGE_STYLES = {
  /** Hanami Hills: the reference village. White plaster, slate tiles, vermilion. */
  sakura: {
    kinds: ['house', 'house', 'shop', 'teahouse', 'kura', 'dojo', 'pagoda', 'shrine', 'tower'],
    palette: {},
  },

  /** Summer Festival: warmer timber, red-brown tiles, everything a shade more lived-in. */
  festival: {
    kinds: ['house', 'shop', 'shop', 'teahouse', 'dojo', 'shrine', 'kura', 'tower'],
    palette: {
      [V.plaster]: 0xf0e2c8,
      [V.plasterWarm]: 0xe4cda4,
      [V.roofTile]: 0x6b4a3a,
      [V.roofRidge]: 0x4a3226,
      [V.timber]: 0x8a5a34,
    },
  },

  /** The Spirit Realm: weathered, mossy, verdigris. Old wood and older stone. */
  spirit: {
    kinds: ['shrine', 'shrine', 'pagoda', 'teahouse', 'kura', 'house', 'tower'],
    palette: {
      [V.plaster]: 0xcfd8cc,
      [V.plasterWarm]: 0xb4c4b8,
      [V.roofTile]: 0x2f5a56,
      [V.roofTileWarm]: 0x3a6b60,
      [V.roofRidge]: 0x1f3f3d,
      [V.timber]: 0x4a4034,
      [V.timberDark]: 0x2b2620,
      [V.paper]: 0xd8fff0,
    },
  },

  /** Neo-Akihabara: concrete, black parapets, and signage that lights the street. */
  neon: {
    kinds: ['blockTower', 'blockTower', 'arcade', 'arcade', 'shop', 'kura', 'tower'],
    palette: {
      [V.plaster]: 0x3f4048,
      [V.plasterWarm]: 0x34353d,
      [V.roofTile]: 0x24252c,
      [V.roofRidge]: 0x17181d,
      [V.timber]: 0x4a4a54,
      [V.timberDark]: 0x1c1d22,
      [V.stone]: 0x5a5b66,
      // The window and sign colour, which the building shader lights after dark. Cyan
      // rather than candle-warm, because that is what is actually behind the glass here.
      [V.paper]: 0x7fe8ff,
    },
  },

  /** Skyward Isles: white stucco under terracotta, steep and chimneyed. */
  skyward: {
    kinds: ['cottage', 'cottage', 'house', 'shop', 'kura', 'tower', 'teahouse'],
    palette: {
      [V.plaster]: 0xf4efe4,
      [V.plasterWarm]: 0xe8dcc4,
      [V.roofTile]: 0xb35a3a,
      [V.roofTileWarm]: 0xc46b44,
      [V.roofRidge]: 0x8a412a,
      [V.timber]: 0x7a6248,
      [V.stone]: 0xbfb5a4,
    },
  },

  /** The Winter Arc: dark stained timber under snow. */
  winter: {
    kinds: ['house', 'cottage', 'kura', 'dojo', 'teahouse', 'tower', 'shrine'],
    palette: {
      [V.plaster]: 0xdfe6ee,
      [V.plasterWarm]: 0xc6d2de,
      // Snow on the roof rather than tile: the ridge stays dark so the roof still has a
      // line, which is what keeps a white roof from reading as a missing texture.
      [V.roofTile]: 0xf2f7fc,
      [V.roofTileWarm]: 0xe4ecf4,
      [V.roofRidge]: 0x3f4a56,
      [V.timber]: 0x4a3a30,
      [V.timberDark]: 0x2b221c,
      [V.stone]: 0x9aa6b4,
    },
  },
}

/** Which kinds a world may build. Falls back to the whole catalogue for an unknown world. */
export function kindsForStyle(styleId) {
  return VILLAGE_STYLES[styleId]?.kinds || VILLAGE_KIND_IDS
}

/**
 * Build one, merged into a single vertex-coloured geometry.
 *
 * The accent — the repo's own colour — is painted onto whatever was `V.cloth`, so every
 * building on a zone carries that zone's colour on its curtains and its shrine posts
 * without any of them being repainted wholesale. That is deliberately a small surface: the
 * street has to read as one village, and a zone whose houses were entirely magenta would
 * read as a different world rather than a different neighbourhood.
 */
export function buildVillage(kind, rand, accent, styleId = 'sakura', { fill = 0.6 } = {}) {
  const make = VILLAGE_KINDS[kind] || VILLAGE_KINDS.house
  const { parts, height, footprint, label, room } = make(rand)

  const palette = VILLAGE_STYLES[styleId]?.palette || {}
  /**
   * The zone's colour, as *dyed cloth* rather than as the colour itself.
   *
   * `V.cloth` is every curtain, banner, awning valance and shrine post in the village, and
   * mapping it to the raw accent meant a zone whose palette entry happened to be magenta had
   * a magenta stripe along the front of every building on it. From the street that reads as
   * neon trim — the single most science-fiction thing left in the world, arriving by the back
   * door through a colour table.
   *
   * Two thirds of the way from a warm cloth red toward the accent keeps every zone
   * distinguishable while keeping all of them made of fabric.
   */
  const accentColor = new THREE.Color(0xc4442e).lerp(new THREE.Color(accent), 0.62)
  const bake = (list, isRoom = false) => list.map(({ geo, color, roof }) => {
    const g = geo.index ? geo.toNonIndexed() : geo
    const count = g.attributes.position.count
    // `cloth` is always the zone's own colour; everything else goes through the world's
    // palette first, and keeps its authored colour where the world has no opinion.
    const c = color === V.cloth ? accentColor : new THREE.Color(palette[color] ?? color)
    // Surface properties still key off the *authored* colour, not the remapped one: a wall
    // is matte plaster whether the world paints it cream or concrete grey.
    const [rough, metal] = V_SURFACE.get(color) || [0.8, 0.0]
    const cols = new Float32Array(count * 3)
    const surf = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      cols[i * 3] = c.r
      cols[i * 3 + 1] = c.g
      cols[i * 3 + 2] = c.b
      surf[i * 2] = rough
      surf[i * 2 + 1] = metal
    }
    /**
     * What this vertex belongs to: 0 the shell's walls, 1 the roof, 2 the room inside.
     *
     * Three values rather than a boolean because the shader has three different things to
     * do with them — walls stand down when the building opens, the roof lifts off, and the
     * room must do neither. A plain roof flag was not enough and failed silently: the
     * interior shares this material, so a rule written as "discard anything that is not
     * roof" deleted the very room it was written to reveal.
     */
    const flags = new Float32Array(count)
    if (roof) flags.fill(1)
    else if (isRoom) flags.fill(2)
    const out = new THREE.BufferGeometry()
    out.setAttribute('position', g.attributes.position)
    out.setAttribute('normal', g.attributes.normal)
    out.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    out.setAttribute('aSurface', new THREE.BufferAttribute(surf, 2))
    out.setAttribute('aRoof', new THREE.BufferAttribute(flags, 1))
    return out
  })

  const shell = bake(parts)
  const merged = BufferGeometryUtils.mergeGeometries(shell, false)
  shell.forEach((g) => g.dispose())
  parts.forEach(({ geo }) => geo.dispose())

  // The room, if this kind has one worth standing in. Built to the walls the generator
  // reported rather than to the mesh, so the furniture never ends up outside the house.
  let interior = null
  if (room) {
    const inside = buildInterior(room.w, room.d, room.h, { fill })
    const baked = bake(inside, true)
    interior = BufferGeometryUtils.mergeGeometries(baked, false)
    baked.forEach((g) => g.dispose())
    inside.forEach(({ geo }) => geo.dispose())
    // Lifted to the floor level the generator gave, so a shrine on posts is furnished at
    // the top of its steps rather than in the dirt under them.
    interior.translate(0, room.y || 0, 0)
  }

  return { geometry: merged, interior, height, footprint, label, door: room?.door || null }
}
