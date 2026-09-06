import * as THREE from 'three'

/**
 * Procedurally drawn surfaces for the colony's own structures — the plot decks and the
 * kerbs that edge them.
 *
 * These are drawn rather than shipped for the same reason the face atlas is: they have to
 * take each repo's accent colour, and a painted texture cannot. Everything here is authored
 * neutral grey so the material's own colour multiplies through cleanly, and the *pattern*
 * carries the detail instead.
 *
 * Each surface comes with a normal map derived from its own height field, which is what
 * makes the difference between a picture of a deck and a deck: panel seams catch a shadow
 * along one edge and a highlight along the other as the sun moves, and the bolt heads pick
 * out the light. On a surface this large and this flat, that relief is doing most of the
 * work — a flat albedo pattern under a single directional light reads as wallpaper.
 *
 * Both are generated once and shared by every plot in the colony.
 */

/** World units one tile of the deck texture covers. Two panels to a tile. */
export const DECK_TEXTURE_SCALE = 4

let deck = null
let kerb = null

/**
 * The plot deck: a plated metal floor of bolted panels.
 *
 * Authored to tile, so a plot of seven hex cells reads as one continuous apron rather than
 * seven repeats of a medallion.
 */
export function deckSurface(size = 512) {
  if (deck) return deck

  const albedo = canvas(size)
  const height = canvas(size)
  const a = albedo.ctx
  const h = height.ctx

  /**
   * Boardwalk, not bulkhead.
   *
   * The space version drew a bolted steel plate here, and it was doing more damage to the
   * setting than anything else on the ground: a zone is a big flat field of this texture,
   * so whatever it is made of is what the whole world is made of. Planks with a visible
   * grain read as a shrine veranda, a festival stage or a boardwalk depending only on the
   * tint the plot puts over them, which is exactly the range these worlds need.
   *
   * Authored in neutral grey, like the plate before it, because the plot multiplies its own
   * colour over the top — see `plots.js`.
   */
  a.fillStyle = '#8e8b86'
  a.fillRect(0, 0, size, size)
  h.fillStyle = '#808080'
  h.fillRect(0, 0, size, size)

  const boards = 6
  const boardH = size / boards
  const gap = Math.max(2, Math.round(size / 220))
  const rand = mulberry(0x5eed)

  for (let i = 0; i < boards; i++) {
    const y = i * boardH
    // Each board a shade off its neighbour. Timber is never one flat field, and the
    // variation is what stops a large deck looking like printed paper.
    const shade = 140 + Math.round((rand() - 0.5) * 22)
    a.fillStyle = `rgb(${shade},${shade - 4},${shade - 10})`
    a.fillRect(0, y + gap, size, boardH - gap * 2)

    // Grain: long, low-contrast strokes running the length of the board.
    const grains = 7 + Math.floor(rand() * 6)
    for (let g = 0; g < grains; g++) {
      const gy = y + gap + rand() * (boardH - gap * 2)
      const dark = rand() > 0.5
      a.strokeStyle = dark ? 'rgba(96,88,78,0.30)' : 'rgba(196,186,172,0.26)'
      a.lineWidth = Math.max(1, (size / 512) * (0.7 + rand()))
      a.beginPath()
      a.moveTo(0, gy)
      // A shallow wander, so the grain is not a ruled line.
      const mid = gy + (rand() - 0.5) * boardH * 0.28
      a.quadraticCurveTo(size * 0.5, mid, size, gy + (rand() - 0.5) * boardH * 0.2)
      a.stroke()
    }

    // A knot every few boards. One clear detail beats a field of noise.
    if (rand() > 0.55) {
      const kx = rand() * size
      const ky = y + boardH * 0.5
      const kr = (size / 512) * (4 + rand() * 5)
      for (let r = 3; r >= 1; r--) {
        a.strokeStyle = `rgba(92,80,68,${0.1 + r * 0.08})`
        a.lineWidth = Math.max(1, size / 460)
        a.beginPath()
        a.ellipse(kx, ky, kr * r * 0.55, kr * r * 0.34, 0, 0, Math.PI * 2)
        a.stroke()
      }
    }
  }

  // The gaps between boards, cut into the height field so they read as real grooves and
  // drawn dark in the albedo so they survive at grazing angles where a normal map does
  // almost nothing.
  a.strokeStyle = 'rgba(48,40,33,0.9)'
  h.strokeStyle = '#3c3c3c'
  a.lineWidth = gap
  h.lineWidth = gap
  for (let i = 0; i <= boards; i++) {
    for (const ctx of [a, h]) {
      ctx.beginPath()
      ctx.moveTo(0, i * boardH)
      ctx.lineTo(size, i * boardH)
      ctx.stroke()
    }
  }

  // Cross joints, staggered board to board the way a laid floor actually is.
  for (let i = 0; i < boards; i++) {
    const jx = (0.2 + rand() * 0.6) * size
    for (const ctx of [a, h]) {
      ctx.beginPath()
      ctx.moveTo(jx, i * boardH + gap)
      ctx.lineTo(jx, (i + 1) * boardH - gap)
      ctx.stroke()
    }
  }

  // Nail heads, in pairs at the ends of each board. The detail the eye catches, so they get
  // the strongest relief on the height sheet.
  const nail = Math.max(1.5, size / 260)
  for (let i = 0; i < boards; i++) {
    const y = i * boardH + boardH * 0.5
    for (const x of [size * 0.06, size * 0.5, size * 0.94]) {
      for (const dy of [-boardH * 0.3, boardH * 0.3]) {
        a.fillStyle = 'rgba(72,64,56,0.8)'
        dot(a, x, y + dy, nail)
        h.fillStyle = '#9a9a9a'
        dot(h, x, y + dy, nail)
      }
    }
  }

  // Wear: scuffed patches where feet have been.
  for (let i = 0; i < 90; i++) {
    const x = rand() * size
    const y = rand() * size
    const r = (0.6 + rand() * 2.4) * (size / 128)
    a.fillStyle = `rgba(${rand() > 0.5 ? '210,202,188' : '92,82,70'},${0.03 + rand() * 0.05})`
    dot(a, x, y, r)
  }

  const map = texture(albedo.el, THREE.SRGBColorSpace)
  deck = {
    map,
    normalMap: normalFrom(height, 1.7),
    // The albedo doubles as the roughness map: three reads the green channel, and a scuffed
    // board being a little duller than a clean one is exactly the correlation wanted here.
    roughnessMap: texture(albedo.el, THREE.NoColorSpace),
  }
  return deck
}

