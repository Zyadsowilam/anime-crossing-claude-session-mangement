/**
 * Taiko — the drum stall.
 *
 * The third game, and the third *kind* of game. Kingyo-sukui asks for restraint, because the
 * net dissolves as you use it. Shateki asks for aim, because the corks are counted and the
 * prizes move. This asks for timing, which neither of the others touches: the notes arrive
 * when they arrive, and nothing you do changes that — the only question is whether your hand
 * is on the beat.
 *
 * Two drums, two hands. **F** is the near skin, **J** is the far rim, and the notes say which
 * to use. That is the whole instrument, and it is enough: what makes a rhythm game hard is
 * never the number of buttons, it is that the pattern does not wait for you.
 *
 * Like the other two, it touches nothing about your threads — see `festival.js` for why the
 * games are kept firmly on that side of the line.
 */

/** The logical play area. Scaled by CSS, like the other stalls. */
const W = 520
const H = 360

/** Where the notes are struck, measured from the left edge. */
const HIT_X = 118
/** How fast the lane scrolls, in play-area units per second. */
const SCROLL = 190

/**
 * How close to the beat counts, in seconds either side.
 *
 * Generous by the standards of a real rhythm game, and deliberately: this is a stall at a
 * festival, not a test. `GOOD` is roughly two frames at sixty either side of perfect.
 */
const PERFECT = 0.055
const GOOD = 0.115

/** The two drums a note can ask for. */
const DON = 0 // the skin, struck with F — the low, near note
const KA = 1 // the rim, struck with J — the high, far one

const COLORS = {
  back: '#1a1524',
  lane: '#241c30',
  laneEdge: '#3a2e4c',
  target: 'rgba(255,255,255,0.22)',
  don: '#e8582f',
  ka: '#5ec6e8',
  perfect: '#ffd166',
  good: '#a8e06a',
  miss: '#8a7f96',
}

/**
 * The chart: an eight-bar phrase at 100bpm, written as beats rather than seconds so it reads
 * as music. Straight fours with a couple of syncopated pairs, which is what a festival drum
 * actually sounds like and is playable on sight.
 */
const BPM = 100
const CHART = [
  [0, DON], [1, DON], [2, KA], [3, DON],
  [4, DON], [4.5, DON], [5, KA], [6, DON], [7, KA],
  [8, DON], [9, DON], [10, KA], [10.5, KA], [11, DON],
  [12, DON], [12.5, DON], [13, KA], [14, DON], [15, DON],
  [16, DON], [17, KA], [18, DON], [18.5, DON], [19, KA],
  [20, DON], [21, DON], [21.5, KA], [22, DON], [23, KA],
  [24, DON], [24.5, DON], [25, DON], [26, KA], [27, DON],
  [28, DON], [29, KA], [30, DON], [31, DON],
]

/** A beat, in seconds. */
const BEAT = 60 / BPM
/** Lead-in before the first note, so you are never struck at on the opening frame. */
const LEAD_IN = 2.2

export class TaikoGame {
  constructor(host, { onClose } = {}) {
    this.host = host
    this.onClose = onClose
    this.running = false
    this.over = false
    this.score = 0
    this.combo = 0
    this.best = 0
    this.hits = 0
    this.notes = []
    this.pops = []
    this.time = 0
    this._raf = 0
    this._last = 0
    this._build()
  }

  _build() {
    this.host.innerHTML = `
      <div class="fest-frame">
        <div class="fest-head">
          <span class="fest-title">Taiko</span>
          <span class="fest-sub">F for the red skin, J for the blue rim</span>
        </div>
        <canvas class="fest-canvas" width="${W}" height="${H}"></canvas>
        <div class="fest-foot">
          <span class="fest-score">0</span>
          <span class="fest-paper"><i style="width:0%"></i></span>
          <button class="fest-close" type="button">Leave (Esc)</button>
        </div>
      </div>`
    this.canvas = this.host.querySelector('.fest-canvas')
    this.ctx = this.canvas.getContext('2d')
    this.scoreEl = this.host.querySelector('.fest-score')
    this.progressEl = this.host.querySelector('.fest-paper i')

    // Clicking the near or far half of the drum is the mouse equivalent of the two keys, so
    // the stall is playable without knowing the keyboard mapping exists.
    this._onDown = (e) => {
      e.preventDefault()
      const r = this.canvas.getBoundingClientRect()
      const y = ((e.clientY - r.top) / r.height) * H
      this.strike(y > H / 2 ? DON : KA)
    }
    this.canvas.addEventListener('pointerdown', this._onDown)
    this.host.querySelector('.fest-close').addEventListener('click', () => this.close())
  }

  start() {
    const alreadyLooping = this.running
    this.running = true
    this.over = false
    this.score = 0
    this.combo = 0
    this.best = 0
    this.hits = 0
    this.pops = []
    this.time = 0
    this.notes = CHART.map(([beat, drum]) => ({ at: LEAD_IN + beat * BEAT, drum, done: 0 }))
    this._syncHud()
    this._last = performance.now()
    if (!alreadyLooping) this._tick()
  }

