import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Hair and props — everything that turns the shared mannequin into a particular character.
 *
 * The colony draws its whole crew as one instanced, GPU-skinned body (see `crew.js`), which
 * means every character shares one silhouette from the neck down. All of the identity has
 * to live in what they *wear*, and everything here is built to keep that cheap: each shape
 * is merged into a single `BufferGeometry` at boot and drawn as one `InstancedMesh`, so a
 * hairstyle costs one draw call no matter whether one character wears it or ninety.
 *
 * That is also why hair is a fixed set of styles rather than a continuous parameter. A
 * per-character mesh would be a per-character draw call, and the colony's whole design is
 * that it costs the same at six threads as at six hundred.
 *
 * **Space.** Every geometry here is authored in the *head bone's* local space unless its
 * entry says otherwise, with the head sphere centred at `HEAD_UP` and of radius `HEAD_R`.
 * Hair therefore sits correctly whatever the rig is scaled to, and a style can be retuned
 * without touching the code that places it.
 */

/**
 * The anime head: larger than the mannequin's own, and slightly egg-shaped.
 *
 * It has to be at least as wide as the helmet it replaced, or the mannequin's own head pokes
 * out through the back of it — the helmet was sized to swallow that head whole and this
 * inherits the job. Beyond that the size is a judgement: big enough for the eyes to read at
 * the distance the colony is watched from, small enough not to be a beach ball on a stick.
 */
export const HEAD_R = 0.42
/** Where that head's centre sits above the head bone, which is authored at the neck. */
export const HEAD_UP = 0.46
/** Vertical squash and stretch applied to the head sphere. Anime skulls are tall, not round. */
export const HEAD_SCALE = new THREE.Vector3(0.95, 1.1, 0.93)

const R = HEAD_R

// ── primitive helpers ──────────────────────────────────────────────────────────────────

/** A capsule-ish tapered strand: the unit every spike, tail and lock is built from. */
function strand(len, thick, tipThick = thick * 0.12, seg = 5) {
  const g = new THREE.CylinderGeometry(tipThick, thick, len, seg, 1)
  g.translate(0, len / 2, 0)
  return g
}

function box(w, h, d, r = 0) {
  if (r <= 0) return new THREE.BoxGeometry(w, h, d)
  // A cheap rounded box: a scaled, low-segment sphere reads rounder than a bevelled cube
  // at the size these render, and costs a third of the triangles.
  const g = new THREE.SphereGeometry(0.5, 10, 7)
  g.scale(w, h, d)
  return g
}

/**
 * A dome: the top half of a sphere, optionally cut off below `floor` so a cap of hair sits
 * on a skull without a hemisphere of geometry hidden inside it.
 */
function dome(radius, floor = 0, wSeg = 14, hSeg = 9) {
  const phiLength = Math.PI * 2
  const thetaLength = Math.acos(Math.max(-1, Math.min(1, floor / radius)))
  return new THREE.SphereGeometry(radius, wSeg, hSeg, 0, phiLength, 0, thetaLength)
}

/**
 * Cut a face out of a hair shell.
 *
 * `dome` builds a *full* sphere section — all the way round the head, down to the floor it is
 * given. That is right for the back and the sides and completely wrong for the front: a
 * hairstyle with any length to it (most of them are between -R*0.5 and -R*0.66) came down over
 * the brow, the eyes and half the nose as one smooth unbroken shell, and since the face decal
 * sits just outside it you got eyes painted onto a helmet. Every long-haired character in the
 * colony was wearing a motorcycle helmet in their own hair colour.
 *
 * Raising the floor is the obvious fix and the wrong one: it shortens the hair everywhere,
 * so the long styles lose the silhouette that distinguishes them and every character ends up
 * with the same crop. What hair actually has is a **hairline** — deep at the back and sides,
 * stopping on the forehead at the front — and that is what this cuts.
 *
 * Vertices below the brow are lifted toward it in proportion to how far forward they face,
 * squared so the hairline curves around the temples instead of slicing a straight chord
 * across the head. Nothing at the sides or the back moves at all, so the length is kept.
 * The fringe still hangs over the forehead; it is built from separate strands with gaps
 * between them, which is the part that reads as hair rather than as a shell.
 */
