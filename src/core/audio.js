/**
 * Sound, synthesised on the spot.
 *
 * A world with nothing to hear is a picture of a world. It is the largest single thing
 * missing from a scene that already has weather, a crowd and a day cycle — you can watch
 * blossom fall past a village in total silence and the whole thing stays behind glass.
 *
 * **Everything here is generated, not loaded.** There are no audio files, and that is a
 * deliberate constraint rather than a shortcut: shipping a wind loop and a footstep pack
 * would be tens of megabytes for a page whose entire point is that it opens instantly off
 * your own machine, and a *looping* wind bed is audible as a loop within about a minute.
 * Filtered noise never repeats, costs a few hundred bytes of code, and can be retuned per
 * world by moving one filter frequency.
 *
 * The palette is four sounds and that is on purpose:
 *
 * - **A wind bed**, always running, that thickens when you move.
 * - **Footsteps**, driven from the walk cycle rather than a timer, so they land on the feet.
 * - **A chime** for arriving somewhere and for being spoken to.
 * - **One bell** for a thread that needs a reply — the only sound allowed to interrupt.
 *
 * The bar for audio in a window somebody leaves open all day is brutally high: it is either
 * excellent or it is muted within the minute and never turned back on. So it starts quiet,
 * it never plays anything sharp, and the mute is one key away.
 */

/**
 * Master level. Halved from the first version, which was mixed like a game and wanted to be
 * mixed like a room somebody is working in.
 */
const MASTER = 0.18

