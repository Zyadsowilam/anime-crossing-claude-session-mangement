import * as THREE from 'three'
import './ui/styles.css'
import { DEFAULT_PRESET, Settings, hasStoredSettings } from './core/settings.js'
import { Engine } from './core/engine.js'
import { CameraRig } from './core/camera.js'
import { Colony, STATUS_LABEL, STATUS_ORDER, statusFor, transcriptProgress } from './game/colony.js'
import { worldToHex } from './world/plots.js'
import { Hud } from './ui/hud.js'
import { WalkMode } from './game/walk.js'
import { Quests } from './game/quests.js'
import { Dialogue } from './game/dialogue.js'
import { FestivalGame } from './game/festival.js'
import { ShatekiGame } from './game/shateki.js'
import { TaikoGame } from './game/taiko.js'
import { LanternGame } from './game/lanterns.js'
import { voiceFor } from './game/themes.js'
import { shoptalk } from './game/shoptalk.js'
import { Mount } from './agents/mount.js'
import { Audio } from './core/audio.js'
import { PLANETS } from './world/planet.js'
import { loadKit } from './world/kit.js'
import { crewRig, loadCrew } from './agents/crew.js'
import { TIMES } from './world/sky.js'
import {
  fetchThreads,
  fetchState,
  saveState,
  openThread,
  archiveThread,
  newSession,
  revealFolder,
} from './game/api.js'

/**
 * Boot and the outer game loop.
 *
 * The one interesting piece of orchestration here is the archive round trip. The harness
 * owns the session records; the colony owns nothing but its own list of what you archived,
 * and that list is written by exactly one writer — this page — so a save from a stale tab
 * can never silently drop an archive. Everything else is wiring.
 */

const POLL_MS = 15000
const app = document.getElementById('app')

app.insertAdjacentHTML(
  'beforeend',
  `<div class="boot"><div class="inner">
     <h1>Anime Crossing</h1>
     <p>Summoning the cast…</p>
     <div class="bar"><i></i></div>
   </div></div>`
)

const settings = new Settings()
if (!hasStoredSettings()) settings.applyPreset(DEFAULT_PRESET)

const engine = new Engine(settings).mount(app)
const rig = new CameraRig(engine.camera, engine.canvas, settings)
const colony = new Colony(engine.scene, settings, engine.camera, engine.renderer)

let state = { archived: [], archivedAt: {}, opened: [], plots: {}, seen: {} }
let threads = []
/** Last legend built for the bottom bar, kept so the open zone's chip can light up between polls. */
let legendProjects = []
/** The zone layout as last written to the colony file, so an unchanged map is not re-saved. */
let lastLayout = ''
let selectedId = null
/** Which zone's sidebar is open. A repo, not a thread — they outlive the threads on them. */
let selectedProject = null
let hoverId = null
let statusCursor = 0
let pendingSave = 0
const hoverGround = new THREE.Vector3()

// ── actions the HUD can trigger ────────────────────────────────────────────────────────

const actions = {
  resetView: () => rig.resetView(),

  screenshot: () => {
    // Render one more frame, then read the buffer before the compositor clears it — the
    // alternative is preserveDrawingBuffer, which costs a copy on every single frame.
    engine.renderFrame()
    const url = engine.canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = `anime-crossing-${colony.planet.id}-${stamp()}.png`
    a.click()
    hud.toast('Screenshot saved')
  },

  /** Google Earth's auto-rotate: a slow sweep around whatever is centred. */
  toggleOrbit: () => {
    const on = rig.toggleOrbit()
    hud.hint(on ? 'Orbit mode on — drag or press O to stop' : 'Orbit mode off')
    return on
  },

  cyclePlanet: () => {
    const ids = Object.keys(PLANETS)
    const next = ids[(ids.indexOf(settings.get('planet')) + 1) % ids.length]
    settings.set('planet', next)
    audio.setWorld(PLANETS[next])
    hud.hint(`${PLANETS[next].name} — ${PLANETS[next].blurb}`)
  },

  cycleTime: () => {
    settings.set('autoTime', false)
    const current = settings.get('timeOfDay')
    // Step to the next named time *after* the current one, wrapping at midnight.
    const next = TIMES.find((t) => t.value > current + 0.005) || TIMES[0]
    settings.set('timeOfDay', next.value)
    hud.hint(next.label)
  },

  /** Fly to the next astronaut in a given state, cycling through them on repeat presses. */
  focusStatus: (status) => {
    const key = status === 'agents' ? null : status
    const pool = colony.astronauts.agents.filter((a) => (key ? a.status === key : true))
    if (!pool.length) {
      hud.hint(key ? `Nobody is ${(STATUS_LABEL[key] || key).toLowerCase()} right now` : 'No crew on the surface')
      return
    }
    pool.sort((a, b) => a.id.localeCompare(b.id))
    const agent = pool[statusCursor++ % pool.length]
    select(agent.id, { fly: true })
  },

  focusProject: (name) => {
    const plot = colony.plots.get(name)
    if (!plot) return
    const at = plot.middle || plot.center
    // In the colony, walk there. Above it, fly there.
    if (walk.active && warpTo(at.x, at.z, { message: `Travelled to ${name}` })) return
    rig.focus(at, { distance: 30 })
  },

  /** The legend, and anything else that means "show me this repo". */
  pickProject: (name) => selectProject(name, { fly: true }),

  /** Back out of one repo to the list of all of them. The panel itself never leaves. */
  closeProject: () => {
    selectedProject = null
    select(null, {})
    syncProject()
  },

  select: (id) => select(id, {}),

  focusThread: (id) => select(id, { fly: true }),

  /**
   * A new thread in this repo. The desktop app opens an empty session with the folder as
   * its workspace — nothing here is resumed, and nothing is written to disk.
   */
  newConversation: async () => {
    const name = selectedProject
    const folder = name && pathForProject(name)
    if (!folder) {
      hud.toast('No folder on disk for that project', 'err')
      return
    }
    try {
      const harness = harnessForProject(name)
      await newSession(folder, harness)
      hud.toast(`New thread in ${name} — opening ${harnessLabel(harness)}`)
      // It lands as an astronaut walking down the ramp, once it has a record to scan.
      setTimeout(poll, 6000)
    } catch (err) {
      hud.toast(err.message || 'Could not start a thread there', 'err')
    }
  },

  revealProject: async () => {
    const folder = selectedProject && pathForProject(selectedProject)
    if (!folder) return
    try {
      await revealFolder(folder)
    } catch (err) {
      hud.toast(err.message || 'Could not open that folder', 'err')
    }
  },

  copyProjectPath: async () => {
    const folder = selectedProject && pathForProject(selectedProject)
    if (!folder) return
    try {
      await navigator.clipboard.writeText(folder)
      hud.toast('Path copied')
    } catch {
      // The async clipboard needs a permission this page does not always have — inside an
      // embedded preview, say. The old selection-based copy has no such gate.
      const copied = copyFallback(folder)
      hud.toast(copied ? 'Path copied' : 'Could not reach the clipboard', copied ? '' : 'err')
    }
  },

  openThread: async () => {
    const thread = threads.find((t) => t.id === selectedId)
    if (!thread) return
    try {
      await openThread(thread)
      quests.open(thread.id)
      refreshQuests()
      colony.astronauts.celebrate(thread.id)
      hud.toast(`Opened in ${thread.harnessName || 'your harness'}`)
      // Opening is the thing that makes a thread no longer unread, so refresh shortly after.
      setTimeout(poll, 1800)
    } catch (err) {
      hud.toast(err.message || 'Could not open that thread', 'err')
    }
  },

  archiveThread: async () => {
    const thread = threads.find((t) => t.id === selectedId)
    if (!thread) return
    try {
      const res = await archiveThread(thread, true)
      state.archived = [...new Set([...state.archived, thread.id])]
      state.archivedAt = { ...state.archivedAt, [thread.id]: Date.now() }
      queueSave()
      select(null, {})
      applyThreads(threads)
      hud.toast(
        res.harnessRecord === false
          ? `Archived here (no ${thread.harnessName || 'harness'} record for it)`
          : 'Archived — heading home'
      )
      colony.ship.ping()
    } catch (err) {
      hud.toast(err.message || 'Could not archive that thread', 'err')
    }
  },

  uiVisibility: (visible) => colony.setUiVisible(visible),

  // The card's bar is about the *thread*, not about how much of its building has risen —
  // those were the same number while construction was drawn by burying the structure.
  progressFor: (id) => {
    const thread = threads.find((t) => t.id === id)
    return thread ? transcriptProgress(thread) : 0
  },
}

