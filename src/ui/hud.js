import { PRESETS, PLANETS_ORDER } from './hud-data.js'
import { PLANETS } from '../world/planet.js'
import { TIMES } from '../world/sky.js'
import { STATUS_LABEL } from '../game/colony.js'
import { FACE, FRAME_COLS, FRAME_ROWS } from '../agents/faces.js'

/**
 * The whole HUD, in plain DOM.
 *
 * Deliberately not a framework: this sits on top of a render loop that must not miss a
 * frame, so the UI only ever touches the DOM when something it shows has actually changed —
 * every setter compares against the last value it wrote and returns early otherwise.
 *
 * The one hard rule is that all of this is optional. Pressing H hides every panel, and the
 * game stays fully readable because status lives above the astronauts' heads in the scene,
 * not in here.
 */

/**
 * The page only ever runs on the machine the server is on — it answers nothing else — so the
 * browser's OS is the server's OS, and the name of the thing that shows a folder can be read
 * here rather than asked for.
 */
const IS_MAC = /Mac/.test(navigator.platform)
const FILE_MANAGER = IS_MAC ? 'Finder' : /Win/.test(navigator.platform) ? 'Explorer' : 'Files'

const ICON = {
  chevronRight:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  chevronLeft:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M6.6 6.6C4.06 8.2 2 11 2 11s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24M2 2l20 20"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9.5 20v-6h5v6"/></svg>`,
  next: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 16h.01"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 8.5h3.2l1.5-2h8.6l1.5 2H21v11H3z"/><circle cx="12" cy="14" r="3.4"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.6v.4"/><path d="M12 17h.01"/></svg>`,
  open: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`,
  archive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18v3H3z"/><path d="M5 9v10h14V9"/><path d="M10 13h4"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.7a8 8 0 0 1-8.5 8 9.3 9.3 0 0 1-2.7-.4L4.5 21l1.4-4.1a7.9 7.9 0 0 1-2.4-5.7A8 8 0 0 1 12 3.6a8 8 0 0 1 8.5 8.1z"/><path d="M12 8.6v5.4M9.3 11.3h5.4"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.4A1.4 1.4 0 0 1 4.4 6h4.2l2 2.5h7A1.4 1.4 0 0 1 19 9.9v7.7a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 17.6z"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>`,
  locate: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.6"/><path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6"/></svg>`,
  orbit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="10.2" ry="4.6" transform="rotate(-24 12 12)"/><circle cx="21" cy="8.2" r="1.5" fill="currentColor" stroke="none"/></svg>`,
}

const STAT_DEFS = [
  { key: 'working', label: 'building', cls: 'working' },
  { key: 'waiting', label: 'need you', cls: 'waiting' },
  { key: 'blocked', label: 'blocked', cls: 'blocked' },
  { key: 'celebrating', label: 'shipped', cls: 'done' },
  { key: 'agents', label: 'crew', cls: 'idle' },
]

export class Hud {
  constructor(root, settings, actions) {
    this.settings = settings
    this.actions = actions
    this.visible = true
    this._last = {}

    this.el = document.createElement('div')
    this.el.className = 'hud'
    this.el.innerHTML = TEMPLATE
    root.appendChild(this.el)

    this.$ = (sel) => this.el.querySelector(sel)

    this._buildStats()
    this._buildSettings()
    this._buildAvatar()
    this._wire()
    this.syncSettings()
  }

  // ── construction ────────────────────────────────────────────────────────────────────

  _buildStats() {
    const wrap = this.$('.stats')
    this.statEls = {}
    for (const def of STAT_DEFS) {
      const b = document.createElement('button')
      b.className = `stat ${def.cls}`
      b.type = 'button'
      b.dataset.key = def.key
      b.title = `Jump to the next ${def.label} astronaut`
      b.innerHTML = `<i class="pip"></i><span class="n">0</span><span class="lbl">${def.label}</span>`
      b.type = 'button'
      b.addEventListener('click', () => this.actions.focusStatus?.(def.key))
      wrap.appendChild(b)
      this.statEls[def.key] = b
    }
  }

