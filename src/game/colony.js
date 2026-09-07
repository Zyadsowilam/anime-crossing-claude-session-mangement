import * as THREE from 'three'
import { PLANETS, createTerrain, createScatter, terrainHeight } from '../world/planet.js'
import { Sky } from '../world/sky.js'
import {
  Plot,
  allocateCells,
  shipPosition,
  createLabel,
  hashString,
  worldToHex,
  hexContains,
  PLOT_TILE,
  DECK_TOP,
  PLOT_PALETTE,
  PLOT_CELL,
} from '../world/plots.js'
import { createBuilding, buildingUniforms, Scaffolds } from '../world/buildings.js'
import { Ship } from '../world/ship.js'
import { buildPaths, PATH_COLORS } from '../world/paths.js'
import { createHorizon } from '../world/horizon.js'
import { Astronauts } from '../agents/astronauts.js'
import { Indicators, BADGE } from '../agents/indicators.js'
import { Particles } from '../agents/particles.js'
import { Navigation } from '../agents/navigation.js'

/**
 * The colony: everything that turns a list of agent threads into a place.
 *
 * The mapping is the whole game. It is a strict precedence rather than a set of independent
 * flags — errored, then running, then merged, then unread — so an astronaut can only ever be
 * telling you one thing, and the loudest true thing wins.
 *
 *   errored        → blocked, red eyes, a `!` over its head
 *   running        → hammering away at its building, sparks flying
 *   PR merged      → celebrating, confetti, a `✓`
 *   unread         → stopped and waiting on you, a bobbing `?` — click it to open the thread
 *   long idle      → asleep on the job
 *   anything else  → pottering about its plot
 *
 * Threads group by repo, one repo per hex plot, and every thread gets a building seeded
 * from its own session id — so the colony's skyline is a stable, readable picture of what
 * you have running.
 */

const STALE_MS = 3 * 24 * 60 * 60 * 1000
/** How wide an astronaut is, for the purpose of not fitting through gaps it should not. */
/** Bucket size for the camera's blocker index — comfortably wider than any frontage. */
const BLOCKER_BUCKET = 6
/** How far above its own ground a city's name plate floats — clear of the tallest roof. */
const LABEL_HEIGHT = 13
/** What a city with nothing happening in it fades its name back to, rather than hiding it. */
const QUIET_LABEL = 0.72
const AGENT_RADIUS = 0.26
/** Progress a live thread adds per second, so a working site visibly grows while you watch. */
const LIVE_GROWTH = 0.004
/** How many zones' positions to remember, including repos with nothing running in them. */
const LAYOUT_MEMORY = 80

export const STATUS_ORDER = ['blocked', 'waiting', 'working', 'celebrating', 'idle', 'sleeping']

export const STATUS_LABEL = {
  working: 'Working',
  waiting: 'Waiting on you',
  blocked: 'Blocked',
  celebrating: 'Shipped',
  idle: 'Idle',
  sleeping: 'Dormant',
  spawning: 'Arriving',
  leaving: 'Heading home',
}

/** Thread → behaviour. First match wins, exactly like the board's auto-sort. */
export function statusFor(thread, now = Date.now()) {
  if (thread.hasError) return 'blocked'
  if (thread.running) return 'working'
  if (thread.prState === 'MERGED') return 'celebrating'
  if (thread.unread) return 'waiting'
  if (now - thread.lastActivityAt > STALE_MS) return 'sleeping'
  return 'idle'
}

/**
 * Which behaviours earn a badge. Dormant and idle deliberately get none: their pose and
 * face already say it, and with most of a real thread list sitting quiet, a badge over
 * every one of them buries the single `?` that actually wants you.
 */
const BADGE_FOR = {
  waiting: BADGE.waiting,
  blocked: BADGE.blocked,
  working: BADGE.working,
  celebrating: BADGE.done,
  sleeping: BADGE.none,
  idle: BADGE.none,
  spawning: BADGE.spawning,
  leaving: BADGE.leaving,
}

/** Transcript size → how finished the building looks. Log scale: threads grow fast early. */
/**
 * How far along a thread is, on a log scale over its transcript size. This drives the bar
 * on the thread card — it no longer drives how much of the building you can see.
 *
 * It used to. The shader draws construction by sinking the structure into the ground and
 * discarding what falls below the deck, and mapping transcript size onto that meant most
 * buildings stood permanently waist-deep in their own plot. Read as a picture of a colony
 * rather than as a chart, that is not "this thread is young", it is "this building is
 * broken" — a dome cut off by a flat plane looks like a rendering fault, and it is the
 * first thing the eye goes to. So the sink is now only what it is good at: the few seconds
 * of a new building rising out of the ground.
 */
export function transcriptProgress(thread) {
  const size = Math.max(1, thread.sizeBytes || 0)
  return THREE.MathUtils.clamp((Math.log10(size) - 3) / 3.5, 0.05, 1)
}

export class Colony {
  constructor(scene, settings, camera, renderer) {
    this.scene = scene
    this.settings = settings
    this.camera = camera
    this.renderer = renderer

    this.planet = PLANETS[settings.get('planet')] || PLANETS.sakura
    this.sky = new Sky(scene, settings, renderer)
    this.sky.setPlanet(this.planet)
    // Push the stored time in explicitly. `settings.set` is a no-op when the value has not
    // changed, so a colony restored at dusk would otherwise open in the morning and stay
    // there until something happened to touch the slider.
    this.sky.setTime(settings.get('timeOfDay'))

    this.plots = new Map()
    this.plotOrder = []
    /**
     * Where every zone sits, kept across polls *and* across the departures of the threads
     * that made it: a repo whose last session you archive comes back to the same ground
     * when a new one starts. Seeded from the colony file by `restoreLayout`.
     */
    this.plotCells = new Map()
    this.buildings = new Map()
    this.threads = new Map()
    this.usedAccents = new Set()

    this.worldGroup = new THREE.Group()
    this.worldGroup.name = 'world'
    scene.add(this.worldGroup)

    this.ship = new Ship(scene, shipPosition())
    this.astronauts = new Astronauts(scene, settings)
    this.astronauts.world = this._world()
    this.indicators = new Indicators(scene, settings, Math.max(64, settings.get('maxAgents')))
    this.particles = new Particles(scene, settings)
    this.scaffolds = new Scaffolds(scene, 320)
    this.nav = new Navigation()
    this.astronauts.setNavigation(this.nav)

    this.plotGroup = new THREE.Group()
    this.labelGroup = new THREE.Group()
    scene.add(this.plotGroup, this.labelGroup)

    // Dismissing the HUD has to survive a poll: labels are chrome, and a scan landing while
    // everything is hidden must not quietly put them back on screen.
    this.uiVisible = true
    this.hoveredPlot = null
    this.activePlots = new Set()
    this._dustTint = new THREE.Color(this.planet.ground.high)
    this._c = new THREE.Color()
    this.stats = { agents: 0, projects: 0, working: 0, waiting: 0, blocked: 0, done: 0 }

    this._buildTerrain()
  }

