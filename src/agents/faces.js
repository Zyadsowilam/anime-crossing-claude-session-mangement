import * as THREE from 'three'

/**
 * The anime faces.
 *
 * Sixteen expressions, drawn once into a single 4×4 canvas atlas and shared by every
 * character on the surface. Nothing here is finished artwork — the atlas is a **three
 * channel mask**, and the colour arrives per-character at draw time:
 *
 * - **red — ink.** Lash lines, brows, mouth, pupil. Painted almost black at draw time.
 *   This is the channel that makes a face read as drawn rather than as lit geometry.
 * - **green — iris.** The coloured part of the eye, multiplied by the character's own eye
 *   colour. Lifted a little above 1.0 and no further — an iris bright enough for the bloom
 *   pass is an iris that smears into a white hole where the face used to be.
 * - **blue — highlight.** Sclera and the specular catchlight. Painted white.
 *
 * One texture, three layers, and every character in the colony gets its own eye colour
 * without a second byte of memory. That split is the whole reason these read as anime eyes
 * instead of the glowing dots a single-channel mask can express: an anime eye is a dark
 * outline *around* a saturated iris *around* a white catchlight, and one channel cannot
 * say all three.
 *
 * The channels are kept mutually exclusive by `paint` below, so drawing order inside a cell
 * is exactly paint order: a later shape replaces what an earlier one put down, the way ink
 * on paper does.
 */

export const FRAME_COLS = 4
export const FRAME_ROWS = 4

/** Frame ids, in atlas order. The index is what gets pushed to the GPU per instance. */
export const FACE = {
  idle: 0,
  blink: 1,
  happy: 2,
  work: 3,
  think1: 4,
  think2: 5,
  think3: 6,
  wait: 7,
  alert: 8,
  error: 9,
  sleep: 10,
  wink: 11,
  love: 12,
  cheer: 13,
  boot: 14,
  sad: 15,
}

/** Little loops the agent code plays instead of picking single frames. */
export const FACE_LOOPS = {
  thinking: [FACE.think1, FACE.think2, FACE.think3, FACE.think2],
  working: [FACE.work, FACE.work, FACE.work, FACE.happy],
  celebrating: [FACE.cheer, FACE.happy, FACE.cheer, FACE.love],
  waiting: [FACE.wait, FACE.wait, FACE.alert, FACE.wait],
  broken: [FACE.error, FACE.error, FACE.sad, FACE.error],
  sleeping: [FACE.sleep],
}

/** Channel routing: each layer is stamped in its own pure primary. See `paint`. */
const INK = '#ff0000'
const IRIS = '#00ff00'
const LIT = '#0000ff'

/**
 * Paint one shape into one channel, and only that channel.
 *
 * This is the piece the first version got wrong, and it is worth spelling out because the
 * failure looks like a lighting bug rather than a compositing one. The shader paints ink,
 * then iris over it, then highlight over that. So if the sclera is filled across the whole
 * eye and the iris is merely drawn into a different channel on top, the highlight channel
 * is still lit underneath the iris — and the last mix wins, so both eyes render as flat
 * white ovals with no iris and no pupil at all.
 *
 * The fix is to make the three channels mutually exclusive: every pixel belongs to exactly
 * one layer. Each shape is therefore stamped twice — once with destination-out to clear
 * whatever an earlier layer put there, then once in its own primary. Drawing order becomes
 * paint order, the way it is on paper.
 */
function paint(ctx, channel, draw) {
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  draw(ctx)
  ctx.restore()

  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = channel
  ctx.strokeStyle = channel
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  draw(ctx)
  ctx.restore()
}

export function buildFaceAtlas(size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const cell = size / FRAME_COLS

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, size, size)

  for (const [name, index] of Object.entries(FACE)) {
    const cx = (index % FRAME_COLS) * cell
    const cy = Math.floor(index / FRAME_COLS) * cell
    ctx.save()
    ctx.translate(cx, cy)
    // Every drawing routine works in a 0..1 box, so the atlas can change size freely.
    ctx.scale(cell, cell)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    DRAW[name](ctx)
    ctx.restore()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.NoColorSpace // it is a mask, not colour — no sRGB decode
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  // Clamping stops a frame from bleeding into its neighbour when mips get small.
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  return texture
}

// ── geometry of an anime face, all in a 0..1 unit box ──────────────────────────────────

/**
 * Eyes sit low and wide apart, and they are *big* — a little over a fifth of the face each.
 * That proportion is the single strongest anime signal available at this size; hair shape
 * and palette do the rest.
 */