function faceOpening(geo, brow) {
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    if (y >= brow) continue
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const horiz = Math.hypot(x, z)
    // +Z is the character's front, so this is 1 straight ahead and 0 at the ears and behind.
    const forward = horiz > 1e-6 ? Math.max(0, z / horiz) : 0
    if (forward <= 0) continue
    const t = forward * forward
    pos.setY(i, y + (brow - y) * t)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

/** Place a geometry: rotate (XYZ euler), then translate. Returns the same geometry. */
function put(g, x, y, z, rx = 0, ry = 0, rz = 0, scale = null) {
  if (scale) g.scale(scale.x ?? scale, scale.y ?? scale, scale.z ?? scale)
  if (rx) g.rotateX(rx)
  if (ry) g.rotateY(ry)
  if (rz) g.rotateZ(rz)
  g.translate(x, y, z)
  return g
}

/**
 * Merge, after flattening every input to the same shape.
 *
 * `mergeGeometries` refuses a batch whose members disagree about whether they are indexed
 * or about which attributes they carry, and the primitives here disagree on both counts —
 * a cone brings groups, an open cylinder brings no caps, a circle brings a different
 * winding. Rather than hand-matching every primitive, each is expanded to a non-indexed
 * position/normal/uv triple first, which every three primitive can produce. The extra
 * vertices cost nothing that matters: these are merged once, at boot, and then live for the
 * process's whole life as a single instanced draw.
 */
function merge(parts) {
  const flat = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g
    const out = new THREE.BufferGeometry()
    out.setAttribute('position', n.getAttribute('position'))
    // A primitive missing normals or uvs gets empty ones, so the sets always line up.
    const count = n.getAttribute('position').count
    out.setAttribute('normal', n.getAttribute('normal') || new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    out.setAttribute('uv', n.getAttribute('uv') || new THREE.BufferAttribute(new Float32Array(count * 2), 2))
    return out
  })
  const g = BufferGeometryUtils.mergeGeometries(flat, false)
  g.computeVertexNormals()
  return g
}

/**
 * The fringe every style wears, in one place.
 *
 * It is the piece with the tightest constraint on it: the face is painted on the front of
 * the head sphere and its eyes are large and sit high, so bangs that hang past the brow
 * line delete the character's entire expression. Everything here stops above that line and
 * leans *out* rather than down — the silhouette of bangs, over an unobstructed face.
 */
function fringe(count = 5, drop = 0.3, spread = 1.5) {
  const parts = []
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1)
    const a = (t - 0.5) * spread
    /**
     * Shortest in the middle, longest at the temples.
     *
     * The intuitive shape is the other way round — a fringe does look longest in the centre
     * on paper — but the centre of this fringe hangs directly over the bridge of the nose,
     * which is precisely where both eyes are. Parting it is what real hair does and what
     * every character design does for the same reason: the face has to get out from under
     * it. Long at the sides also frames the face, which is the look this was after anyway.
     */
    const len = drop * (1.12 - 0.45 * Math.sin(t * Math.PI))
    // Wide and flat rather than round. Round strands at this size read as a row of teeth
    // across the forehead; overlapping flat locks read as a curtain of hair, which is what
    // a fringe is. The width is deliberately more than the spacing so they overlap.
    // Wide enough to overlap its neighbour and no wider. The first pass at this used round
    // strands and read as a row of teeth; the correction went too far the other way and
    // gave a solid slab across the brow, which hides the eyes just as effectively.
    const g = strand(len, R * 0.26, R * 0.1, 4)
    g.scale(1, 1, 0.4)
    put(
      g,
      Math.sin(a) * R * 0.66,
      // Grown from the hairline, hanging down the forehead — but stopping short of the brow,
      // because the eyes are the entire performance and bangs over them delete it.
      HEAD_UP + R * 0.52 - len * 0.5,
      Math.cos(a) * R * 0.78,
      Math.PI * 0.94,
      0,
      -a * 0.5
    )
    parts.push(g)
  }
  return parts
}