  // ── terrain ─────────────────────────────────────────────────────────────────────────

  _buildTerrain() {
    if (this.terrain) {
      this.worldGroup.remove(this.terrain)
      this.terrain.geometry.dispose()
      this.terrain.material.dispose()
    }
    if (this.scatterGroup) {
      this.worldGroup.remove(this.scatterGroup)
      disposeTree(this.scatterGroup)
    }

    this.terrain = createTerrain(this.planet, this.settings.get('groundDetail'))
    this.worldGroup.add(this.terrain)
    this._buildScatter()

    // The horizon belongs to the world, so it is rebuilt with it — each preset's own rock
    // and its own haze colour, which is what makes the far ridges look like they are being
    // seen through this world's air rather than pasted behind it.
    if (this.horizon) {
      this.worldGroup.remove(this.horizon)
      disposeTree(this.horizon)
    }
    this.horizon = createHorizon(1337, this.planet.fog.color, this.planet.rock)
    this.worldGroup.add(this.horizon)

    // The ship has legs, and legs have to reach the ground. Its landing spot is a fixed hex
    // cell, but the height of that spot is the planet's, so it is set here rather than once
    // at construction — a world with more relief would otherwise leave it hovering.
    const ship = shipPosition()
    this.ship.group.position.y = terrainHeight(ship.x, ship.z, this.planet)

    this._dustTint.set(this.planet.ground.high)
  }

  /**
   * Ground scatter, placed to miss every tile of every plot and the ship's apron.
   *
   * Kept separate from the terrain because of *when* it has to run: the world is built
   * before the first roster arrives, so at that point there are no plots to avoid, and
   * boulders and trees end up under decks that are laid on top of them afterwards — poking
   * through in fragments. So this runs again whenever a zone's footprint changes, which is
   * cheap next to rebuilding the terrain mesh alongside it.
   */
  _buildScatter() {
    if (this.scatterGroup) {
      this.worldGroup.remove(this.scatterGroup)
      disposeTree(this.scatterGroup)
    }
    const clear = []
    for (const plot of this.plotOrder) {
      for (const local of plot.localCenters) {
        clear.push({ x: plot.center.x + local.x, z: plot.center.z + local.z, r: 8.6 })
      }
    }
    const ship = shipPosition()
    clear.push({ x: ship.x, z: ship.z, r: 7.5 })
    this.scatterGroup = createScatter(this.planet, this.settings.get('scatterDensity'), clear)
    this.worldGroup.add(this.scatterGroup)
    this._scatterFootprint = this._plotFootprint()
    // The crew routes around scatter, so a new scatter is a new navigation grid.
    if (this.nav) this._rebuildNavigation()
  }

  /** What the scatter has to avoid, as one string — cheap to compare every poll. */
  _plotFootprint() {
    return this.plotOrder.map((plot) => plot.signature).join('|')
  }

  /**
   * Called once the model kits are in.
   *
   * The colony is built before boot has finished fetching them, so the first terrain is
   * scattered with fallback primitives. Rebuilding it here is what puts the real trees and
   * boulders down — without it the ground keeps its placeholders until something else
   * happens to invalidate the terrain, which on a colony nobody touches is never.
   */
  onAssetsReady() {
    this._buildTerrain()
  }

  setPlanet(id) {
    const planet = PLANETS[id]
    if (!planet || planet === this.planet) return
    this.planet = planet
    this.sky.setPlanet(planet)
    this._buildTerrain()

    /**
     * The architecture belongs to the world, so changing worlds rebuilds it.
     *
     * Every building's geometry is baked at construction with its world's palette and its
     * world's catalogue of kinds — a concrete block tower is a different mesh to a
     * plaster townhouse, not the same mesh in different paint — so there is nothing to
     * recolour. Dropping them makes the next `setThreads` build them again against the
     * world that is now current, and because the seed is still the thread's own id, a given
     * chat keeps *its* building: the same house in Hanami Hills is the same cottage in
     * Skyward Isles, in the same slot, every time you switch back.
     *
     * The zone copses go with them for the same reason — they are tinted from the world's
     * planting as well as the zone's accent.
     */
    for (const [bid, entry] of [...this.buildings]) this._removeBuilding(bid, entry)
    this.buildings.clear()
    // Torn down exactly the way a retired zone is, rather than merely dropped: a plot owns
    // a deck, a border, its posts, its clutter, its lanterns and a label, and forgetting the
    // group it lives in leaves every one of them in the scene, invisible under the new ones.
    for (const [, plot] of this.plots) {
      this.plotGroup.remove(plot.group)
      if (plot.label) {
        this.labelGroup.remove(plot.label)
        plot.label.userData.dispose?.()
      }
      this.usedAccents.delete(plot.accent)
      plot.dispose()
    }
    this.plots.clear()
    this.plotOrder = []
    // Re-run the last roster against the new world. Nothing is re-scanned: this is the list
    // already in hand, so switching worlds costs a rebuild and not a round trip to disk.
    if (this._lastThreads) this.setThreads(this._lastThreads, this._lastArchived || new Set())
  }

  onSettingsChanged(changed, scope) {
    if (changed.has('planet')) this.setPlanet(this.settings.get('planet'))
    else if (scope.world) this._buildTerrain()

    this.sky.onSettingsChanged(changed)
    this.astronauts.onSettingsChanged(changed)
    this.particles.onSettingsChanged(changed)
    if (changed.has('showLabels')) this._syncLabels()
    if (changed.has('timeOfDay')) this.sky.setTime(this.settings.get('timeOfDay'))
  }

  // ── roster ──────────────────────────────────────────────────────────────────────────

