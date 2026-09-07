import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { DECK_TEXTURE_SCALE, KERB_UV, applyGrain, deckSurface, kerbSurface } from './surfaces.js'
import { buildFestivalProp, glowMaterial, mergeProps, propMaterial } from './festival-props.js'
import { buildVillage, kindsForStyle } from './village.js'
import { buildingUniforms } from './buildings.js'
import { atlasTexture, hasPart, part } from './kit.js'
import { mulberry } from './planet.js'

/**
 * Project plots — the fenced-off sections of the map, one per repo.
 *
 * Plots sit on a hexagonal lattice, and a project claims **as many cells as it has threads
 * to house**: a repo with forty sessions sprawls across six tiles, a one-off gets a single
 * tile. The cells tile exactly, so a multi-cell plot reads as one continuous zone, and the
 * accent border is drawn only on the edges that actually face something else — internal
 * seams between a project's own cells get no border at all.
 *
 * Cells are handed out in a spiral from the middle, biggest project first, so the busiest
 * repo lands where you are already looking and quiet ones ring the edge.
 */

/**
 * Scenery is built a little smaller than the buildings that mean something.
 *
 * Not so much that it reads as a different town — it is the same architecture — but enough
 * that the main street stays the tallest thing in the city and the eye goes there first.
 * The buildings that carry data should dominate the skyline they are part of.
 */
/**
 * How big a scenery building is next to a thread's own.
 *
 * Two thirds used to be right when the back streets stood *behind* the real ones and had to
 * stay visibly lesser. On a street grid they line the same roads you walk down, and a
 * half-height terrace beside a full-height house reads as a model village. Near enough to
 * full size that the street wall is continuous; the height variation in `_buildDistricts` is
 * what keeps the roofline from being flat.
 */
const SCENERY_SCALE = 0.95

/**
 * One material for every scenery building in the colony.
 *
 * Vertex-coloured and surface-mapped exactly like the real thing, minus everything to do
 * with progress and opening — scenery never rises out of the ground and never has its roof
 * taken off. It keeps only the paper-glow, so a back street lights up at night along with
 * the front one.
 */
function sceneryMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0,
    side: THREE.FrontSide,
  })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = buildingUniforms.uNight
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n attribute vec2 aSurface;\n varying vec2 vSurface;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n vSurface = aSurface;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n varying vec2 vSurface;\n uniform float uNight;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurface.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurface.y;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float paper = smoothstep( 0.72, 0.9, dot( diffuseColor.rgb, vec3( 0.32, 0.34, 0.2 ) ) );
         totalEmissiveRadiance += diffuseColor.rgb * paper * uNight * 0.9;`
      )
    // Something on the plaster. Applied last, and on its own line: it rewrites both shaders
    // in place and returns nothing, so it cannot sit inside the chain above.
    applyGrain(shader)
  }
  return mat
}

export const PLOT_PALETTE = [
  0xc96442, 0x4f9a63, 0x4f7ec9, 0xb8942a, 0x8b5cc9, 0xc94f8b,
  0x3fa8a0, 0xc97f4f, 0x6f8f4f, 0x5c7fc9, 0xc95c5c, 0x7f6fc9,
]

/**
 * The lattice, and the deck that sits in the middle of a lattice cell.
 *
 * These used to be the same number: cells tiled exactly, so every zone shared an edge with
 * its neighbours and the colony was one continuous floor. That is the right answer when you
 * are looking *down* at it — no wasted space, every zone adjacent to the map — and the wrong
 * one the moment you are walking, because arriving somewhere means nothing when you were
 * already there. A repo should be a place you go to.
 *
 * So the lattice is now half again as wide as the deck that stands in it. The layout rule,
 * the hit-testing and the spiral all still work on the lattice exactly as before; the only
 * change is that there is now forty per cent more ground than deck, and that ground is
 * where the trees, the paths and the walk between zones live.
 */
/**
 * How far apart two lattice cells sit.
 *
 * Tripled, and the reason is a measurement rather than a taste. A character stands 1.23
 * units tall, so one unit is about 1.4 metres -- which made the old eleven-unit deck a town
 * *sixteen metres across*. Sixteen metres is a tennis court. Nothing that can be done with
 * architecture, density or lighting makes a tennis court read as a city, and every earlier
 * attempt at "bigger" was spent adding detail to something whose real problem was that you
 * could cross it in nine paces.
 *
 * At this size one cell is ninety metres of frontage -- a district, four blocks deep, with
 * streets you lose sight of the end of. Everything else in this file is measured off it, so
 * the tile, the copse, the kerb and the lamps all grew with it.
 *
 * The cell is only a little wider than the deck it holds (40 against 33), which leaves about
 * twelve units of green between one district and the next. That gap is deliberately small.
 * Districts this size laid out on a roomier lattice put the far side of the colony five
 * hundred units away -- two and a half minutes of walking -- and the ground between them was
 * empty, so the size read as distance rather than as city. Packed this close the colony is
 * one conurbation with parkland between its quarters, and you cross from one to the next the
 * way you cross a street.
 */
const CELL = 40.0
/** Exported for hit-testing: on a hex lattice the nearest cell centre *is* the containing cell. */
export const PLOT_CELL = CELL
/**
 * The deck itself, in absolute units rather than a share of the cell — it has to keep fitting
 * seven building slots and their clutter, and that requirement did not change when the
 * lattice opened up.
 */
const TILE = 33.0
/** Exported so the ground can tell a deck's edge from its cell's. */
export const PLOT_TILE = TILE
/**
 * Top face of a plot's tile slab — the surface everything on a plot stands on, and the one
 * height every prop, building, kerb and pair of boots on a plot is measured from.
 *
 * It has to clear the ground it is laid on. Inside the colony the terrain is gentle but not
 * flat: it runs from about -0.3 to +0.24 on the Moon and half again as far on Mars, so the
 * old 0.22 put the top face *level with the high patches* — decks read as sunken, props sat
 * in the ground up to their waists, and every surface that met the terrain tore. This stands
 * the slab proud of the roughest ground any plot can be dealt.
 */
export const DECK_TOP = 0.45
/**
 * How far the slab's underside reaches below y=0.
 *
 * The prism used to stop dead at zero, and zero is *above* the ground over most of a plot:
 * the colony floor bottoms out near -0.36 on the roughest planet, so about three fifths of
 * every plot's edge had open air under it. At the camera's shallowest tilt — six degrees off
 * the horizon — you could see straight through that gap, and even at the resting isometric
 * angle it read as a slab hovering a hand's width off the dirt.
 *
 * Buried by definition, so it only has to reach past the lowest ground a plot can be dealt;
 * it is never the surface anything is measured from. That is still `DECK_TOP`.
 */
/**
 * How far the slab reaches below its own top face.
 *
 * Deep, now that the ground rolls. A town sits at the height of its own centre and the
 * terrain under the rest of it can fall away by several units before the deck's edge is
 * reached — so the skirt has to be tall enough to meet the ground everywhere underneath, or
 * a town on a slope is a platform hovering over a hillside with daylight beneath it.
 */
const DECK_SKIRT = 7
/** The whole prism: the rim you can see, plus the skirt buried under it. */
const DECK_HEIGHT = DECK_TOP + DECK_SKIRT
/**
 * Thread slots per cell: eight a side down the main avenue.
 *
 * A district holds far more building than it holds *meaning* -- there are only ever as many
 * real buildings as you have conversations open. Sixteen is what fits down one avenue at a
 * readable spacing, and it is deliberately the number that decides how many cells a repo is
 * given: a repo with forty threads gets three districts rather than one impossible street.
 */
const SLOTS_PER_CELL = 16
/**
 * The city block, and everything measured off it.
 *
 * A district is a **grid of blocks**, not a row of houses, and that single change is what
 * separates a village from a city. Buildings ring the outside of each block facing the
 * street, so from the ground you never see a building standing on its own -- you see a
 * continuous wall of frontage with roofs stepping away behind it, and a junction every
 * twenty metres where the view opens down a cross street. The middle of a block is a yard
 * you cannot get into, which costs nothing and is why real cities have depth.
 *
 * Block centres sit at half-pitch offsets, so the *streets* land on the axes rather than
 * the blocks: there is always an avenue straight through the middle of a district, and it
 * is that avenue the thread buildings stand on.
 */
const BLOCK = 14.0
/** How far a block's frontage stands from the block's own centre. */
const BLOCK_INSET = 3.6
/** Spacing along a frontage -- close enough that a row reads as terraced. */
const FRONT_SPACING = 3.2
/** Frontages per block edge. */
const FRONT_COUNT = 3
/** How wide the streets are paved, and the avenue through the middle. */
const STREET_WIDTH = 4.6
const AVENUE_WIDTH = 6.2
/** Where the thread buildings stand: either side of the avenue, facing across it. */
const STREET_HALF = BLOCK * 0.5 - BLOCK_INSET
const ROW_SPACING = FRONT_SPACING
/** A position on a frontage, rounded to a tenth, so two builders can agree on one. */
const fkey = (x, z) => `${Math.round(x * 10)}:${Math.round(z * 10)}`
/**
 * The back streets.
 *
 * How far from the camera a district stops being built out of buildings.
 *
 * Past this, the whole district is swapped for a single merged mesh of boxes and pitched
 * roofs — a skyline, about a twentieth of the triangles. This is the price of the size: a
 * hundred and twenty buildings a district is affordable for the one you are standing in and
 * ruinous for the eight you can see from it, and culling does not help, because from open
 * ground they are all genuinely on screen.
 *
 * Set just above the lattice spacing rather than well beyond it. At 118 a district could see
 * six neighbours in full detail, which on a lattice where neighbours sit 69 units apart is
 * most of the colony at once. Just over one cell means the district you are in is real, the
 * ring around it is roofline, and a place resolves as you walk into it — which is the right
 * bargain, because arriving is exactly when the detail starts being worth paying for.
 */
/** How far along the cross street from the crossroads the district's festival stall stands. */
const STALL_OFFSET = 6.5
const FAR_DETAIL = 78
/** Hysteresis on the swap, so a district does not flicker between tiers as you walk. */
const DETAIL_SLACK = 12
const MAX_CELLS = 9
/** The lattice cell the ship owns. Nothing else may be placed there. */
const SHIP_CELL = { q: -2, r: 1 }

const HEX_DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
]

/**
 * Edge j of a flat-top hexagon runs between the corners at 60j° and 60(j+1)°, so its
 * midpoint faces 60j+30°. This maps that edge to the neighbour sitting across it.
 */
const EDGE_TO_DIR = [0, 5, 4, 3, 2, 1]

const key = (q, r) => `${q},${r}`
const ORIGIN = { q: 0, r: 0 }

/** Flat-top axial hex → world. */
function hexToWorld(q, r, size = CELL) {
  return { x: size * 1.5 * q, z: size * Math.sqrt(3) * (r + q / 2) }
}

/**
 * The inverse: which cell a world point falls in. Exact rather than nearest-centre, because
 * it decides whether something is standing on a plot's raised deck or on bare ground, and a
 * radius test would put an astronaut on a deck it is not actually over.
 */
export function worldToHex(x, z, size = CELL) {
  const q = x / (size * 1.5)
  const r = z / (size * Math.sqrt(3)) - q / 2
  return cubeRound(q, r)
}

/** Round fractional axial coordinates to the cell that actually contains the point. */
function cubeRound(q, r) {
  const y = -q - r
  let rq = Math.round(q)
  let rr = Math.round(r)
  const ry = Math.round(y)
  const dq = Math.abs(rq - q)
  const dr = Math.abs(rr - r)
  const dy = Math.abs(ry - y)
  // Whichever axis drifted furthest is the one recomputed from the other two.
  if (dq > dr && dq > dy) rq = -rr - ry
  else if (dr > dy) rr = -rq - ry
  return { q: rq, r: rr }
}

function hexRing(radius) {
  if (radius === 0) return [{ q: 0, r: 0 }]
  const out = []
  let q = HEX_DIRS[4][0] * radius
  let r = HEX_DIRS[4][1] * radius
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      out.push({ q, r })
      q += HEX_DIRS[i][0]
      r += HEX_DIRS[i][1]
    }
  }
  return out
}

const cellsNeeded = (threadCount) =>
  Math.max(1, Math.min(MAX_CELLS, Math.ceil(threadCount / SLOTS_PER_CELL)))

/** Hex distance in axial coordinates: the cube distance, halved. */
function hexDistance(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2
}

/**
 * Hand out cells to projects, keeping every zone exactly where it already is.
 *
 * This used to be a pure function of the size list, and that was the bug: one thread
 * appearing anywhere changed the order, the order decided the cells, and the whole colony
 * re-laid itself out. A zone you were watching could jump to the far side of the map
 * because a *different* repo gained a session, which makes the place impossible to learn.
 *
 * So the previous layout is an input. A zone that still needs the same number of cells
 * keeps precisely the cells it had; one that grew keeps them and claims neighbours; one
 * that shrank drops the cells it claimed most recently. Only a repo that has never been
 * placed is placed at all, and it takes the innermost cells still free — which is what
 * keeps the busy middle busy.
 *
 * Each list is ordered root-first and growth appends, so a shrink is a slice, and
 * grow-then-shrink puts a zone back in exactly the shape it started in.
 *
 * Contiguity still comes from a flood fill: slicing runs out of a hex spiral looks like it
 * would work and does not, because the last cell of one ring and the first of the next sit
 * on opposite sides of the colony.
 *
 * @param projects [{ id, size }], biggest first — the order only decides who gets the
 *   innermost seed among repos that are *new*.
 * @param previous Map of id → cells from the last pass (or a saved colony file).
 * @returns Map of id → cells.
 */
export function allocateCells(projects, previous = new Map()) {
  const reserved = key(SHIP_CELL.q, SHIP_CELL.r)
  const wanted = projects.map((p) => ({ id: p.id, want: cellsNeeded(p.size) }))
  const total = wanted.reduce((n, w) => n + w.want, 0)

  // Spiral order decides where a *new* project settles. The pool runs past what is needed
  // so there is always somewhere to grow into.
  const pool = []
  const free = new Set()
  // The pool has to reach every cell anybody *remembers*, not merely as far as today's
  // colony needs. Sized from `total` alone, a zone that has sat out at ring five for a week
  // finds its own cell missing from `free` the moment the colony shrinks, cannot reclaim
  // it, and is re-seeded in the middle — which is exactly the jump this function exists to
  // prevent, arriving by the back door.
  let farthest = 0
  for (const project of projects) {
    for (const cell of previous.get(project.id) || []) farthest = Math.max(farthest, hexDistance(cell, ORIGIN))
  }
  for (let ring = 0; (pool.length < total + 30 || ring <= farthest) && ring < 12; ring++) {
    for (const cell of hexRing(ring)) {
      const k = key(cell.q, cell.r)
      if (k === reserved) continue
      pool.push(cell)
      free.add(k)
    }
  }

  const held = new Map()
  for (const { id, want } of wanted) {
    const before = previous.get(id)
    if (!before || !before.length) continue
    // The root cell is the whole point — it is the zone's origin, and everything standing
    // on the zone is placed relative to it. A blob that loses its root has *moved*, so if
    // the root is gone this project is seeded afresh rather than quietly re-rooted onto
    // whichever of its old cells happens to still be free.
    if (!free.has(key(before[0].q, before[0].r))) continue
    const keep = []
    for (const cell of before) {
      if (keep.length >= want) break // shrunk: whatever it claimed last is what it gives up
      const k = key(cell.q, cell.r)
      if (!free.has(k)) continue // the ship's cell, or a duplicate in a hand-edited file
      free.delete(k)
      keep.push({ q: cell.q, r: cell.r })
    }
    if (keep.length) held.set(id, keep)
  }

  const out = new Map()
  // Anybody who was already here grows first, so a newcomer cannot take the cell a zone
  // was about to expand into while its own seed is still free.
  for (const { id, want } of wanted) {
    const cells = held.get(id)
    if (!cells) continue
    growBlob(cells, want, free)
    out.set(id, cells)
  }

  for (const { id, want } of wanted) {
    if (out.has(id)) continue
    const seed = pool.find((c) => free.has(key(c.q, c.r)))
    if (!seed) {
      out.set(id, [])
      continue
    }
    free.delete(key(seed.q, seed.r))
    const cells = [{ q: seed.q, r: seed.r }]
    growBlob(cells, want, free)
    out.set(id, cells)
  }
  return out
}

/** Claim free neighbours until the blob is big enough, hugging its root cell first. */
function growBlob(cells, want, free) {
  const root = cells[0]
  while (cells.length < want) {
    let best = null
    let bestScore = Infinity
    for (const c of cells) {
      for (const [dq, dr] of HEX_DIRS) {
        const n = { q: c.q + dq, r: c.r + dr }
        if (!free.has(key(n.q, n.r))) continue
        // Hug the root first, then the middle of the colony, so blobs come out compact.
        const score = hexDistance(n, root) * 100 + hexDistance(n, ORIGIN)
        if (score < bestScore) {
          bestScore = score
          best = n
        }
      }
    }
    if (!best) break // completely hemmed in by neighbours
    free.delete(key(best.q, best.r))
    cells.push(best)
  }
}

export const shipPosition = () => {
  const { x, z } = hexToWorld(SHIP_CELL.q, SHIP_CELL.r)
  return new THREE.Vector3(x, 0, z)
}

/**
 * Three builds a 6-sided cylinder with its first vertex on +Z, which puts its corners at
 * 30°, 90°, 150°… — a *pointy-top* hexagon. The lattice, the edge-to-neighbour mapping and
 * the border bars all assume a **flat-top** hexagon with corners at 0°, 60°, 120°… so every
 * hexagonal prism has to be turned by this much to agree with them. Without it the decks sit
 * a half-step out of phase and their corners poke through the borders.
 */
const HEX_PHASE = Math.PI / 6

/** How many times the deck plate repeats around a tile's rim, at the deck's own scale. */
const PERIMETER_REPEATS = (6 * TILE) / DECK_TEXTURE_SCALE

/**
 * Is this point on a flat-top hexagon of circumradius `r` centred at the origin?
 *
 * Exported because the answer decides what height the ground is. A deck used to be found by
 * asking which lattice *cell* a point fell in, which was close enough when the tile filled
 * most of its cell -- but a cell is now fifty units across and its deck thirty-three, so the
 * ring between them is seventeen units of open country that the old test called "town". You
 * would walk out of a city and keep walking at roof height over the fields.
 */
export function hexContains(x, z, r) {
  const dx = Math.abs(x)
  const dz = Math.abs(z)
  const apothem = r * 0.8660254
  if (dx > r || dz > apothem) return false
  return 0.8660254 * dx + 0.5 * dz <= apothem
}

/**
 * Half the chord a flat-top hexagon cuts out of the line x = c, and of the line z = c.
 *
 * Used to pave the street grid: a road laid the full width of the deck overhangs it at the
 * corners, and one laid short of it stops in the middle of a field.
 */
export function hexChordZ(c, r) {
  const a = Math.abs(c)
  if (a >= r) return 0
  return a <= r * 0.5 ? r * 0.8660254 : 1.7320508 * (r - a)
}

export function hexChordX(c, r) {
  const a = Math.abs(c)
  if (a >= r * 0.8660254) return 0
  return r - a / 1.7320508
}

/**
 * Give a geometry a flat vertex colour, so unrelated boxes can be merged into one mesh and
 * still be different colours. The skyline tier is one draw call for a whole district, which
 * is the entire point of it, and one draw call means one material.
 */
function tintGeometry(geo, color) {
  const n = geo.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r
    arr[i * 3 + 1] = color.g
    arr[i * 3 + 2] = color.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
}

/** Corner i of a flat-top hexagon, in plot-local coordinates. */
function corner(cx, cz, i, size) {
  const a = (Math.PI / 3) * i
  return [cx + size * Math.cos(a), cz + size * Math.sin(a)]
}

/** A flat-top hexagonal prism, phase-corrected. */
/**
 * Replace a geometry's UVs with a world-planar projection.
 *
 * A hex tile is a six-sided cylinder, and a cylinder's cap UVs are a disc — which turns a
 * tiling plate pattern into a medallion, one per tile. Projecting from XZ instead makes the
 * seams run straight across a whole plot, so seven cells read as one apron rather than seven
 * repeats. Upright faces get the rim treatment: the deck's edge is a shallow band next to
 * the plot it wraps, and a flat XZ projection smears it into streaks at exactly the grazing
 * angle it is seen from.
 *
 * `height` is the prism's own height, which is what the rim's texel density is set against.
 * It is not `DECK_TOP`: the slab reaches below the ground as well as above it, and a rim
 * scaled to only the part you can see would stretch the plate over the part you cannot.
 */
function planarUv(geo, scale, offsetX = 0, offsetZ = 0, height = DECK_TOP) {
  const pos = geo.attributes.position
  const nrm = geo.attributes.normal
  const src = geo.attributes.uv
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (Math.abs(nrm.getY(i)) > 0.5) {
      // Top and bottom: straight down, in world space, so the pattern runs across tiles.
      uv[i * 2] = (x + offsetX) / scale
      uv[i * 2 + 1] = (z + offsetZ) / scale
    } else {
      // The rim keeps the cylinder's own unwrap, only rescaled to world density.
      //
      // Two simpler ideas both fail here. A fixed horizontal axis like `x + z` is *constant*
      // along two of every six sides of a hexagon, which leaves those faces with no UV
      // gradient, a degenerate tangent, and — since three builds the normal-mapped shading
      // frame out of that — solid black. Arc length from `atan2` fixes the gradient but
      // introduces a seam: the face straddling ±π jumps a full turn in one step, crushing a
      // dozen repeats of the texture into one panel, which reads as fine stripes at the
      // corners and as mud once mipmapping averages them. The generated unwrap already
      // solves both, because it duplicates the vertices at the seam.
      uv[i * 2] = src.getX(i) * PERIMETER_REPEATS
      // The cylinder's own v runs 0 at the foot of the prism to 1 at its top, so scaling it
      // by the prism's real height is what keeps the plate at world density whatever the
      // slab's total depth. Lifted off zero so a rim this shallow samples the middle of a
      // plate rather than straddling the seam that runs along the texture's own edge.
      uv[i * 2 + 1] = 0.25 + src.getY(i) * (height / scale)
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/**
 * Point a kerb bar's upper face at the lit dash strip and every other face at plain colour.
 *
 * A box hands all six of its faces the same 0..1 UV square, so one strip drawn once is
 * stretched down the sides and across the ends as well. On a bar 14cm tall that squashes
 * the dark gaps between dashes into what reads as a solid black edge — most visible exactly
 * where two plots meet and six of those edges gather at a corner.
 */
function kerbUv(geo) {
  const nrm = geo.attributes.normal
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) {
    if (nrm.getY(i) > 0.5) {
      uv.setY(i, KERB_UV.top.v0 + uv.getY(i) * (KERB_UV.top.v1 - KERB_UV.top.v0))
    } else {
      uv.setXY(i, KERB_UV.side.u, KERB_UV.side.v)
    }
  }
  uv.needsUpdate = true
}

function hexPrism(radius, height) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 6)
  geo.rotateY(HEX_PHASE)
  return geo
}

// ── plot mesh ─────────────────────────────────────────────────────────────────────────

export class Plot {
  constructor({ id, name, index, cells, accent, foliage, style = 'sakura', sampleGround = null }) {
    this.id = id
    this.name = name
    this.index = index
    this.cells = cells
    this.accent = accent
    this.cellKeys = new Set(cells.map((c) => key(c.q, c.r)))

    // The plot's origin is its **root** tile — the one it was seeded on and never gives up
    // — rather than the centroid of whatever cells it holds this minute. A zone that gains
    // a tile must not drag its buildings, its crew and its name sideways: the root stays
    // exactly where it was and the new tile appears beside it.
    const origin = hexToWorld(cells[0].q, cells[0].r)
    let sx = 0
    let sz = 0
    this.localCenters = cells.map((c) => {
      const { x, z } = hexToWorld(c.q, c.r)
      sx += x
      sz += z
      return { x: x - origin.x, z: z - origin.z }
    })
    this.center = new THREE.Vector3(origin.x, 0, origin.z)
    // Where the camera aims and where the name plate goes: the middle of the whole zone,
    // so an L-shaped blob is framed as one place rather than from its corner.
    this.middle = new THREE.Vector3(sx / cells.length, 0, sz / cells.length)
    let anchor = this.localCenters[0]
    let anchorD = Infinity
    for (const p of this.localCenters) {
      const dx = p.x - (this.middle.x - origin.x)
      const dz = p.z - (this.middle.z - origin.z)
      const d = dx * dx + dz * dz
      if (d < anchorD) {
        anchorD = d
        anchor = p
      }
    }
    /**
     * The height this town stands at: above the *highest* ground under it, not the middle.
     *
     * Everything on a town is level with everything else on it, which is what a town is. The
     * question is which height that should be, and sampling the middle — the obvious answer,
     * and the one that was here — is wrong for any town on a slope.
     *
     * The terrain rolls on a long swell, and a deck is sixty-six units across. Measured over
     * a live colony, the ground rose *above* the middle-sampled deck in **22 of 24 cities**,
     * by as much as 2.5 units: the hillside came up through the paving and the buildings
     * standing on it were buried to the windows. That is the "everything renders inside the
     * ground" — not a z-fighting or depth problem, just a flat slab set too low.
     *
     * Taking the maximum over the footprint means the deck always clears its own hillside.
     * The cost is that the downhill side sits higher off the ground, which is exactly what
     * `DECK_SKIRT` is for — it is seven deep and the worst span here is under four, so the
     * slab still meets the earth all the way round and the town reads as cut into the slope.
     */
    this.sampleGround = sampleGround
    let baseY = sampleGround ? sampleGround(this.middle.x, this.middle.z) : 0
    if (sampleGround) {
      // The rim is what matters — the middle is already sampled and the swell is far too
      // long a wavelength to hide a peak between these rings.
      for (const lc of this.localCenters) {
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2
          for (const r of [TILE * 0.5, TILE * 0.8, TILE]) {
            const h = sampleGround(this.center.x + lc.x + Math.cos(a) * r, this.center.z + lc.z + Math.sin(a) * r)
            if (h > baseY) baseY = h
          }
        }
      }
    }
    this.center.y = baseY
    this.middle.y = baseY
    this.labelAnchor = new THREE.Vector3(this.center.x + anchor.x, baseY, this.center.z + anchor.z)
    this.radius = CELL * Math.sqrt(cells.length)

    this.group = new THREE.Group()
    this.group.position.copy(this.center)
    this.group.name = `plot:${id}`

    this._buildDeck()
    this._buildBorder()
    this._buildPosts()
    // Before the city, because the city is built around them: a thread's house is an
    // address on the high street, and the terrace has to know which addresses are spoken for.
    this.slots = this._buildSlots()
    this._buildStreets()
    this._buildDistricts(style)
    this._buildClutter()
    this._buildSurrounds(foliage)
  }

  /** One merged slab of hex tiles. */
  _buildDeck() {
    // UVs are assigned per tile, before it is moved into place: the rim wraps around the
    // tile's own centre, so it has to be at the origin when that is worked out. The top's
    // projection takes the tile's offset explicitly, which keeps the plate pattern running
    // continuously across a whole plot.
    const parts = this.localCenters.map(({ x, z }) => {
      const geo = hexPrism(TILE, DECK_HEIGHT)
      planarUv(geo, DECK_TEXTURE_SCALE, x, z, DECK_HEIGHT)
      // Positioned by its *top* face rather than by its middle: everything on a plot is
      // measured from that face, so it is the end of the prism that has to stay put when
      // the skirt under it changes depth.
      geo.translate(x, DECK_TOP - DECK_HEIGHT / 2, z)
      return geo
    })
    const geo = BufferGeometryUtils.mergeGeometries(parts)
    parts.forEach((g) => g.dispose())

    // Dark and nearly desaturated: the deck is a backdrop for buildings, and the accent
    // belongs on the border where it can outline the zone without shouting. The plate
    // pattern arrives as a texture and this tints it, which is why the drawing is authored
    // neutral grey.
    // Dark, but not black. The deck is a backdrop and wants to sit under the buildings
    // rather than compete with them — but its rim faces sideways, so whatever the top reads
    // as in full sun the edge reads as one stop darker, and a backdrop that goes to nothing
    // at the plot boundary just looks like a hole.
    /**
     * Timber, faintly stained with the zone's own colour.
     *
     * The space version took the accent, drained the saturation out of it and darkened it,
     * which over a steel plate gave a believable painted deck. Over boards it gave grey
     * driftwood, and a world of grey driftwood is the same problem the steel had. So the
     * accent is now a *stain* — a fifth of the way from real timber toward the zone's
     * colour — which keeps every deck reading as wood while still telling two neighbouring
     * zones apart at a glance.
     */
    const color = new THREE.Color(0xb08355).lerp(new THREE.Color(this.accent), 0.22)
    const plate = deckSurface()
    this.deck = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color,
        map: plate.map,
        normalMap: plate.normalMap,
        roughnessMap: plate.roughnessMap,
        normalScale: new THREE.Vector2(0.7, 0.7),
        roughness: 0.82,
        metalness: 0.18,
      })
    )
    this.deck.receiveShadow = true
    this.group.add(this.deck)
  }

  /**
   * The glowing accent kerb, drawn as one bar per *outside* edge — skipping shared edges is
   * what makes six tiles read as one zone instead of a honeycomb.
   *
   * Two things here exist purely to stop the borders flickering. The bar is inset so it lies
   * wholly **inside** its own tile: centred on the edge it would overlap the neighbouring
   * plot's bar by more than its own width, and two interpenetrating emissive slabs in
   * different colours z-fight along every shared edge in the colony. And it sits **on top of**
   * the deck rather than straddling it, so no two surfaces in a plot are ever coplanar.
   */
  _buildBorder() {
    const parts = []
    const apothem = TILE * Math.cos(Math.PI / 6)
    const width = 0.32
    const inset = 0.05
    // Centreline of the bar, pulled inboard far enough to clear the tile edge entirely.
    const mid = apothem - inset - width / 2
    // The bars form a smaller regular hexagon, whose side equals its own circumradius.
    const side = mid / Math.cos(Math.PI / 6)

    this.cells.forEach((cell, i) => {
      const { x, z } = this.localCenters[i]
      for (let edge = 0; edge < 6; edge++) {
        const dir = HEX_DIRS[EDGE_TO_DIR[edge]]
        if (this.cellKeys.has(key(cell.q + dir[0], cell.r + dir[1]))) continue

        const angle = (Math.PI / 3) * edge + Math.PI / 6
        // Sits on the deck: bottom flush with the deck's top face, never inside it.
        const geo = new THREE.BoxGeometry(width, 0.14, side * 1.02)
        kerbUv(geo)
        geo.rotateY(-angle)
        geo.translate(x + Math.cos(angle) * mid, DECK_TOP + 0.07, z + Math.sin(angle) * mid)
        parts.push(geo)
      }
    })

    if (!parts.length) return
    const geo = BufferGeometryUtils.mergeGeometries(parts)
    parts.forEach((g) => g.dispose())
    // Every bar is the same length, so a box's own 0..1 UVs put the same run of dashes on
    // each one without any reprojection.
    const lit = kerbSurface()
    /**
     * The kerb: painted timber with lamplight in it, not a neon strip.
     *
     * The emissive was the plot's raw accent at half intensity, which over a dashed mask is
     * runway edge lighting — and a village ringed in glowing magenta is the last thing in
     * the world still reading as science fiction, however many tiled roofs are standing on
     * it. Blending most of the way to lantern amber keeps the zone's colour identifiable
     * while making the light itself the colour light actually is here.
     */
    const glow = new THREE.Color(this.accent).lerp(new THREE.Color(0xffb861), 0.62)
    /**
     * And the kerb's own colour, which was the other half of the neon.
     *
     * Dimming the emissive was not enough: the base colour was the plot's raw accent, so by
     * daylight every zone was still edged in a saturated magenta or cyan strip. The accent
     * has to stay legible — it is how you tell two neighbouring zones apart from the air —
     * but as a *stain on timber* rather than as the timber's own colour, exactly the way the
     * deck boards already take it.
     */
    const kerbColor = new THREE.Color(0x7a6148).lerp(new THREE.Color(this.accent), 0.34)
    this.borderMaterial = new THREE.MeshStandardMaterial({
      color: kerbColor,
      map: lit.map,
      emissive: glow,
      emissiveMap: lit.emissiveMap,
      emissiveIntensity: 0.16,
      normalMap: lit.normalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.78,
      metalness: 0.0,
    })
    this.border = new THREE.Mesh(geo, this.borderMaterial)
    this.border.receiveShadow = true
    this.group.add(this.border)
  }

  /** A lamp post on one corner of each cell — the plot's own night lighting. */
  _buildPosts() {
    const posts = []
    const lamps = []
    this.localCenters.forEach(({ x, z }, i) => {
      // Out on the deck's own edge, clear of the blocks: at three quarters of the tile this
      // lands inside the outermost terrace.
      const [px, pz] = corner(x, z, (i * 2) % 6, TILE * 0.94)
      const pole = new THREE.CylinderGeometry(0.055, 0.085, 1.8, 6)
      pole.translate(px, DECK_TOP + 0.9, pz)
      posts.push(pole)
      const head = new THREE.SphereGeometry(0.14, 8, 6)
      head.translate(px, DECK_TOP + 1.84, pz)
      lamps.push(head)
    })

    const poleMesh = new THREE.Mesh(
      BufferGeometryUtils.mergeGeometries(posts),
      new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.7, metalness: 0.3 })
    )
    poleMesh.castShadow = true
    this.lampMaterial = new THREE.MeshBasicMaterial({ color: this.accent, toneMapped: true })
    this.lamps = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(lamps), this.lampMaterial)
    this._lampBase = new THREE.Color(this.accent)
    this.group.add(poleMesh, this.lamps)
    posts.forEach((g) => g.dispose())
    lamps.forEach((g) => g.dispose())
  }

  /**
   * Ground clutter — crates, drums and a floodlight or two, hugging the kerb.
   *
   * A plot with buildings on its slots and nothing anywhere else reads as a car park. This
   * fills the gap for one extra draw call: a merged mesh of kit props, placed against the
   * outer edge of each cell where the crew's routes between slots do not run, so nothing
   * has to be added to the navigation grid and nobody ends up walking through a barrel.
   *
   * Seeded off the plot's own name, so a repo's yard is laid out the same on every reload.
   */
  /**
   * The copse around a zone: what makes one repo feel like a different *place* to the next.
   *
   * Opening the lattice put ground between the decks, and bare ground between decks is just
   * a gap. What turns a gap into a journey is having something to walk past, and what turns
   * two zones into two places is that the things you walk past are different — so every
   * tree here is tinted from the zone's own accent rather than from the world preset. Walk
   * from a repo ringed in deep green into one ringed in rust and you have unmistakably
   * arrived somewhere, without a single label being involved.
   *
   * Gaps are deliberate. A closed ring of trees is a wall, and a zone you can only enter
   * from one side is a zone the crew queues to get into — so roughly a third of the ring is
   * left open, and every trunk goes into the navigation grid so pathing routes between them
   * rather than through them.
   */
  _buildSurrounds(worldFoliage) {
    const TREES = ['Tree_1_A_Color1', 'Tree_3_A_Color1', 'Tree_4_A_Color1', 'Tree_1_C_Color1']
    const BUSHES = ['Bush_1_E_Color1', 'Bush_3_B_Color1', 'Grass_2_D_Color1']
    if (!TREES.every((n) => hasPart(n, 'forest'))) return

    const rand = mulberry(hashString(this.id) + 991)
    const parts = []
    // The zone's own foliage: its accent pulled most of the way toward the world's own
    // planting, so a street of zones still reads as one hillside rather than as a paint
    // chart. A quarter of the way is enough to tell two neighbours apart.
    const tint = new THREE.Color(worldFoliage || 0x8fbf6a).lerp(new THREE.Color(this.accent), 0.55)

    this.surroundSpots = []
    this.localCenters.forEach(({ x, z }) => {
      /**
       * Eleven candidate positions, of which about two thirds are planted.
       *
       * Sixteen looked better in a still and cost about six hundred trees across a
       * twenty-four repo colony — most of a two-million-triangle frame, on a scene that is
       * meant to be left open on a second monitor. Eleven with the same gap rate keeps the
       * copse reading as a copse while halving it, and the extra spacing makes the ways
       * through it read as ways through rather than as accidents.
       */
      const ring = 7
      for (let i = 0; i < ring; i++) {
        // A third of the ring left open, and the openings fall in different places on each
        // cell because the sequence keeps running.
        if (rand() > 0.66) continue
        const a = (i / ring) * Math.PI * 2 + rand() * 0.16
        const r = TILE * (1.02 + rand() * 0.26)
        const px = x + Math.cos(a) * r
        const pz = z + Math.sin(a) * r
        // Never on top of a neighbouring cell of this same zone: the ring is drawn per cell,
        // so on a multi-cell zone the inner arcs would plant trees in the middle of the deck.
        if (this.localCenters.some((c) => c !== undefined && Math.hypot(px - c.x, pz - c.z) < TILE * 0.98)) continue

        const big = rand() > 0.42
        const name = big ? TREES[Math.floor(rand() * TREES.length)] : BUSHES[Math.floor(rand() * BUSHES.length)]
        const geo = part(name, 'forest')
        const scale = big ? 0.55 + rand() * 0.45 : 0.7 + rand() * 0.6
        geo.scale(scale, scale, scale)
        geo.rotateY(rand() * Math.PI * 2)
        // On the hillside, not on the town's level. The copse rings the deck and therefore
        // stands on ground that has already begun to fall away from it; planted at the
        // town's own height, half of every ring would be floating and the other half buried.
        const groundY = this.sampleGround
          ? this.sampleGround(this.center.x + px, this.center.z + pz) - this.center.y
          : 0
        geo.translate(px, groundY, pz)
        parts.push(geo)
        // Only the trunks are worth blocking. A grass tuft that stops a character is a
        // character standing in a field refusing to move.
        if (big) this.surroundSpots.push({ x: px, z: pz, r: 0.45 * scale + 0.25 })
      }
    })

    if (!parts.length) return
    const geo = BufferGeometryUtils.mergeGeometries(parts, false)
    parts.forEach((g) => g.dispose())

    const material = new THREE.MeshStandardMaterial({
      map: atlasTexture('forest'),
      roughness: 0.85,
      metalness: 0,
      color: tint,
    })
    /**
     * The same trick the world's own scatter uses: collapse the atlas to its own luminance
     * so it becomes a shading map, and let the zone's colour be the actual colour. Without
     * it the tint multiplies the pack's summer green and every zone comes out olive.
     *
     * The multiply back by `diffuse` at the end is not optional, and its absence is a
     * convincing impostor of a lighting bug. Three applies the material's colour *before*
     * `map_fragment`, so flattening `diffuseColor` to a grey here throws that colour away
     * and every zone's copse renders bone white — which reads as blown-out highlights
     * rather than as a missing multiply. The world's scatter gets away without it only
     * because its colour arrives per-instance in `color_fragment`, which runs afterwards.
     */
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         float leafLuma = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
         diffuseColor.rgb = vec3( 0.5 + leafLuma * 0.8 ) * diffuse;`
      )
    }

    this.surrounds = new THREE.Mesh(geo, material)
    // Same bargain as the scenery: a ring of trees round a deck casts almost entirely onto
    // grass and onto itself, and it is the second largest mesh in the colony.
    this.surrounds.castShadow = false
    this.surrounds.receiveShadow = true
    this.group.add(this.surrounds)
  }

  /**
   * The one stall in each district you can actually play at.
   *
   * Everything else in `_buildClutter` is furniture — placed by a seeded random, merged into
   * the same mesh, and never spoken to. This one is a *destination*: it is always in the same
   * place relative to its district, so once you have found one you know where every other one
   * is, and its position is handed to the colony so `E` can reach it.
   *
   * It stands on the cross street rather than the avenue. The avenue's frontage is where the
   * thread buildings live and a stall parked among them competes with the doors that matter;
   * the cross street is open road at every x, so a stall six units out from the crossroads is
   * clear of every building and still the first thing you meet walking out of the middle of
   * town.
   */
  _buildStall(solidParts, glowParts) {
    this.stallSpots = []
    for (const { x, z } of this.localCenters) {
      const px = x + STALL_OFFSET
      const pz = z
      const built = buildFestivalProp('stall', {
        x: px,
        y: DECK_TOP,
        z: pz,
        // Front is +Z, so a quarter turn back puts the counter facing the avenue you came from.
        yaw: -Math.PI / 2,
        scale: 1.15,
      })
      solidParts.push(...built.solid)
      glowParts.push(...built.glow)
      this.clutterSpots.push({ x: px, z: pz, r: Math.max(0.6, built.radius * 0.9) })
      // Where you have to stand to be served: in front of the counter, not inside it.
      this.stallSpots.push({ x: px - 1.9, z: pz })
    }
  }

  _buildClutter() {
    const rand = mulberry(hashString(this.id) + 17)
    const solidParts = []
    const glowParts = []
    /** Plot-local footprints, for the colony to hand to the navigation grid. */
    this.clutterSpots = []

    /**
     * What stands where. Lantern posts are common because they are what lights the deck
     * after dark and what gives it vertical rhythm by day; stalls are rare because one is
     * an event and four is a market.
     */
    const COMMON = ['lanternPost', 'lanternPost', 'banner', 'barrels', 'stoneLantern']
    const RARE = ['stall', 'miniTorii']

    this.localCenters.forEach(({ x, z }) => {
      /**
       * Along the street, not scattered over the cell.
       *
       * Props used to be thrown at two rings around the cell, which was the right answer
       * when the buildings were in a ring too. With a street, the furniture belongs *on*
       * it: lanterns down both kerbs at regular intervals, a stall or a banner filling the
       * gaps between buildings. Regular spacing is the point — a row of lanterns at even
       * intervals is what makes a road read as a road rather than as a gap.
       */
      // The full run of the avenue, edge to edge of the deck, rather than the length of a
      // three-house row: the street is now the width of the district.
      const length = hexChordZ(0, TILE - 1.2) * 2
      // Inside the building line, on the edge of the paving — a lantern set at the frontage
      // itself stands in somebody's front room.
      // Inside the building line by a clear metre. The frontage now stands at STREET_HALF
      // and a house is over three units across, so anything placed at the old kerb ends up
      // standing in somebody's front room.
      const kerb = 1.7

      // Lanterns down both edges.
      // Spaced for a street the width of a district rather than a village row: at the old
      // two-metre pitch this is fifty lanterns a side and reads as a fence of light.
      const lanterns = Math.round(length / 4.5)
      for (let i = 0; i <= lanterns; i++) {
        const t = (i / lanterns - 0.5) * length
        for (const side of [-1, 1]) {
          if (rand() > 0.82) continue
          const px = x + side * kerb
          const pz = z + t
          const built = buildFestivalProp('lanternPost', {
            x: px,
            y: DECK_TOP,
            z: pz,
            yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2,
            scale: 0.9,
          })
          solidParts.push(...built.solid)
          glowParts.push(...built.glow)
          this.clutterSpots.push({ x: px, z: pz, r: 0.4 })
        }
      }

      // And something in the gaps between the buildings — a stall, a banner, some barrels.
      const FILLER = ['banner', 'barrels', 'stall', 'stoneLantern', 'miniTorii']
      const gaps = SLOTS_PER_CELL / 2 - 1
      for (let i = 0; i < gaps; i++) {
        for (const side of [-1, 1]) {
          if (rand() > 0.55) continue
          const along = (i - (gaps - 1) / 2) * ROW_SPACING
          // On the roadside, not on the building line: the terrace is continuous now, so
          // there is no gap between two houses to stand a stall in.
          const px = x + side * 2.4
          const pz = z + along
          const name = FILLER[Math.floor(rand() * FILLER.length)]
          const built = buildFestivalProp(name, {
            x: px,
            y: DECK_TOP,
            z: pz,
            yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2,
            scale: 0.85 + rand() * 0.25,
          })
          solidParts.push(...built.solid)
          glowParts.push(...built.glow)
          this.clutterSpots.push({ x: px, z: pz, r: Math.max(0.45, built.radius * 0.9) })
        }
      }
    })

    this._buildStall(solidParts, glowParts)

    const solid = mergeProps(solidParts)
    if (solid) {
      this.clutter = new THREE.Mesh(solid, propMaterial())
      this.clutter.castShadow = true
      this.clutter.receiveShadow = true
      this.group.add(this.clutter)
    }

    // The lantern paper, in its own unlit batch so it survives nightfall as light rather
    // than going dark with everything else.
    const glow = mergeProps(glowParts)
    if (glow) {
      this.lanternMaterial = glowMaterial()
      this.lanterns = new THREE.Mesh(glow, this.lanternMaterial)
      this.group.add(this.lanterns)
    }
  }

  /**
   * Where the thread buildings stand: down the middle of the avenue, facing across it.
   *
   * These are the only buildings in a district that mean anything — one per conversation —
   * and where they are is the whole reason the block grid is laid out the way it is. The
   * street grid puts an avenue on the district's own axis, and this is that avenue: eight
   * plots a side, alternating left and right as threads are dealt out, so a repo with three
   * conversations still reads as the start of a street rather than as three sheds.
   *
   * The frontage the blocks would otherwise have put here is left out (see
   * `_buildDistricts`), so a thread's house is never shouldered by scenery and there is
   * never a question about which door is a real one.
   *
   * Fixed rather than random, so a session keeps its spot as siblings come and go — a
   * building must never jump because a neighbour was archived.
   */
  /**
   * Every address on the high street, best first.
   *
   * The two rows of blocks either side of the avenue present their inner frontage to it, and
   * this is that frontage — the same positions the terrace would otherwise be built on. Sorted
   * by distance from the crossroads at the middle of the district, so a repo with three
   * conversations gets the three addresses at the centre of town rather than three at the far
   * end of it, and the sort being stable is what puts each pair on opposite sides of the road.
   */
  _avenueFrontage(cx, cz) {
    const out = []
    for (const bxSign of [-1, 1]) {
      const bx = bxSign * BLOCK * 0.5
      for (const j of [-1.5, -0.5, 0.5, 1.5]) {
        const bz = j * BLOCK
        if (!hexContains(bx, bz, TILE - BLOCK * 0.5)) continue
        // The block's inner edge — the one facing the avenue.
        const rowX = bx - bxSign * BLOCK_INSET
        for (let i = 0; i < FRONT_COUNT; i++) {
          const along = (i - (FRONT_COUNT - 1) / 2) * FRONT_SPACING
          out.push({
            x: cx + rowX,
            z: cz + bz + along,
            // A building's own front is its +Z, so the row on the right of the avenue is
            // turned a quarter turn to look back across it.
            yaw: bxSign > 0 ? -Math.PI / 2 : Math.PI / 2,
          })
        }
      }
    }
    out.sort((a, b) => Math.abs(a.z - cz) - Math.abs(b.z - cz))
    return out
  }

  /**
   * Where the thread buildings stand: **in** the terrace, not instead of it.
   *
   * This is the correction to the obvious version of the idea, and the difference between the
   * two is the difference between a city and a film set. The obvious version leaves the
   * avenue's frontage empty for the threads to fill — which means a repo with eleven
   * conversations has eleven houses strung out along a two-hundred-foot road with nothing
   * between them, and the main street of the city is the emptiest place in it.
   *
   * So the terrace is built continuously and the threads take addresses out of it. A thread's
   * house is a house in a row of houses: the same architecture, the same building line, the
   * same roofline. What makes it a thread is that it has a door that opens, a resident, a
   * badge and a name — and those are things the scenery never has, so there is still no way to
   * mistake one for the other.
   *
   * Fixed rather than random, so a session keeps its address as siblings come and go — a
   * building must never jump because a neighbour was archived.
   */
  _buildSlots() {
    const slots = []
    this.takenFrontage = new Set()
    for (const { x, z } of this.localCenters) {
      const frontage = this._avenueFrontage(x, z)
      for (let i = 0; i < Math.min(SLOTS_PER_CELL, frontage.length); i++) {
        slots.push(frontage[i])
        this.takenFrontage.add(fkey(frontage[i].x, frontage[i].z))
      }
    }
    return slots
  }

  /**
   * The blocks of one district, in plot-local coordinates.
   *
   * Centres sit at half-pitch, which is what puts the *streets* on the axes: there is always
   * a clear avenue through x = 0 and a cross street through z = 0, and the thread buildings
   * stand on the first of them. Blocks whose frontage would hang off the edge of the deck are
   * dropped, so a district is a grid cut to a hexagon rather than a square with its corners
   * in mid-air — which is also why the corners of a deck read as parkland.
   */
  _blockCenters(cx, cz) {
    const out = []
    for (const i of [-1.5, -0.5, 0.5, 1.5]) {
      for (const j of [-1.5, -0.5, 0.5, 1.5]) {
        const bx = i * BLOCK
        const bz = j * BLOCK
        if (!hexContains(bx, bz, TILE - BLOCK * 0.5)) continue
        out.push({ x: cx + bx, z: cz + bz, bx, bz })
      }
    }
    return out
  }

  /**
   * The city itself: a hundred-odd buildings a district, ringing the blocks.
   *
   * The buildings that carry *meaning* are threads, and there are only ever a handful of
   * those, so density has to come from somewhere else. It comes from scenery — and the
   * project's rule for scenery is "make it scenery and put it somewhere the data never goes",
   * which is exactly what these are: never on the avenue, never enterable, never carrying a
   * resident or a badge. There is no way to mistake one for a thread, and what they buy is
   * the thing seven buildings in a row can never buy, which is a horizon made of roofs.
   *
   * Two things make this affordable, and both are structural rather than tuning:
   *
   * 1. **One mesh per block, not per district.** A district merged whole is a single
   *    hundred-metre bounding sphere that is on screen from everywhere inside it, so frustum
   *    culling can never reject any of it. Merged per block, standing in one street rejects
   *    most of the district behind you for free — the culling has something the size of a
   *    block to work with.
   * 2. **A skyline tier past `FAR_DETAIL`.** See `updateDetail`.
   */
  _buildDistricts(styleId) {
    const rand = mulberry(hashString(this.id) + 4242)
    const catalogue = kindsForStyle(styleId)
    this.scenerySpots = []
    this.blocks = []
    const skyline = []
    const poles = []
    const lampHeads = []

    const DIRS = [
      { dx: 1, dz: 0, yaw: Math.PI / 2 },
      { dx: -1, dz: 0, yaw: -Math.PI / 2 },
      { dx: 0, dz: 1, yaw: 0 },
      { dx: 0, dz: -1, yaw: Math.PI },
    ]

    for (const { x: cx, z: cz } of this.localCenters) {
      for (const block of this._blockCenters(cx, cz)) {
        const geos = []
        /**
         * One way into the middle of every block.
         *
         * A block ringed all the way round is a **sealed courtyard**, and the yard inside it
         * is open ground as far as the navigation grid is concerned — so anything that ends
         * up in there can never path out again. It is not hypothetical: characters spawn near
         * their own building and the nearest free cell to that is quite often the yard behind
         * it, and a character shut in a courtyard stands still for the rest of the session,
         * refuses to walk anywhere, and cannot be raced, met or gathered with.
         *
         * So each block loses the middle house on one of its four sides. That is an alley
         * into the yard — which is what a real block of this shape has anyway — and it is
         * chosen per block rather than at random per building, so the gap is always wide
         * enough to walk through instead of sometimes being two half-gaps in a row.
         */
        const alleyEdge = Math.floor(rand() * 4)
        const alleyAt = Math.floor((FRONT_COUNT - 1) / 2)
        let edgeIndex = -1
        for (const dir of DIRS) {
          edgeIndex++
          const rowX = block.x + dir.dx * BLOCK_INSET
          const rowZ = block.z + dir.dz * BLOCK_INSET
          for (let i = 0; i < FRONT_COUNT; i++) {
            const along = (i - (FRONT_COUNT - 1) / 2) * FRONT_SPACING
            // "Along the frontage" is whichever axis the row does not run out along.
            const px = rowX + (dir.dx === 0 ? along : 0)
            const pz = rowZ + (dir.dz === 0 ? along : 0)
            // A thread already lives at this address. Leave the gap; `Colony` fills it with a
            // real building, and one house standing inside another is the one mistake this
            // whole arrangement has to avoid.
            if (this.takenFrontage.has(fkey(px, pz))) continue
            // The occasional missing tooth, so a terrace is a terrace and not a fence. Never
            // on the avenue, where a gap in the row reads as a plot waiting for a thread.
            const onAvenue = dir.dz === 0 && Math.abs(block.bx) < BLOCK && Math.sign(block.bx) === -dir.dx
            // The alley. Never cut into the avenue's own terrace, which has to stay unbroken.
            if (!onAvenue && edgeIndex === alleyEdge && i === alleyAt) continue
            if (!onAvenue && rand() > 0.93) continue

            const kind = catalogue[Math.floor(rand() * catalogue.length)]
            const built = buildVillage(kind, rand, this.accent, styleId)
            // Scenery never has a room, so throw the interior away rather than carry it.
            built.interior?.dispose()

            /**
             * Varied in height, and barely at all in plan.
             *
             * A terrace whose buildings are all one height reads as a fence; one whose
             * buildings are all different widths leaves gaps that break the street wall. So
             * the footprint hardly moves and the storey height does: the row stays continuous
             * at eye level and the roofline steps all the way along it, which is what you
             * actually see when you look down a street.
             */
            const plan = SCENERY_SCALE * (0.94 + rand() * 0.16)
            const rise = SCENERY_SCALE * (0.95 + rand() * 0.75)
            const geo = built.geometry
            geo.scale(plan, rise, plan)
            geo.rotateY(dir.yaw)
            geo.translate(px, DECK_TOP, pz)
            geos.push(geo)

            const r = built.footprint * plan
            this.scenerySpots.push({ x: px, z: pz, r })
            skyline.push({ x: px, z: pz, r, h: built.height * rise, tone: rand() })
          }
        }

        if (geos.length) {
          const mesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(geos, false), sceneryMaterial())
          /**
           * Scenery does not cast shadows, and that is where most of the frame used to go.
           *
           * `renderer.info` reported 2.4M triangles against a scene holding 690k, which is
           * the shadow pass drawing nearly everything a second time. Back streets are the
           * largest block of geometry in the colony and the least worth shadowing: what they
           * would cast falls almost entirely on other scenery. They still *receive*, so the
           * avenue's buildings still shadow onto them and the city keeps its depth.
           */
          mesh.castShadow = false
          mesh.receiveShadow = true
          this.group.add(mesh)
          this.blocks.push(mesh)
          geos.forEach((g) => g.dispose())
        }

        // A lamp on the block's corner, which is where a street lamp goes, and what turns the
        // grid into a readable network of junctions after dark.
        const lx = block.x + BLOCK_INSET * 1.05
        const lz = block.z + BLOCK_INSET * 1.05
        const pole = new THREE.CylinderGeometry(0.06, 0.09, 2.6, 6)
        pole.translate(lx, DECK_TOP + 1.3, lz)
        poles.push(pole)
        const head = new THREE.SphereGeometry(0.17, 8, 6)
        head.translate(lx, DECK_TOP + 2.68, lz)
        lampHeads.push(head)
      }
    }

    if (poles.length) {
      const poleMesh = new THREE.Mesh(
        BufferGeometryUtils.mergeGeometries(poles, false),
        new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.75, metalness: 0.2 })
      )
      poleMesh.castShadow = false
      this.group.add(poleMesh)
      poles.forEach((g) => g.dispose())

      const heads = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(lampHeads, false), this.lampMaterial)
      this.group.add(heads)
      this.streetLamps = heads
      lampHeads.forEach((g) => g.dispose())
    }

    this._buildSkyline(skyline)
  }

  /**
   * The same district, as roofline only.
   *
   * One box and one pitched roof per building — about twenty triangles where the real thing
   * costs three hundred and twenty. It is not a trick and it is not a texture: it is the same
   * buildings, in the same places, at the same heights, with everything that cannot be
   * resolved at ninety metres taken away. What the eye reads at that distance is silhouette
   * and colour, and both survive; what it cannot read is the veranda, the noren and the
   * window frames, and those are the whole three hundred triangles.
   *
   * Built once, hidden, and swapped in by `updateDetail`.
   */
  _buildSkyline(spots) {
    if (!spots.length) return
    const geos = []
    const wall = new THREE.Color()
    const roofColor = new THREE.Color(this.accent).lerp(new THREE.Color(0x3c4450), 0.72)

    for (const s of spots) {
      const w = Math.max(1.1, s.r * 1.7)
      const h = Math.max(1.2, s.h)
      const body = new THREE.BoxGeometry(w, h, w)
      body.translate(s.x, DECK_TOP + h / 2, s.z)
      // A four-sided cone, turned to sit square on the box: a hipped roof.
      const roof = new THREE.ConeGeometry(w * 0.78, h * 0.42, 4)
      roof.rotateY(Math.PI / 4)
      roof.translate(s.x, DECK_TOP + h + h * 0.21, s.z)

      wall.setHSL(0.09, 0.1, 0.54 + s.tone * 0.22)
      tintGeometry(body, wall)
      tintGeometry(roof, roofColor)
      geos.push(body, roof)
    }

    this.skyline = new THREE.Mesh(
      BufferGeometryUtils.mergeGeometries(geos, false),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })
    )
    this.skyline.castShadow = false
    this.skyline.receiveShadow = false
    this.skyline.visible = false
    this.group.add(this.skyline)
    geos.forEach((g) => g.dispose())
  }

  /**
   * Pick a level of detail for this district from where the camera is.
   *
   * Distance is measured to the district's *middle* and the whole district switches at once,
   * because one that changed tier building by building would visibly crawl as you walked.
   * `DETAIL_SLACK` is what stops it flickering: the swap out happens further away than the
   * swap back, so standing on the boundary is stable rather than a strobe.
   */
  updateDetail(camX, camZ) {
    if (!this.skyline) return
    const d = Math.hypot(camX - this.middle.x, camZ - this.middle.z)
    const far = this._far ? d > FAR_DETAIL - DETAIL_SLACK : d > FAR_DETAIL
    if (far === this._far) return
    this._far = far
    for (const mesh of this.blocks) mesh.visible = !far
    this.skyline.visible = far
  }

  /**
   * The street grid, paved.
   *
   * Roads are laid on the deck rather than cut into the navigation grid, like the roads
   * between zones — a street you cannot step off is a corridor, and the point of the deck is
   * that it is open ground with a city on it. Each road is clipped to the hexagon it is laid
   * on, so nothing overhangs the edge and nothing stops half way across.
   */
  _buildStreets() {
    const parts = []
    const stones = []
    const lines = [-1, 0, 1].map((k) => k * BLOCK)

    for (const { x, z } of this.localCenters) {
      for (const c of lines) {
        // Running along z.
        const halfZ = hexChordZ(c, TILE - 0.6)
        if (halfZ > 1) {
          const width = c === 0 ? AVENUE_WIDTH : STREET_WIDTH
          const road = new THREE.BoxGeometry(width, 0.05, halfZ * 2)
          road.translate(x + c, DECK_TOP + 0.015, z)
          parts.push(road)
        }
        // Running along x.
        const halfX = hexChordX(c, TILE - 0.6)
        if (halfX > 1) {
          const width = c === 0 ? AVENUE_WIDTH : STREET_WIDTH
          const road = new THREE.BoxGeometry(halfX * 2, 0.05, width)
          road.translate(x, DECK_TOP + 0.014, z + c)
          parts.push(road)
        }
      }

      // Stepping stones down the avenue, spaced so they read as a path rather than paving.
      const run = hexChordZ(0, TILE - 0.6)
      const count = Math.round((run * 2) / 1.5)
      for (let i = 0; i < count; i++) {
        const t = (i / (count - 1) - 0.5) * run * 2
        const stone = new THREE.CylinderGeometry(0.4, 0.38, 0.06, 6)
        stone.rotateY(i * 1.1)
        stone.translate(x + (i % 2 ? 0.22 : -0.22), DECK_TOP + 0.05, z + t)
        stones.push(stone)
      }
    }
    if (!parts.length) return

    const road = new THREE.Mesh(
      BufferGeometryUtils.mergeGeometries(parts, false),
      new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.98, metalness: 0 })
    )
    road.receiveShadow = true
    this.group.add(road)
    parts.forEach((g) => g.dispose())

    const path = new THREE.Mesh(
      BufferGeometryUtils.mergeGeometries(stones, false),
      new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.95, metalness: 0 })
    )
    path.receiveShadow = true
    this.group.add(path)
    stones.forEach((g) => g.dispose())
  }


  slotFor(index) {
    return this.slots[index % this.slots.length]
  }

  worldSlot(index, out = new THREE.Vector3()) {
    const s = this.slotFor(index)
    // Measured from the town's own ground, not from zero: buildings live in the world group
    // rather than in the plot's, so nothing lifts them for free.
    return out.set(this.center.x + s.x, this.center.y + DECK_TOP, this.center.z + s.z)
  }

  /** Night lighting, plus a pulse on the border when this plot holds something urgent. */
  setNight(night, urgent, elapsed) {
    if (this.borderMaterial) {
      // Much dimmer by day than it was — a kerb is edging, not a light fitting — and it
      // still comes up after dark, and still pulses when the zone holds something urgent,
      // because that pulse is the one signal on it that carries meaning.
      this.borderMaterial.emissiveIntensity =
        0.06 + night * 0.75 + (urgent ? 0.3 + Math.sin(elapsed * 3.4) * 0.24 : 0)
    }
    this.lampMaterial.color.copy(this._lampBase).multiplyScalar(0.5 + night * 2.4)
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose()
        o.material.dispose()
      }
    })
  }
}