/**
 * The skull cap under every style: the hair that is simply lying on the head.
 *
 * `floor` matters more than it looks. Cut too high, the cap is a beret sitting on top of a
 * large bare skull and the character reads as bald with a hat on — which is exactly what the
 * first version did. Hair has to come down past the ear line before a head reads as having
 * hair at all, so the default reaches well below the head's equator and each style only
 * raises it where a shaved or tied-back silhouette actually wants scalp showing.
 */
/**
 * The shell of a hairstyle, with a face cut out of it.
 *
 * `brow` is where the hair stops at the front. It sits a touch under the head's own centre,
 * which is above the eye line — the fringe is what covers the forehead, and it is meant to be
 * seen through.
 */
function cap(lift = 1.03, floor = -R * 0.62, brow = -R * 0.1) {
  return put(faceOpening(dome(R * lift, floor), brow), 0, HEAD_UP, 0)
}

// ── the hairstyles ─────────────────────────────────────────────────────────────────────

const HAIR_BUILDERS = {
  /**
   * Shonen and sports: everything sweeps up and *back*, hard.
   *
   * The obvious construction — spikes pushed out along the sphere's own normals — is wrong,
   * and wrong in a way that only shows once it is on a head: normals point outward evenly,
   * so the spikes ring the skull like a crown of teeth and the front ones stab forward over
   * the face. Real spiky hair is combed. Every spike here starts on the upper half and
   * leans toward the back of the head, with the lean growing the further forward it starts,
   * which is what turns a hedgehog into a haircut.
   */
  spiky() {
    const parts = [cap(1.0, -R * 0.5), ...fringe(6, 0.3, 1.7)]
    const rows = [
      { count: 5, ring: 0.42, y: 1.0, len: 1.15 },
      { count: 6, ring: 0.72, y: 0.66, len: 0.95 },
      { count: 5, ring: 0.88, y: 0.18, len: 0.7 },
    ]
    for (const row of rows) {
      for (let i = 0; i < row.count; i++) {
        // Spread across the back three-quarters only: nothing grows out over the face.
        const a = Math.PI + ((i + 0.5) / row.count - 0.5) * Math.PI * 1.55
        const g = strand(R * row.len, R * 0.23, R * 0.02, 4)
        const rad = R * row.ring
        // Lean back by a fixed amount plus however far forward this spike started.
        const lean = 0.5 + (1 + Math.cos(a)) * 0.42
        put(
          g,
          Math.sin(a) * rad,
          HEAD_UP + R * row.y,
          Math.cos(a) * rad,
          -lean,
          0,
          Math.sin(a) * 0.5
        )
        parts.push(g)
      }
    }
    return merge(parts)
  },

  /** Two tails off the sides, plus the bobbles that hold them. */
  twintails() {
    const parts = [cap(1.03), ...fringe(7, 0.34, 1.9)]
    for (const side of [-1, 1]) {
      // The bobble.
      parts.push(put(new THREE.SphereGeometry(R * 0.2, 8, 6), side * R * 0.86, HEAD_UP + R * 0.5, -R * 0.1))
      // The tail: three strands fanned slightly so it has volume from every angle.
      for (let i = 0; i < 3; i++) {
        const len = R * (1.5 - i * 0.16)
        const g = strand(len, R * 0.27, R * 0.09, 5)
        put(
          g,
          side * (R * 0.9 + i * R * 0.06),
          HEAD_UP + R * 0.46,
          -R * 0.12 + (i - 1) * R * 0.16,
          0,
          0,
          // Out and down, more steeply on the outer strands.
          side * (Math.PI * 0.62 + i * 0.1)
        )
        parts.push(g)
      }
    }
    return merge(parts)
  },

  /** A long straight fall down the back, with the two front locks that frame the face. */
  long() {
    const parts = [cap(1.03), ...fringe(7, 0.33, 2.0)]
    // The back sheet: a flattened, tapered slab rather than strands, so it stays one silhouette.
    parts.push(put(box(R * 1.5, R * 2.1, R * 0.72, 1), 0, HEAD_UP - R * 0.62, -R * 0.34))
    parts.push(put(box(R * 1.15, R * 0.8, R * 0.6, 1), 0, HEAD_UP - R * 1.62, -R * 0.3))
    // Face-framing locks, kept outside the eye line.
    for (const side of [-1, 1]) {
      const g = strand(R * 1.5, R * 0.2, R * 0.07, 5)
      put(g, side * R * 0.74, HEAD_UP + R * 0.28, R * 0.24, 0, 0, side * Math.PI * 0.96)
      parts.push(g)
    }
    return merge(parts)
  },

  /** A blunt bob: a rounded helmet of hair with a hard bottom edge. */
  bob() {
    const parts = [cap(1.06, -R * 0.62), ...fringe(8, 0.32, 2.1)]
    // The flare at the jawline is what makes a bob a bob.
    const flare = new THREE.CylinderGeometry(R * 1.14, R * 1.02, R * 0.7, 16, 1, true)
    parts.push(put(flare, 0, HEAD_UP - R * 0.5, -R * 0.04))
    parts.push(put(new THREE.CircleGeometry(R * 1.14, 16), 0, HEAD_UP - R * 0.85, -R * 0.04, Math.PI / 2))
    return merge(parts)
  },

  /** Shaved sides, a knot on the crown, and a short tail off the back of it. */
  topknot() {
    const parts = [cap(0.99, R * 0.02)]
    parts.push(...fringe(4, 0.18, 1.1))
    parts.push(put(new THREE.SphereGeometry(R * 0.3, 9, 7), 0, HEAD_UP + R * 1.06, -R * 0.06))
    const tail = strand(R * 0.9, R * 0.17, R * 0.05, 5)
    parts.push(put(tail, 0, HEAD_UP + R * 1.14, -R * 0.16, Math.PI * 0.72))
    // The tie.
    parts.push(put(new THREE.CylinderGeometry(R * 0.2, R * 0.2, R * 0.12, 10), 0, HEAD_UP + R * 0.86, -R * 0.06))
    return merge(parts)
  },

  /** Tight at the sides, swept hard to one side on top. */
  undercut() {
    const parts = [cap(0.98, R * 0.06)]
    // The sweep: five strands laid across the crown, all leaning the same way.
    for (let i = 0; i < 5; i++) {
      const t = i / 4
      const g = strand(R * (0.72 - t * 0.16), R * 0.26, R * 0.08, 4)
      put(
        g,
        (t - 0.5) * R * 1.1,
        HEAD_UP + R * 0.62,
        R * (0.42 - t * 0.24),
        Math.PI * 0.36,
        0,
        -Math.PI * 0.34
      )
      parts.push(g)
    }
    return merge(parts)
  },

  /**
   * Hime cut: blunt fringe, two straight sidelocks at the jaw, long behind. The most
   * formal silhouette in the set and the one that reads as "important" from a distance.
   */
  hime() {
    const parts = [cap(1.04, -R * 0.66), ...fringe(9, 0.34, 2.3)]
    parts.push(put(box(R * 1.5, R * 2.2, R * 0.74, 1), 0, HEAD_UP - R * 0.7, -R * 0.34))
    for (const side of [-1, 1]) {
      // The sidelocks are cut square at the jaw, which is the whole point of the style —
      // tapered strands here read as an ordinary long cut instead.
      const lock = box(R * 0.4, R * 1.5, R * 0.5, 0.5)
      put(lock, side * R * 0.82, HEAD_UP - R * 0.35, R * 0.16)
      parts.push(lock)
    }
    return merge(parts)
  },

  /** A single thick braid over one shoulder, tapering to a tie. */
  braid() {
    const parts = [cap(1.02, -R * 0.5), ...fringe(6, 0.3, 1.8)]
    // Built as a run of shrinking beads: a braid is lumpy, and a smooth cone is a tail.
    const beads = 7
    for (let i = 0; i < beads; i++) {
      const t = i / (beads - 1)
      const bead = new THREE.SphereGeometry(R * (0.28 - t * 0.15), 8, 6)
      bead.scale(1, 0.8, 1)
      put(
        bead,
        R * (0.4 + t * 0.5),
        HEAD_UP - R * (0.1 + t * 1.5),
        -R * (0.3 - t * 0.1),
        0,
        0,
        0
      )
      parts.push(bead)
    }
    parts.push(put(new THREE.CylinderGeometry(R * 0.11, R * 0.11, R * 0.13, 8), R * 0.9, HEAD_UP - R * 1.62, -R * 0.2))
    return merge(parts)
  },

  /** Messy bedhead: short, and going in every direction at once but not spiked. */
  messy() {
    const parts = [cap(1.05, -R * 0.55), ...fringe(7, 0.28, 2.0)]
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2
      const tuft = strand(R * (0.4 + (i % 3) * 0.14), R * 0.22, R * 0.09, 4)
      // Short, fat and only loosely aligned — the difference between bedhead and a hedgehog
      // is length and taper, not direction.
      put(
        tuft,
        Math.sin(a) * R * 0.6,
        HEAD_UP + R * 0.68,
        Math.cos(a) * R * 0.55,
        -0.5 + Math.cos(a) * 0.45,
        0,
        Math.sin(a) * 0.55
      )
      parts.push(tuft)
    }
    return merge(parts)
  },

  /** Very long and wild — the late-arc power-up silhouette. */
  wild() {
    // Long again. Shortening the whole shell was the first attempt at getting the face out
    // from under this, and it cost the style the length its name is about; `cap` now cuts the
    // face opening itself, so the back and sides can stay as long as they were meant to be.
    const parts = [cap(1.02, -R * 0.5), ...fringe(5, 0.28, 1.6)]
    const spikes = 13
    for (let i = 0; i < spikes; i++) {
      // Behind the temples only. Swept the full way round, the front spikes hang down over
      // the eyes and the character loses its entire performance to its own haircut.
      const a = Math.PI + ((i + 0.5) / spikes - 0.5) * Math.PI * 1.45
      const len = R * (1.5 + (i % 3) * 0.45)
      const g = strand(len, R * 0.26, R * 0.03, 4)
      const ring = R * (0.5 + (i % 2) * 0.4)
      put(
        g,
        Math.sin(a) * ring,
        HEAD_UP + R * (0.45 + (i % 3) * 0.28),
        Math.cos(a) * ring,
        -0.85 + Math.cos(a) * 0.3,
        0,
        Math.sin(a) * 0.7
      )
      parts.push(g)
    }
    return merge(parts)
  },

  /** Pulled back into a single high tail. */
  ponytail() {
    const parts = [cap(1.0, -R * 0.1), ...fringe(5, 0.26, 1.6)]
    parts.push(put(new THREE.CylinderGeometry(R * 0.19, R * 0.19, R * 0.14, 10), 0, HEAD_UP + R * 0.66, -R * 0.72, Math.PI * 0.2))
    for (let i = 0; i < 2; i++) {
      const g = strand(R * (1.8 - i * 0.3), R * 0.25, R * 0.06, 5)
      put(g, (i - 0.5) * R * 0.18, HEAD_UP + R * 0.6, -R * 0.78, Math.PI * (0.78 + i * 0.06))
      parts.push(g)
    }
    return merge(parts)
  },
}

