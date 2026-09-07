/**
 * Shateki — the cork-gun shooting stall.
 *
 * The second stall game, and deliberately the opposite of the first one. Kingyo-sukui is
 * about *restraint*: the net is dissolving and every shot you take costs you the ability to
 * take another, so the skill is knowing when to stop. This is about *timing*: the corks are
 * counted out in front of you and nothing you do makes them run out faster, so the only
 * question is whether you can lead a moving target.
 *
 * Having two games that ask for different things is most of the reason to have two games at
 * all. A second one with the same feel would be the same stall painted differently.
 *
 * Like the goldfish, it reads and writes nothing about your threads — see `festival.js` for
 * why the games are kept on that side of the line.
 */

/** The logical play area. Scaled by CSS; the game never sees a device pixel. */
const W = 520
const H = 360

/** How many corks you are given, and how long the shot animation runs. */
const CORKS = 6
const SHOT_TIME = 0.14

/** The shelves: how high, how fast things slide along them, and what they are worth. */
const SHELVES = [
  { y: 96, speed: 62, size: 15, points: 5 },
  { y: 176, speed: 44, size: 20, points: 3 },
  { y: 256, speed: 30, size: 26, points: 1 },
]

/** How long a knocked-down prize stays down before the stallholder resets it. */
const RESET_TIME = 1.6

const COLORS = {
  back: '#241a2e',
  shelf: '#6b4c3a',
  shelfLip: '#8a6448',
  prize: ['#f0c46a', '#e8582f', '#5ec6e8', '#a8e06a', '#e07ab8'],
  cork: '#e8dcc8',
}

function rand(a, b) {
  return a + Math.random() * (b - a)
}

export class ShatekiGame {
  constructor(host, { onClose } = {}) {
    this.host = host
    this.onClose = onClose
    this.running = false
    this.over = false
    this.score = 0
    this.corks = CORKS
    this.targets = []
    this.shots = []
    this.pointer = { x: W / 2, y: H / 2, inside: false }
    this._raf = 0
    this._last = 0
    this._build()
  }

  _build() {
    this.host.innerHTML = `
      <div class="fest-frame">
        <div class="fest-head">
          <span class="fest-title">Shateki</span>
          <span class="fest-sub">Six corks. Lead the moving ones.</span>
        </div>
        <canvas class="fest-canvas" width="${W}" height="${H}"></canvas>
        <div class="fest-foot">
          <span class="fest-score">0 points</span>
          <span class="fest-paper"><i style="width:100%"></i></span>
          <button class="fest-close" type="button">Leave (Esc)</button>
        </div>
      </div>`
    this.canvas = this.host.querySelector('.fest-canvas')
    this.ctx = this.canvas.getContext('2d')
    this.scoreEl = this.host.querySelector('.fest-score')
    this.corksEl = this.host.querySelector('.fest-paper i')

    this._onMove = (e) => {
      const r = this.canvas.getBoundingClientRect()
      this.pointer.x = ((e.clientX - r.left) / r.width) * W
      this.pointer.y = ((e.clientY - r.top) / r.height) * H
      this.pointer.inside = true
    }
    this._onLeave = () => {
      this.pointer.inside = false
    }
    this._onDown = (e) => {
      e.preventDefault()
      this._fire()
    }
    this.canvas.addEventListener('pointermove', this._onMove)
    this.canvas.addEventListener('pointerleave', this._onLeave)
    this.canvas.addEventListener('pointerdown', this._onDown)
    this.host.querySelector('.fest-close').addEventListener('click', () => this.close())
  }

  /** Same contract as the goldfish stall: this both starts and *restarts*. */
  start() {
    const alreadyLooping = this.running
    this.running = true
    this.over = false
    this.score = 0
    this.corks = CORKS
    this.shots = []
    this.targets = []
    SHELVES.forEach((shelf, row) => {
      /**
       * Three to a shelf, spaced along it rather than dropped at random.
       *
       * Everything on one shelf moves at the same speed, so two that spawn on top of each
       * other stay on top of each other for the whole game — they never drift apart, because
       * nothing makes them. Dealing them evenly and nudging each by less than half a gap
       * keeps the rows from lining up into a grid without ever letting two share a spot.
       */
      const gap = (W - 80) / 3
      for (let i = 0; i < 3; i++) {
        this.targets.push({
          row,
          x: 40 + gap * (i + 0.5) + rand(-gap * 0.28, gap * 0.28),
          // Alternating, so a shelf is never a convoy all heading the same way.
          dir: i % 2 === 0 ? 1 : -1,
          down: 0,
          color: COLORS.prize[Math.floor(Math.random() * COLORS.prize.length)],
        })
      }
    })
    this._syncHud()
    this._last = performance.now()
    if (!alreadyLooping) this._tick()
  }

