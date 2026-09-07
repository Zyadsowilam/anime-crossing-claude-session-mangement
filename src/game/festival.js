/**
 * Kingyo-sukui — the goldfish-scooping stall.
 *
 * The one thing in this world that is not a picture of your data, and it is deliberately
 * kept that way. Everything else on screen means something: a character is a thread, a
 * building's height is a transcript, a badge is a reply somebody is waiting for. The project's
 * own rule is that decoration must never lie about data — so the safest place to put a game is
 * somewhere the data never goes at all. This scores nothing, saves nothing, and is not
 * consulted by anything else in the colony. It is a stall at a festival.
 *
 * The mechanic is the real one. You are given a *poi*: a paper net on a hoop. Paper does not
 * survive water, so the game is not about aiming — it is about how much you dare use a net
 * that is dissolving. Every scoop costs it, a miss costs it more, and a fish that fights costs
 * most of all. It ends when the paper tears, which it always does.
 *
 * Drawn to a canvas at a fixed logical size and scaled by CSS, so it is crisp on any display
 * without the game logic ever knowing what a device pixel is.
 */

/** The logical play area. Everything below is in these units, whatever the element's size. */
const W = 520
const H = 360

/** How many fish are in the bowl at once, and how fast they wander. */
const FISH_COUNT = 9
const FISH_SPEED = 26

/**
 * How much paper each thing costs.
 *
 * A hit is cheap and a miss is dear, which is the whole tension: the net that can still catch
 * a fish is the net you have already half spent, and the only way to keep it is not to play.
 */
const COST_HIT = 0.055
const COST_MISS = 0.14
/** Bigger fish are worth more and tear more paper. */
const COST_PER_SIZE = 0.05

/** The poi's reach, in play-area units. */
const POI_R = 30

const COLORS = {
  water: '#12384a',
  waterLip: '#1d5570',
  poiRim: '#e8dcc8',
  poiPaper: 'rgba(255,255,255,0.30)',
  poiTorn: 'rgba(255,120,120,0.30)',
}

/** The four goldfish colours. Picked per fish, so a bowl is never all one shade. */
const FISH_COLORS = ['#e8582f', '#f0813a', '#e33f5a', '#ffd166']

/** A seeded-enough wander: fish do not need to be reproducible between visits. */
function rand(a, b) {
  return a + Math.random() * (b - a)
}

export class FestivalGame {
  /**
   * @param host the element to build the stall inside — the HUD hands one over and owns it
   * @param onClose called when the player walks away or the paper tears and they dismiss it
   */
  constructor(host, { onClose } = {}) {
    this.host = host
    this.onClose = onClose
    this.running = false
    this.fish = []
    this.score = 0
    this.paper = 1
    this.pointer = { x: W / 2, y: H / 2, inside: false }
    this._raf = 0
    this._last = 0
    this._build()
  }