  /**
   * Take a fresh scan and reshape the colony around it. Everything here is keyed by stable
   * ids — repo name for plots, session id for buildings — so a poll that changes nothing
   * moves nothing on screen.
   */
  setThreads(threads, archivedIds = new Set()) {
    // Kept so `setPlanet` can rebuild the world from the list already in hand rather than
    // waiting up to a poll interval for the next scan.
    this._lastThreads = threads
    this._lastArchived = archivedIds
    const now = Date.now()
    const live = threads.filter((t) => !t.archived && !archivedIds.has(t.id))

    // Group by repo, biggest project first so the busiest work lands nearest the middle.
    const byProject = new Map()
    for (const thread of live) {
      const key = thread.project || 'unknown'
      if (!byProject.has(key)) byProject.set(key, [])
      byProject.get(key).push(thread)
    }
    const projects = [...byProject.entries()].sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length
      return a[0].localeCompare(b[0])
    })

    this._syncPlots(projects)

    const roster = []
    const seenBuildings = new Set()
    const stats = { agents: 0, projects: projects.length }
    for (const key of STATUS_ORDER) stats[key] = 0
    // Plots holding anything that wants your attention get a pulsing rim, so you can spot
    // the repo that needs you from right across the colony without reading a single label.
    const urgent = new Set()
    // Plots with anyone working, waiting or stuck keep their name on screen; quiet ones
    // only show it on hover.
    const active = new Set()

    for (const [name, list] of projects) {
      const plot = this.plots.get(name)
      if (!plot) continue
      // Oldest thread first, so a given session keeps its slot as siblings come and go.
      list.sort((a, b) => a.createdAt - b.createdAt)

      list.forEach((thread, i) => {
        const status = statusFor(thread, now)
        if (stats[status] !== undefined) stats[status]++
        if (status === 'waiting' || status === 'blocked') urgent.add(plot.id)
        if (status === 'waiting' || status === 'blocked' || status === 'working') active.add(plot.id)
        stats.agents++

        const building = this._syncBuilding(thread, plot, i)
        seenBuildings.add(thread.id)

        roster.push({
          id: thread.id,
          thread,
          status,
          site: this._workSite(plot, building, i),
          // Where the work actually is. A working astronaut circles it rather than standing
          // at one spot, so it needs the building, not just a place to stand near it.
          anchor: building.mesh.position.clone(),
        })
      })
    }

    // Anything that dropped out of the scan — archived, or a transcript that vanished —
    // takes its building down and walks its astronaut back to the ship.
    for (const [id, entry] of this.buildings) {
      if (!seenBuildings.has(id)) this._removeBuilding(id, entry)
    }

    this.threads = new Map(live.map((t) => [t.id, t]))
    this.urgentPlots = urgent
    this.activePlots = active
    this._buildPaths()
    this._rebuildNavigation()
    this.stats = { ...stats, done: stats.celebrating }
    this.astronauts.setRoster(roster, this._world())
    return this.stats
  }

  _syncPlots(projects) {
    // The previous layout is an input, so a zone only moves when its own footprint changes
    // — never because a different repo gained or lost a thread. `plotCells` carries it
    // between polls, and the colony file carries it between sessions.
    const layout = allocateCells(
      projects.map(([name, list]) => ({ id: name, size: list.length })),
      this.plotCells
    )
    // Remembered, not replaced: a project that has just lost its last thread keeps its
    // ground on the books, and the oldest entries fall off the end.
    for (const [name, cells] of layout) {
      this.plotCells.delete(name)
      this.plotCells.set(name, cells)
    }
    while (this.plotCells.size > LAYOUT_MEMORY) this.plotCells.delete(this.plotCells.keys().next().value)

    const wanted = new Map()
    for (const [name, cells] of layout) wanted.set(name, `${name}:${cells.map((c) => `${c.q},${c.r}`).join('/')}`)

    // A plot is rebuilt whenever its own footprint moved, and left completely alone
    // whenever it did not.
    for (const [name, plot] of this.plots) {
      if (wanted.get(name) === plot.signature) continue
      this.plotGroup.remove(plot.group)
      if (plot.label) {
        this.labelGroup.remove(plot.label)
        plot.label.userData.dispose?.()
      }
      this.usedAccents.delete(plot.accent)
      plot.dispose()
      this.plots.delete(name)
    }

    projects.forEach(([name], index) => {
      if (this.plots.has(name)) return
      const cells = layout.get(name)
      if (!cells?.length) return
      const accent = this._pickAccent(name)
      const plot = new Plot({
        id: name,
        name,
        index,
        cells,
        accent,
        foliage: this.planet.foliage,
        style: this.planet.id,
        sampleGround: (x, z) => terrainHeight(x, z, this.planet),
      })
      plot.signature = wanted.get(name)
      this.plots.set(name, plot)
      this.plotGroup.add(plot.group)

      const label = createLabel(name, accent)
      /**
       * Above the roofs, and measured from the city's own ground.
       *
       * The old height was a bare 3.2 in world space, which was fine when a zone was a low
       * platform on flat ground and wrong twice over now: a city stands on a deck at whatever
       * height the terrain dealt it, and its pagodas and towers reach well past three units.
       * A plate left at 3.2 sits *among* the roofs — it still draws (it ignores depth) but it
       * reads as a sticker stuck on a building rather than as the name of the place.
       */
      label.position.set(plot.labelAnchor.x, plot.labelAnchor.y + LABEL_HEIGHT, plot.labelAnchor.z)
      plot.label = label
      this.labelGroup.add(label)
    })

    this.plotOrder = [...this.plots.values()]
    // Zones that just moved, appeared or grew are zones the scatter does not know about.
    if (this.scatterGroup && this._plotFootprint() !== this._scatterFootprint) this._buildScatter()
    // Which hex cells are decked. Ground height is asked for once per moving agent per
    // frame, so it wants to be a lookup rather than a scan over every plot's every tile.
    // Cell → the height of the town standing on it, so `groundAt` can answer for a deck
    // that is no longer at a fixed height.
    this.deckedCells = new Map()
    for (const plot of this.plotOrder) {
      // The tile's own centre goes in as well as its height. A cell is fifty units across and
      // its deck thirty-three, so cell membership is no longer the same question as "standing
      // on the town" — the seventeen-unit ring between them is open country, and answering
      // "deck" for it walks the crew out of a city at roof height over the fields.
      for (let i = 0; i < plot.cells.length; i++) {
        const cell = plot.cells[i]
        const local = plot.localCenters[i]
        this.deckedCells.set(`${cell.q},${cell.r}`, {
          y: plot.center.y,
          x: plot.center.x + local.x,
          z: plot.center.z + local.z,
        })
      }
    }
    this._syncLabels()
  }

  /**
   * How high the ground is at a world point — the surface anything walking stands on.
   *
   * A plot's tiles are a raised slab, so on one of those it is the deck; everywhere else it
   * is the terrain, sampled from the same noise field the mesh was built from. Without this
   * the crew walks along y=0 while the ground around them runs from -0.35 to +0.20, and they
   * spend half the colony buried to the shins.
   */
  /** The bits of the world the crew needs to know about, as plain callbacks. */
  _world() {
    return {
      shipDoor: () => this.ship.shipDoor(),
      groundAt: (x, z) => this.groundAt(x, z),
    }
  }

  groundAt(x, z) {
    const cell = worldToHex(x, z)
    const deck = this.deckedCells?.get(`${cell.q},${cell.r}`)
    // On the tile, not merely in its cell: the deck is a hexagon two thirds the width of the
    // cell it sits in, and its edge is where the town stops and the hillside starts.
    if (deck !== undefined && hexContains(x - deck.x, z - deck.z, PLOT_TILE)) return deck.y + DECK_TOP
    return terrainHeight(x, z, this.planet)
  }

  /** A stable colour per repo, probing forward on a collision so no two plots match. */
  _pickAccent(name) {
    const start = hashString(name) % PLOT_PALETTE.length
    for (let i = 0; i < PLOT_PALETTE.length; i++) {
      const accent = PLOT_PALETTE[(start + i) % PLOT_PALETTE.length]
      if (!this.usedAccents.has(accent)) {
        this.usedAccents.add(accent)
        return accent
      }
    }
    return PLOT_PALETTE[start]
  }

  _syncBuilding(thread, plot, index) {
    let entry = this.buildings.get(thread.id)
    // Whole, always. A building that has finished rising is a building you can see all of.
    const target = 1

    if (!entry) {
      /**
       * The building at the head of a street is always a tall one.
       *
       * A town needs a silhouette. Rooftops all of a height read as a texture from any
       * distance, and a country of them gives you nothing to steer by — you cannot tell one
       * town from another, or judge how far away either is. One spire per town fixes both:
       * it breaks the roofline, it is the thing you see first over a rise, and it is what
       * you walk toward.
       *
       * The slot decides, not the thread, so which conversation happens to land there does
       * not change the skyline. Slot 6 is the one closing the end of the street.
       */
      const landmark = index % 7 === 6
      const mesh = createBuilding({
        seed: hashString(thread.id),
        accent: plot.accent,
        style: this.planet.id,
        kind: landmark ? (hashString(thread.id) % 2 ? 'tower' : 'pagoda') : null,
        // How full the room is: the same log scale the thread card's bar uses, so the pile
        // of scrolls inside a house and the progress bar on its card are the same reading.
        fill: transcriptProgress(thread),
      })
      const pos = plot.worldSlot(index)
      mesh.position.copy(pos)
      /**
       * Turned to face the street, not to a random angle.
       *
       * A random yaw was right when the buildings stood in a ring with nothing to face. On a
       * street it is exactly wrong: half the doors end up facing the back of the next house,
       * and the row stops reading as a row. The slot knows which side of the road it is on,
       * so the slot decides — with a couple of degrees of slop, because a village street
       * where every frontage is perfectly parallel looks stamped rather than built.
       */
      const slot = plot.slotFor(index)
      const jitter = (((hashString(thread.id) >>> 8) % 100) / 100 - 0.5) * 0.08
      mesh.rotation.y = (slot.yaw ?? 0) + jitter
      // New buildings rise from nothing rather than appearing whole.
      mesh.userData.setProgress(0)
      this.worldGroup.add(mesh)
      entry = { mesh, plot: plot.id, slot: index, progress: 0, target, retiring: false }
      this.buildings.set(thread.id, entry)
    } else {
      // Where this building belongs *now*. Comparing the world position rather than the
      // plot id and slot number is what catches a zone that was rebuilt underneath it: the
      // repo is the same and the slot is the same, but the ground moved, and a habitat left
      // behind on bare terrain takes its astronaut off the plot with it.
      const want = plot.worldSlot(index, this._slotAt || (this._slotAt = new THREE.Vector3()))
      if (entry.plot !== plot.id || entry.slot !== index || entry.mesh.position.distanceToSquared(want) > 1e-4) {
        entry.plot = plot.id
        entry.slot = index
        entry.mesh.position.copy(want)
      }
    }

    entry.target = target
    entry.accent = plot.accent
    entry.retiring = false
    return entry
  }

  _removeBuilding(id, entry) {
    // Wind the reveal back down, then take it out — a building that vanishes mid-frame
    // reads as a glitch, one that sinks reads as being packed up.
    entry.retiring = true
    entry.target = 0
    if (entry.progress <= 0.02) {
      this.worldGroup.remove(entry.mesh)
      entry.mesh.geometry.dispose()
      entry.mesh.material.dispose()
      entry.mesh.customDepthMaterial?.dispose()
      this.buildings.delete(id)
    }
  }

  /**
   * Hand the navigation grid the colony's current footprint.
   *
   * The blocking radius is the building's bounding radius trimmed a little, plus the
   * astronaut's own width. The trim matters: the bounding radius already over-covers
   * anything that is not round, and blocking the full extent closes the gaps between a ring
   * of buildings, which is exactly where the crew needs to walk.
   */
  /**
   * The roads between zones, rebuilt whenever the set of zones changes.
   *
   * Rebuilt rather than patched because the network is a spanning tree: adding one zone can
   * re-route the whole thing, and a tree that is only ever added to stops being minimal
   * almost immediately. Twenty-odd zones is a couple of hundred distance checks, which is
   * nothing next to the geometry it produces.
   *
   * Deliberately *not* in the navigation grid. A road is a suggestion, not a corridor —
   * walking off one and cutting across the grass has to stay possible, or the map becomes a
   * set of rails.
   */
  _buildPaths() {
    if (this.paths) {
      this.worldGroup.remove(this.paths)
      disposeTree(this.paths)
      this.paths = null
    }
    const centres = this.plotOrder.map((plot) => plot.middle || plot.center)
    // The gate is on the network too: it is where every thread arrives, so it had better be
    // somewhere you can walk to without striking out across open country.
    centres.push(shipPosition())
    const built = buildPaths(centres, (x, z) => terrainHeight(x, z, this.planet))
    if (!built.stones) return

    const group = new THREE.Group()
    group.name = 'paths'
    const stone = new THREE.Mesh(
      built.stones,
      new THREE.MeshStandardMaterial({ color: PATH_COLORS.stone, roughness: 0.95, metalness: 0 })
    )
    stone.receiveShadow = true
    group.add(stone)

    if (built.lanterns) {
      const posts = new THREE.Mesh(
        built.lanterns,
        new THREE.MeshStandardMaterial({ color: PATH_COLORS.post, roughness: 0.8, metalness: 0 })
      )
      posts.castShadow = true
      group.add(posts)
    }
    if (built.lamps) {
      // Unlit, like every other light in the world, so the bloom pass turns a road into a
      // line of lanterns after dark rather than a grey dotted line.
      this.pathLampMaterial = new THREE.MeshBasicMaterial({ color: PATH_COLORS.paper, toneMapped: true })
      group.add(new THREE.Mesh(built.lamps, this.pathLampMaterial))
    }

    this.worldGroup.add(group)
    this.paths = group
  }

  _rebuildNavigation() {
    const obstacles = []
    /**
     * A second, much shorter list: the things tall enough to hide a character from the
     * camera.
     *
     * The navigation grid cannot answer that question, because walking and seeing are
     * blocked by different things. A crate, a boulder and a lamppost all stop an astronaut
     * and none of them stops the camera — but a follow camera that pulled itself in for
     * every lamppost in the colony would spend the whole walk jammed against the back of
     * your own head. Only buildings and the ship go in here, and without the agent-radius
     * padding, because a camera is a point rather than a body.
     */
    const viewBlockers = []
    for (const [bid, entry] of this.buildings) {
      if (entry.retiring) continue
      // A house you are standing in must not also be a wall. Its footprint comes out of the
      // grid for as long as it is open, which is what lets anyone walk through the doorway.
      if (bid === this.openBuilding) continue
      const p = entry.mesh.position
      const footprint = entry.mesh.userData.footprint || 1.2
      const r = footprint * 0.8 + AGENT_RADIUS
      obstacles.push({ x: p.x, z: p.z, r })
      // Not while you are inside it: a house you are standing in must not push the camera
      // away from you, which at this range means shoving it through the opposite wall.
      if (bid !== this.openBuilding) viewBlockers.push({ x: p.x, z: p.z, r: footprint * 0.72 })
    }
    // Ground clutter counts too. A crate is only knee-high, but an astronaut walking
    // straight through one is exactly as wrong as one walking through a habitat.
    for (const plot of this.plotOrder) {
      for (const spot of plot.clutterSpots || []) {
        obstacles.push({ x: plot.center.x + spot.x, z: plot.center.z + spot.z, r: spot.r + AGENT_RADIUS })
      }
      // The trees ringing a zone, too. They stand on the ground *between* zones, which is
      // exactly where the crew walks to get anywhere — a copse that can be walked through
      // is a copse that characters visibly stand inside.
      for (const spot of plot.surroundSpots || []) {
        obstacles.push({ x: plot.center.x + spot.x, z: plot.center.z + spot.z, r: spot.r + AGENT_RADIUS })
      }
      // The back streets are real buildings as far as walking is concerned, even though
      // nobody lives in them — a town you can walk through the walls of is not a town.
      for (const spot of plot.scenerySpots || []) {
        obstacles.push({ x: plot.center.x + spot.x, z: plot.center.z + spot.z, r: spot.r + AGENT_RADIUS })
      }
    }
    // Ground scatter counts as well. A boulder an astronaut can walk through is the same
    // bug as a habitat it can walk through, and a sleeping one parked inside a solar panel
    // is what that bug looks like from the outside. Instances are read straight off the
    // matrices, so this costs no bookkeeping of its own.
    const mat = this._navMatrix || (this._navMatrix = new THREE.Matrix4())
    for (const mesh of this.scatterGroup?.children || []) {
      if (!mesh.isInstancedMesh || !mesh.count) continue
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox
      const spread = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, mat)
        const scale = Math.hypot(mat.elements[0], mat.elements[1], mat.elements[2])
        const r = spread * scale * 0.65
        // Only what an astronaut would visibly stand *inside*. Blocking every pebble and
        // sprig fences the corridors between zones — the crew walks the gaps between plots
        // to get anywhere, and scatter is placed in exactly those gaps.
        if (r < 0.55) continue
        obstacles.push({ x: mat.elements[12], z: mat.elements[14], r: r + AGENT_RADIUS })
      }
    }

    const ship = shipPosition()
    obstacles.push({ x: ship.x, z: ship.z, r: 3.4 + AGENT_RADIUS })
    viewBlockers.push({ x: ship.x, z: ship.z, r: 3.2 })
    /**
     * The city blocks the camera as well as the walk.
     *
     * Scenery used to be left out of this list on the grounds that it was only decoration,
     * which was harmless when it stood in two rows behind the street. On a block grid it is
     * the street *wall*, three storeys of it either side, and a follow camera that ignores it
     * spends every alley inside somebody's roof — you get a view of the underside of a
     * ceiling and no idea where you are. Blocking it means the boom shortens in a narrow
     * street and lets out again at a junction, which is what the street grid is for.
     */
    for (const plot of this.plotOrder) {
      for (const spot of plot.scenerySpots || []) {
        viewBlockers.push({ x: plot.center.x + spot.x, z: plot.center.z + spot.z, r: spot.r * 0.8 })
      }
    }
    this.viewBlockers = viewBlockers
    this._indexBlockers(viewBlockers)
    this.nav.rebuild(obstacles)
  }

  /**
   * Is this point inside something that would hide the character from a camera standing
   * there? Used by the follow camera to decide how far back its boom can reach.
   *
   * A linear scan over the buildings rather than a grid: there are a few hundred of them at
   * most, it runs a dozen times per frame along one ray, and a circle test is three
   * multiplies — cheaper than the cache misses a grid lookup would cost at this size.
   */
  /**
   * Bucket the blockers into a coarse grid, once per rebuild.
   *
   * The list used to be a few hundred buildings and a linear scan over it was genuinely the
   * cheapest thing available. A city put three thousand frontages in it, and the camera asks
   * this question a dozen times a frame down its boom — thirty-odd thousand circle tests a
   * frame, for a query whose answer only ever depends on things within two units. Each circle
   * is written into every bucket it touches, so a lookup reads one bucket and tests the
   * handful of things that could possibly be there.
   */
  _indexBlockers(list) {
    const grid = new Map()
    for (const b of list) {
      const minX = Math.floor((b.x - b.r) / BLOCKER_BUCKET)
      const maxX = Math.floor((b.x + b.r) / BLOCKER_BUCKET)
      const minZ = Math.floor((b.z - b.r) / BLOCKER_BUCKET)
      const maxZ = Math.floor((b.z + b.r) / BLOCKER_BUCKET)
      for (let ix = minX; ix <= maxX; ix++) {
        for (let iz = minZ; iz <= maxZ; iz++) {
          const k = ix + ',' + iz
          const cell = grid.get(k)
          if (cell) cell.push(b)
          else grid.set(k, [b])
        }
      }
    }
    this._blockerGrid = grid
  }

  viewBlocked(x, z) {
    const grid = this._blockerGrid
    if (!grid) return false
    const list = grid.get(Math.floor(x / BLOCKER_BUCKET) + ',' + Math.floor(z / BLOCKER_BUCKET))
    if (!list) return false
    for (let i = 0; i < list.length; i++) {
      const b = list[i]
      const dx = x - b.x
      const dz = z - b.z
      if (dx * dx + dz * dz < b.r * b.r) return true
    }
    return false
  }

  /**
   * The nearest doorway you could walk through, or null.
   *
   * Only buildings with a room have one, and the distance is measured to the *door* rather
   * than to the building's middle — standing behind a house should not offer to let you in
   * through the back wall.
   */
  nearestDoor(x, z, maxDist = 2.6) {
    let best = null
    let bestD = maxDist
    for (const [id, entry] of this.buildings) {
      const mesh = entry.mesh
      if (!mesh.userData.room || entry.retiring || !mesh.visible) continue
      const out = this._doorAt(mesh, this._doorV || (this._doorV = new THREE.Vector3()))
      const d = Math.hypot(out.x - x, out.z - z)
      if (d < bestD) {
        bestD = d
        best = { id, entry, distance: d, point: out.clone() }
      }
    }
    return best
  }

  /**
   * The nearest festival stall you could walk up to and play at, or null.
   *
   * Same shape and the same generous-ish reach as `nearestDoor`, because it competes with it
   * for the `E` key and the two have to be comparable to be ranked against each other.
   */
  nearestStall(x, z, maxDist = 3.0) {
    let best = null
    let bestD = maxDist
    for (const plot of this.plotOrder) {
      for (const spot of plot.stallSpots || []) {
        const sx = plot.center.x + spot.x
        const sz = plot.center.z + spot.z
        const d = Math.hypot(sx - x, sz - z)
        if (d < bestD) {
          bestD = d
          best = { plot, distance: d, x: sx, z: sz }
        }
      }
    }
    return best
  }

  /** Where a building's door is, in world space. Its own front, turned by its own rotation. */
  _doorAt(mesh, out) {
    const dz = mesh.userData.door || 1
    const yaw = mesh.rotation.y
    return out.set(
      mesh.position.x + Math.sin(yaw) * dz,
      mesh.position.y,
      mesh.position.z + Math.cos(yaw) * dz
    )
  }

  /**
   * Open a building up and let people in — including its own resident.
   *
   * Three things happen, and the third is the one that makes it feel like a place rather
   * than a diorama: the roof lifts, the building stops being a wall as far as pathing is
   * concerned, and **the thread that lives there is sent home**. Open a teahouse and its
   * character walks in and sits down, because it is their house.
   */
  enterBuilding(id) {
    if (this.openBuilding === id) return null
    if (this.openBuilding) this.exitBuilding()
    const entry = this.buildings.get(id)
    if (!entry?.mesh.userData.room) return null

    this.openBuilding = id
    entry.openTarget = 1

    // Standing room, a little inside the door.
    const door = this._doorAt(entry.mesh, new THREE.Vector3())
    const yaw = entry.mesh.rotation.y
    // Just inside the doorway, facing the back of the room — far enough in that the door
    // is behind you, near enough that you are not standing on the table.
    const depth = entry.mesh.userData.roomDepth || 1
    const inside = new THREE.Vector3(
      entry.mesh.position.x + Math.sin(yaw) * depth * 0.45,
      entry.mesh.position.y,
      entry.mesh.position.z + Math.cos(yaw) * depth * 0.45
    )

    // The walls come out of the navigation grid while the house is open, or nobody —
    // including you — can get through the doorway.
    this._rebuildNavigation()

    const agent = this.astronauts.byId.get(id)
    if (agent) {
      agent.indoors = true
      agent.site.copy(inside)
      agent.state = 'walking'
      agent.stateAge = 0
      agent.pathVersion = -1
    }
    return { door, inside, label: entry.mesh.userData.label }
  }

  /** Shut it again, and let the resident go back to work. */
  exitBuilding() {
    const id = this.openBuilding
    if (!id) return
    this.openBuilding = null
    const entry = this.buildings.get(id)
    if (entry) entry.openTarget = 0
    const agent = this.astronauts.byId.get(id)
    if (agent) {
      agent.indoors = false
      // Its real site comes back from the next roster pass; nudging it out now stops it
      // standing inside a building that is no longer open.
      agent.state = 'walking'
      agent.pathVersion = -1
    }
    this._rebuildNavigation()
  }

  /** The plot under a world point. On a hex lattice the nearest cell centre is the cell. */
  plotAt(x, z) {
    let best = null
    let bestD = Infinity
    for (const plot of this.plotOrder) {
      for (const local of plot.localCenters) {
        const dx = x - (plot.center.x + local.x)
        const dz = z - (plot.center.z + local.z)
        const d = dx * dx + dz * dz
        if (d < bestD) {
          bestD = d
          best = plot
        }
      }
    }
    return bestD <= PLOT_CELL * PLOT_CELL ? best : null
  }

  /**
   * The plot whose name plate is under the cursor.
   *
   * Plates are billboarded in the vertex shader — a CPU raycast against the quad would test
   * the geometry as authored, which is not where it ends up on screen. So this repeats the
   * shader's own maths instead: the plate sits at its anchor in view space and spans
   * `half * (0.55 + dist * 0.03)`, which projects to `half * k * P / dist` in NDC.
   *
   * Opacity is deliberately not consulted. A quiet project's plate is invisible until it is
   * pointed at, and it is this hit test that decides it is being pointed at.
   */
  pickLabel(ndcX, ndcY) {
    const view = this._labelView || (this._labelView = new THREE.Vector3())
    const p = this.camera.projectionMatrix.elements
    let best = null
    let bestDist = Infinity
    for (const plot of this.plotOrder) {
      const label = plot.label
      if (!label) continue
      const dist = -view.copy(label.position).applyMatrix4(this.camera.matrixWorldInverse).z
      if (dist <= 0.01 || dist >= bestDist) continue
      const geo = label.geometry.parameters
      const k = 0.55 + dist * 0.03
      const cx = (view.x * p[0]) / dist
      const cy = (view.y * p[5]) / dist
      if (Math.abs(ndcX - cx) > ((geo.width / 2) * k * p[0]) / dist) continue
      if (Math.abs(ndcY - cy) > ((geo.height / 2) * k * p[5]) / dist) continue
      bestDist = dist
      best = plot
    }
    return best
  }

  /**
   * Take the zone layout out of the colony file. Cells arrive as `[q, r]` pairs from a file
   * a person can edit, so anything that is not a pair of whole numbers is dropped rather
   * than trusted — a bad entry would put a zone on a cell that does not exist.
   */
  restoreLayout(saved) {
    const clean = new Map()
    for (const [name, cells] of Object.entries(saved || {})) {
      if (!Array.isArray(cells)) continue
      const list = []
      for (const cell of cells) {
        const q = Array.isArray(cell) ? cell[0] : cell?.q
        const r = Array.isArray(cell) ? cell[1] : cell?.r
        if (Number.isInteger(q) && Number.isInteger(r)) list.push({ q, r })
      }
      if (list.length) clean.set(String(name), list)
    }
    this.plotCells = clean
  }

  /** The same, on the way out. */
  layoutForSave() {
    const out = {}
    for (const [name, cells] of this.plotCells) out[name] = cells.map((c) => [c.q, c.r])
    return out
  }

  setHoveredPlot(plot) {
    this.hoveredPlot = plot || null
  }

  /**
   * Names fade in for the plots that have something going on, and for whichever one you are
   * pointing at. Everywhere else the colony stays unlabelled.
   */
  /**
   * Every city says its name.
   *
   * This used to show a name only while somebody in that repo was working, waiting or stuck,
   * and hide it otherwise — a deliberate choice, and the right one when the whole colony fitted
   * on screen as a handful of small platforms you could tell apart by shape. It does not
   * survive the world getting bigger. Two dozen cities of the same architecture, most of them
   * quiet at any given moment, means a map with almost nothing written on it and no way to
   * tell which district you are looking at or flying toward.
   *
   * So a name is always drawn, and *activity* is carried by brightness instead of by
   * existence: a city with something happening in it reads at full strength, a quiet one sits
   * back at `QUIET_LABEL`. That keeps the original intent — your eye is still pulled to the
   * repo that wants you — without the map going blank to get it.
   */
  _updateLabels(dt) {
    const show = this.uiVisible && this.settings.get('showLabels')
    for (const plot of this.plotOrder) {
      const label = plot.label
      if (!label) continue
      const lit = this.activePlots.has(plot.id) || this.hoveredPlot === plot
      const wanted = show ? (lit ? 1 : QUIET_LABEL) : 0
      const next = THREE.MathUtils.damp(label.material.opacity, wanted, 9, dt)
      label.material.opacity = next
      label.visible = next > 0.01
    }
  }

  /** Where the astronaut stands: just outside its building, facing in. */
  _workSite(plot, entry, index) {
    const b = entry.mesh.position
    // Outward from the *middle* of the zone rather than from its root tile: the root sits
    // on one edge of a grown blob, and standing spots measured from there all point the
    // same way instead of fanning around the buildings.
    const middle = plot.middle || plot.center
    const dx = b.x - middle.x
    const dz = b.z - middle.z
    const len = Math.hypot(dx, dz)
    // Buildings in the middle of a plot have no outward direction, so fan those out by index.
    const a = len > 0.2 ? Math.atan2(dz, dx) : (index * 2.4) % (Math.PI * 2)
    // Clear of the building's *own* footprint rather than a fixed 2.35: a big habitat blocks
    // more ground than a small one, and a standing spot inside that radius is a spot the
    // crew can never actually reach — it walks at the wall for as long as the thread lives.
    const blocked = (entry.mesh.userData.footprint || 1.2) * 0.8 + AGENT_RADIUS
    const stand = Math.max(2.35, blocked + 0.5)
    let site = new THREE.Vector3(b.x + Math.cos(a) * stand, 0, b.z + Math.sin(a) * stand)
    // Outward points straight off the zone for a building on its edge, and an astronaut
    // standing in the neighbouring repo's yard reads as belonging to that repo. The inside
    // of its own plot is always the better answer when the outside is somebody else's.
    const onPlot = (v) => {
      const cell = worldToHex(v.x, v.z)
      return plot.cellKeys.has(`${cell.q},${cell.r}`)
    }
    if (!onPlot(site)) {
      const inward = new THREE.Vector3(b.x - Math.cos(a) * stand, 0, b.z - Math.sin(a) * stand)
      if (onPlot(inward)) site = inward
    }
    // The grid is the one built for the last roster, so this is a best effort — but sites
    // are recomputed every poll, and anything walled in by a neighbour is nudged out to the
    // nearest ground somebody can stand on rather than left as a trap.
    if (this.nav?.isBlocked(site.x, site.z)) {
      const free = this.nav.nearestFree(site.x, site.z)
      if (free) site.set(this.nav.toWorld(free.ix), 0, this.nav.toWorld(free.iz))
    }
    return site
  }

  // ── per-frame ───────────────────────────────────────────────────────────────────────

  update(dt, elapsed, focus) {
    if (focus) this.sky.setFocus(focus)
    const cycled = this.sky.update(dt, elapsed, this.camera)
    if (cycled) this.settings.values.timeOfDay = this.sky.time

    const night = this.sky.nightFactor ?? 0
    buildingUniforms.uNight.value = night
    // One write turns every rotor in the colony.
    buildingUniforms.uTime.value = elapsed
    this.ship.update(dt, elapsed, night)
    // The road lanterns, which is what turns a spanning tree into somewhere to walk after
    // dark. Painted rather than lit: they are unlit geometry, so this *is* their brightness.
    if (this.pathLampMaterial) {
      const gain = 0.22 + night * 1.9
      this.pathLampMaterial.color.setRGB(1.15 * gain, 0.82 * gain, 0.46 * gain)
    }

    this._growBuildings(dt)
    this.astronauts.update(dt, elapsed)
    this.astronauts.updateRings(elapsed)
    this.indicators.update(this.astronauts.agents, elapsed, (a) => this._badgeFor(a))
    this._emit(dt, elapsed)
    this.particles.ambient(dt, this.camera, this.planet)
    this.particles.update(dt)
    this._updateDetail()
    this._updatePlots(night, elapsed)
    this._updateScaffolds()
    this._updateLabels(dt)
  }

  /**
   * Hand every district the camera, so it can pick a level of detail.
   *
   * Cheap enough to do every frame — a distance per zone, and each zone early-outs unless it
   * has actually crossed its own threshold — and it has to be every frame, because the tier a
   * district should be at is a function of where you are standing, which is the one thing that
   * changes continuously.
   */
  _updateDetail() {
    const cam = this.camera.position
    for (const plot of this.plotOrder) plot.updateDetail(cam.x, cam.z)
    // The crew is culled against the same point, so the range where people stop being drawn
    // and the range where buildings drop to roofline stay tied together.
    this.astronauts.viewPoint = cam
  }

  _growBuildings(dt) {
    for (const [id, entry] of this.buildings) {
      // A running thread's site creeps upward while you watch it.
      if (!entry.retiring && this._isLive(id)) entry.target = Math.min(1, entry.target + LIVE_GROWTH * dt)
      /**
       * Snap the last sliver, or every building keeps its construction band forever.
       *
       * `damp` approaches its target asymptotically and never arrives, and the guard below
       * used to stop updating once the per-frame change fell under a twentieth of a percent
       * — which left progress resting at about 0.9994. The shader draws a bright band in the
       * zone's accent at the ground line of anything whose progress is *not* 1, as the
       * "somebody is building here right now" signal. So every finished building in the
       * colony wore a glowing accent stripe round its feet, permanently, and on a magenta
       * zone that stripe was the most science-fiction thing left in a village of tiled roofs.
       *
       * The signal itself is right and worth keeping; it just has to be able to switch off.
       */
      const next = THREE.MathUtils.damp(entry.progress, entry.target, 1.8, dt)
      // The window has to be wider than the point at which the per-frame delta guard below
      // stops updating at all, or the two thresholds fight and progress parks just short of
      // the target — measured at 0.9931, which is exactly where the first attempt at this
      // left it and why the band was still lit.
      const settled = Math.abs(entry.target - next) < 0.02
      if (settled && entry.progress !== entry.target) {
        entry.progress = entry.target
        entry.mesh.userData.setProgress(entry.target)
      } else if (Math.abs(next - entry.progress) > 0.0005) {
        entry.progress = next
        entry.mesh.userData.setProgress(next)
      }
      // The lid, eased. Quick enough to feel like a response to pressing a key, slow enough
      // that you see it happen.
      const wantOpen = entry.openTarget || 0
      const openNow = entry.open || 0
      if (Math.abs(wantOpen - openNow) > 0.002) {
        entry.open = THREE.MathUtils.damp(openNow, wantOpen, 5, dt)
        entry.mesh.userData.setOpen?.(entry.open)
      }

      if (entry.retiring && entry.progress <= 0.02) this._removeBuilding(id, entry)
    }
  }

  _isLive(id) {
    const thread = this.threads.get(id)
    return Boolean(thread && thread.running)
  }

  /** A site somebody is standing at: running, or stopped waiting on you. */
  _isActive(id) {
    const thread = this.threads.get(id)
    return Boolean(thread && (thread.running || thread.unread || thread.hasError))
  }

  _badgeFor(agent) {
    if (agent.state === 'spawning') return BADGE.spawning
    if (agent.state === 'leaving') return BADGE.leaving
    // Badges only appear once an astronaut has actually reached its post — a stream of
    // symbols bobbing over a walking crowd is noise.
    if (agent.state !== 'at-site') return BADGE.none
    /**
     * Talking beats whatever the thread is doing, for as long as it lasts.
     *
     * The two are never in conflict for anything urgent: only an idle character will strike
     * up a conversation (see `AVAILABLE` in social.js), so nothing that is waiting on you or
     * broken can have its badge hidden by one. What this displaces is the "idle" badge, and
     * "these two are chatting" is strictly more information than "this one has nothing on".
     */
    if (agent.social?.kind === 'chat') return BADGE.chat
    return BADGE_FOR[agent.status] ?? BADGE.none
  }

  /** Particle emission, driven by what each astronaut is doing. */
  _emit(dt, elapsed) {
    if (!this.particles.enabled) return
    const full = this.settings.get('particles') === 'full'

    for (const agent of this.astronauts.agents) {
      if (agent.scale < 0.5) continue
      // What this one is standing on, which on a plot is the deck rather than the terrain
      // under it. Everything thrown off an astronaut has to land back on the same surface.
      const ground = agent.groundY || 0

      if (agent.state === 'at-site' && agent.status === 'working') {
        // Sparks on the downbeat of the hammer swing, not every frame.
        const swing = Math.sin(agent.workSwing)
        if (swing < -0.75 && !agent._sparked) {
          agent._sparked = true
          const c = this._c.set(0x9fe8c0)
          this.particles.weld(
            agent.pos.x + Math.sin(agent.yaw) * 0.55,
            agent.pos.y + 0.55,
            agent.pos.z + Math.cos(agent.yaw) * 0.55,
            c,
            ground
          )
        } else if (swing > 0) {
          agent._sparked = false
        }
      }

      if (agent.state === 'at-site' && agent.status === 'celebrating' && agent.hop > 0.18 && !agent._cheered) {
        agent._cheered = true
        this.particles.cheer(agent.pos.x, agent.pos.y, agent.pos.z, this._c.set(0xffc86a), ground)
      } else if (agent.hop < 0.05) {
        agent._cheered = false
      }

      if (agent.state === 'at-site' && agent.status === 'sleeping' && Math.random() < dt * 0.35) {
        this.particles.snooze(agent.pos.x + 0.2, agent.pos.y + 1.05, agent.pos.z + 0.15)
      }

      // Boot dust, on the footfall.
      if (full && (agent.walkAmp || 0) > 0.4) {
        const step = Math.sin(agent.phase)
        if (step < -0.9 && !agent._stepped) {
          agent._stepped = true
          this.particles.step(agent.pos.x, agent.pos.y, agent.pos.z, this._dustTint, ground)
        } else if (step > 0) {
          agent._stepped = false
        }
      }

      // The ramp notices anyone stepping on or off it.
      if (agent.state === 'spawning' || (agent.state === 'leaving' && agent.scale < 0.6)) {
        if (Math.random() < dt * 3) this.ship.ping()
      }
    }
  }

  _updatePlots(night, elapsed) {
    const urgent = this.urgentPlots
    for (const plot of this.plotOrder) plot.setNight(night, urgent?.has(plot.id) ?? false, elapsed)
  }

  _updateScaffolds() {
    const sites = []
    for (const [id, entry] of this.buildings) {
      // Scaffolding says a thread is running here — the README's own promise. It used to be
      // gated on the building being unfinished as well, which was fine while "unfinished"
      // was most of them and useless the moment buildings stopped standing in a hole.
      if (entry.progress <= 0.03) continue
      if (!this._isActive(id)) continue
      const p = entry.mesh.position
      sites.push({
        x: p.x,
        z: p.z,
        y: p.y,
        radius: (entry.mesh.userData.footprint || 1.4) + 0.35,
        height: Math.max(0.6, entry.mesh.userData.height * entry.progress + 0.5),
      })
    }
    this.scaffolds.update(sites)
  }

  // ── interaction ─────────────────────────────────────────────────────────────────────

  pick(ndcX, ndcY, aspect) {
    return this.astronauts.pick(this.camera, ndcX, ndcY, aspect)
  }

  agentFor(id) {
    return this.astronauts.byId.get(id)
  }

  setUiVisible(visible) {
    this.uiVisible = visible
    this._syncLabels()
  }

  _syncLabels() {
    // Visibility is per-label now; the group only ever hides everything at once.
    this.labelGroup.visible = true
  }

  dispose() {
    this.sky.dispose()
    this.ship.dispose()
    this.astronauts.dispose()
    this.indicators.dispose()
    this.particles.dispose()
    this.scaffolds.dispose()
    disposeTree(this.worldGroup)
    disposeTree(this.plotGroup)
    disposeTree(this.labelGroup)
    this.scene.remove(this.worldGroup, this.plotGroup, this.labelGroup)
  }
}

function disposeTree(root) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return
    o.geometry?.dispose()
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
    else o.material?.dispose()
  })
}
