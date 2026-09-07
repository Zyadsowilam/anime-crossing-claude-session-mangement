/**
 * Lantern Drift — the one that speeds up until it beats you.
 *
 * The other three stalls are *sedate*, and that is the honest criticism of them. Scooping,
 * shooting and drumming all run at a fixed pace, all end politely when a counter reaches zero,
 * and none of them ever threatens you. They are pleasant. They are not exciting.
 *
 * This one is built the other way round, on the oldest arcade formula there is, because it is
 * the one that reliably produces excitement:
 *
 * - **It accelerates.** Every catch makes the next drop faster. The game is always getting
 *   harder and you can feel the moment it passes what you can handle.
 * - **It can kill you.** Three lanterns on the ground and it is over. A fail state is what
 *   makes the near-misses matter; without one, dropping something costs nothing and the whole
 *   thing is a screensaver.
 * - **It makes you choose.** Fireworks fall alongside the lanterns and catching one costs a
 *   life, so the basket cannot simply sit under everything — every drop is a decision.
 * - **It rewards nerve.** Catching without dropping builds a streak, and the streak multiplies
 *   the score, so the player who keeps going when it is fast outscores the careful one by a
 *   long way.
 *
 * Steered with the mouse or the arrow keys, because at speed a mouse is faster than a key and
 * the game gets fast enough for that to matter.
 *
 * Like the rest of the festival it reads and writes nothing about your threads — see
 * `festival.js` for why the games are kept firmly on that side of the line.
 */

const W = 520
const H = 360

/** The basket. */
const BASKET_W = 74
const BASKET_H = 15
const BASKET_Y = H - 34
/** How quickly the basket closes on where you are pointing. Snappy, but not instant. */
const BASKET_EASE = 18

/** Falling speed at the start, and how much each catch adds. */
const FALL_START = 105
const FALL_STEP = 3.4
const FALL_MAX = 430
/** Seconds between drops at the start, and the floor it tightens toward. */
const GAP_START = 0.95
const GAP_MIN = 0.30

/** How many you may drop before the stall takes its lanterns back. */
const LIVES = 3

/** Chance a given drop is a firework rather than a lantern. Climbs with the pace. */
const BOMB_BASE = 0.13
const BOMB_MAX = 0.32

const COLORS = {
  sky: '#191430',
  glow: 'rgba(255,196,120,0.10)',
  basket: '#8a6448',
  basketRim: '#c49a6c',
  lantern: ['#ffd166', '#ff9f5a', '#ffe9a8', '#ff7a7a'],
  bomb: '#4a4f6a',
  fuse: '#ff5a4a',
  life: '#ff8a5a',
}

function rand(a, b) {
  return a + Math.random() * (b - a)
}

export class LanternGame {
  constructor(host, { onClose } = {}) {
    this.host = host
    this.onClose = onClose
    this.running = false
    this.over = false
    this.score = 0
    this.streak = 0
    this.best = 0
    this.lives = LIVES
    this.items = []
    this.pops = []
    this.basketX = W / 2
    this.aimX = W / 2
    this.fall = FALL_START
    this.gap = GAP_START
    this.next = 0
    this.shake = 0
    this.held = { left: false, right: false }
    this._raf = 0
    this._last = 0
    this._build()
  }

  _build() {
    this.host.innerHTML = `
      <div class="fest-frame">
        <div class="fest-head">
          <span class="fest-title">Lantern Drift</span>
          <span class="fest-sub">Catch the lanterns. Not the fireworks.</span>
        </div>
        <canvas class="fest-canvas" width="${W}" height="${H}"></canvas>
        <div class="fest-foot">
          <span class="fest-score">0</span>
          <span class="fest-paper"><i style="width:100%"></i></span>
          <button class="fest-close" type="button">Leave (Esc)</button>
        </div>
      </div>`
    this.canvas = this.host.querySelector('.fest-canvas')
    this.ctx = this.canvas.getContext('2d')
    this.scoreEl = this.host.querySelector('.fest-score')
    this.livesEl = this.host.querySelector('.fest-paper i')

    this._track = (e) => {
      const r = this.canvas.getBoundingClientRect()
      if (!r.width) return
      this.aimX = ((e.clientX - r.left) / r.width) * W
    }
    this._onMove = (e) => this._track(e)
    this.canvas.addEventListener('pointermove', this._onMove)
    this.canvas.addEventListener('pointerdown', this._onMove)
    this.host.querySelector('.fest-close').addEventListener('click', () => this.close())
  }