const hud = new Hud(app, settings, actions)

/**
 * Walk mode — the default way in.
 *
 * You are a character standing among the others rather than a camera hanging over them, and
 * the overhead view is the thing you step *out* to (Tab), not the thing you step in from.
 * The two share one camera rig, so leaving walk mode leaves the camera exactly where your
 * character was standing rather than cutting to a saved overview.
 */
/**
 * The quest board. Everything on it is a real thread in a real state — see `quests.js` for
 * why that constraint is the whole design rather than a limitation of it.
 */
const quests = new Quests()

/** The conversation currently open, if any. See `game/dialogue.js`. */
const dialogue = new Dialogue()

/**
 * The soundtrack, such as it is: wind, footsteps, and four notes. See `core/audio.js` for
 * why none of it is a file.
 *
 * Started on the first gesture rather than at boot, because that is the only time a browser
 * will allow it — and the listeners take themselves off afterwards so this costs nothing
 * for the rest of the session.
 */
const audio = new Audio(settings)
const wakeAudio = () => {
  audio.start()
  audio.setWorld(colony.planet)
  window.removeEventListener('pointerdown', wakeAudio)
  window.removeEventListener('keydown', wakeAudio)
}
window.addEventListener('pointerdown', wakeAudio)
window.addEventListener('keydown', wakeAudio)

/** The rideable. One in the whole world, drawn at whoever is on it. */
const mount = new Mount(engine.scene)

const walk = new WalkMode(colony.astronauts, rig, {
  colony,
  mount,
  onMount: (on) => {
    hud.hint(on ? 'Riding — R to dismount' : 'On foot again')
    audio.chime(on ? 'quest' : 'talk')
  },
  onEnter: (result) => {
    if (result) {
      hud.hint(`Inside the ${String(result.label || 'building').toLowerCase()} — E to step out`)
      audio.chime('enter')
    } else {
      hud.hint('Back outside')
    }
  },
  // Buildings and the ship only — see `Colony.viewBlocked` for why the navigation grid is
  // the wrong thing to ask.
  occluded: (x, z) => colony.viewBlocked(x, z),
  onInteract: (agent) => talkTo(agent),
  onStall: () => openStall(),
  onToggle: (on) => {
    hud.setWalkMode?.(on)
    if (!on) hud.closeTalk?.()
  },
  onView: (mode) => hud.hint(mode === 'first' ? 'First person — V to look over your shoulder' : 'Third person — V for first person'),
})

/**
 * Which zone you are standing in, announced when it changes.
 *
 * This is the cheapest thing in the whole fork and one of the most useful: a repo is a
 * *place* here, and a place you can walk into should tell you its name on the way in. It
 * also quietly answers the question the overhead view answered for free and walking around
 * took away — "which project am I looking at?"
 */
let standingIn = null
function checkArea() {
  if (!walk.active) {
    if (standingIn !== null) {
      standingIn = null
      hud.setArea(null)
    }
    return
  }
  const player = colony.astronauts.player
  if (!player) return
  const plot = colony.plotAt(player.pos.x, player.pos.z)
  // `plotAt` answers with the *nearest* zone rather than the containing one, so a name only
  // counts once you are genuinely standing on that zone's own cells — otherwise the banner
  // would flicker through three repos while you crossed the grass between them.
  const name = plot && plotContains(plot, player.pos) ? plot.name : null
  if (name === standingIn) return
  standingIn = name
  hud.setArea(name ? { name, threads: countThreads(name) } : null)
  if (name) {
    audio.chime('enter')
    quests.visit(name)
    refreshQuests()
  }
}

/** True when a point is genuinely on one of a plot's cells, not merely nearest to it. */
function plotContains(plot, v) {
  const cell = worldToHex(v.x, v.z)
  return plot.cellKeys.has(`${cell.q},${cell.r}`)
}

const countThreads = (name) => threads.filter((t) => t.project === name).length

/** Threads already known to be waiting, so the bell rings on the transition only. */
let knownWaiting = null

