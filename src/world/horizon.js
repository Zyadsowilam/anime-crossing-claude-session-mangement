import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Mountains, ringing the world.
 *
 * The single cheapest thing that makes a place feel large, and the reason is worth stating:
 * a world with nothing beyond it has no scale. However far the ground runs, if it simply
 * fades into fog then the fog is the edge, and the edge is close — you can *feel* that there
 * is nothing behind it. Put ridges out there and the eye has something to measure against,
 * the fog becomes distance rather than a wall, and the same terrain reads as a valley in a
 * country instead of a disc in a void.
 *
 * They are three rings of low-poly ridges at increasing distance, each fainter and bluer
 * than the last — **aerial perspective**, which is how the eye actually judges distance
 * outdoors, and which does more for the sense of size than the geometry does. Nothing here
 * is walkable, nothing is lit, nothing casts a shadow: they exist to be far away.
 *
 * The whole ring is one merged mesh per band, so the horizon costs three draw calls.
 */

/** The bands: how far out, how tall, how many peaks, and how far toward the sky they fade. */
const BANDS = [
  { radius: 640, height: 78, peaks: 30, fade: 0.42, jitter: 0.5 },
  { radius: 980, height: 140, peaks: 24, fade: 0.66, jitter: 0.4 },
  { radius: 1380, height: 220, peaks: 18, fade: 0.84, jitter: 0.3 },
]

/**
 * One ridge: a broad triangular prism, squashed and skewed so no two read the same.
 *
 * Deliberately not cones. A cone is symmetrical from every angle and a row of them reads as
 * a paper crown; real ridges are asymmetric lumps with a shoulder on one side, which is what
 * the skew and the uneven base width below produce.
 */
function ridge(width, height, depth, skew) {
  const g = new THREE.ConeGeometry(width, height, 5, 1)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const t = (y + height / 2) / height
    // Lean the peak over, and pinch the base so it is wider across than it is deep.
    pos.setX(i, pos.getX(i) + skew * t * width * 0.6)
    pos.setZ(i, pos.getZ(i) * depth)
  }
  pos.needsUpdate = true
  g.computeVertexNormals()
  g.translate(0, height / 2, 0)
  return g
}

/**
 * Build the horizon.
 *
 * @param seed so a world's mountains are the same every time it is opened
 * @param skyColor what the furthest band fades toward — the world's own haze colour, so the
 *   mountains belong to the sky they are seen through rather than sitting in front of it
 */
export function createHorizon(seed = 1337, skyColor = 0xbcd8ee, rockColor = 0x6b7a8a) {
  const group = new THREE.Group()
  group.name = 'horizon'

  let n = seed >>> 0
  const rand = () => {
    n = (n * 1664525 + 1013904223) >>> 0
    return n / 4294967296
  }

  const rock = new THREE.Color(rockColor)
  const sky = new THREE.Color(skyColor)

  for (const band of BANDS) {
    const parts = []
    for (let i = 0; i < band.peaks; i++) {
      // Evenly spaced with jitter, so the ring is neither a grid nor a clump.
      const a = ((i + (rand() - 0.5) * band.jitter) / band.peaks) * Math.PI * 2
      const r = band.radius * (0.9 + rand() * 0.2)
      const h = band.height * (0.55 + rand() * 0.75)
      const w = band.height * (0.85 + rand() * 0.8)
      const g = ridge(w, h, 0.6 + rand() * 0.5, (rand() - 0.5) * 1.6)
      g.rotateY(rand() * Math.PI * 2)
      g.translate(Math.cos(a) * r, -h * 0.06, Math.sin(a) * r)
      parts.push(g)
    }

    const merged = BufferGeometryUtils.mergeGeometries(parts, false)
    parts.forEach((g) => g.dispose())

    /**
     * Unlit, and already faded toward the sky.
     *
     * `MeshBasicMaterial` rather than a lit one on purpose: these are far enough away that
     * the sun's direction on them would be meaningless, and a lit mountain at this distance
     * picks up a terminator that reads as a seam. Baking the haze into the colour instead
     * costs nothing and is what aerial perspective actually looks like.
     */
    const mat = new THREE.MeshBasicMaterial({
      color: rock.clone().lerp(sky, band.fade),
      fog: false,
      depthWrite: true,
    })
    const mesh = new THREE.Mesh(merged, mat)
    mesh.frustumCulled = false
    mesh.renderOrder = -5
    group.add(mesh)
  }

  return group
}