  start() {
    const alreadyLooping = this.running
    this.running = true
    this.over = false
    this.score = 0
    this.streak = 0
    this.best = 0
    this.lives = LIVES
    this.items = []
    this.pops = []
    this.basketX = W / 2
    this.aimX = W / 2
    this.fall = FALL_START
    this.gap = GAP_START
    this.next = 0.6
    this.shake = 0
    this._syncHud()
    this._last = performance.now()
    if (!alreadyLooping) this._tick()
  }

  /** Arrow keys, for anyone who would rather not chase the basket with a mouse. */
  hold(dir, down) {
    if (dir === 'left') this.held.left = down
    if (dir === 'right') this.held.right = down
  }

  _syncHud() {
    this.scoreEl.textContent = `${this.score}${this.streak > 2 ? `  ×${1 + Math.floor(this.streak / 5)}` : ''}`
    this.livesEl.style.width = `${(this.lives / LIVES) * 100}%`
    this.livesEl.classList.toggle('low', this.lives <= 1)
  }

  _pop(x, y, text, color) {
    this.pops.push({ x, y, text, color, t: 0.6 })
  }

  _tick = () => {
    if (!this.running) return
    const now = performance.now()
    const dt = Math.min(0.05, (now - this._last) / 1000)
    this._last = now
    if (!this.over) this._step(dt)
    this._draw()
    this._raf = requestAnimationFrame(this._tick)
  }

  _step(dt) {
    // Steering: the keys nudge the aim, the mouse sets it outright.
    if (this.held.left) this.aimX -= 420 * dt
    if (this.held.right) this.aimX += 420 * dt
    this.aimX = Math.max(BASKET_W / 2, Math.min(W - BASKET_W / 2, this.aimX))
    this.basketX += (this.aimX - this.basketX) * Math.min(1, BASKET_EASE * dt)

    this.shake = Math.max(0, this.shake - dt * 3)

    this.next -= dt
    if (this.next <= 0) {
      this.next = this.gap * rand(0.75, 1.25)
      const bombChance = Math.min(BOMB_MAX, BOMB_BASE + (this.fall - FALL_START) / (FALL_MAX - FALL_START) * 0.2)
      this.items.push({
        x: rand(28, W - 28),
        y: -20,
        bomb: Math.random() < bombChance,
        sway: rand(0, Math.PI * 2),
        color: COLORS.lantern[Math.floor(Math.random() * COLORS.lantern.length)],
      })
    }

    const top = BASKET_Y - BASKET_H
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      it.y += this.fall * dt
      it.sway += dt * 2.2
      const x = it.x + Math.sin(it.sway) * 9

      // Caught? The mouth of the basket, not its whole body.
      if (it.y > top && it.y < BASKET_Y + 6 && Math.abs(x - this.basketX) < BASKET_W / 2) {
        this.items.splice(i, 1)
        if (it.bomb) {
          this.lives--
          this.streak = 0
          this.shake = 1
          this._pop(x, top, 'firework!', COLORS.fuse)
        } else {
          this.streak++
          this.best = Math.max(this.best, this.streak)
          const mult = 1 + Math.floor(this.streak / 5)
          this.score += 10 * mult
          this._pop(x, top, mult > 1 ? `+${10 * mult}` : '+10', it.color)
          // Every catch tightens the screw: faster fall, shorter gap.
          this.fall = Math.min(FALL_MAX, this.fall + FALL_STEP)
          this.gap = Math.max(GAP_MIN, this.gap - 0.012)
        }
        this._syncHud()
        continue
      }

      if (it.y > H + 24) {
        this.items.splice(i, 1)
        // A dropped lantern costs a life; a dropped firework is exactly what you wanted.
        if (!it.bomb) {
          this.lives--
          this.streak = 0
          this.shake = 0.6
          this._pop(x, H - 40, 'dropped', COLORS.life)
        }
        this._syncHud()
      }
    }

    for (let i = this.pops.length - 1; i >= 0; i--) {
      this.pops[i].t -= dt
      if (this.pops[i].t <= 0) this.pops.splice(i, 1)
    }