  /**
   * Hit whichever drum, and see whether anything was there.
   *
   * The nearest *unjudged* note is taken rather than the nearest note of the matching drum:
   * hitting the wrong skin at the right moment has to be a miss, and looking only at matching
   * notes would quietly forgive it by finding the next correct one further down the lane.
   */
  strike(drum) {
    if (!this.running || this.over) return
    let best = null
    let bestD = GOOD
    for (const n of this.notes) {
      if (n.done) continue
      const d = Math.abs(n.at - this.time)
      if (d < bestD) {
        bestD = d
        best = n
      }
    }
    if (!best) {
      // Struck into empty air. It breaks the combo but costs no points, because a stall that
      // punishes enthusiasm is a stall nobody plays twice.
      this.combo = 0
      this._pop(HIT_X, 'miss', '')
      return
    }
    if (best.drum !== drum) {
      best.done = 2
      this.combo = 0
      this._pop(HIT_X, 'miss', 'wrong drum')
      this._syncHud()
      return
    }
    const perfect = bestD <= PERFECT
    best.done = 1
    this.hits++
    this.combo++
    this.best = Math.max(this.best, this.combo)
    this.score += (perfect ? 300 : 100) + Math.min(this.combo, 20) * 5
    this._pop(HIT_X, perfect ? 'perfect' : 'good', perfect ? 'perfect' : 'good')
    this._syncHud()
  }

  _pop(x, kind, text) {
    this.pops.push({ x, kind, text, t: 0.55 })
  }

  _syncHud() {
    this.scoreEl.textContent = `${this.score}${this.combo > 2 ? `  ×${this.combo}` : ''}`
    const total = this.notes.length || 1
    const judged = this.notes.filter((n) => n.done).length
    this.progressEl.style.width = `${(judged / total) * 100}%`
    this.progressEl.classList.remove('low')
  }

  _tick = () => {
    if (!this.running) return
    const now = performance.now()
    const dt = Math.min(0.05, (now - this._last) / 1000)
    this._last = now
    this._step(dt)
    this._draw()
    this._raf = requestAnimationFrame(this._tick)
  }

  _step(dt) {
    this.time += dt
    // Anything that has gone past the window without being struck is a miss.
    for (const n of this.notes) {
      if (!n.done && this.time - n.at > GOOD) {
        n.done = 2
        this.combo = 0
        this._syncHud()
      }
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      this.pops[i].t -= dt
      if (this.pops[i].t <= 0) this.pops.splice(i, 1)
    }
    if (!this.over && this.notes.every((n) => n.done) && this.time > LEAD_IN) {
      this.over = true
      this._syncHud()
    }
  }

  _draw() {
    const c = this.ctx
    c.fillStyle = COLORS.back
    c.fillRect(0, 0, W, H)

    // The lane the notes travel down.
    const laneY = H / 2 - 44
    c.fillStyle = COLORS.lane
    c.fillRect(0, laneY, W, 88)
    c.fillStyle = COLORS.laneEdge
    c.fillRect(0, laneY, W, 2)
    c.fillRect(0, laneY + 86, W, 2)

    // The target ring where the beat lands.
    c.strokeStyle = COLORS.target
    c.lineWidth = 3
    c.beginPath()
    c.arc(HIT_X, H / 2, 26, 0, Math.PI * 2)
    c.stroke()

    for (const n of this.notes) {
      if (n.done) continue
      const x = HIT_X + (n.at - this.time) * SCROLL
      if (x < -40 || x > W + 40) continue
      c.fillStyle = n.drum === DON ? COLORS.don : COLORS.ka
      c.beginPath()
      c.arc(x, H / 2, n.drum === DON ? 20 : 15, 0, Math.PI * 2)
      c.fill()
    }

    for (const p of this.pops) this._drawPop(c, p)
    this._drawKeys(c)
    if (this.over) this._drawOver(c)
  }

  _drawPop(c, p) {
    const k = p.t / 0.55
    c.save()
    c.globalAlpha = k
    c.fillStyle = COLORS[p.kind] || '#fff'
    c.textAlign = 'center'
    c.font = '600 17px ui-sans-serif, system-ui, sans-serif'
    c.fillText(p.text, p.x, H / 2 - 42 - (1 - k) * 18)
    c.restore()
  }

  /** The two keys, drawn where the two note colours are, so the mapping needs no explaining. */
  _drawKeys(c) {
    c.textAlign = 'center'
    c.font = '600 13px ui-sans-serif, system-ui, sans-serif'
    c.fillStyle = COLORS.don
    c.fillText('F', HIT_X - 34, H / 2 + 62)
    c.fillStyle = COLORS.ka
    c.fillText('J', HIT_X + 34, H / 2 + 62)
  }

  _drawOver(c) {
    c.fillStyle = 'rgba(6,10,16,0.74)'
    c.fillRect(0, 0, W, H)
    c.fillStyle = '#f4f2ee'
    c.textAlign = 'center'
    c.font = '600 28px ui-sans-serif, system-ui, sans-serif'
    c.fillText(`${this.score}`, W / 2, H / 2 - 16)
    c.font = '400 17px ui-sans-serif, system-ui, sans-serif'
    c.fillStyle = '#c9c6c0'
    c.fillText(`${this.hits}/${this.notes.length} on the beat · best run ${this.best}`, W / 2, H / 2 + 14)
    c.fillText('press E to play it again', W / 2, H / 2 + 40)
  }

  restart() {
    this.start()
  }

  close() {
    this.running = false
    cancelAnimationFrame(this._raf)
    this.onClose?.()
  }

  dispose() {
    this.running = false
    cancelAnimationFrame(this._raf)
    this.canvas?.removeEventListener('pointerdown', this._onDown)
    this.host.innerHTML = ''
  }
}