  _buildSettings() {
    const body = this.$('.settings .body')
    const s = this.settings
    this.controls = []

    // Quality presets.
    body.appendChild(
      group(
        'Quality preset',
        chips(
          Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, title: p.hint })),
          () => s.get('preset'),
          (id) => s.applyPreset(id),
          this.controls
        )
      )
    )

    // Performance.
    const perf = group('Performance')
    perf.append(
      this._toggle('HDR + bloom', 'bloom', 'Glowing eyes, lamps and windows. The first thing to drop.'),
      this._toggle('Tilt-shift', 'tiltShift', 'A shallow depth of field, which is what makes the colony read as a model.'),
      this._slider(
        'Tilt-shift blur',
        'tiltShiftStrength',
        0,
        1,
        0.05,
        (v) => `${Math.round(v * 100)}%`,
        'Aperture: how shallow the focus is, and how far out of it things go.'
      ),
      this._slider(
        'Tilt-shift angle',
        'tiltShiftAngle',
        -90,
        90,
        1,
        (v) => `${v}°`,
        'Swings the plane of focus, the way tilting a real lens does.'
      ),
      this._select('Shadows', 'shadows', [
        ['off', 'Off'],
        ['low', 'Low'],
        ['high', 'High'],
        ['ultra', 'Ultra'],
      ]),
      this._select('Particles', 'particles', [
        ['off', 'Off'],
        ['low', 'Low'],
        ['full', 'Full'],
      ]),
      this._select('Textures', 'textureQuality', [
        ['low', 'Low'],
        ['medium', 'Medium'],
        ['high', 'High'],
        ['ultra', 'Ultra'],
      ]),
      this._select('Ground detail', 'groundDetail', [
        ['low', 'Low'],
        ['medium', 'Medium'],
        ['high', 'High'],
      ]),
      this._toggle('Anti-aliasing', 'antialias', 'SMAA pass. Cheap, but not free.'),
      this._slider(
        'Render scale',
        'renderScale',
        0.35,
        2,
        0.05,
        (v) => `${Math.round(v * 100)}%`,
        '100% is your display’s own resolution, retina included.'
      ),
      this._toggle('Adaptive quality', 'autoQuality', 'Quietly drops render scale if frames get expensive.'),
      this._slider('Scatter', 'scatterDensity', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
      this._slider('Max crew', 'maxAgents', 10, 200, 10, (v) => String(v)),
      this._toggle('Stars', 'stars')
    )
    body.appendChild(perf)

    // World.
    const world = group('Planet')
    const planets = document.createElement('div')
    planets.className = 'planets'
    for (const id of PLANETS_ORDER) {
      const planet = PLANETS[id]
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'planet'
      b.title = planet.blurb
      const c1 = hex(planet.ground.high)
      const c2 = hex(planet.ground.low)
      b.innerHTML = `<i class="orb" style="background:radial-gradient(circle at 33% 30%, ${c1}, ${c2})"></i><span>${planet.name}</span>`
      b.addEventListener('click', () => this.settings.set('planet', id))
      planets.appendChild(b)
      this.controls.push({ el: b, sync: () => b.setAttribute('aria-pressed', String(this.settings.get('planet') === id)) })
    }
    world.appendChild(planets)
    body.appendChild(world)

    // Lighting.
    const light = group('Lighting')
    light.append(
      chips(
        TIMES.map((t) => ({ id: t.id, label: t.label })),
        () => nearestTime(this.settings.get('timeOfDay')),
        (id) => {
          this.settings.set('autoTime', false)
          this.settings.set('timeOfDay', TIMES.find((t) => t.id === id).value)
        },
        this.controls
      ),
      this._slider('Time of day', 'timeOfDay', 0, 1, 0.005, clockLabel),
      this._toggle('Cycle day/night', 'autoTime', 'Runs the clock forward on its own.'),
      this._slider('Cycle length', 'dayLength', 30, 900, 30, (v) => `${Math.round(v / 60)}m`),
      this._toggle(
        'Environment light',
        'ibl',
        'Image-based lighting taken from this planet’s own sky. Metals get something to reflect.'
      ),
      this._slider('Environment', 'iblIntensity', 0, 2, 0.05, (v) => v.toFixed(2)),
      this._slider('Exposure', 'exposure', 0.4, 2, 0.05, (v) => v.toFixed(2)),
      this._slider('Bloom', 'bloomStrength', 0, 1.6, 0.02, (v) => v.toFixed(2))
    )
    body.appendChild(light)

    // View.
    const view = group('View')
    view.append(
      this._toggle('Return to isometric', 'autoFrame', 'Eases the angle back when you stop dragging.'),
      this._slider('Field of view', 'fov', 20, 60, 1, (v) => `${v}°`),
      this._toggle('Project labels', 'showLabels'),
      this._toggle('Reduced motion', 'reducedMotion', 'Calms the bobbing and the camera easing.'),
      this._toggle('Show FPS', 'showFps')
    )
    body.appendChild(view)
  }

  _row(label, hint) {
    const row = document.createElement('div')
    row.className = 'row'
    const l = document.createElement('div')
    l.className = 'label'
    l.innerHTML = `<span>${label}</span>${hint ? `<span class="hint">${hint}</span>` : ''}`
    row.appendChild(l)
    return row
  }

  _toggle(label, key, hint) {
    const row = this._row(label, hint)
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'toggle'
    b.setAttribute('role', 'switch')
    b.addEventListener('click', () => this.settings.set(key, !this.settings.get(key)))
    row.appendChild(b)
    this.controls.push({
      el: row,
      sync: () => {
        b.setAttribute('aria-checked', String(Boolean(this.settings.get(key))))
        row.classList.toggle('overridden', this.settings.isOverridden(key))
      },
    })
    return row
  }

  _select(label, key, options, hint) {
    const row = this._row(label, hint)
    const sel = document.createElement('select')
    sel.className = 'select'
    for (const [value, text] of options) {
      const o = document.createElement('option')
      o.value = value
      o.textContent = text
      sel.appendChild(o)
    }
    sel.addEventListener('change', () => this.settings.set(key, sel.value))
    row.appendChild(sel)
    this.controls.push({
      el: row,
      sync: () => {
        sel.value = String(this.settings.get(key))
        row.classList.toggle('overridden', this.settings.isOverridden(key))
      },
    })
    return row
  }

  _slider(label, key, min, max, step, format, hint) {
    const row = this._row(label, hint)
    const wrap = document.createElement('div')
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px'
    const input = document.createElement('input')
    input.type = 'range'
    input.className = 'slider'
    input.min = min
    input.max = max
    input.step = step
    const out = document.createElement('span')
    out.className = 'value'
    input.addEventListener('input', () => this.settings.set(key, Number(input.value)))
    wrap.append(input, out)
    row.appendChild(wrap)
    this.controls.push({
      el: row,
      sync: () => {
        const v = Number(this.settings.get(key))
        // Never fight the thumb the user is dragging.
        if (document.activeElement !== input) input.value = String(v)
        out.textContent = format(v)
        row.classList.toggle('overridden', this.settings.isOverridden(key))
      },
    })
    return row
  }

  /** The little face on the agent card, drawn from the same atlas the astronauts use. */
  _buildAvatar() {
    const canvas = this.$('.thread-pop .avatar canvas')
    canvas.width = 108
    canvas.height = 108
    this.avatarCtx = canvas.getContext('2d')
    this.avatarTmp = document.createElement('canvas')
    this.avatarTmp.width = 108
    this.avatarTmp.height = 108
    this.avatarTmpCtx = this.avatarTmp.getContext('2d')
    this._avatarState = { frame: -1, color: '' }
  }

  _wire() {
    const on = (sel, ev, fn) => this.$(sel).addEventListener(ev, fn)

    on('#btn-settings', 'click', () => this.toggleSettings())
    on('#btn-close-settings', 'click', () => this.toggleSettings(false))
    on('#btn-hide', 'click', () => this.toggleUi())
    on('#btn-collapse', 'click', () => this.toggleSide())
    this.el.querySelector('.side-handle').addEventListener('click', () => this.toggleSide())
    on('#btn-help', 'click', () => this.toggleHelp())
    on('#btn-shot', 'click', () => this.actions.screenshot?.())
    on('#btn-home', 'click', () => this.actions.resetView?.())
    on('#btn-next', 'click', () => this.actions.focusStatus?.('waiting'))
    on('#btn-orbit', 'click', () => this.setOrbit(this.actions.toggleOrbit?.()))
    on('#btn-planet', 'click', () => this.actions.cyclePlanet?.())
    on('#btn-time', 'click', () => this.actions.cycleTime?.())
    on('#btn-open', 'click', () => this.actions.openThread?.())
    on('#btn-archive', 'click', () => this.actions.archiveThread?.())
    on('#btn-deselect', 'click', () => this.actions.select?.(null))
    on('#btn-new-session', 'click', () => this.actions.newConversation?.())
    on('#btn-reveal', 'click', () => this.actions.revealProject?.())
    on('#btn-copy-path', 'click', () => this.actions.copyProjectPath?.())
    on('#btn-locate', 'click', () => this.actions.focusProject?.(this.project?.name))
    on('#btn-close-project', 'click', () => this.actions.closeProject?.())
    on('.help', 'click', (e) => {
      if (e.target === this.$('.help')) this.toggleHelp(false)
    })
    this.$('.help .sheet').addEventListener('click', (e) => e.stopPropagation())
    on('#btn-help-close', 'click', () => this.toggleHelp(false))

    this.settings.onChange(() => this.syncSettings())
  }

  // ── state in ────────────────────────────────────────────────────────────────────────

  syncSettings() {
    for (const c of this.controls) c.sync()
    this.$('.fps').classList.toggle('on', Boolean(this.settings.get('showFps')))
  }

  setStats(stats) {
    for (const def of STAT_DEFS) {
      const n = stats[def.key] ?? 0
      const el = this.statEls[def.key]
      if (this._last['stat:' + def.key] === n) continue
      this._last['stat:' + def.key] = n
      el.querySelector('.n').textContent = String(n)
      el.dataset.empty = String(n === 0)
    }
  }

  /**
   * Every repo, in the sidebar. This was a strip of chips along the bottom of the screen;
   * it is a list now because the sidebar is where all the chrome lives, and because a list
   * can carry a count and an alarm without running out of room at eleven repos.
   */
  setLegend(projects, activeName = null) {
    const signature = projects.map((p) => `${p.name}:${p.count}:${p.accent}:${p.urgent ? 1 : 0}`).join('|') + `~${activeName}`
    if (this._last.legend === signature) return
    this._last.legend = signature

    const wrap = this.$('.projects')
    wrap.innerHTML = ''
    for (const p of projects) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'repo'
      b.title = `${p.count} thread${p.count === 1 ? '' : 's'} in ${p.name}`
      b.setAttribute('aria-pressed', String(p.name === activeName))
      b.innerHTML =
        `<i class="swatch" style="background:${hex(p.accent)};color:${hex(p.accent)}"></i>` +
        `<span class="n">${escapeHtml(p.name)}</span>` +
        (p.urgent ? '<i class="alarm"></i>' : '') +
        `<span class="count">${p.count}</span>`
      b.addEventListener('click', () => this.actions.pickProject?.(p.name))
      wrap.appendChild(b)
    }
    this.$('.sec-head span').textContent = `${projects.length} repo${projects.length === 1 ? '' : 's'}`
  }

  /**
   * The project sidebar: what a zone is, and the things you can do to the *repo* rather
   * than to one thread in it. Opened by clicking a zone, its name plate, its legend chip,
   * or any astronaut standing on it.
   */
  setProject(project) {
    const panel = this.$('.side')
    if (!project) {
      this.project = null
      if (this._last.project === null) return
      this._last.project = null
      panel.classList.remove('drilled')
      return
    }

    this.project = project
    // The minute is part of the signature because `ago()` is: without it a repo where
    // nothing is happening keeps whatever "4m ago" it was first drawn with, for as long as
    // you leave the panel open.
    const signature =
      `${project.name}~${project.path}~${project.accent}~${project.selectedId}~${Math.floor(Date.now() / 60000)}~` +
      project.threads.map((t) => `${t.id}:${t.status}:${t.title}:${t.lastActivityAt}`).join('|')
    panel.classList.add('drilled')
    if (this._last.project === signature) return
    this._last.project = signature

    const swatch = this.$('.side .who .swatch')
    swatch.style.background = hex(project.accent)
    swatch.style.color = hex(project.accent) // the halo is `currentColor`
    this.$('.side .name').textContent = project.name
    const path = this.$('.side .path')
    path.textContent = project.path ? shortPath(project.path) : 'folder unknown'
    path.title = project.path || ''
    // Nothing to open a new thread in, and nothing to reveal, without a folder on disk.
    this.$('#btn-new-session').disabled = !project.path
    this.$('#btn-reveal').disabled = !project.path
    this.$('#btn-copy-path').disabled = !project.path

    const n = project.threads.length
    const waiting = project.threads.filter((t) => t.status === 'waiting' || t.status === 'blocked').length
    this.$('.side .threads-head').innerHTML =
      `<span>${n} thread${n === 1 ? '' : 's'}</span>` + (waiting ? `<span class="want">${waiting} need you</span>` : '')

    const list = this.$('.side .threads')
    // A poll rewrites these rows every time a live thread's timestamp moves. Losing your
    // place in a forty-thread repo every fifteen seconds would make the list unusable.
    const scroll = list.scrollTop
    list.innerHTML = ''
    for (const t of project.threads) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `thread ${statusClass(t.status)}`
      b.setAttribute('aria-pressed', String(t.id === project.selectedId))
      b.title = STATUS_LABEL[t.status] || t.status
      b.innerHTML =
        '<i class="pip"></i>' +
        `<span class="t">${escapeHtml(t.title || 'Untitled thread')}</span>` +
        `<span class="when">${ago(t.lastActivityAt)}</span>` +
        (t.worktree ? `<span class="wt">⑂ ${escapeHtml(t.worktree)}</span>` : '') +
        // One agent standing for a schedule that has fired more than once.
        (t.runCount > 1 ? `<span class="wt">⟳ ${t.runCount} runs</span>` : '')
      b.addEventListener('click', () => this.actions.focusThread?.(t.id))
      list.appendChild(b)
      // A long repo can hide the astronaut you just clicked in the world. Scrolled by hand
      // rather than with `scrollIntoView`, which walks up the ancestors and will happily
      // scroll the *page* — and a page that can scroll at all is one keystroke away from
      // the whole HUD sitting sideways with nothing to put it back.
      if (t.id === project.selectedId && this._scrolledTo !== t.id) {
        this._scrolledTo = t.id
        const row = b
        requestAnimationFrame(() => {
          const top = row.offsetTop
          const bottom = top + row.offsetHeight
          if (top < list.scrollTop) list.scrollTop = top
          else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
        })
      }
    }
    list.scrollTop = scroll
    if (!project.selectedId) this._scrolledTo = null
  }

  /**
   * The selected thread, shown inside the zone sidebar rather than in a panel of its own —
   * one thread and its repo are the same context, and splitting them across the screen made
   * you look in two places to act on one astronaut.
   */
  setSelection(agent, thread) {
    const card = this.$('.thread-pop')
    // Only ever one accent button in the panel: whichever action is the immediate one.
    this.$('#btn-new-session').classList.toggle('primary', !agent || !thread)
    if (!agent || !thread) {
      card.classList.remove('on')
      this.selected = null
      return
    }
    this.selected = { agent, thread }
    card.classList.add('on')

    this.$('.thread-pop .title').textContent = thread.title || 'Untitled thread'
    const status = STATUS_LABEL[agent.status] || agent.status
    const meta = this.$('.thread-pop .meta')
    const bits = [
      `<span class="tag"><i class="swatch" style="background:${hex(agent.aura.getHex())}"></i>${escapeHtml(status)}</span>`,
    ]
    // Who this thread *is*, before what it is doing — the name is how you will refer to it
    // once you have walked past it a few times, and the genre is why it looks the way it does.
    if (agent.charName) {
      bits.push(
        `<span class="tag" style="color:${hex(agent.theme.accent)}">${escapeHtml(agent.charName)}</span>`,
        `<span class="tag">${escapeHtml(agent.theme.name)}</span>`
      )
    }
    // The repo is the panel's own heading now, so the card says what the *thread* is.
    if (thread.worktree) bits.push(`<span class="tag">⑂ ${escapeHtml(thread.worktree)}</span>`)
    if (thread.runCount > 1) bits.push(`<span class="tag">⟳ ${thread.runCount} runs</span>`)
    if (thread.gitBranch) bits.push(`<span class="tag">${escapeHtml(thread.gitBranch)}</span>`)
    if (thread.model) bits.push(`<span class="tag">${escapeHtml(shortModel(thread.model))}</span>`)
    bits.push(`<span>${ago(thread.lastActivityAt)}</span>`)
    meta.innerHTML = bits.join('')

    const pct = Math.round((this.actions.progressFor?.(thread.id) ?? 0) * 100)
    this.$('.thread-pop .progress > i').style.width = `${pct}%`
    this.$('.thread-pop .progress > i').style.background = hex(agent.aura.getHex())
    // Measured once per selection rather than per frame: placing the card beside its
    // astronaut needs its size sixty times a second, and asking the layout for it that
    // often is how a HUD starts costing frames.
    this._cardSize = { w: card.offsetWidth, h: card.offsetHeight }
    this.$('#btn-open').disabled = thread.canOpen === false
  }

  /**
   * Put the thread card beside its own astronaut, in screen space, every frame.
   *
   * `screen` is where the astronaut is right now, in CSS pixels, or null when it is behind
   * the camera. The card prefers the astronaut's right, flips to its left rather than slide
   * under the sidebar, and never leaves the window — so it stays reachable at any zoom
   * without ever covering the thing it is describing.
   */
  placeCard(screen) {
    const el = this.$('.thread-pop')
    if (!screen || !this.selected) {
      if (this._cardOn) {
        this._cardOn = false
        el.classList.remove('on')
      }
      return
    }
    const size = this._cardSize || { w: 280, h: 150 }
    const margin = 12
    const gap = 26
    const rightWall = window.innerWidth - margin - (this._sideWidth || 0)

    let flip = false
    let left = screen.x + gap
    if (left + size.w > rightWall) {
      left = screen.x - gap - size.w
      flip = true
      // Nowhere to go on either side — sit over the middle rather than off the edge.
      if (left < margin) left = Math.min(Math.max(margin, screen.x - size.w / 2), rightWall - size.w)
    }
    const top = Math.min(Math.max(margin, screen.y - size.h / 2), window.innerHeight - margin - size.h)

    if (!this._cardOn) {
      this._cardOn = true
      el.classList.add('on')
    }
    // Whole pixels, and only when it actually moved: a transform written every frame with a
    // fractional delta is a repaint the compositor cannot skip.
    const x = Math.round(left)
    const y = Math.round(top)
    if (x !== this._cardX || y !== this._cardY) {
      this._cardX = x
      this._cardY = y
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`
    }
    // The nib points back at the astronaut, so it changes sides with the card.
    if (flip !== this._cardFlip) {
      this._cardFlip = flip
      el.classList.toggle('flip', flip)
    }
    // And it tracks the astronaut vertically when the card has been pushed off-centre.
    const nib = Math.min(Math.max(14, screen.y - y), size.h - 14)
    if (nib !== this._cardNib) {
      this._cardNib = nib
      el.style.setProperty('--nib-y', `${Math.round(nib)}px`)
    }
  }

  /** How much of the right-hand edge the sidebar is taking, so the card can avoid it. */
  /**
   * Slide the panel off the right edge, and back.
   *
   * Walk mode is the reason this exists. The panel is the right shape for reading a repo's
   * threads and the wrong shape for standing in a world: it owns a third of the window, and
   * the third it owns is the one you turn the camera toward. Hiding *all* the chrome with H
   * already worked, but that also takes the quest board and the talk prompt, which are the
   * two things you actually want while walking.
   *
   * The card that follows a character has to be told as well, or it keeps dodging a wall
   * that is no longer there.
   */
  toggleSide(force) {
    const on = force === undefined ? !this.sideCollapsed : force
    this.sideCollapsed = on
    this.el.classList.toggle('side-collapsed', on)
    this.setSideWidth(on ? 0 : this._sideWidth || 334)
    return on
  }

  setSideWidth(px) {
    // Remembered so uncollapsing can restore it without the page having to say it again.
    if (px) this._sideWidth = px
    this._sideWidth = px
  }

  /** Redraw the card's face so it blinks in step with the astronaut it belongs to. */
  updateAvatar(faceAtlasCanvas) {
    if (!this.selected || !faceAtlasCanvas) return
    const agent = this.selected.agent
    const frame = agent.faceFrame ?? FACE.idle
    const color = agent.eye
    const css = cssFromGlow(color)
    if (this._avatarState.frame === frame && this._avatarState.color === css) return
    this._avatarState = { frame, color: css }

    const size = 108
    const cell = faceAtlasCanvas.width / FRAME_COLS
    const sx = (frame % FRAME_COLS) * cell
    const sy = Math.floor(frame / FRAME_COLS) * (faceAtlasCanvas.height / FRAME_ROWS)

    // The atlas is an opaque white-on-black mask, so the tint is a `multiply`, not a
    // `source-in`: black stays black and the white features take the eye colour. Keying on
    // alpha instead would flood the whole cell, because every pixel in it is opaque.
    const t = this.avatarTmpCtx
    t.globalCompositeOperation = 'source-over'
    t.clearRect(0, 0, size, size)
    t.drawImage(faceAtlasCanvas, sx, sy, cell, cell, 0, 0, size, size)
    t.globalCompositeOperation = 'multiply'
    t.fillStyle = css
    t.fillRect(0, 0, size, size)
    t.globalCompositeOperation = 'source-over'

    const c = this.avatarCtx
    c.fillStyle = '#06070c'
    c.fillRect(0, 0, size, size)
    c.drawImage(this.avatarTmp, 0, 0)
    // Scanlines, so the card's face reads as the same little screen as the one in the world.
    c.globalAlpha = 0.2
    c.fillStyle = '#000'
    for (let y = 0; y < size; y += 3) c.fillRect(0, y, size, 1)
    c.globalAlpha = 1
  }

  setFps(perf, viewport, extra) {
    if (!this.settings.get('showFps')) return
    const el = this.$('.fps')
    const fps = Math.round(perf.fps)
    if (this._last.fps === fps && this._last.calls === perf.drawCalls) return
    this._last.fps = fps
    this._last.calls = perf.drawCalls
    el.innerHTML =
      `<b>${fps}</b> fps · ${perf.frameMs.toFixed(1)} ms<br>` +
      `${perf.drawCalls} draws · ${(perf.triangles / 1000).toFixed(0)}k tris<br>` +
      // The setting is a share of the display, so the readout is too — otherwise a retina
      // machine sitting exactly on the 100% slider reads back "200%".
      `${viewport.bw}×${viewport.bh} (${Math.round((viewport.scale / (window.devicePixelRatio || 1)) * 100)}%)` +
      (extra ? `<br>${extra}` : '')
  }

  /**
   * The "press E" prompt, shown while a character is within talking range.
   *
   * Takes the character rather than a string so it can decide for itself when nothing has
   * changed: this is called every frame, and rewriting the DOM sixty times a second to say
   * the same thing is both wasteful and enough to make the text flicker on some browsers.
   */
  setTalkPrompt(what) {
    const el = this.$('.talk-prompt')
    const id = what ? what.id : null
    if (id === this._promptFor) return
    this._promptFor = id
    el.classList.toggle('on', Boolean(what))
    if (what) el.querySelector('span').textContent = what.label
  }

  /**
   * The quest board.
   *
   * Rendered from a list rather than mutated in place, and skipped entirely when the list
   * is unchanged — this is called on every poll and every conversation, and rebuilding
   * three lines of DOM each time would restart their entrance animation constantly.
   */
  setQuests(list) {
    const el = this.$('.quests')
    const key = list.map((q) => q.id + ':' + (q.progress ? q.progress.join('/') : '')).join('|')
    if (key === this._questKey) return
    this._questKey = key

    if (!list.length) {
      el.classList.remove('on')
      el.innerHTML = ''
      return
    }
    el.classList.add('on')
    el.innerHTML = list
      .map((q) => {
        const pct = q.progress ? Math.round((q.progress[0] / Math.max(1, q.progress[1])) * 100) : null
        return `<div class="quest quest-${escapeHtml(q.kind)}">
          <div class="quest-title">${escapeHtml(q.title)}</div>
          <div class="quest-detail">${escapeHtml(q.detail || '')}</div>
          <div class="quest-hint">${escapeHtml(q.hint || '')}</div>
          ${pct === null ? '' : `<div class="quest-bar"><i style="width:${pct}%"></i></div>`}
        </div>`
      })
      .join('')
  }

  /**
   * Announce the zone you have just walked into, the way a game names a region.
   *
   * Called every frame with the same answer while you stand still, so it does its own
   * change detection — re-triggering the animation sixty times a second would hold the
   * title on screen permanently and defeat the point of it being an event.
   */
  setArea(area) {
    const el = this.$('.area-title')
    const name = area ? area.name : null
    if (name === this._areaName) return
    this._areaName = name
    if (!name) {
      el.classList.remove('on')
      return
    }
    el.querySelector('.area-name').textContent = name
    const n = area.threads
    el.querySelector('.area-sub').textContent =
      n === 1 ? '1 conversation lives here' : `${n} conversations live here`
    // Restart the animation: without removing the class first, walking back into a zone you
    // just left does nothing at all, because the class is already set.
    el.classList.remove('on')
    void el.offsetWidth
    el.classList.add('on')
    clearTimeout(this._areaTimer)
    this._areaTimer = setTimeout(() => el.classList.remove('on'), 3600)
  }

  /**
   * Show a turn of conversation: what they said, and what you can say back.
   *
   * With options the box stops dismissing itself — a panel that vanishes while you are
   * reading the third of four choices is worse than no panel. Without them it behaves as it
   * always did, because a passing remark should not need dismissing.
   */
  speak(turn, { onChoose } = {}) {
    const box = this.$('.talk-box')
    box.querySelector('.talk-name').textContent = turn.name
    box.querySelector('.talk-genre').textContent = turn.genre
    box.querySelector('.talk-line').textContent = turn.line
    box.style.setProperty('--talk-accent', hex(turn.accent))

    const list = box.querySelector('.talk-options')
    this._choices = turn.options || []
    list.innerHTML = this._choices
      .map(
        (o, i) =>
          `<button class="talk-choice${o.action ? ' action' : ''}" data-id="${escapeHtml(o.id)}">
             <b>${i + 1}</b><span>${escapeHtml(o.label)}</span>
           </button>`
      )
      .join('')
    for (const btn of list.querySelectorAll('.talk-choice')) {
      btn.addEventListener('click', () => onChoose?.(btn.dataset.id))
    }
    this._onChoose = onChoose

    box.classList.add('on')
    box.classList.toggle('has-options', this._choices.length > 0)
    clearTimeout(this._talkTimer)
    if (!this._choices.length) this._talkTimer = setTimeout(() => box.classList.remove('on'), 6000)
  }

  /**
   * Pick a choice by number.
   *
   * Wired to the digit keys because this is a conversation you are having while standing in
   * a world with a hand on WASD — reaching for the mouse to say "how is it going" breaks the
   * one thing the whole walk mode is for.
   */
  chooseByIndex(n) {
    const choice = this._choices?.[n - 1]
    if (!choice) return false
    this._onChoose?.(choice.id)
    return true
  }

  hasChoices() {
    return Boolean(this._choices?.length)
  }

  closeTalk() {
    clearTimeout(this._talkTimer)
    const box = this.$('.talk-box')
    box.classList.remove('on')
    box.classList.remove('has-options')
    this._choices = []
    this._onChoose = null
    this.setTalkPrompt(null)
  }

  /** Walk mode on or off, so the chrome can say which controls are live. */
  setWalkMode(on) {
    this.el.classList.toggle('walking', on)
    if (!on) this.setTalkPrompt(null)
  }

  hint(text, ms = 3200) {
    const el = this.$('.hint-pill')
    el.textContent = text
    el.classList.add('on')
    clearTimeout(this._hintTimer)
    this._hintTimer = setTimeout(() => el.classList.remove('on'), ms)
  }

  toast(message, kind = '') {
    const el = document.createElement('div')
    el.className = `toast panel ${kind}`
    el.textContent = message
    this.$('.toasts').appendChild(el)
    setTimeout(() => {
      el.classList.add('leaving')
      setTimeout(() => el.remove(), 260)
    }, 3600)
  }

  // ── visibility ──────────────────────────────────────────────────────────────────────

  /** Reflect orbit mode on the rail button. */
  setOrbit(on) {
    this.$('#btn-orbit').setAttribute('aria-pressed', String(Boolean(on)))
  }

  toggleSettings(force) {
    const panel = this.$('.settings')
    const open = force ?? panel.classList.contains('closed')
    panel.classList.toggle('closed', !open)
    this.$('#btn-settings').setAttribute('aria-pressed', String(open))
    // Both live in the same slot on the right; the sidebar steps aside rather than hides.
    this.$('.side').classList.toggle('shifted', open)
  }

  toggleHelp(force) {
    const el = this.$('.help')
    const open = force ?? !el.classList.contains('open')
    el.classList.toggle('open', open)
  }

  /**
   * Dismiss everything. This is the mode the game is really meant to be left in — the
   * colony carries its own state above the astronauts' heads, so the panels are for
   * setting things up, not for playing.
   */
  toggleUi(force) {
    this.visible = force ?? !this.visible
    this.el.classList.toggle('hidden', !this.visible)
    this.$('#btn-hide').innerHTML = this.visible ? ICON.eye : ICON.eyeOff
    this.actions.uiVisibility?.(this.visible)
    if (!this.visible) this.toggleHelp(false)
    return this.visible
  }

  removeBoot() {
    const boot = document.querySelector('.boot')
    if (!boot) return
    boot.classList.add('gone')
    setTimeout(() => boot.remove(), 550)
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────────────

function group(title, child) {
  const el = document.createElement('div')
  el.className = 'group'
  el.innerHTML = `<h3>${title}</h3>`
  if (child) el.appendChild(child)
  return el
}

function chips(items, current, onPick, registry) {
  const wrap = document.createElement('div')
  wrap.className = 'chips'
  const buttons = []
  for (const item of items) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'chip'
    b.textContent = item.label
    if (item.title) b.title = item.title
    b.addEventListener('click', () => onPick(item.id))
    wrap.appendChild(b)
    buttons.push([item.id, b])
  }
  registry.push({
    el: wrap,
    sync: () => {
      const now = current()
      for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(id === now))
    },
  })
  return wrap
}

const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6)
/**
 * Eye colours are authored above 1.0 so the bloom pass catches them in the scene. For the
 * card they are normalised by the brightest channel — which keeps the hue the astronaut
 * actually has rather than clipping a 3.0-red down to the same white as a 3.0-blue.
 */
function cssFromGlow(color) {
  const peak = Math.max(color.r, color.g, color.b, 1)
  const enc = (v) => Math.round(Math.pow(Math.min(1, v / peak), 1 / 2.2) * 255)
  return `rgb(${enc(color.r)},${enc(color.g)},${enc(color.b)})`
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

/** Status → the colour family the top-bar counters already use for it. */
function statusClass(status) {
  if (status === 'working') return 'working'
  if (status === 'waiting') return 'waiting'
  if (status === 'blocked') return 'blocked'
  if (status === 'celebrating') return 'done'
  return 'idle'
}

/**
 * A path that fits, trimmed from the *left* so the repo end survives — the deep end is the
 * part that identifies it. CSS can only ellipsise the tail, and `direction: rtl` mangles a
 * leading `~`, so the trim is done here and the whole path lives in the title attribute.
 */
function shortPath(dir, max = 30) {
  const home = dir.replace(/^\/Users\/[^/]+/, '~')
  if (home.length <= max) return home
  const parts = home.split('/')
  let out = parts.pop() || ''
  while (parts.length) {
    const next = parts.pop()
    if (out.length + next.length + 3 > max) break
    out = `${next}/${out}`
  }
  return `…/${out}`
}

function shortModel(model) {
  return String(model).replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

function clockLabel(t) {
  const total = t * 24 * 60
  const h = Math.floor(total / 60) % 24
  const m = Math.floor(total % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function nearestTime(value) {
  let best = TIMES[0]
  let bestD = Infinity
  for (const t of TIMES) {
    // Wrap-aware, so 0.99 is nearest to dawn rather than to noon.
    const d = Math.min(Math.abs(t.value - value), 1 - Math.abs(t.value - value))
    if (d < bestD) {
      bestD = d
      best = t
    }
  }
  return bestD < 0.03 ? best.id : null
}

function ago(ts) {
  if (!ts) return 'never'
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const TEMPLATE = `
<aside class="side panel">
  <header class="brandbar">
    <div class="brand"><i class="dot"></i>Anime Crossing</div>
    <button class="btn icon ghost" id="btn-collapse" title="Collapse the panel (\\)">${ICON.chevronRight}</button>
    <button class="btn icon ghost" id="btn-shot" title="Screenshot (P)">${ICON.camera}</button>
    <button class="btn icon ghost" id="btn-help" title="Help (?)">${ICON.help}</button>
    <button class="btn icon ghost" id="btn-hide" title="Hide all UI (H)">${ICON.eye}</button>
    <button class="btn icon ghost" id="btn-settings" title="Settings (S)" aria-pressed="false">${ICON.settings}</button>
  </header>

  <div class="stats"></div>

  <div class="side-body">
    <div class="projects-pane">
      <div class="sec-head"><span>Repos</span></div>
      <div class="projects"></div>
    </div>

    <div class="project-detail">
      <button class="btn ghost back" id="btn-close-project" title="Back to every repo (Esc)">${ICON.back} All repos</button>
      <div class="who">
        <i class="swatch"></i>
        <div class="text">
          <div class="name"></div>
          <div class="path"></div>
        </div>
        <button class="btn icon ghost" id="btn-locate" title="Fly to this zone">${ICON.locate}</button>
      </div>
      <div class="project-actions">
        <button class="btn primary" id="btn-new-session" title="Start a new thread in this folder (C)">${ICON.plus} New conversation</button>
        <div class="pair">
          <button class="btn" id="btn-reveal" title="Show this folder in ${FILE_MANAGER}">${ICON.folder} ${FILE_MANAGER}</button>
          <button class="btn" id="btn-copy-path" title="Copy the folder path">${ICON.copy} Copy path</button>
        </div>
      </div>
      <div class="threads-head"></div>
      <div class="threads"></div>
    </div>
  </div>
</aside>

<div class="rail panel">
  <button class="btn icon" id="btn-home" title="Reset the view (0)">${ICON.home}</button>
  <button class="btn icon" id="btn-next" title="Next astronaut waiting on you (N)">${ICON.next}</button>
  <div class="sep"></div>
  <button class="btn icon" id="btn-orbit" title="Orbit mode — sweep around the colony (O)" aria-pressed="false">${ICON.orbit}</button>
  <button class="btn icon" id="btn-planet" title="Change planet (Tab)">${ICON.globe}</button>
  <button class="btn icon" id="btn-time" title="Change the time of day (L)">${ICON.sun}</button>
</div>

<div class="settings panel closed">
  <header>Settings <button class="btn icon ghost" id="btn-close-settings" title="Close">${ICON.close}</button></header>
  <div class="body"></div>
</div>

<div class="thread-pop panel">
  <i class="nib"></i>
  <div class="top">
    <div class="avatar"><canvas></canvas></div>
    <div class="info">
      <div class="title"></div>
      <div class="meta"></div>
    </div>
    <button class="btn icon ghost" id="btn-deselect" title="Deselect (Esc)">${ICON.close}</button>
  </div>
  <div class="progress"><i></i></div>
  <div class="pair">
    <button class="btn primary" id="btn-open" title="Open this thread in the harness it came from (Enter)">${ICON.open} Open</button>
    <button class="btn" id="btn-archive" title="Archive — this astronaut walks back to the ship (A)">${ICON.archive} Archive</button>
  </div>
</div>

<div class="toasts"></div>
<div class="fps panel"></div>
<div class="hint-pill panel"></div>

<!-- Walk mode. The prompt sits low and centre where the eye already is when you are
     steering a character; the dialogue box takes the same band when someone speaks. -->
<!-- The handle that brings the panel back. Lives outside it, because a button inside a
     panel that has slid off the screen is a button you cannot press. -->
<button class="side-handle" title="Show the panel (\\)">${ICON.chevronLeft}</button>

<!-- The quest board. Left edge, clear of the toolbar, and only ever three lines long. -->
<div class="quests"></div>

<!-- The area title, on the way into a zone. Deliberately large and deliberately brief:
     it is the one piece of chrome allowed to interrupt the view, and only for a moment. -->
<div class="area-title">
  <div class="area-kicker">Now entering</div>
  <div class="area-name"></div>
  <div class="area-sub"></div>
</div>

<div class="talk-box">
  <div class="talk-name"></div>
  <div class="talk-genre"></div>
  <p class="talk-line"></p>
  <div class="talk-options"></div>
</div>
<!-- After the box, not before: the prompt hides itself with a sibling selector while
     somebody is speaking, and CSS can only look forwards. -->
<div class="talk-prompt"><b>E</b><span></span></div>

<div class="festival"></div>

<div class="help">
  <div class="sheet panel">
    <h2>Anime Crossing</h2>
    <p class="sub">Every coding-agent thread on this machine is an anime character, dealt a genre of its own — magical girl, mecha pilot, shinobi, whatever the thread id happens to hash to. The same chat is the same character every time.</p>
    <p class="sub">You are down there with them. Walk around with <b>WASD</b> and press <b>E</b> — at a person it starts a conversation, at a doorway it takes the roof off the building and shows you the room inside. Conversations have replies: press <b>1</b>–<b>3</b> to ask what they are working on, how it is going, how long they have been at it. Every answer is read off the real thread.</p>
    <p class="sub"><b>R</b> summons something to ride, <b>V</b> drops into first person, and clicking a repo or a thread in the sidebar walks you there rather than flying the camera — so the quickest way across the map is to click where you want to be.</p>
    <p class="sub"><b>Tab</b> steps back out to the map view, where navigation works like Google Earth — drag the ground itself, right-drag to tilt, scroll to zoom in on whatever is under the cursor. The board on the left is a quest log, and everything on it is a real thread in a real state: somebody waiting on a reply, something that fell over, a zone you have not walked into yet.</p>
    <div class="cols">
      <div>
        <div class="k"><span>Walk</span><kbd>W A S D</kbd></div>
        <div class="k"><span>First / third person</span><kbd>V</kbd></div>
        <div class="k"><span>Run</span><kbd>⇧ + walk</kbd></div>
        <div class="k"><span>Talk / enter / leave</span><kbd>E</kbd></div>
        <div class="k"><span>Reply in conversation</span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></div>
        <div class="k"><span>Summon the cat</span><kbd>R</kbd></div>
        <div class="k"><span>Walk / map view</span><kbd>Tab</kbd></div>
        <div class="k"><span>Turn the camera</span><kbd>drag</kbd></div>
        <div class="k"><span>Drag the ground</span><kbd>drag</kbd></div>
        <div class="k"><span>Tilt &amp; rotate</span><kbd>right-drag</kbd></div>
        <div class="k"><span>&nbsp;</span><kbd>⌃ or ⇧ + drag</kbd></div>
        <div class="k"><span>Zoom to cursor</span><kbd>scroll</kbd></div>
        <div class="k"><span>Move / zoom</span><kbd>arrows</kbd> <kbd>+ −</kbd></div>
        <div class="k"><span>Reset view</span><kbd>0</kbd></div>
        <div class="k"><span>Collapse the panel</span><kbd>\</kbd></div>
        <div class="k"><span>Hide all UI</span><kbd>H</kbd> <kbd>${IS_MAC ? '⌘' : 'Ctrl'}\\</kbd></div>
        <div class="k"><span>Settings</span><kbd>S</kbd></div>
        <div class="k"><span>Screenshot</span><kbd>P</kbd></div>
      </div>
      <div>
        <div class="k"><span>Next needing you</span><kbd>N</kbd></div>
        <div class="k"><span>Open thread</span><kbd>Enter</kbd></div>
        <div class="k"><span>Archive</span><kbd>A</kbd></div>
        <div class="k"><span>New conversation</span><kbd>C</kbd></div>
        <div class="k"><span>Orbit mode</span><kbd>O</kbd></div>
        <div class="k"><span>Change world</span><kbd>G</kbd></div>
        <div class="k"><span>Mute sound</span><kbd>M</kbd></div>
        <div class="k"><span>Time of day</span><kbd>L</kbd></div>
        <div class="k"><span>Deselect</span><kbd>Esc</kbd></div>
        <div class="k"><span>This sheet</span><kbd>?</kbd></div>
      </div>
    </div>
    <div style="margin-top:16px">
      <div class="legend-row"><i class="badge" style="background:#1a2b46;color:#8fb4ee">?</i> waiting on your reply — click to open the thread</div>
      <div class="legend-row"><i class="badge" style="background:#3d1c1c;color:#e88b8b">!</i> the session hit an error</div>
      <div class="legend-row"><i class="badge" style="background:#16301f;color:#7fd39a">⚒</i> running right now, building</div>
      <div class="legend-row"><i class="badge" style="background:#332b12;color:#e6c67f">✓</i> its pull request landed</div>
      <div class="legend-row"><i class="badge" style="background:#1d1f2e;color:#a9a8c0">z</i> nothing for three days</div>
    </div>
    <div style="margin-top:18px;display:flex;justify-content:flex-end">
      <button class="btn primary" id="btn-help-close">Got it</button>
    </div>
  </div>
</div>
`