    if (this.lives <= 0) this.over = true
  }

  _draw() {
    const c = this.ctx
    c.save()
    if (this.shake > 0) {
      c.translate(rand(-1, 1) * this.shake * 5, rand(-1, 1) * this.shake * 5)
    }

    c.fillStyle = COLORS.sky
    c.fillRect(-8, -8, W + 16, H + 16)
    const g = c.createRadialGradient(W / 2, H, 30, W / 2, H, H)
    g.addColorStop(0, COLORS.glow)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(-8, -8, W + 16, H + 16)

    for (const it of this.items) {
      const x = it.x + Math.sin(it.sway) * 9
      if (it.bomb) this._drawBomb(c, x, it.y)
      else this._drawLantern(c, x, it.y, it.color)
    }

    this._drawBasket(c)
    for (const p of this.pops) this._drawPop(c, p)
    c.restore()
    if (this.over) this._drawOver(c)
  }

  _drawLantern(c, x, y, color) {
    c.save()
    c.translate(x, y)
    // A soft halo, because a paper lantern is a light rather than a shape.
    const g = c.createRadialGradient(0, 0, 2, 0, 0, 22)
    g.addColorStop(0, 'rgba(255,220,150,0.42)')
    g.addColorStop(1, 'rgba(255,220,150,0)')
    c.fillStyle = g
    c.beginPath()
    c.arc(0, 0, 22, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = color
    c.beginPath()
    c.ellipse(0, 0, 10, 12, 0, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = 'rgba(0,0,0,0.34)'
    c.fillRect(-4, -13, 8, 3)
    c.fillRect(-4, 10, 8, 3)
    c.restore()
  }

  _drawBomb(c, x, y) {
    c.save()
    c.translate(x, y)
    c.fillStyle = COLORS.bomb
    c.beginPath()
    c.arc(0, 0, 11, 0, Math.PI * 2)
    c.fill()
    // A lit fuse, so it is unmistakably the thing not to catch.
    c.strokeStyle = COLORS.fuse
    c.lineWidth = 2.5
    c.beginPath()
    c.moveTo(0, -10)
    c.quadraticCurveTo(7, -17, 2, -22)
    c.stroke()
    c.fillStyle = COLORS.fuse
    c.beginPath()
    c.arc(2, -23, 2.6 + Math.sin(performance.now() / 60) * 0.8, 0, Math.PI * 2)
    c.fill()
    c.restore()
  }

  _drawBasket(c) {
    const x = this.basketX
    c.fillStyle = COLORS.basket
    c.beginPath()
    c.roundRect(x - BASKET_W / 2, BASKET_Y - BASKET_H, BASKET_W, BASKET_H + 10, 5)
    c.fill()
    c.fillStyle = COLORS.basketRim
    c.fillRect(x - BASKET_W / 2, BASKET_Y - BASKET_H, BASKET_W, 4)
  }

  _drawPop(c, p) {
    const k = p.t / 0.6
    c.save()
    c.globalAlpha = k
    c.fillStyle = p.color
    c.textAlign = 'center'
    c.font = '600 15px ui-sans-serif, system-ui, sans-serif'
    c.fillText(p.text, p.x, p.y - (1 - k) * 22)
    c.restore()
  }

  _drawOver(c) {
    c.fillStyle = 'rgba(6,10,16,0.76)'
    c.fillRect(0, 0, W, H)
    c.fillStyle = '#f4f2ee'
    c.textAlign = 'center'
    c.font = '600 30px ui-sans-serif, system-ui, sans-serif'
    c.fillText(`${this.score}`, W / 2, H / 2 - 14)
    c.font = '400 17px ui-sans-serif, system-ui, sans-serif'
    c.fillStyle = '#c9c6c0'
    c.fillText(`best run of ${this.best} — press E to go again`, W / 2, H / 2 + 18)
  }

  restart() {
    this.start()
  }

  close() {
    this.running = false
    this.held.left = false
    this.held.right = false
    cancelAnimationFrame(this._raf)
    this.onClose?.()
  }

  dispose() {
    this.running = false
    cancelAnimationFrame(this._raf)
    this.canvas?.removeEventListener('pointermove', this._onMove)
    this.canvas?.removeEventListener('pointerdown', this._onMove)
    this.host.innerHTML = ''
  }
}