  /**
   * Fire at wherever the crosshair is.
   *
   * The cork is checked against the targets *immediately* rather than travelling — a cork
   * with a flight time reads as unresponsive at this range, and the drawn shot is a flourish
   * over a decision that has already been made.
   */
  _fire() {
    if (!this.running || this.over || this.corks <= 0) return
    this.corks--
    this.shots.push({ x: this.pointer.x, y: this.pointer.y, t: SHOT_TIME, hit: false })
    const shot = this.shots[this.shots.length - 1]

    for (const t of this.targets) {
      if (t.down > 0) continue
      const shelf = SHELVES[t.row]
      const dx = t.x - this.pointer.x
      const dy = shelf.y - shelf.size / 2 - this.pointer.y
      if (Math.hypot(dx, dy) < shelf.size) {
        t.down = RESET_TIME
        this.score += shelf.points
        shot.hit = true
        break
      }
    }
    if (this.corks <= 0) this.over = true
    this._syncHud()
  }

  _syncHud() {
    this.scoreEl.textContent = `${this.score} point${this.score === 1 ? '' : 's'}`
    this.corksEl.style.width = `${(this.corks / CORKS) * 100}%`
    this.corksEl.classList.toggle('low', this.corks <= 2)
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
    for (const t of this.targets) {
      if (t.down > 0) {
        t.down -= dt
        continue
      }
      const shelf = SHELVES[t.row]
      t.x += t.dir * shelf.speed * dt
      // Turn at the ends of the shelf rather than wrapping, so a target you have been
      // tracking stays trackable instead of teleporting behind you.
      if (t.x < 30) {
        t.x = 30
        t.dir = 1
      } else if (t.x > W - 30) {
        t.x = W - 30
        t.dir = -1
      }
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      this.shots[i].t -= dt
      if (this.shots[i].t <= 0) this.shots.splice(i, 1)
    }
  }

  _draw() {
    const c = this.ctx
    c.fillStyle = COLORS.back
    c.fillRect(0, 0, W, H)
    const g = c.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, 'rgba(255,200,120,0.10)')
    g.addColorStop(1, 'rgba(0,0,0,0.30)')
    c.fillStyle = g
    c.fillRect(0, 0, W, H)

    for (const shelf of SHELVES) {
      c.fillStyle = COLORS.shelf
      c.fillRect(18, shelf.y, W - 36, 9)
      c.fillStyle = COLORS.shelfLip
      c.fillRect(18, shelf.y, W - 36, 3)
    }
    for (const t of this.targets) this._drawTarget(c, t)
    for (const s of this.shots) this._drawShot(c, s)
    if (this.pointer.inside && !this.over) this._drawSight(c)
    if (this.over) this._drawOver(c)
  }

  _drawTarget(c, t) {
    const shelf = SHELVES[t.row]
    const s = shelf.size
    c.save()
    if (t.down > 0) {
      // Knocked flat on the shelf, then stood back up.
      c.translate(t.x, shelf.y - 3)
      c.rotate(Math.PI / 2)
      c.globalAlpha = 0.45
    } else {
      c.translate(t.x, shelf.y - s / 2)
    }
    c.fillStyle = t.color
    c.beginPath()
    c.roundRect(-s / 2, -s / 2, s, s, s * 0.22)
    c.fill()
    c.fillStyle = 'rgba(0,0,0,0.28)'
    c.beginPath()
    c.arc(0, 0, s * 0.22, 0, Math.PI * 2)
    c.fill()
    c.restore()
  }

  _drawShot(c, s) {
    const k = s.t / SHOT_TIME
    c.save()
    c.globalAlpha = k
    c.strokeStyle = s.hit ? '#ffd166' : COLORS.cork
    c.lineWidth = 2
    const r = 10 + (1 - k) * 14
    c.beginPath()
    c.arc(s.x, s.y, r, 0, Math.PI * 2)
    c.stroke()
    c.restore()
  }

  _drawSight(c) {
    const { x, y } = this.pointer
    c.save()
    c.strokeStyle = 'rgba(255,255,255,0.75)'
    c.lineWidth = 1.5
    c.beginPath()
    c.arc(x, y, 11, 0, Math.PI * 2)
    c.moveTo(x - 18, y)
    c.lineTo(x - 4, y)
    c.moveTo(x + 4, y)
    c.lineTo(x + 18, y)
    c.moveTo(x, y - 18)
    c.lineTo(x, y - 4)
    c.moveTo(x, y + 4)
    c.lineTo(x, y + 18)
    c.stroke()
    c.restore()
  }

  _drawOver(c) {
    c.fillStyle = 'rgba(6,10,16,0.72)'
    c.fillRect(0, 0, W, H)
    c.fillStyle = '#f4f2ee'
    c.textAlign = 'center'
    c.font = '600 30px ui-sans-serif, system-ui, sans-serif'
    c.fillText('Out of corks', W / 2, H / 2 - 12)
    c.font = '400 18px ui-sans-serif, system-ui, sans-serif'
    c.fillStyle = '#c9c6c0'
    c.fillText(`${this.score} points — press E to buy six more`, W / 2, H / 2 + 20)
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
    this.canvas?.removeEventListener('pointermove', this._onMove)
    this.canvas?.removeEventListener('pointerleave', this._onLeave)
    this.canvas?.removeEventListener('pointerdown', this._onDown)
    this.host.innerHTML = ''
  }
}
