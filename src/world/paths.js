import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * The roads between zones.
 *
 * Opening the lattice put real ground between repos, which made arriving somewhere mean
 * something — and immediately created a different problem: undifferentiated grass in every
 * direction. A gap you cross is a journey; a field you cross is a chore, because nothing in
 * it tells you where you are going or how far is left.
 *
 * So the zones are joined by a road network, and the network is a **minimum spanning tree**
 * over the zone centres rather than a road from everywhere to everywhere. That choice is the
 * whole design:
 *
 * - It is the shortest set of roads that still connects every zone, so no ground is paved
 *   that does not need to be.
 * - It produces *branches* — a trunk with spurs off it — which is what real settlements look
 *   like and what makes a map learnable. A complete graph is a spider's web and reads as
 *   noise.
 * - It gives every pair of zones exactly one route, so "follow the road" is always a
 *   complete instruction.
 *
 * Stones are laid on the terrain's own height and skip the last stretch at each end, because
 * a zone's deck is raised and a flagstone half-buried in the side of one reads as a mistake.
 */

/** How far apart the stones sit, and how big they are. */
const SPACING = 1.5
const STONE = 0.62
/** Distance from a zone's centre where its road stops — clear of the deck. */
/**
 * Where a road stops at each end: clear of the city it is arriving at.
 *
 * Has to exceed the deck's own half-width, or the last stones are laid up the side of a
 * raised platform and read as a paving mistake rather than as a road reaching a town.
 */
const CLEARANCE = 30
/** A lantern every so many stones, so a road at night is a line of lights. */
const LANTERN_EVERY = 11

const STONE_COLOR = 0x9a948a
const POST_COLOR = 0x4a3a2c
const PAPER_COLOR = 0xffdba8

/**
 * Prim's algorithm over the zone centres.
 *
 * Chosen over Kruskal because the input is a handful of points with no edge list — Prim
 * grows from one node and only ever needs the nearest unconnected neighbour, which for
 * twenty-odd zones is a couple of hundred distance checks and no sorting at all.
 */
function spanningTree(points) {
  if (points.length < 2) return []
  const inTree = new Set([0])
  const edges = []
  while (inTree.size < points.length) {
    let best = null
    let bestD = Infinity
    for (const i of inTree) {
      for (let j = 0; j < points.length; j++) {
        if (inTree.has(j)) continue
        const d = (points[i].x - points[j].x) ** 2 + (points[i].z - points[j].z) ** 2
        if (d < bestD) {
          bestD = d
          best = [i, j]
        }
      }
    }
    if (!best) break
    inTree.add(best[1])
    edges.push(best)
  }
  return edges
}

/**
 * Build the network.
 *
 * @param centres [{x, z}] one per zone
 * @param groundAt (x, z) => height, so stones sit on the terrain rather than through it
 * @returns { stones, lanterns, lamps } three merged geometries, or nulls
 */
export function buildPaths(centres, groundAt) {
  if (!centres || centres.length < 2) return { stones: null, lanterns: null, lamps: null }

  const stones = []
  const posts = []
  const lamps = []
  const edges = spanningTree(centres)
  let laid = 0

  for (const [ai, bi] of edges) {
    const a = centres[ai]
    const b = centres[bi]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const length = Math.hypot(dx, dz)
    // Two zones whose decks nearly touch need no road between them.
    if (length <= CLEARANCE * 2 + SPACING) continue
    const ux = dx / length
    const uz = dz / length

    for (let t = CLEARANCE; t <= length - CLEARANCE; t += SPACING) {
      // A gentle wander, so the road is laid rather than ruled. The sine is keyed to
      // distance along the road, so both ends stay put while the middle drifts.
      const sway = Math.sin(t * 0.22 + ai * 1.7) * 0.55
      const x = a.x + ux * t - uz * sway
      const z = a.z + uz * t + ux * sway
      const y = groundAt ? groundAt(x, z) : 0

      const stone = new THREE.CylinderGeometry(STONE * (0.8 + Math.random() * 0.4), STONE * 0.9, 0.14, 6)
      stone.rotateY(Math.random() * Math.PI)
      // Sunk most of the way in: a flagstone stands a finger proud of the grass, not a hand.
      stone.translate(x, y + 0.045, z)
      stones.push(stone)

      if (laid % LANTERN_EVERY === 0 && t > CLEARANCE + SPACING) {
        const px = x - uz * 1.15
        const pz = z + ux * 1.15
        const py = groundAt ? groundAt(px, pz) : 0
        const post = new THREE.CylinderGeometry(0.07, 0.09, 1.5, 6)
        post.translate(px, py + 0.75, pz)
        posts.push(post)
        const cap = new THREE.ConeGeometry(0.26, 0.2, 6)
        cap.translate(px, py + 1.72, pz)
        posts.push(cap)
        const box = new THREE.BoxGeometry(0.26, 0.28, 0.26)
        box.translate(px, py + 1.55, pz)
        lamps.push(box)
      }
      laid++
    }
  }

  const merge = (list) => (list.length ? BufferGeometryUtils.mergeGeometries(list, false) : null)
  const out = { stones: merge(stones), lanterns: merge(posts), lamps: merge(lamps) }
  for (const list of [stones, posts, lamps]) list.forEach((g) => g.dispose())
  return out
}

export const PATH_COLORS = { stone: STONE_COLOR, post: POST_COLOR, paper: PAPER_COLOR }