/**
 * The ahoge — the single hair that stands up off the crown and refuses to lie down. It is
 * its own mesh rather than part of each style because it is *animated*: it lags and springs
 * as the character turns, which is the cheapest life you can buy on a static silhouette.
 */
export function ahogeGeometry() {
  // Thin, small, and only three-quarters of a turn. A full loop of thick tube reads as a
  // handle welded to the skull rather than as one hair that will not lie down.
  const g = new THREE.TorusGeometry(R * 0.17, R * 0.028, 4, 12, Math.PI * 0.78)
  g.rotateY(Math.PI / 2)
  g.rotateZ(-0.5)
  g.translate(0, R * 0.14, 0)
  return g
}

export const HAIR_STYLES = Object.keys(HAIR_BUILDERS)

export function buildHair(style) {
  const build = HAIR_BUILDERS[style] || HAIR_BUILDERS.spiky
  return build()
}

// ── the props ──────────────────────────────────────────────────────────────────────────

/**
 * Each prop declares the bone it rides and its geometry. `slot` is one of the three bones
 * the rig bakes world transforms for — `head`, `chest`, `hand` — and the geometry is
 * authored in that bone's space.
 *
 * The rule the head props all obey: nothing crosses the eye line. A pair of shades over an
 * anime face removes the only thing anyone looks at, so the shades sit pushed up on the
 * forehead, which is both readable and how they are drawn half the time anyway.
 */