const EYE_L = 0.315
const EYE_R = 0.685
const EYE_Y = 0.47
const EYE_W = 0.23
const EYE_H = 0.28

function dot(ctx, x, y, r, channel) {
  paint(ctx, channel, (c) => {
    c.beginPath()
    c.arc(x, y, r, 0, Math.PI * 2)
    c.fill()
  })
}

/**
 * One full anime eye, in layers: sclera, iris, pupil, the heavy upper lash line, and two
 * catchlights — a big one up top and a small one low and opposite, which is the trick that
 * makes a flat iris look wet.
 *
 * `open` scales the eye vertically, so the same routine draws a wide stare and a squint.
 * `look` slides the iris within the sclera for glances.
 */
function animeEye(ctx, x, y, w = EYE_W, h = EYE_H, open = 1, look = 0, lookY = 0) {
  const hh = h * open
  if (hh < 0.02) return arcEye(ctx, x, y, w, false)

  // Painted in the order an eye is drawn on paper, each layer clearing the one beneath.
  // Sclera: a rounded almond, wider than tall.
  paint(ctx, LIT, (c) => {
    c.beginPath()
    c.ellipse(x, y, w / 2, hh / 2, 0, 0, Math.PI * 2)
    c.fill()
  })

  const ix = x + look * w * 0.16
  const iy = y + lookY * hh * 0.16
  // Iris: nearly the full height of the eye, which is what separates an anime eye from a
  // cartoon dot — the sclera survives only as two slivers at the corners.
  const ir = Math.min(w * 0.38, hh * 0.46)
  dot(ctx, ix, iy, ir, IRIS)
  dot(ctx, ix, iy, ir * 0.46, INK)

  // Upper lash line: thick, and drawn past the outer corner where a real one flicks up.
  paint(ctx, INK, (c) => {
    c.lineWidth = Math.max(0.03, hh * 0.19)
    c.beginPath()
    c.moveTo(x - w / 2 - 0.01, y - hh * 0.14)
    c.quadraticCurveTo(x, y - hh * 0.78, x + w / 2 + 0.012, y - hh * 0.18)
    c.stroke()
  })

  // Catchlights. The pair is deliberate: one large, one small, on opposite sides.
  dot(ctx, ix - ir * 0.34, iy - ir * 0.38, ir * 0.36, LIT)
  dot(ctx, ix + ir * 0.4, iy + ir * 0.42, ir * 0.18, LIT)
}

/** A closed or curved eye: the `^` of delight, or the `‿` of a blink. */
function arcEye(ctx, x, y, w, up, thickness = 0.05) {
  paint(ctx, INK, (c) => {
    c.lineWidth = thickness
    c.beginPath()
    if (up) {
      c.moveTo(x - w / 2, y + w * 0.3)
      c.quadraticCurveTo(x, y - w * 0.44, x + w / 2, y + w * 0.3)
    } else {
      c.moveTo(x - w / 2, y - w * 0.26)
      c.quadraticCurveTo(x, y + w * 0.4, x + w / 2, y - w * 0.26)
    }
    c.stroke()
  })
}

/** Brows, angled by `tilt` — up and in is cross, down and in is worried. */
function brows(ctx, tilt, lift = 0) {
  const y = EYE_Y - EYE_H * 0.72 - lift
  paint(ctx, INK, (c) => {
    c.lineWidth = 0.032
    c.beginPath()
    c.moveTo(EYE_L - 0.1, y + tilt)
    c.lineTo(EYE_L + 0.08, y - tilt)
    c.moveTo(EYE_R + 0.1, y + tilt)
    c.lineTo(EYE_R - 0.08, y - tilt)
    c.stroke()
  })
}

function crossEye(ctx, x, y, w) {
  const h = w / 2
  paint(ctx, INK, (c) => {
    c.lineWidth = 0.05
    c.beginPath()
    c.moveTo(x - h, y - h)
    c.lineTo(x + h, y + h)
    c.moveTo(x + h, y - h)
    c.lineTo(x - h, y + h)
    c.stroke()
  })
}

function heartEye(ctx, x, y, s) {
  paint(ctx, IRIS, (c) => {
    c.beginPath()
    c.moveTo(x, y + s * 0.55)
    c.bezierCurveTo(x - s * 1.15, y - s * 0.18, x - s * 0.5, y - s * 0.95, x, y - s * 0.32)
    c.bezierCurveTo(x + s * 0.5, y - s * 0.95, x + s * 1.15, y - s * 0.18, x, y + s * 0.55)
    c.fill()
  })
  dot(ctx, x - s * 0.3, y - s * 0.22, s * 0.2, LIT)
}