/**
 * Recompute the quest board and celebrate anything that just finished.
 *
 * Called after every action that could complete something — a poll, a conversation, walking
 * into a new zone — rather than on a timer, so a quest ticks over on the frame you earn it
 * instead of up to fifteen seconds later.
 */
function refreshQuests() {
  const projects = [...colony.plots.keys()]
  const finished = quests.refresh(threads, (t) => statusFor(t), projects)
  for (const quest of finished) hud.toast(`Done — ${Quests.describe(quest)}`, 'ok')
  if (finished.length) audio.chime('quest')

  /**
   * The bell, for a thread that has *started* waiting on you since the last poll.
   *
   * Only on the transition, and only for threads not already known to be waiting — the
   * board is recomputed on every poll and on every conversation, and ringing for the
   * standing set each time would be a bell every fifteen seconds forever, which is how a
   * feature like this gets muted permanently within a minute.
   */
  const waitingNow = new Set(threads.filter((t) => statusFor(t) === 'waiting').map((t) => t.id))
  if (knownWaiting) {
    for (const id of waitingNow) {
      if (!knownWaiting.has(id)) {
        audio.chime('need')
        break
      }
    }
  }
  knownWaiting = waitingNow

  hud.setQuests(quests.active)
}
// The sidebar is permanent, so the card beside an astronaut has a wall to stay clear of.
const sideWidth = () => (window.innerWidth <= 820 ? 0 : 334)
hud.setSideWidth(sideWidth())
window.addEventListener('resize', () => hud.setSideWidth(sideWidth()))

/**
 * Put your character somewhere, rather than putting the camera there.
 *
 * Every "show me this" action in the app — clicking a repo in the sidebar, clicking a
 * thread, pressing N for the next one that needs a reply — used to mean *fly the camera*.
 * That is the right answer when you are looking down at a map and the wrong one when you
 * are standing in it: the camera leaves and your character does not, and you end up
 * watching an empty hillside from above while the person you are playing is still by the
 * gate.
 *
 * So in walk mode those actions move *you*. The camera comes along because it is pinned to
 * you, which means one behaviour serves both modes and there is no second code path that
 * can disagree about where "there" is.
 *
 * The landing spot is nudged off the exact target and onto a cell the navigation grid says
 * is free — arriving inside a building is worse than arriving a metre to its left.
 */
function warpTo(x, z, { facing = null, message = null } = {}) {
  const player = colony.astronauts.player
  if (!player) return false
  const nav = colony.astronauts.nav
  const cell = nav?.nearestFree(x, z)
  const px = cell ? nav.toWorld(cell.ix) : x
  const pz = cell ? nav.toWorld(cell.iz) : z
  player.pos.set(px, player.pos.y, pz)
  // Re-sample the ground on the next frame rather than easing up to it from wherever the
  // old ground was: eased, a warp onto a raised deck is a visible half-second of rising
  // out of the floor.
  player.groundAt = null
  player.groundY = null
  player.vel.set(0, 0, 0)
  if (facing) {
    player.targetYaw = Math.atan2(facing.x - px, facing.z - pz)
    player.yaw = player.targetYaw
    // First person aims the camera as well, or you arrive looking at whatever you left.
    if (rig.follow?.mode === 'first') {
      rig.desiredAzimuth = player.yaw + Math.PI
      rig.azimuth = rig.desiredAzimuth
    }
  }
  if (message) hud.hint(message)
  return true
}

// ── selection ─────────────────────────────────────────────────────────────────────────

function select(id, { fly = false } = {}) {
  selectedId = id
  const agent = id ? colony.agentFor(id) : null
  if (!agent) {
    selectedId = null
    colony.astronauts.setSelected(null)
    hud.setSelection(null, null)
    syncProject()
    return
  }
  colony.astronauts.setSelected(agent)
  const thread = threads.find((t) => t.id === id) || agent.thread
  hud.setSelection(agent, thread)
  // Picking somebody is also picking the zone they are standing on: the sidebar follows.
  if (thread?.project && colony.plots.has(thread.project)) selectedProject = thread.project
  syncProject()
  if (fly) {
    if (walk.active) {
      // Land a couple of metres short and turn to face them, which is where you would have
      // stopped if you had walked over — and close enough that E works straight away.
      const back = 2.2
      const ox = agent.pos.x + Math.sin(agent.yaw) * back
      const oz = agent.pos.z + Math.cos(agent.yaw) * back
      if (warpTo(ox, oz, { facing: agent.pos, message: `Went to see ${agent.charName || 'them'}` })) return
    }
    rig.focus(new THREE.Vector3(agent.pos.x, 0, agent.pos.z), { distance: Math.min(rig.desiredDistance, 26) })
  }
}

/** Open a zone's sidebar. Any selected astronaut from a different zone lets go. */
function selectProject(name, { fly = false } = {}) {
  if (!name || !colony.plots.has(name)) return
  selectedProject = name
  const current = threads.find((t) => t.id === selectedId)
  if (current && current.project !== name) select(null, {})
  else syncProject()
  if (fly) actions.focusProject(name)
}

/**
 * The repo folder behind a zone. Plots are keyed by the folder's *name*, which is all the
 * colony needs to draw one — the path itself lives on the threads, so it is read back off
 * them, taking the most common answer if two checkouts somehow share a basename.
 */
/** The human name for a harness id — every thread already carries its own. */
function harnessLabel(id) {
  for (const thread of colony.threads.values()) {
    if (thread.harness === id && thread.harnessName) return thread.harnessName
  }
  return 'your harness'
}

/**
 * Which harness a project's threads belong to, picked the same way its path is: the most
 * common answer among the threads standing there. A repo worked on from two harnesses gets
 * a new thread in whichever one it is mostly used from.
 */