// ── labels ────────────────────────────────────────────────────────────────────────────

/**
 * Project name plates. Drawn to a canvas once per project and billboarded in the vertex
 * shader, so they stay upright and legible from any camera angle without a per-frame
 * lookAt on the CPU.
 */
export function createLabel(text, accent, pixelRatio = 4) {
  const fontSize = 34
  const font = `600 ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
  const dot = 9
  const gap = 10
  const pad = 14

  const measure = document.createElement('canvas').getContext('2d')
  measure.font = font
  const textWidth = Math.ceil(measure.measureText(text).width)

  const canvas = document.createElement('canvas')
  const w = textWidth + dot + gap + pad * 2
  const h = fontSize + pad * 2
  canvas.width = Math.ceil(w * pixelRatio)
  canvas.height = Math.ceil(h * pixelRatio)
  const c = canvas.getContext('2d')
  c.scale(pixelRatio, pixelRatio)

  // No plate and no outline — legibility comes from a soft dark halo behind the glyphs,
  // which sits on grass, regolith or rust equally well and disappears the moment you stop
  // reading it. A small accent dot is all that ties the name to its zone.
  c.font = font
  c.textAlign = 'left'
  c.textBaseline = 'middle'
  const textX = pad + dot + gap
  const midY = h / 2

  // The halo is the only thing separating the name from what is behind it, and what is
  // behind it is now usually a roof rather than grass. Pale tile under white text needs a
  // deeper, wider shadow than dirt did — four passes rather than three, because each pass
  // compounds the same blur and that is cheaper than one enormous one.
  c.shadowColor = 'rgba(0,0,0,0.92)'
  c.shadowBlur = 12
  c.fillStyle = 'rgba(0,0,0,0.9)'
  for (let i = 0; i < 4; i++) c.fillText(text, textX, midY) // build the halo up in passes
  c.beginPath()
  c.arc(pad + dot / 2, midY, dot / 2, 0, Math.PI * 2)
  c.fill()

  c.shadowBlur = 0
  c.fillStyle = '#' + new THREE.Color(accent).getHexString()
  c.beginPath()
  c.arc(pad + dot / 2, midY, dot / 2, 0, Math.PI * 2)
  c.fill()
  c.fillStyle = '#f4f2ee'
  c.fillText(text, textX, midY)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  // A plate holds a near-constant screen size, so it is *magnified* when you lean in and
  // *minified* when you pull out, and it has to survive both: the pixel ratio covers the
  // close end, mipmaps the far one. Without them a distant name crawls with aliasing.
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8

  const height = 0.56
  const geo = new THREE.PlaneGeometry(height * (w / h), height)
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    // A name plate is a label on the world rather than an object in it: it floats above its
    // zone, so a habitat between it and the camera used to cut the name in half. Like the
    // badges, it is drawn on top of the scene and ordered against them — badges come last,
    // because the one that wants you matters more than the zone it is standing in.
    depthTest: false,
    toneMapped: false,
    opacity: 0,
  })
  /**
   * Billboard the plate, and hold it at a readable size however far away it is.
   *
   * The two terms do different jobs and the second one is the important one. A plate of fixed
   * world size shrinks as `1/distance` and is unreadable across a colony this wide, so the
   * size is grown *with* distance — which makes the screen size converge on a constant, and
   * that constant is what the second coefficient sets.
   *
   * It is worth doing the arithmetic rather than tuning by eye, because the old value looked
   * plausible and was not. Screen height as a fraction of the viewport is
   *
   *     plateHeight * ( a + b * d ) / ( 2 * d * tan( fov/2 ) )
   *
   * which for large `d` tends to `plateHeight * b / (2 * tan( fov/2 ))`. At the old `b` of
   * 0.03, with a 0.56 plate and a 55° field of view, that is 1.8% of the viewport — about
   * **seven pixels of cap height** on a 720p window, at every distance past the near field.
   * Seven pixels is not small, it is illegible, and it is why a map of two dozen cities had
   * nothing on it you could read.
   *
   * At 0.095 the same sum lands near 5% of the viewport, or roughly twenty pixels of cap
   * height, and holds there from fifty units out to the far side of the world. The near-field
   * term comes down to compensate, so standing next to a city does not put its name across
   * your whole screen.
   */
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
       float dist = -mvPosition.z;
       mvPosition.xy += position.xy * ( 0.30 + dist * 0.095 );
       gl_Position = projectionMatrix * mvPosition;`
    )
  }
  const mesh = new THREE.Mesh(geo, mat)
  mesh.renderOrder = 8
  mesh.frustumCulled = false
  mesh.visible = false
  mesh.userData.dispose = () => {
    texture.dispose()
    geo.dispose()
    mat.dispose()
  }
  return mesh
}

export function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