/** Mouth curve. `curve` > 0 smiles, < 0 frowns, 0 is a flat line. Small — anime mouths are. */
function smile(ctx, y, w, curve, thickness = 0.036) {
  paint(ctx, INK, (c) => {
    c.lineWidth = thickness
    c.beginPath()
    c.moveTo(0.5 - w / 2, y)
    c.quadraticCurveTo(0.5, y + curve, 0.5 + w / 2, y)
    c.stroke()
  })
}

/** An open mouth — the `o` of surprise. Ink, with a lit tongue if it is wide enough. */
function openMouth(ctx, y, w, h) {
  paint(ctx, INK, (c) => {
    c.beginPath()
    c.ellipse(0.5, y, w / 2, h / 2, 0, 0, Math.PI * 2)
    c.fill()
  })
}

/** The lower half of an ellipse: a proper open-wide happy grin, with teeth. */
function grin(ctx, y, w, h) {
  paint(ctx, INK, (c) => {
    c.beginPath()
    c.ellipse(0.5, y, w / 2, h, 0, 0, Math.PI)
    c.fill()
  })
  paint(ctx, LIT, (c) => {
    c.beginPath()
    c.ellipse(0.5, y + 0.004, w / 2 - 0.012, h * 0.26, 0, 0, Math.PI)
    c.fill()
  })
}

/** The blush lines — three little strokes a side, the way they are actually drawn. */
function blush(ctx, y) {
  paint(ctx, INK, (c) => {
    c.lineWidth = 0.017
    for (const cx of [0.135, 0.865]) {
      for (let i = -1; i <= 1; i++) {
        const x = cx + i * 0.032
        c.beginPath()
        c.moveTo(x, y - 0.028)
        c.lineTo(x, y + 0.028)
        c.stroke()
      }
    }
  })
}

/** The sweatdrop. Nothing else says "this is anime" in one shape quite so cheaply. */
function sweatdrop(ctx, x = 0.855, y = 0.235, s = 0.075) {
  paint(ctx, LIT, (c) => {
    c.beginPath()
    c.moveTo(x, y - s)
    c.bezierCurveTo(x + s * 0.72, y + s * 0.3, x + s * 0.5, y + s, x, y + s)
    c.bezierCurveTo(x - s * 0.5, y + s, x - s * 0.72, y + s * 0.3, x, y - s)
    c.fill()
  })
}

function zzz(ctx) {
  paint(ctx, LIT, (c) => {
    c.lineWidth = 0.03
    const z = (x, y, s) => {
      c.beginPath()
      c.moveTo(x - s, y - s)
      c.lineTo(x + s, y - s)
      c.lineTo(x - s, y + s)
      c.lineTo(x + s, y + s)
      c.stroke()
    }
    z(0.85, 0.19, 0.045)
    z(0.935, 0.31, 0.03)
  })
}