function harnessForProject(name) {
  const counts = new Map()
  for (const thread of colony.threads.values()) {
    if (thread.project !== name || !thread.harness) continue
    counts.set(thread.harness, (counts.get(thread.harness) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [id, n] of counts) {
    if (n <= bestCount) continue
    best = id
    bestCount = n
  }
  return best
}

function pathForProject(name) {
  const counts = new Map()
  for (const thread of colony.threads.values()) {
    if (thread.project !== name) continue
    const dir = thread.projectPath || thread.cwd
    if (!dir) continue
    counts.set(dir, (counts.get(dir) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [dir, n] of counts) {
    if (n <= bestCount) continue
    best = dir
    bestCount = n
  }
  return best
}

/** Push the open zone's current contents at the sidebar. Closes it if the zone is gone. */
function syncProject() {
  const plot = selectedProject ? colony.plots.get(selectedProject) : null
  if (!plot) {
    selectedProject = null
    hud.setProject(null)
    hud.setLegend(legendProjects, null)
    return
  }
  const now = Date.now()
  const list = [...colony.threads.values()]
    .filter((thread) => thread.project === plot.name)
    .map((thread) => ({
      id: thread.id,
      title: thread.title,
      worktree: thread.worktree,
      runCount: thread.runCount,
      lastActivityAt: thread.lastActivityAt,
      status: statusFor(thread, now),
    }))
    // Whoever wants something first, then most recently touched — the same order of
    // importance the badges use above their heads.
    .sort((a, b) => {
      const rank = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      return rank || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
    })

  hud.setProject({
    name: plot.name,
    accent: plot.accent,
    path: pathForProject(plot.name),
    threads: list,
    selectedId,
  })
  // The legend is the same selection seen from the bottom of the screen: keep it in step
  // here rather than only on the next poll.
  hud.setLegend(legendProjects, selectedProject)
}

// ── pointer ───────────────────────────────────────────────────────────────────────────

/**
 * Where an astronaut is on screen, in CSS pixels, or null if it is behind the camera.
 *
 * Measured off the engine's own viewport rather than the canvas's bounding rect: this runs
 * every frame for the selected agent, and a layout read per frame to learn a number that
 * only changes on resize is the kind of thing that quietly costs a HUD its smoothness.
 */
const cardAnchor = new THREE.Vector3()
function screenOf(agent) {
  cardAnchor.set(agent.pos.x, agent.pos.y + 0.95, agent.pos.z).project(engine.camera)
  if (cardAnchor.z > 1) return null
  const { w, h } = engine.viewport
  return { x: (cardAnchor.x * 0.5 + 0.5) * w, y: (-cardAnchor.y * 0.5 + 0.5) * h }
}

function ndc(e) {
  const rect = engine.canvas.getBoundingClientRect()
  return {
    x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
    y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    aspect: rect.width / rect.height,
  }
}

engine.canvas.addEventListener('pointermove', (e) => {
  // Mid-drag the cursor is the grab hand and nothing else: running a pick every move event
  // while the world is being dragged would flicker the hover ring across the whole colony.
  if (rig.interacting) {
    engine.canvas.style.cursor = rig._mode === 'orbit' ? 'move' : 'grabbing'
    return
  }
  const p = ndc(e)
  const agent = colony.pick(p.x, p.y, p.aspect)
  hoverId = agent?.id ?? null
  colony.astronauts.setHover(agent)
  // Pointing at a quiet plot is what makes its name appear.
  const plot = plotUnder(e, p)
  colony.setHoveredPlot(plot)
  engine.canvas.style.cursor = agent || plot ? 'pointer' : 'grab'
})

/**
 * The zone under the cursor: its name plate first, then the deck itself. The plate is
 * hit-tested whether or not it is currently faded in — pointing at where a quiet project's
 * name would be is exactly what makes it appear.
 */
function plotUnder(e, p) {
  const label = colony.pickLabel(p.x, p.y)
  if (label) return label
  const ground = rig.groundPoint(e.clientX, e.clientY, hoverGround)
  return ground ? colony.plotAt(ground.x, ground.z) : null
}

// Pressing on an astronaut used to suppress the camera, on the theory that grabbing one
// should not also drag the world out from under it. But nothing is draggable *about* an
// astronaut — a press is only ever the start of a selection or the start of a pan — so all
// that suppression did was make the ground refuse to move whenever a drag happened to begin
// on top of somebody. Selection is decided on release instead, where `wasClick` already
// distinguishes a click from a drag.
engine.canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !rig.wasClick) return
  const p = ndc(e)
  const agent = colony.pick(p.x, p.y, p.aspect)
  if (agent) {
    select(agent.id, {})
    return
  }
  // Nobody there: a zone's deck or its name plate opens that repo's sidebar instead, and
  // bare ground puts everything down.
  const plot = plotUnder(e, p)
  if (plot) selectProject(plot.name, {})
  else {
    select(null, {})
    actions.closeProject()
  }
})

engine.canvas.addEventListener('pointerleave', () => {
  hoverId = null
  colony.astronauts.setHover(null)
  colony.setHoveredPlot(null)
})

// ── keyboard ──────────────────────────────────────────────────────────────────────────

/**
 * Key *releases*, which only the stall games care about.
 *
 * Everything else in this app acts on the press alone, so there has never been a keyup
 * listener. A game steered by holding a key needs one or the basket keeps travelling after
 * you let go — the press says "start moving" and nothing ever says "stop".
 */
window.addEventListener('keyup', (e) => {
  if (!stallOpen()) return
  const game = currentStall()
  if (!game?.hold) return
  if (e.key === 'ArrowLeft') game.hold('left', false)
  else if (e.key === 'ArrowRight') game.hold('right', false)
})

window.addEventListener('keydown', (e) => {
  // Never steal keys from a field the user is actually typing in.
  const t = e.target
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return

  // ⌘\ (⌃\ elsewhere) dismisses the chrome, the same as H — the shortcut every editor
  // uses for its sidebar, and the one hand that is already on the keyboard.
  if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
    e.preventDefault()
    hud.toggleUi()
    return
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return

  /**
   * The stall owns the keyboard while it is open, and it has to say so *before* Tab is
   * claimed for the walk/map toggle below — otherwise stepping between the two games quietly
   * threw you out of the colony instead.
   *
   * `Esc` leaves, `Tab` swaps stall, `E` buys another go once you have run out. Everything
   * else is swallowed: the alternative is walking away from the stall you are standing at, or
   * archiving a thread with the hand you are scooping with.
   */
  if (stallOpen()) {
    e.preventDefault()
    const game = currentStall()
    if (e.key === 'Escape') game.close()
    else if (e.key === 'Tab') nextStall()
    else if ((e.key === 'e' || e.key === 'E') && game.over) game.restart()
    // A game that wants keys of its own gets them. Only the drums do, and only two — but the
    // guard swallows everything by default, so anything playable has to be let through here
    // explicitly or it simply never receives an input.
    else if (game.strike && (e.key === 'f' || e.key === 'F')) game.strike(0)
    else if (game.strike && (e.key === 'j' || e.key === 'J')) game.strike(1)
    else if (game.hold && e.key === 'ArrowLeft') game.hold('left', true)
    else if (game.hold && e.key === 'ArrowRight') game.hold('right', true)
    return
  }

  // Tab steps between being in the colony and looking down at it. It is the one key that
  // has to work in both modes, so it sits above the switch rather than inside it.
  if (e.key === 'Tab') {
    e.preventDefault()
    const on = !walk.active
    walk.setActive(on)
    hud.hint(on ? 'Walk mode — WASD to move, E to talk' : 'Map view — drag to move, Tab to walk')
    return
  }

  // Plain backslash collapses the panel; the modified one still hides everything, which is
  // the editor convention and the reason both live on the same key. Matched on `code`
  // rather than `key`, so it works on layouts where backslash needs a modifier to type.
  // A conversation owns the number keys while it is open, and nothing else does.
  if (dialogue.open && e.key >= '1' && e.key <= '9') {
    if (hud.chooseByIndex(Number(e.key))) {
      e.preventDefault()
      return
    }
  }
  if (dialogue.open && e.key === 'Escape') {
    e.preventDefault()
    say(dialogue.end())
    return
  }

  if (e.code === 'Backslash') {
    e.preventDefault()
    hud.toggleSide()
    return
  }

  /**
   * The stall owns the keyboard while it is open.
   *
   * `Esc` leaves, `E` buys another net once the paper has gone. Everything else is swallowed,
   * because the alternative is walking out of the stall you are standing at — or archiving a
   * thread with the same hand you are scooping with, which is the exact class of bug the
   * guard below this one exists to stop.
   */
  /**
   * While you are walking, the movement keys are *only* movement keys.
   *
   * Both handlers listen on `window`, and `walk.js` calls `preventDefault()` on the keys it
   * uses — which stops the browser scrolling the page and does nothing whatever to stop this
   * switch also running. So every step you took fired a map-mode shortcut underneath it:
   *
   * - **`A` archived the selected thread.** Talking to somebody selects their thread (`E`
   *   calls `talkTo` → `select`), so the ordinary sequence of walking up to a character,
   *   pressing `E`, and then strafing away past them archived the thread you had just opened.
   *   Silently, with no confirmation and no undo — the toast said "Archived — heading home"
   *   and the character walked out through the gate.
   * - **`S` opened the settings panel**, every single time you backed up.
   *
   * `preventDefault` was never the right tool for this; the two listeners are peers and one
   * cannot suppress the other. The fix is to say plainly which mode owns which keys.
   */
  if (walk.active && WALK_KEYS.has(e.code)) return

  switch (e.key) {
    case 'm':
    case 'M': {
      const on = !settings.get('sound')
      settings.set('sound', on)
      audio.setEnabled(on)
      hud.hint(on ? 'Sound on' : 'Sound muted')
      break
    }
    case 'h':
    case 'H':
      hud.toggleUi()
      break
    case 's':
    case 'S':
      hud.toggleSettings()
      break
    case 'n':
    case 'N':
      actions.focusStatus('waiting')
      break
    case 'p':
    case 'P':
      actions.screenshot()
      break
    case 'l':
    case 'L':
      actions.cycleTime()
      break
    case 'o':
    case 'O':
      hud.setOrbit(actions.toggleOrbit())
      break
    // Cycling the world moved off Tab when Tab became the way in and out of walk mode:
    // stepping into the colony is the thing you reach for constantly, and changing planet
    // is the thing you do twice.
    case 'g':
    case 'G':
      actions.cyclePlanet()
      break
    case '0':
      actions.resetView()
      hud.setOrbit(false)
      break
    case 'Enter':
      if (selectedId) actions.openThread()
      break
    case 'a':
    case 'A':
      if (selectedId) actions.archiveThread()
      break
    case 'c':
    case 'C':
      if (selectedProject) actions.newConversation()
      break
    case '?':
      hud.toggleHelp()
      break
    // Arrow keys nudge the view and +/- zoom, the same as Earth's keyboard.
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight': {
      e.preventDefault()
      const step = rig.distance * 0.09
      const forward = new THREE.Vector3(Math.sin(rig.azimuth), 0, Math.cos(rig.azimuth))
      const right = new THREE.Vector3(forward.z, 0, -forward.x)
      if (e.key === 'ArrowUp') rig.desiredTarget.addScaledVector(forward, -step)
      if (e.key === 'ArrowDown') rig.desiredTarget.addScaledVector(forward, step)
      if (e.key === 'ArrowLeft') rig.desiredTarget.addScaledVector(right, -step)
      if (e.key === 'ArrowRight') rig.desiredTarget.addScaledVector(right, step)
      rig._clampTarget()
      rig.idleFor = 0
      break
    }
    case '+':
    case '=':
      rig.desiredDistance = Math.max(4, rig.desiredDistance * 0.82)
      break
    case '-':
    case '_':
      rig.desiredDistance = Math.min(150, rig.desiredDistance * 1.22)
      break
    // One step at a time, outward: the thread, then the zone it belongs to.
    case 'Escape':
      if (document.querySelector('.help.open')) hud.toggleHelp(false)
      else if (selectedId) select(null, {})
      else if (selectedProject) actions.closeProject()
      break
  }
})