  _build() {
    this.host.innerHTML = `
      <div class="fest-frame">
        <div class="fest-head">
          <span class="fest-title">Kingyo-sukui</span>
          <span class="fest-sub">Scoop what you can before the paper goes</span>
        </div>
        <canvas class="fest-canvas" width="${W}" height="${H}"></canvas>
        <div class="fest-foot">
          <span class="fest-score">0 scooped</span>
          <span class="fest-paper"><i style="width:100%"></i></span>
          <button class="fest-close" type="button">Leave (Esc)</button>
        </div>
      </div>`
    this.canvas = this.host.querySelector('.fest-canvas')
    this.ctx = this.canvas.getContext('2d')
    this.scoreEl = this.host.querySelector('.fest-score')
    this.paperEl = this.host.querySelector('.fest-paper i')

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
      this._scoop()
    }
    this.canvas.addEventListener('pointermove', this._onMove)
    this.canvas.addEventListener('pointerleave', this._onLeave)
    this.canvas.addEventListener('pointerdown', this._onDown)
    this.host.querySelector('.fest-close').addEventListener('click', () => this.close())
  }

  /**
   * Deal a fresh bowl and a fresh net.
   *
   * The `running` guard here is only about not starting a *second* animation loop — it must
   * not skip the reset, which is the bug it caused first time round: the loop keeps running
   * after the paper tears so the game-over screen can be drawn, so `running` was still true
   * when the player asked for another net, `start` returned early, and they were handed a
   * brand new net that was already spent.
   */
  start() {
    const alreadyLooping = this.running
    this.running = true
    this.score = 0
    this.paper = 1
    this.over = false
    this.fish = []
    for (let i = 0; i < FISH_COUNT; i++) this.fish.push(this._newFish())
    this._syncHud()
    this._last = performance.now()
    if (!alreadyLooping) this._tick()
  }

  _newFish() {
    const size = rand(0.75, 1.35)
    return {
      x: rand(50, W - 50),
      y: rand(50, H - 50),
      // Heading, and how long until it changes its mind.
      a: rand(0, Math.PI * 2),
      turnAt: rand(0.4, 1.8),
      size,
      // A darting fish is briefly much faster, which is what makes a near-miss feel like one.
      dart: 0,
      wiggle: rand(0, Math.PI * 2),
      color: FISH_COLORS[Math.floor(Math.random() * FISH_COLORS.length)],
      caught: 0,
    }
  }

  /**
   * Try to scoop whatever is under the poi.
   *
   * The nearest fish inside the hoop is taken rather than every fish inside it — a net that
   * cleared the bowl in one dip would end the game on the first click, and the fish are dense
   * enough that it would happen often.
   */
  _scoop() {
    if (!this.running || this.over) return
    let best = null
    let bestD = POI_R
    for (const f of this.fish) {
      if (f.caught) continue
      const d = Math.hypot(f.x - this.pointer.x, f.y - this.pointer.y)
      if (d < bestD) {
        bestD = d
        best = f
      }
    }
    if (best) {
      best.caught = 1
      this.score++
      this.paper -= COST_HIT + best.size * COST_PER_SIZE
      // Everything else in the bowl saw that and bolts.
      for (const f of this.fish) {
        if (f === best || f.caught) continue
        const dx = f.x - this.pointer.x
        const dy = f.y - this.pointer.y
        f.a = Math.atan2(dy, dx) + rand(-0.5, 0.5)
        f.dart = rand(0.35, 0.75)
      }
    } else {
      this.paper -= COST_MISS
    }
    if (this.paper <= 0) {
      this.paper = 0
      this.over = true
    }
    this._syncHud()
  }

  _syncHud() {
    this.scoreEl.textContent = `${this.score} scooped`
    this.paperEl.style.width = `${Math.max(0, this.paper) * 100}%`
    this.paperEl.classList.toggle('low', this.paper < 0.34)
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
    for (const f of this.fish) {
      if (f.caught) {
        // Lifted out of the water, then replaced by a new one so the bowl never empties.
        f.caught += dt * 2.2
        if (f.caught > 1) Object.assign(f, this._newFish())
        continue
      }
      f.turnAt -= dt
      if (f.turnAt <= 0) {
        f.a += rand(-1.1, 1.1)
        f.turnAt = rand(0.4, 1.8)
      }
      f.dart = Math.max(0, f.dart - dt)
      const speed = FISH_SPEED * (1 + f.dart * 3.4) / f.size
      f.x += Math.cos(f.a) * speed * dt
      f.y += Math.sin(f.a) * speed * dt
      f.wiggle += dt * (6 + f.dart * 12)
      // The bowl's wall, as a turn rather than a bounce — a fish that ricochets reads as a ball.
      const m = 26
      if (f.x < m || f.x > W - m || f.y < m || f.y > H - m) {
        const toCentre = Math.atan2(H / 2 - f.y, W / 2 - f.x)
        let d = toCentre - f.a
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        f.a += d * Math.min(1, dt * 6)
        f.x = Math.max(m * 0.6, Math.min(W - m * 0.6, f.x))
        f.y = Math.max(m * 0.6, Math.min(H - m * 0.6, f.y))
      }
    }
  }

  _draw() {
    const c = this.ctx
    c.clearRect(0, 0, W, H)

    // The water, and a lip so the bowl has an edge rather than stopping at the canvas.
    c.fillStyle = COLORS.water
    c.fillRect(0, 0, W, H)
    const g = c.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.62)
    g.addColorStop(0, 'rgba(120,220,255,0.16)')
    g.addColorStop(1, 'rgba(0,0,0,0.28)')
    c.fillStyle = g
    c.fillRect(0, 0, W, H)

    for (const f of this.fish) this._drawFish(c, f)
    if (this.pointer.inside && !this.over) this._drawPoi(c)
    if (this.over) this._drawOver(c)
  }

  _drawFish(c, f) {
    const lift = f.caught ? Math.min(1, f.caught) : 0
    c.save()
    c.translate(f.x, f.y - lift * 26)
    c.rotate(f.a)
    c.globalAlpha = f.caught ? 1 - lift * 0.75 : 1
    const s = f.size
    // Body.
    c.fillStyle = f.color
    c.beginPath()
    c.ellipse(0, 0, 11 * s, 7 * s, 0, 0, Math.PI * 2)
    c.fill()
    // Tail, swept by the wiggle so it reads as swimming rather than sliding.
    const sweep = Math.sin(f.wiggle) * 0.5
    c.beginPath()
    c.moveTo(-9 * s, 0)
    c.lineTo(-20 * s, -7 * s + sweep * 7 * s)
    c.lineTo(-20 * s, 7 * s + sweep * 7 * s)
    c.closePath()
    c.fill()
    // Eye.
    c.fillStyle = 'rgba(0,0,0,0.75)'
    c.beginPath()
    c.arc(5 * s, -2 * s, 1.7 * s, 0, Math.PI * 2)
    c.fill()
    c.restore()
  }

  _drawPoi(c) {
    const torn = this.paper < 0.34
    c.save()
    c.translate(this.pointer.x, this.pointer.y)
    c.fillStyle = torn ? COLORS.poiTorn : COLORS.poiPaper
    c.beginPath()
    c.arc(0, 0, POI_R, 0, Math.PI * 2)
    c.fill()
    // The paper thins visibly as it goes, so the bar at the bottom is never the only warning.
    c.globalAlpha = 0.25 + this.paper * 0.55
    c.strokeStyle = COLORS.poiRim
    c.lineWidth = 3
    c.beginPath()
    c.arc(0, 0, POI_R, 0, Math.PI * 2)
    c.stroke()
    c.globalAlpha = 1
    c.strokeStyle = 'rgba(255,255,255,0.35)'
    c.lineWidth = 2
    c.beginPath()
    c.moveTo(POI_R * 0.7, POI_R * 0.7)
    c.lineTo(POI_R * 1.5, POI_R * 1.5)
    c.stroke()
    c.restore()
  }

  _drawOver(c) {
    c.fillStyle = 'rgba(6,10,16,0.72)'
    c.fillRect(0, 0, W, H)
    c.fillStyle = '#f4f2ee'
    c.textAlign = 'center'
    c.font = '600 30px ui-sans-serif, system-ui, sans-serif'
    c.fillText('The paper went', W / 2, H / 2 - 12)
    c.font = '400 18px ui-sans-serif, system-ui, sans-serif'
    c.fillStyle = '#c9c6c0'
    const tally = this.score === 1 ? '1 goldfish' : `${this.score} goldfish`
    c.fillText(`${tally} — press E to buy another net`, W / 2, H / 2 + 20)
  }

  /** Another net, same stall. */
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