const DRAW = {
  idle(ctx) {
    animeEye(ctx, EYE_L, EYE_Y)
    animeEye(ctx, EYE_R, EYE_Y)
    smile(ctx, 0.71, 0.11, 0.05)
  },

  blink(ctx) {
    arcEye(ctx, EYE_L, EYE_Y, 0.2, false)
    arcEye(ctx, EYE_R, EYE_Y, 0.2, false)
    smile(ctx, 0.71, 0.11, 0.05)
  },

  // Eyes squeezed into happy arcs, open grin, and the blush lines.
  happy(ctx) {
    arcEye(ctx, EYE_L, EYE_Y, 0.22, true, 0.055)
    arcEye(ctx, EYE_R, EYE_Y, 0.22, true, 0.055)
    grin(ctx, 0.66, 0.24, 0.1)
    blush(ctx, 0.58)
  },

  // Focused: lids down to a determined squint, brows in, mouth a hard little line.
  work(ctx) {
    animeEye(ctx, EYE_L, EYE_Y + 0.01, EYE_W, EYE_H, 0.62)
    animeEye(ctx, EYE_R, EYE_Y + 0.01, EYE_W, EYE_H, 0.62)
    brows(ctx, 0.028)
    smile(ctx, 0.73, 0.1, 0.008)
  },

  think1(ctx) {
    thinking(ctx, 1)
  },
  think2(ctx) {
    thinking(ctx, 2)
  },
  think3(ctx) {
    thinking(ctx, 3)
  },

  // Waiting on you: wide, hopeful, looking straight out, small patient `o`.
  wait(ctx) {
    animeEye(ctx, EYE_L, EYE_Y, EYE_W * 1.05, EYE_H * 1.08)
    animeEye(ctx, EYE_R, EYE_Y, EYE_W * 1.05, EYE_H * 1.08)
    brows(ctx, -0.018, 0.012)
    openMouth(ctx, 0.735, 0.075, 0.075)
  },

  // The `!` moment: eyes blown wide, brows up, mouth open, one sweatdrop.
  alert(ctx) {
    animeEye(ctx, EYE_L, EYE_Y, EYE_W * 1.12, EYE_H * 1.18)
    animeEye(ctx, EYE_R, EYE_Y, EYE_W * 1.12, EYE_H * 1.18)
    brows(ctx, -0.03, 0.03)
    openMouth(ctx, 0.75, 0.12, 0.11)
    sweatdrop(ctx)
  },

  error(ctx) {
    crossEye(ctx, EYE_L, EYE_Y, 0.19)
    crossEye(ctx, EYE_R, EYE_Y, 0.19)
    // A wobbly mouth — three little humps.
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.04
    ctx.beginPath()
    ctx.moveTo(0.37, 0.73)
    ctx.quadraticCurveTo(0.435, 0.67, 0.5, 0.73)
    ctx.quadraticCurveTo(0.565, 0.79, 0.63, 0.73)
    ctx.stroke()
    sweatdrop(ctx, 0.15, 0.245, 0.07)
  },

  sleep(ctx) {
    arcEye(ctx, EYE_L, EYE_Y, 0.2, false)
    arcEye(ctx, EYE_R, EYE_Y, 0.2, false)
    openMouth(ctx, 0.735, 0.07, 0.09)
    zzz(ctx)
  },

  wink(ctx) {
    arcEye(ctx, EYE_L, EYE_Y, 0.21, true, 0.055)
    animeEye(ctx, EYE_R, EYE_Y)
    smile(ctx, 0.7, 0.14, 0.06)
    blush(ctx, 0.58)
  },

  love(ctx) {
    heartEye(ctx, EYE_L, EYE_Y, 0.16)
    heartEye(ctx, EYE_R, EYE_Y, 0.16)
    grin(ctx, 0.68, 0.2, 0.085)
    blush(ctx, 0.58)
  },

  cheer(ctx) {
    // `> <` squeezed-shut delight.
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.05
    ctx.beginPath()
    ctx.moveTo(EYE_L - 0.1, EYE_Y - 0.09)
    ctx.lineTo(EYE_L + 0.05, EYE_Y)
    ctx.lineTo(EYE_L - 0.1, EYE_Y + 0.09)
    ctx.moveTo(EYE_R + 0.1, EYE_Y - 0.09)
    ctx.lineTo(EYE_R - 0.05, EYE_Y)
    ctx.lineTo(EYE_R + 0.1, EYE_Y + 0.09)
    ctx.stroke()
    grin(ctx, 0.64, 0.28, 0.14)
    blush(ctx, 0.56)
  },

  // First moment on the surface: eyes still resolving, a soft scan across them.
  boot(ctx) {
    animeEye(ctx, EYE_L, EYE_Y, EYE_W, EYE_H, 0.4)
    animeEye(ctx, EYE_R, EYE_Y, EYE_W, EYE_H, 0.4)
    paint(ctx, LIT, (c) => {
      for (let i = 0; i < 3; i++) c.fillRect(0.16, 0.34 + i * 0.07, 0.68, 0.016)
    })
    smile(ctx, 0.73, 0.08, 0.01)
  },

  sad(ctx) {
    animeEye(ctx, EYE_L, EYE_Y + 0.02, EYE_W, EYE_H * 0.92, 1, 0, 0.4)
    animeEye(ctx, EYE_R, EYE_Y + 0.02, EYE_W, EYE_H * 0.92, 1, 0, 0.4)
    brows(ctx, -0.034)
    smile(ctx, 0.76, 0.13, -0.05)
  },
}

/** Eyes rolled up and to the side, with a growing run of dots. */
function thinking(ctx, dots) {
  animeEye(ctx, EYE_L, EYE_Y - 0.01, EYE_W, EYE_H, 0.86, -0.9, -0.9)
  animeEye(ctx, EYE_R, EYE_Y - 0.01, EYE_W, EYE_H, 0.86, -0.9, -0.9)
  brows(ctx, 0.012)
  smile(ctx, 0.74, 0.08, 0.012)
  for (let i = 0; i < dots; i++) dot(ctx, 0.4 + i * 0.1, 0.235, 0.028, LIT)
}