// ── data ──────────────────────────────────────────────────────────────────────────────

function applyThreads(list) {
  threads = list
  const archivedSet = new Set(state.archived)
  const stats = colony.setThreads(list, archivedSet)
  hud.setStats(stats)
  // Statuses change underneath the board on every poll, so it is re-derived here rather
  // than kept as its own copy of the thread list that could drift out of step.
  refreshQuests()

  legendProjects = colony.plotOrder
    .map((plot) => ({
      name: plot.name,
      accent: plot.accent,
      count: list.filter((t) => !t.archived && !archivedSet.has(t.id) && t.project === plot.name).length,
      urgent: colony.urgentPlots?.has(plot.id) ?? false,
    }))
    .sort((a, b) => b.count - a.count)

  // Keep the card honest if the thread it is showing changed underneath it.
  if (selectedId) {
    const still = colony.agentFor(selectedId)
    if (still) hud.setSelection(still, list.find((t) => t.id === selectedId) || still.thread)
    else select(null, {})
  }
  // Which also repaints the legend, so the open zone's chip is lit by the same pass.
  syncProject()

  // Zones only move when their own footprint changes, and when one does the colony file
  // learns about it — so the map you built up a memory of survives a reload.
  const layout = colony.layoutForSave()
  const signature = JSON.stringify(layout)
  if (signature !== lastLayout) {
    lastLayout = signature
    state.plots = layout
    queueSave()
  }
}