export function kerbSurface(size = 128) {
  if (kerb) return kerb

  // Two bands. The top half is the lit strip; the bottom half is a plain patch that every
  // face except the kerb's upper surface points at.
  //
  // A box gives all six of its faces the same 0..1 UV square, so a strip drawn once gets
  // stretched across the ends and down the sides as well — and on a bar 14cm tall that
  // squashes the dark gaps between dashes into a solid black edge. Sending the other five
  // faces to a patch of flat colour is what keeps the sides reading as painted kerb.
  const h = size / 2
  const albedo = canvas(size, h)
  const glow = canvas(size, h)
  const height = canvas(size, h)
  const band = h / 2

  // The strip: dark channel, white dashes, and a raised lip either side of them.
  albedo.ctx.fillStyle = '#3c4148'
  albedo.ctx.fillRect(0, 0, size, band)
  glow.ctx.fillStyle = '#000000'
  glow.ctx.fillRect(0, 0, size, h)
  height.ctx.fillStyle = '#606060'
  height.ctx.fillRect(0, 0, size, band)

  const dashes = 6
  const pitch = size / dashes
  const len = pitch * 0.62
  for (let i = 0; i < dashes; i++) {
    const x = i * pitch + (pitch - len) / 2
    albedo.ctx.fillStyle = '#e9edf2'
    albedo.ctx.fillRect(x, band * 0.22, len, band * 0.56)
    glow.ctx.fillStyle = '#ffffff'
    glow.ctx.fillRect(x, band * 0.22, len, band * 0.56)
    height.ctx.fillStyle = '#d0d0d0'
    height.ctx.fillRect(x, band * 0.18, len, band * 0.64)
  }

  // The plain patch: near-white so the material's accent comes through at full strength,
  // unlit so the sides stay dark after nightfall, and flat so the normal map leaves them be.
  albedo.ctx.fillStyle = '#e6e9ee'
  albedo.ctx.fillRect(0, band, size, h - band)
  height.ctx.fillStyle = '#808080'
  height.ctx.fillRect(0, band, size, h - band)

  kerb = {
    map: texture(albedo.el, THREE.SRGBColorSpace),
    emissiveMap: texture(glow.el, THREE.SRGBColorSpace),
    normalMap: normalFrom(height, 1.1),
  }
  return kerb
}

/**
 * Where on the kerb texture a face should look, given which way it points.
 *
 * `top` is the lit dash strip; everything else lands on the plain patch.
 */
export const KERB_UV = {
  top: { v0: 0.04, v1: 0.46 },
  side: { u: 0.5, v: 0.75 },
}

// ── drawing helpers ───────────────────────────────────────────────────────────────────

function canvas(w, h = w) {
  const el = document.createElement('canvas')
  el.width = w
  el.height = h
  return { el, ctx: el.getContext('2d', { willReadFrequently: true }) }
}

function dot(ctx, x, y, r) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function texture(el, colorSpace) {
  const t = new THREE.CanvasTexture(el)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.colorSpace = colorSpace
  t.anisotropy = 8
  return t
}

/**
 * Sobel a height field into a tangent-space normal map.
 *
 * Sampling wraps at the edges, because a normal map whose borders do not agree puts a hard
 * seam down every tile boundary — which on a floor built out of tiles is every seam there
 * is.
 */
function normalFrom({ ctx, el }, strength) {
  const w = el.width
  const h = el.height
  const src = ctx.getImageData(0, 0, w, h).data
  const out = ctx.createImageData(w, h)
  const at = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) - (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) - (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
      const nx = dx * strength
      const ny = dy * strength
      const len = Math.hypot(nx, ny, 1)
      const i = (y * w + x) * 4
      out.data[i] = ((nx / len) * 0.5 + 0.5) * 255
      out.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255
      out.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5
      out.data[i + 3] = 255
    }
  }

  const dest = canvas(w, h)
  dest.ctx.putImageData(out, 0, 0)
  return texture(dest.el, THREE.NoColorSpace)
}

/** The same small PRNG the rest of the world uses, kept local so this module stands alone. */
function mulberry(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