const PROP_BUILDERS = {
  headband: {
    slot: 'head',
    tint: 'trim',
    build() {
      const band = new THREE.CylinderGeometry(R * 1.02, R * 1.02, R * 0.24, 16, 1, true)
      put(band, 0, HEAD_UP + R * 0.5, 0)
      // The two tails streaming off the back.
      const tails = [band]
      for (const side of [-1, 1]) {
        const t = strand(R * 1.15, R * 0.13, R * 0.09, 4)
        put(t, side * R * 0.3, HEAD_UP + R * 0.5, -R * 0.95, Math.PI * 0.62, 0, side * 0.2)
        tails.push(t)
      }
      return merge(tails)
    },
  },

  visor: {
    slot: 'head',
    tint: 'trim',
    // Pushed up onto the forehead, so it reads as pilot gear without blanking the face.
    build: () => put(box(R * 1.7, R * 0.3, R * 0.5, 1), 0, HEAD_UP + R * 0.66, R * 0.34, -0.32),
  },

  shades: {
    slot: 'head',
    tint: 'ink',
    build: () => put(box(R * 1.6, R * 0.26, R * 0.42, 1), 0, HEAD_UP + R * 0.62, R * 0.42, -0.28),
  },

  mask: {
    slot: 'head',
    tint: 'outfit',
    // Across the mouth only — the ninja read, and it leaves the eyes doing the acting.
    build: () => put(dome(R * 1.03, -R * 0.5, 12, 6), 0, HEAD_UP - R * 0.05, 0, Math.PI, 0, 0),
  },

  ears: {
    slot: 'head',
    tint: 'hair',
    build() {
      const parts = []
      for (const side of [-1, 1]) {
        const outer = new THREE.ConeGeometry(R * 0.26, R * 0.5, 5)
        put(outer, side * R * 0.52, HEAD_UP + R * 0.92, -R * 0.04, 0, 0, side * 0.28)
        parts.push(outer)
      }
      return merge(parts)
    },
  },

  towel: {
    slot: 'chest',
    tint: 'trim',
    // Slung round the neck, hanging down both sides.
    build() {
      const parts = []
      for (const side of [-1, 1]) {
        parts.push(put(box(R * 0.3, R * 0.9, R * 0.16, 1), side * R * 0.4, R * 0.5, R * 0.24))
      }
      parts.push(put(box(R * 1.0, R * 0.22, R * 0.5, 1), 0, R * 0.86, 0))
      return merge(parts)
    },
  },

  satchel: {
    slot: 'chest',
    tint: 'trim',
    build() {
      const bag = put(box(R * 0.8, R * 0.62, R * 0.4, 1), R * 0.52, -R * 0.3, -R * 0.05)
      const strapg = put(box(R * 0.18, R * 1.3, R * 0.16, 0.6), R * 0.16, R * 0.24, R * 0.02, 0, 0, -0.42)
      return merge([bag, strapg])
    },
  },

  cloak: {
    slot: 'chest',
    tint: 'outfit',
    build() {
      const c = new THREE.CylinderGeometry(R * 0.62, R * 1.35, R * 1.9, 14, 1, true)
      put(c, 0, R * 0.05, -R * 0.12)
      const collar = new THREE.TorusGeometry(R * 0.52, R * 0.15, 5, 12)
      put(collar, 0, R * 0.86, 0, Math.PI / 2)
      return merge([c, collar])
    },
  },

  strawhat: {
    slot: 'head',
    tint: 'trim',
    build() {
      // A wide flat brim and a shallow crown. The brim is the whole silhouette, so it is
      // deliberately wider than the head is tall.
      const brim = new THREE.CylinderGeometry(R * 1.95, R * 1.95, R * 0.09, 18)
      put(brim, 0, HEAD_UP + R * 0.62, 0)
      const crown = dome(R * 1.12, 0, 14, 6)
      put(crown, 0, HEAD_UP + R * 0.6, 0)
      const band = new THREE.CylinderGeometry(R * 1.14, R * 1.14, R * 0.16, 16, 1, true)
      put(band, 0, HEAD_UP + R * 0.72, 0)
      return merge([brim, crown, band])
    },
  },

  scarf: {
    slot: 'chest',
    tint: 'trim',
    build() {
      const parts = []
      // Wound round the neck twice, with one long tail streaming behind.
      for (let i = 0; i < 2; i++) {
        const wrap = new THREE.TorusGeometry(R * 0.52, R * 0.15, 6, 14)
        put(wrap, 0, R * 0.82 - i * R * 0.2, 0, Math.PI / 2)
        parts.push(wrap)
      }
      const tail = box(R * 0.34, R * 1.5, R * 0.14, 0.4)
      put(tail, R * 0.3, R * 0.1, -R * 0.4, 0.35, 0, 0.25)
      parts.push(tail)
      return merge(parts)
    },
  },

  book: {
    slot: 'hand',
    tint: 'ink',
    build() {
      const covers = box(R * 0.62, R * 0.82, R * 0.16, 0)
      put(covers, 0, R * 0.2, 0)
      const pages = box(R * 0.54, R * 0.74, R * 0.13, 0)
      put(pages, 0, R * 0.2, R * 0.02)
      return merge([covers, pages])
    },
  },

  greatsword: {
    slot: 'hand',
    tint: 'ink',
    build() {
      // Absurdly large on purpose: this is the late-arc weapon, and a sensible one reads as
      // a bread knife at the size these render.
      const blade = box(R * 0.16, R * 3.2, R * 0.62, 0)
      put(blade, 0, R * 2.0, 0)
      const guard = box(R * 0.2, R * 0.16, R * 1.0, 0)
      put(guard, 0, R * 0.4, 0)
      const grip = new THREE.CylinderGeometry(R * 0.1, R * 0.11, R * 0.7, 6)
      put(grip, 0, R * 0.05, 0)
      return merge([blade, guard, grip])
    },
  },

  katana: {
    slot: 'hand',
    tint: 'ink',
    build() {
      const blade = put(box(R * 0.09, R * 2.3, R * 0.22), 0, R * 1.5, 0)
      const guard = put(new THREE.CylinderGeometry(R * 0.22, R * 0.22, R * 0.07, 10), 0, R * 0.34, 0)
      const grip = put(box(R * 0.12, R * 0.6, R * 0.14), 0, 0, 0)
      return merge([blade, guard, grip])
    },
  },

  wand: {
    slot: 'hand',
    tint: 'trim',
    build() {
      const shaft = put(new THREE.CylinderGeometry(R * 0.05, R * 0.06, R * 1.3, 6), 0, R * 0.65, 0)
      // The star: an octahedron reads as a five-point star in silhouette and costs eight faces.
      const star = put(new THREE.OctahedronGeometry(R * 0.3, 0), 0, R * 1.44, 0)
      return merge([shaft, star])
    },
  },

  mic: {
    slot: 'hand',
    tint: 'ink',
    build() {
      const stick = put(new THREE.CylinderGeometry(R * 0.08, R * 0.07, R * 0.72, 8), 0, R * 0.36, 0)
      const headg = put(new THREE.SphereGeometry(R * 0.17, 8, 6), 0, R * 0.78, 0)
      return merge([stick, headg])
    },
  },

  lantern: {
    slot: 'hand',
    tint: 'trim',
    build() {
      const handle = new THREE.TorusGeometry(R * 0.16, R * 0.03, 4, 10, Math.PI)
      put(handle, 0, R * 0.34, 0)
      const body = put(box(R * 0.34, R * 0.44, R * 0.34, 0.35), 0, R * 0.1, 0)
      return merge([handle, body])
    },
  },
}