let polling = false
async function poll() {
  if (polling) return
  polling = true
  try {
    const res = await fetchThreads()
    applyThreads(res.threads || [])
    hud.removeBoot()
  } catch (err) {
    hud.toast(err.message || 'Could not reach the thread scanner', 'err')
    hud.removeBoot()
  } finally {
    polling = false
  }
}

function queueSave() {
  clearTimeout(pendingSave)
  pendingSave = setTimeout(async () => {
    try {
      await saveState(state)
    } catch {
      /* the colony still runs; only the archive list is at risk, and it retries next time */
    }
  }, 500)
}

async function boot() {
  // The model kit and the crew rig both have to be in hand before the first roster arrives:
  // buildings and the ground scatter are assembled out of the kit synchronously the moment
  // a thread shows up, and the crew's body mesh is built from the rig. Fetched alongside
  // the saved state rather than after it, since none of them waits on the others.
  const settle = (p) => p.then(() => null, (err) => err)
  const [, kitError, crewError] = await Promise.all([
    fetchState()
      .then((s) => {
        state = s
        // Before the first roster: zones come back to the ground they were on last time.
        colony.restoreLayout(state.plots)
        // And the settings, but only for a browser that has none of its own — an explicit
        // choice made here always outranks the file.
        if (!hasStoredSettings() && state.settings) settings.applyAll(state.settings)
      })
      .catch(() => {
        /* first run, or the file is gone — an empty colony state is a valid one */
      }),
    settle(loadKit()),
    settle(loadCrew()),
  ])
  if (kitError || crewError) {
    hud.toast('Could not load the model assets — run `npm run assets`', 'err')
    console.error(kitError || crewError)
  }
  colony.astronauts.setRig(crewRig())
  if (!kitError) colony.onAssetsReady()

  await poll()
  refreshQuests()
  setInterval(poll, POLL_MS)
  window.addEventListener('focus', poll)
  // A tab that was hidden for an hour should catch up the moment it comes back.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll()
  })

  // Walk mode is where you start. It needs the crew rig and the navigation grid, both of
  // which exist by now — before the first poll there is no ground built to stand on.
  walk.setActive(true)

  if (!localStorage.getItem('animecrossing.seen-help')) {
    hud.toggleHelp(true)
    localStorage.setItem('animecrossing.seen-help', '1')
  } else {
    hud.hint('WASD to walk · E to talk · Tab for the map view', 6000)
  }
}

/**
 * Walking up to a character and pressing E.
 *
 * The thread card is the existing selection card — the one with Open and Archive on it —
 * because a second panel that did the same two things would be a second thing to keep in
 * step with the harness. What talking adds is the half a dashboard cannot do: the character
 * says something, in the voice of whatever genre its thread was dealt.
 */
/**
 * The keys walk mode owns outright. Anything here is ignored by the map's shortcuts while you
 * are on foot — see the guard in the keydown handler for why that has to be explicit.
 */
const WALK_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyE',
  'KeyV',
  'KeyR',
])

/**
 * The festival stall: opened by `E` at the counter, closed by `Esc` or by walking off.
 *
 * Built once and kept, rather than made and thrown away each visit — the canvas, its
 * listeners and the fish all survive between openings, so stepping up to a second stall is
 * instant and there is nothing to leak.
 *
 * It deliberately takes the keyboard while it is open (see the guard in the keydown handler).
 * A game you can walk away from mid-scoop is a game the world is still moving underneath,
 * and the whole point of a stall is that you have stopped at it.
 */
/**
 * The stalls, and which one you are standing at.
 *
 * Each game owns its own canvas element rather than sharing one, because they keep live state
 * (fish mid-swim, targets mid-slide) and tearing that down and rebuilding it on every switch
 * would make swapping games feel like loading rather than like turning around. They are built
 * on first use, so a session that never visits the festival never pays for either.
 */
const STALLS = [
  { id: 'kingyo', label: 'Goldfish scooping', make: (host, opts) => new FestivalGame(host, opts) },
  { id: 'shateki', label: 'Cork shooting', make: (host, opts) => new ShatekiGame(host, opts) },
  { id: 'taiko', label: 'Taiko drumming', make: (host, opts) => new TaikoGame(host, opts) },
  { id: 'lanterns', label: 'Lantern Drift', make: (host, opts) => new LanternGame(host, opts) },
]
const stalls = new Map()
let stallIndex = 0

function stallHost(id) {
  const root = hud.$('.festival')
  let host = root.querySelector(`[data-stall="${id}"]`)
  if (!host) {
    host = document.createElement('div')
    host.dataset.stall = id
    root.appendChild(host)
  }
  return host
}

function currentStall() {
  const spec = STALLS[stallIndex]
  let game = stalls.get(spec.id)
  if (!game) {
    game = spec.make(stallHost(spec.id), {
      onClose: () => {
        hud.$('.festival').classList.remove('on')
        walk.setLocked(false)
        audio.chime('enter')
      },
    })
    stalls.set(spec.id, game)
  }
  return game
}

function openStall() {
  const root = hud.$('.festival')
  root.classList.add('on')
  // The stall takes the keyboard off the player for as long as it is up. `walk.js` listens on
  // the same window as the page's own handler, so the guard there cannot speak for it.
  walk.setLocked(true)
  // Only the game you are playing is on screen; the other keeps its state but stops drawing.
  for (const [id, game] of stalls) {
    const on = id === STALLS[stallIndex].id
    stallHost(id).style.display = on ? '' : 'none'
    if (!on) game.running = false
  }
  const game = currentStall()
  stallHost(STALLS[stallIndex].id).style.display = ''
  game.over ? game.restart() : game.start()
  hud.hint(`${STALLS[stallIndex].label} — Tab for the other stall, Esc to leave`)
  audio.chime('talk')
}

/** Step to the next stall without leaving the festival. */
function nextStall() {
  const leaving = stalls.get(STALLS[stallIndex].id)
  if (leaving) leaving.running = false
  stallIndex = (stallIndex + 1) % STALLS.length
  openStall()
}