/** A pentatonic scale in semitones, so any two notes picked at random still agree. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16]
const noteHz = (semitone, root = 220) => root * Math.pow(2, semitone / 12)

export class Audio {
  constructor(settings) {
    this.settings = settings
    this.ctx = null
    this.enabled = settings.get('sound') !== false
    this.ready = false
    this._stepPhase = 0
    this._windTarget = 0
    this._world = null
  }

  /**
   * Start the audio graph.
   *
   * Browsers refuse to start an `AudioContext` until the page has been interacted with, so
   * this is called from the first pointer or key event rather than at boot. Calling it again
   * afterwards is free.
   */
  start() {
    if (this.ctx || !this.enabled) return
    const Ctor = window.AudioContext || window.webkitAudioContext
    if (!Ctor) return
    const ctx = (this.ctx = new Ctor())

    this.master = ctx.createGain()
    this.master.gain.value = this.enabled ? MASTER : 0
    this.master.connect(ctx.destination)

    // A gentle low-pass across everything, so nothing in here is ever bright enough to be
    // fatiguing over an eight-hour window.
    this.tone = ctx.createBiquadFilter()
    this.tone.type = 'lowpass'
    this.tone.frequency.value = 5200
    this.tone.connect(this.master)

    this._buildNoise()
    this._buildWind()
    this._buildPad()
    this.ready = true
    if (this._world) this.setWorld(this._world)
  }

  /**
   * Two seconds of white noise on a loop, shared by the wind and every footstep.
   *
   * One buffer rather than one per sound: noise is noise, and the difference between wind
   * and a boot on a boardwalk is entirely in the filter and the envelope over the top.
   */
  _buildNoise() {
    const ctx = this.ctx
    const frames = ctx.sampleRate * 2
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1
    this.noise = buffer
  }

  /**
   * Wind — air moving through leaves, not a machine idling.
   *
   * The first version of this was a motor, and it is worth being precise about why, because
   * the mistake is easy to repeat. It band-passed noise at 420 Hz with a low Q and left the
   * gain constant. A narrow-ish band low in the spectrum, held at a steady level, is exactly
   * how you synthesise an engine — the ear reads *constant* + *low* + *pitched* as machinery,
   * and no amount of slow filter wobble talks it out of that.
   *
   * Three changes fix it, and all three matter:
   *
   * - **High, not low.** The band sits up where leaves and air live, not down in the engine
   *   room.
   * - **Gusts, not a level.** The gain is driven by a slow random walk, so it swells and
   *   falls away to near silence. Wind is an event; a hum is a fault.
   * - **Wide, not narrow.** A high Q is a pitch, and a pitch is a note somebody has to
   *   listen to for eight hours.
   */
  _buildWind() {
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true

    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 1400
    // Deliberately below 1: wide enough that there is no discernible pitch in it at all.
    band.Q.value = 0.28

    // A second, gentler shelf under it so the gusts have some body and are not just hiss.
    const shelf = ctx.createBiquadFilter()
    shelf.type = 'lowshelf'
    shelf.frequency.value = 300
    shelf.gain.value = -14

    const gain = ctx.createGain()
    gain.gain.value = 0.0

    src.connect(band).connect(shelf).connect(gain).connect(this.tone)
    src.start()
    this.windSource = src
    this.windBand = band
    this.windGain = gain
    this._gust = 0
    this._gustTarget = 0
    this._gustAt = 0
  }

  /**
   * The melodic layer: a few notes, a long way apart.
   *
   * This replaced a drone of three detuned oscillators, which was the other half of the
   * motor — a triangle wave held indefinitely is a tone, and a tone that never resolves is
   * something the ear keeps returning to and resenting.
   *
   * What is here instead is closer to a wind chime than to a score: a single soft note every
   * several seconds, drawn from a pentatonic scale so no two of them can clash however they
   * overlap, with a slow attack and a very long decay. It is music in the sense that a room
   * with a piano somewhere else in the house has music in it.
   */
  _buildPad() {
    const ctx = this.ctx
    this.padGain = ctx.createGain()
    this.padGain.gain.value = 1
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2400
    this.padGain.connect(lp).connect(this.tone)
    this._noteAt = 0
    this._root = 220
  }

  /** One note of the ambient melody. Soft in, very slow out. */
  _note(semitone, level = 0.055, decay = 4.5) {
    const ctx = this.ctx
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = noteHz(semitone, this._root)

    // A second oscillator an octave up at a fraction of the level, which is what stops a
    // pure sine sounding like a test tone.
    const shimmer = ctx.createOscillator()
    shimmer.type = 'sine'
    shimmer.frequency.value = noteHz(semitone + 12, this._root)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(level, t + 0.35)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay)

    const shimmerGain = ctx.createGain()
    shimmerGain.gain.setValueAtTime(0.0001, t)
    shimmerGain.gain.exponentialRampToValueAtTime(level * 0.28, t + 0.5)
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.7)

    osc.connect(gain).connect(this.padGain)
    shimmer.connect(shimmerGain).connect(this.padGain)
    osc.start(t)
    shimmer.start(t)
    osc.stop(t + decay + 0.1)
    shimmer.stop(t + decay + 0.1)
  }

  /**
   * Retune the bed for a world.
   *
   * Each world moves the wind's centre frequency and the drone's root, which is enough to
   * make six places sound like six places: rain sits high and bright, a spirit realm sits
   * low and hollow, snow is almost silent.
   */
  setWorld(planet) {
    this._world = planet
    if (!this.ready || !planet) return
    const BEDS = {
      // band: where the wind sits, wind: how strong its gusts get, root: the melody's key,
      // rate: roughly how many seconds between notes.
      sakura: { band: 1500, wind: 0.05, root: 262, rate: 7 },
      festival: { band: 1250, wind: 0.042, root: 233, rate: 6 },
      spirit: { band: 900, wind: 0.055, root: 196, rate: 9 },
      neon: { band: 2100, wind: 0.06, root: 175, rate: 11 },
      skyward: { band: 1800, wind: 0.07, root: 294, rate: 6 },
      winter: { band: 1100, wind: 0.038, root: 208, rate: 10 },
    }
    const bed = BEDS[planet.id] || BEDS.sakura
    const now = this.ctx.currentTime
    // Slid rather than jumped: a world change should feel like walking somewhere else, and
    // an instant cut in the ambience gives the game away as a settings change.
    this.windBand.frequency.setTargetAtTime(bed.band, now, 1.2)
    this._windBase = bed.wind
    this._root = bed.root
    this._noteRate = bed.rate
  }

  /**
   * Per-frame. `speed` is how fast the player is actually travelling, which both drives the
   * footsteps and leans on the wind — moving through air is the cheapest way to make
   * movement feel like it costs something.
   */
  update(dt, { speed = 0, walking = false } = {}) {
    if (!this.ready) return
    const now = this.ctx.currentTime

    /**
     * Gusts. A new target every few seconds, eased toward — so the bed rises, holds, and
     * falls away to nearly nothing, which is what makes it read as weather rather than as a
     * level somebody set. Two thirds of the targets are near-silent on purpose: the silence
     * between gusts is what the gusts are heard against.
     */
    if (now > this._gustAt) {
      this._gustAt = now + 2.5 + Math.random() * 5
      this._gustTarget = Math.random() < 0.62 ? Math.random() * 0.25 : 0.5 + Math.random() * 0.5
    }
    this._gust += (this._gustTarget - this._gust) * Math.min(1, dt * 0.6)
    // Moving through air adds to it, so running is audibly faster than walking.
    const level = (this._windBase || 0.05) * (this._gust * 0.85 + 0.15) * (1 + Math.min(1, speed / 7) * 0.8)
    this.windGain.gain.setTargetAtTime(level, now, 0.3)

    // The melody, sparse and unhurried. Never while sprinting: the ear is already busy.
    if (now > this._noteAt) {
      const rate = this._noteRate || 8
      this._noteAt = now + rate * (0.6 + Math.random() * 0.9)
      const semi = SCALE[Math.floor(Math.random() * SCALE.length)]
      this._note(semi, 0.045 + Math.random() * 0.02, 3.5 + Math.random() * 3)
      // Now and then a second note over the first, a fifth or so above it.
      if (Math.random() < 0.3) setTimeout(() => this.ready && this._note(semi + 7, 0.03, 4), 420)
    }

    if (!walking || speed < 0.4) {
      this._stepPhase = 0.55 // land the next step promptly on setting off
      return
    }
    // Stride rate from ground speed, so footfalls stay with the legs at a walk and a run
    // rather than drifting against them.
    this._stepPhase += dt * (speed * 0.62)
    if (this._stepPhase >= 1) {
      this._stepPhase -= 1
      this.step(Math.min(1, speed / 5))
    }
  }

  /** One footfall: a short filtered thud with a little grit on top. */
  step(intensity = 0.7) {
    if (!this.ready) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    // Start somewhere random in the buffer, or every footstep is the same sample of noise
    // and the ear picks that out surprisingly fast.
    const offset = Math.random() * 1.5

    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 300 + Math.random() * 260

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.09 * intensity, now + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13)

    src.connect(lp).connect(gain).connect(this.tone)
    src.start(now, offset)
    src.stop(now + 0.16)
  }

  /**
   * A struck note. `kind` picks the character, not a sample.
   *
   * `need` is the only one with any carrying power, because it is the only event in this
   * world that is genuinely worth interrupting somebody for.
   */
  chime(kind = 'talk') {
    if (!this.ready) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const SPEC = {
      talk: { notes: [SCALE[2]], root: 330, decay: 0.5, level: 0.05, type: 'sine' },
      enter: { notes: [SCALE[0], SCALE[3]], root: 262, decay: 1.3, level: 0.055, type: 'sine' },
      quest: { notes: [SCALE[2], SCALE[5]], root: 294, decay: 0.9, level: 0.05, type: 'triangle' },
      need: { notes: [SCALE[4], SCALE[0]], root: 196, decay: 2.6, level: 0.075, type: 'triangle' },
    }
    const spec = SPEC[kind] || SPEC.talk

    spec.notes.forEach((semi, i) => {
      const t = now + i * 0.13
      const osc = ctx.createOscillator()
      osc.type = spec.type
      osc.frequency.value = noteHz(semi, spec.root)

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(spec.level, t + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + spec.decay)

      osc.connect(gain).connect(this.tone)
      osc.start(t)
      osc.stop(t + spec.decay + 0.05)
    })
  }

  setEnabled(on) {
    this.enabled = on
    if (on) this.start()
    if (!this.ready) return
    this.master.gain.setTargetAtTime(on ? MASTER : 0, this.ctx.currentTime, 0.15)
  }

  dispose() {
    this.ctx?.close?.()
    this.ctx = null
    this.ready = false
  }
}