export const PROP_KINDS = Object.keys(PROP_BUILDERS)

export function propSpec(kind) {
  return PROP_BUILDERS[kind] || null
}

export function buildProp(kind) {
  const spec = PROP_BUILDERS[kind]
  return spec ? spec.build() : null
}

/**
 * The head. A sphere, squashed into an anime skull, with the face painted on the front by
 * `faces.js`. It replaces the space colony's helmet in the same instanced slot, which is
 * why it is measured off the same `HEAD_R` the helmet used.
 */
export function headGeometry() {
  const g = new THREE.SphereGeometry(R, 18, 13)
  g.scale(HEAD_SCALE.x, HEAD_SCALE.y, HEAD_SCALE.z)
  // A slight forward bias to the jaw, so the profile is not a perfect ball.
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    if (y < 0) pos.setZ(i, pos.getZ(i) + (-y / R) * R * 0.06)
  }
  pos.needsUpdate = true
  g.computeVertexNormals()
  g.translate(0, HEAD_UP, 0)
  return g
}

/**
 * A four-step cel ramp, as a gradient map for `MeshToonMaterial`.
 *
 * Toon shading is the other half of the anime read, after the eyes: it collapses the
 * lighting into flat bands so a character looks *drawn* rather than lit. The steps are
 * deliberately uneven — a wide lit band, a narrow terminator, and a shadow that never goes
 * fully black, because ink-and-paint never does either.
 */
export function toonGradient() {
  /**
   * Six steps rather than four, and the lit end of the ramp compressed.
   *
   * Four hard bands is textbook cel shading and it is *loud*: a face crossing a terminator
   * jumps a quarter of its brightness in one pixel, which is what makes a character read as
   * a flat sticker rather than as an object standing in light. Six steps with the top three
   * close together keeps the drawn look — there are still bands, and the shadow still never
   * goes to black — while letting the lit side round off the way a real surface does.
   */
  const steps = [0.44, 0.58, 0.7, 0.82, 0.92, 1.0]
  const data = new Uint8Array(steps.length * 4)
  steps.forEach((v, i) => {
    const b = Math.round(v * 255)
    data[i * 4] = b
    data[i * 4 + 1] = b
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  })
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

/** Skin tones, picked per character off its id so a crowd is not one colour. */
export const SKIN_TONES = [0xffe0c4, 0xf7d0aa, 0xe8b990, 0xd19a6e, 0xa9704c, 0x7d4f33]