function stallOpen() {
  return hud.$('.festival').classList.contains('on')
}

/**
 * A footrace against one of the crew, from wherever you are standing to that district's
 * festival stall.
 *
 * The finish is the stall rather than an arbitrary marker because it is somewhere you can
 * already see and already know how to find — a race to a point you have to be *told* about
 * is a race spent reading the HUD instead of running. It is also the one landmark every
 * district has in the same place, so the game is the same game in every city.
 *
 * The colony keeps running underneath: your opponent uses the ordinary navigation grid, so
 * it takes the streets, goes round the buildings, and is slowed by the same corners you are.
 */
const RACE_FINISH_RADIUS = 2.6
let race = null

function startRace(agent) {
  const plot = colony.plotAt(agent.pos.x, agent.pos.z)
  const spot = plot?.stallSpots?.[0]
  if (!plot || !spot) {
    hud.hint('No stall nearby to race to')
    return
  }
  const finish = { x: plot.center.x + spot.x, z: plot.center.z + spot.z }
  const started = colony.astronauts.startRace(agent, finish.x, finish.z, (who, { gaveUp } = {}) => {
    // The character got there. If the race is still live, they beat you to it.
    if (race?.agent === who && !race.done) finishRace(gaveUp ? 'void' : 'them')
  })
  if (!started) return
  race = { agent, finish, done: false, startedAt: performance.now() }
  // Deliberately not the area banner: `checkArea` owns that every frame and would either
  // stamp on this or be stamped on by it. A race is an event, and events are hints.
  hud.hint(`Go! ${agent.charName} is running to the stall — hold Shift`)
  audio.chime('quest')
}

/**
 * Called every frame while a race is live: have *you* got there, and is the race still real?
 */
function updateRace() {
  if (!race || race.done) return
  const player = colony.astronauts.player
  if (!player) return finishRace('void')
  // Walking out of the district, or opening a thread, abandons it — a race you have wandered
  // away from should not still be waiting to congratulate you.
  if (performance.now() - race.startedAt > 90000) return finishRace('void')
  const d = Math.hypot(player.pos.x - race.finish.x, player.pos.z - race.finish.z)
  if (d < RACE_FINISH_RADIUS) finishRace('you')
}

function finishRace(who) {
  if (!race || race.done) return
  race.done = true
  colony.astronauts.cancelRace(race.agent)
  const name = race.agent?.charName || 'They'
  if (who === 'you') {
    hud.toast(`You beat ${name} to the stall`)
    audio.chime('quest')
  } else if (who === 'them') {
    hud.toast(`${name} got there first`)
    audio.chime('need')
  }
  race = null
}

/**
 * Show what the crew are saying to each other.
 *
 * The badge said *that* two characters were talking; this says *what*. A speech bubble is the
 * difference between "something is happening over there" and a colony that feels inhabited,
 * and it costs one projection per speaker because the crew already computes its own screen
 * position for click-picking.
 *
 * Lines are chosen once per conversation and held for its whole length, keyed off the
 * conversation's own end time — re-rolling per frame would be a stroboscope, and re-rolling
 * per tick would still read as a character with no train of thought. They come from the same
 * `voiceFor` the dialogue box uses, so a character says things in the voice its theme gives
 * it rather than in a generic one.
 *
 * Only the nearest few are drawn. Every bubble past the third is unreadable anyway at the
 * distance they start stacking up, and a screen of overlapping labels is worse than none.
 */
const MAX_BUBBLES = 4
/** How far away a conversation is still worth reading. */
const BUBBLE_RANGE = 26
const bubbleLines = new WeakMap()

function updateChatter() {
  if (!walk.active || !hud.setChatter) return hud.setChatter?.([])
  const cam = engine.camera
  const player = colony.astronauts.player
  if (!player) return hud.setChatter([])

  const near = []
  for (const agent of colony.astronauts.agents) {
    const social = agent.social
    if (!social || social.kind !== 'chat' || !social.talker) continue
    const d = Math.hypot(agent.pos.x - player.pos.x, agent.pos.z - player.pos.z)
    if (d > BUBBLE_RANGE) continue
    near.push({ agent, d })
  }
  if (!near.length) return hud.setChatter([])
  near.sort((a, b) => a.d - b.d)

  const w = engine.viewport?.w || window.innerWidth
  const h = engine.viewport?.h || window.innerHeight
  const items = []
  for (const { agent } of near.slice(0, MAX_BUBBLES)) {
    // One line per conversation, remembered against the end time that identifies it.
    /**
      * A new line every few seconds, working through what this thread actually knows.
      *
      * `turn` advances on a slow clock rather than per frame, so an exchange reads as two
      * people taking turns rather than as a ticker. The content is real: see `shoptalk`,
      * where every line is built from a field that came off disk.
      */
     const turn = Math.floor((performance.now() - (agent.social.startedAt || 0)) / 4200)
     let held = bubbleLines.get(agent)
     if (!held || held.until !== agent.social.until || held.turn !== turn) {
       const partner = agent.social.with
       const text =
         shoptalk(agent, threads.find((t) => t.id === agent.id) || agent.thread, partner, partner ? threads.find((t) => t.id === partner.id) || partner.thread : null, turn) ||
         voiceFor(agent.id, agent.theme, turn)
       held = { until: agent.social.until, turn, text }
       bubbleLines.set(agent, held)
     }
    const v = chatterV.set(agent.pos.x, agent.pos.y + (colony.astronauts.headHeight || 0.75) + 0.42, agent.pos.z)
    v.project(cam)
    if (v.z > 1) continue // behind the camera
    items.push({
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
      text: held.text,
      accent: '#' + agent.outfit.getHexString(),
    })
  }
  hud.setChatter(items)
}
const chatterV = new THREE.Vector3()

/**
 * Have one thread actually brief the other, for real.
 *
 * The only place in this app where the world reaches back into the harness and spends
 * something. It builds a record of both threads from what was genuinely scanned off disk,
 * posts it, and the *server* turns that into a prompt — the page never writes one, which is
 * what keeps this from being a hole you could post arbitrary text into a model through.
 *
 * The answer is real, so it is shown as the character saying it rather than as a toast.
 */
async function runConfer(agent) {
  /**
   * The same fallback the menu uses, and it has to be the same or the option is a dead button.
   *
   * Pressing E ends the conversation you are interrupting, so by the time this runs `social`
   * is already null. The menu learned that and started falling back to `lastPartner`; this did
   * not, so the option appeared, was clickable, and silently returned — which looks exactly
   * like the feature being broken rather than like two lookups disagreeing.
   */
  const partner = agent?.social?.with || agent?.lastPartner || null
  if (!agent || !partner) return
  const mine = threads.find((t) => t.id === agent.id) || agent.thread || {}
  const theirs = threads.find((t) => t.id === partner.id) || partner.thread || {}
  const pack = (a, t) => ({
    title: t.title,
    project: t.project,
    branch: t.gitBranch,
    status: a.status,
    model: t.model,
    idleFor: t.lastActivityAt ? `${Math.round((Date.now() - t.lastActivityAt) / 3600000)}h` : '',
  })

  hud.speak(
    { name: agent.charName, genre: agent.theme.name, accent: agent.theme.accent, line: `Thinking about what ${partner.charName} needs to know…`, options: [] },
    {}
  )
  try {
    const res = await fetch('/api/confer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The folder these two threads actually share, so the answer is grounded in their
      // repository rather than in whatever directory this server was started from.
      body: JSON.stringify({ from: pack(agent, mine), to: pack(partner, theirs), cwd: mine.projectPath || mine.cwd || '' }),
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || 'The relay failed')
    say({
      name: agent.charName,
      genre: agent.theme.name,
      accent: agent.theme.accent,
      line: data.reply,
      options: [{ id: 'bye', label: 'Goodbye', action: true }],
    })
    audio.chime('quest')
  } catch (err) {
    hud.toast(err.message || 'Could not reach the other session', 'err')
    say(dialogue.end())
  }
}

function talkTo(agent) {
  if (!agent) {
    hud.hint('Nobody close enough. Walk up to someone and press E.')
    return
  }
  select(agent.id, {})
  const thread = threads.find((t) => t.id === agent.id) || agent.thread
  say(dialogue.start(agent, thread))
  audio.chime('talk')
  quests.talk(agent)
  refreshQuests()
}

/**
 * Render one turn, and wire what the player can say back.
 *
 * The two *actions* are handled here rather than in the dialogue module, because opening a
 * thread and walking away are things the page does — the module's job is to know what a
 * thread has been up to and how its character would put it, and it would be the wrong place
 * to reach into the harness from.
 */
function say(turn) {
  if (!turn) {
    hud.closeTalk()
    return
  }
  hud.speak(turn, {
    onChoose: (id) => {
      if (id === 'open') {
        actions.openThread()
        say(dialogue.end())
        return
      }
      if (id === 'confer') {
        runConfer(dialogue.agent)
        return
      }
      if (id === 'race') {
        const opponent = dialogue.agent
        say(dialogue.end())
        if (opponent) startRace(opponent)
        return
      }
      if (id === 'bye') {
        say(dialogue.end())
        return
      }
      audio.chime('talk')
      say(dialogue.ask(id))
    },
  })
}

// ── settings plumbing ─────────────────────────────────────────────────────────────────

settings.onChange((changed, scope) => {
  // Kept in the colony file as well as in this browser's own storage. `localStorage` is
  // per *origin*, so a dev server that comes back on a different port looks to the browser
  // like a different site and hands you factory settings — the file does not care.
  state.settings = { ...settings.values }
  queueSave()
  if (scope.render || changed.has('fov')) engine.applySettings()
  colony.onSettingsChanged(changed, scope)
  if (changed.has('showFps')) hud.syncSettings()
  if (changed.has('maxAgents')) applyThreads(threads)
})

// ── frame ─────────────────────────────────────────────────────────────────────────────

engine.add({
  update(dt, elapsed) {
    // Before the camera, so the rig follows where the character *is* this frame rather
    // than where it was last one — a frame of lag here is visible as the camera swimming.
    const near = walk.update(dt)
    // Step away and the conversation is over — a panel that stays open while you walk off is
    // a panel you then have to go and dismiss.
    if (dialogue.open && dialogue.agent) {
      const p = colony.astronauts.player
      const a2 = dialogue.agent
      if (p && Math.hypot(a2.pos.x - p.pos.x, a2.pos.z - p.pos.z) > 5.5) say(dialogue.end())
    }
    const player = colony.astronauts.player
    audio.update(dt, {
      speed: walk.active && player ? player.groundSpeed || 0 : 0,
      walking: walk.active,
    })
    checkArea()
    updateRace()
    updateChatter()
    rig.update(dt)
    colony.update(dt, elapsed, rig.target)
    // The prompt says whichever of the three things E would actually do.
    hud.setTalkPrompt(
      walk.active
        ? colony.openBuilding
          ? { id: 'exit', label: 'Step outside' }
          : near
            ? { id: near.id, label: `Talk to ${near.charName}` }
            : walk.door
              ? { id: 'door:' + walk.door.id, label: `Enter the ${String(walk.door.entry.mesh.userData.label || 'building').toLowerCase()}` }
              : walk.stall
                ? { id: 'stall', label: 'Play at the festival stall' }
                : null
        : null
    )
    // Whatever the camera is orbiting is what should be in focus.
    engine.setFocusDistance(rig.distance)

    if (selectedId) {
      hud.updateAvatar(colony.astronauts.faceTexture.image)
      // A selected astronaut that walked off the roster should not keep a stale card open.
      const agent = colony.agentFor(selectedId)
      if (!agent) select(null, {})
      else hud.placeCard(screenOf(agent))
    }
    hud.setFps(engine.perf, engine.viewport, `${colony.astronauts.visibleCount} crew · ${colony.particles.liveCount} bits`)
  },
})

engine.start()
boot()

// Handy for poking at the running colony from the console.
window.botCrossing = {
  engine,
  rig,
  colony,
  settings,
  hud,
  poll,
  walk,
  audio,
  quests,
  // The festival stalls, so a game can be stepped and inspected from the console the same
  // way the colony can. They are built lazily, so this is empty until one has been opened.
  stalls,
  get threads() {
    return threads
  },
}

/** `execCommand('copy')` over a throwaway textarea — the copy that predates permissions. */
function copyFallback(text) {
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.cssText = 'position:fixed;top:0;opacity:0;pointer-events:none'
  document.body.appendChild(el)
  el.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  el.remove()
  return ok
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
