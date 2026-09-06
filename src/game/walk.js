import * as THREE from 'three'

/**
 * Walk mode: being *in* the colony rather than above it.
 *
 * This owns three things and nothing else — the keys currently held, the translation of
 * those keys into a world-space intent, and whether the camera is pinned to the player. The
 * character itself is an ordinary member of the crew living in `Astronauts`, and the camera
 * is the ordinary `CameraRig` with its target pinned; neither knows this module exists.
 * That is deliberate. A walk mode that owned its own camera and its own character would be
 * a second copy of the two hardest parts of the app, permanently drifting out of step with
 * the first.
 *
 * **Movement is camera-relative**, which is the one thing that has to be right. W goes the
 * way the camera is facing, not the way the world's +Z happens to point, so turning the
 * camera turns what "forward" means. The rotation is done here rather than in the character
 * because the camera's heading is the camera's business — two places both deciding which
 * way forward points is two places to disagree.
 */

/** Keys, by what they do rather than by where they are, so remapping is a data change. */
const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
}

/**
 * How steeply the camera looks down into an opened building. Not straight down — a plan
 * view of a room is a floor plan, and the point is to see the walls and what is against
 * them as well as the floor.
 */
const INSPECT_POLAR = 0.62

/** Eyeline in first person: a few degrees below the horizon, where people actually look. */
const FIRST_PERSON_POLAR = Math.PI / 2 - 0.12
/** The tilt the shoulder camera returns to. Matches the rig's own follow default. */
const THIRD_PERSON_POLAR = (66 * Math.PI) / 180

/**
 * How far the eye travels on each step, in world units. Small numbers: head bob is one of
 * those effects that is completely invisible until it is very slightly too much, at which
 * point it is the only thing anybody notices, and then it makes people feel ill.
 */
const BOB_UP = 0.028
const BOB_SIDE = 0.022
/** Extra degrees of field of view at a full sprint. */
const RUN_FOV = 5.5
/**
 * The field of view on the ground.
 *
 * The map view uses 38°, which is right for it: a narrow lens flattens perspective and makes
 * the colony read as a model on a table, which is exactly what you want when looking down at
 * one. At head height it is the opposite of what you want — a telephoto lens compresses
 * distance, so a valley two hundred units across looks like a courtyard, and walking through
 * it feels like walking on the spot. Widening the lens is the cheapest way to make the same
 * ground feel further across, and it is what makes a big world read as big rather than as a
 * long way to walk.
 */
const WALK_FOV = 55

const HELD = new Map()
for (const [action, codes] of Object.entries(BINDINGS)) for (const code of codes) HELD.set(code, action)

export class WalkMode {
  /**
   * @param astronauts the crew, which owns the player character
   * @param rig the camera rig to pin
   * @param onInteract called with the character you pressed the interact key at, or null
   */
  constructor(astronauts, rig, { onInteract, onToggle, onView, onEnter, onMount, occluded, colony, mount } = {}) {
    this.astronauts = astronauts
    this.rig = rig
    /** Needed for doorways: the colony owns the buildings and their nav footprints. */
    this.colony = colony
    /** The doorway in reach, or null. Recomputed each frame alongside the talk target. */
    this.door = null
    this.onInteract = onInteract
    this.onToggle = onToggle
    this.onView = onView
    this.onEnter = onEnter
    this.onMount = onMount
    /** The rideable, set by the page once the scene exists. */
    this.mount = mount || null
    /** 'third' over the shoulder, or 'first' out of the character's own eyes. */
    this.view = 'third'
    /** Asked by the follow camera how far its boom can reach. See `Colony.viewBlocked`. */
    this.occluded = occluded
    this.active = false
    this.held = new Set()
    this.intent = { x: 0, z: 0, run: false }
    this._forward = new THREE.Vector3()
    this._right = new THREE.Vector3()
    /** The character currently in range, so the prompt only re-renders when it changes. */
    this.target = null

    this._onKeyDown = (e) => this._key(e, true)
    this._onKeyUp = (e) => this._key(e, false)
    // Losing the window with a key down would otherwise leave the character walking into
    // the distance until you came back and pressed it again.
    this._onBlur = () => this.held.clear()
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    window.addEventListener('blur', this._onBlur)
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    window.removeEventListener('blur', this._onBlur)
  }

  _key(e, down) {
    // Never steal a key from a text field, and never from a modified shortcut.
    const el = document.activeElement
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
    if (e.ctrlKey || e.metaKey || e.altKey) return

    const action = HELD.get(e.code)
    if (action) {
      if (down) this.held.add(action)
      else this.held.delete(action)
      // Arrow keys scroll the page and space scrolls it further; walking should do neither.
      if (this.active) e.preventDefault()
      return
    }

    if (!down) return
    if (e.code === 'KeyE' && this.active) {
      e.preventDefault()
      /**
       * One key, three meanings, resolved by whichever is actually nearest.
       *
       * Inside a building, E is the way out — nothing else can be meant. Outside, it is
       * whichever of the person and the doorway you are closer to. Ranking people above
       * doors unconditionally was the obvious rule and a bad one: a thread's character
       * stands at its *own building*, so its house was permanently unenterable because its
       * resident was always in the way of the door.
       */
      if (this.colony?.openBuilding) {
        this.leaveDoor()
        return
      }
      const choice = this._reach()
      if (choice?.kind === 'person') this.onInteract?.(choice.person)
      else if (choice?.kind === 'door') this.enterDoor(choice.door)
      return
    }
    if (e.code === 'KeyV' && this.active) {
      e.preventDefault()
      this.cycleView()
      return
    }
    if (e.code === 'KeyR' && this.active) {
      e.preventDefault()
      this.toggleMount()
    }
  }

  /**
   * Step between looking over your character's shoulder and looking out of their eyes.
   *
   * Two modes rather than three. An over-the-shoulder middle setting is the obvious third,
   * and it earns its place in a game where you aim something; here there is nothing to aim,
   * and a third press that changes the picture only slightly reads as a broken toggle.
   */
  cycleView() {
    const follow = this.rig.follow
    if (!follow) return this.view
    const next = follow.mode === 'third' ? 'first' : 'third'
    follow.mode = next
    this.view = next
    if (next === 'first') {
      /**
       * Level the eyeline on the way in.
       *
       * The boom's tilt is shared between the two modes, and a third-person camera sits
       * well above its target looking down — which as an *eyeline* means walking around
       * staring at your own feet. Anything near the horizontal reads as a person looking
       * where they are going; this is a few degrees below it, which is where people
       * actually look.
       */
      this.rig.desiredPolar = FIRST_PERSON_POLAR
      this.rig.polar = FIRST_PERSON_POLAR
    } else {
      // Coming back out, the boom has to be told how far to reach again — first person left
      // the distance wherever it happened to be — and the tilt has to come back up, or the
      // camera returns to the shoulder at eye level and looks straight through the ground.
      this.rig.desiredDistance = follow.wanted
      this.rig.desiredPolar = THIRD_PERSON_POLAR
      this.rig.polar = THIRD_PERSON_POLAR
    }
    const player = this.astronauts.player
    // Your own head fills the screen from the inside otherwise.
    if (player) player.hidden = next === 'first'
    this.onView?.(next)
    return next
  }

  /**
   * What E would act on right now: the nearest person, the nearest doorway, or nothing.
   *
   * Computed in one place so the prompt and the key can never disagree about what is about
   * to happen — a prompt offering to open a door while the key starts a conversation is the
   * kind of bug nobody reports and everybody feels.
   */
  _reach() {
    const player = this.astronauts.player
    if (!player || this.colony?.openBuilding) return null

    const person = this.astronauts.nearestToPlayer()
    const personD = person ? Math.hypot(person.pos.x - player.pos.x, person.pos.z - player.pos.z) : Infinity
    const door = this.colony?.nearestDoor(player.pos.x, player.pos.z) || null
    // A doorway has to be clearly nearer to win, so brushing past a door on the way to
    // somebody does not keep swapping the prompt under you.
    if (door && door.distance + 0.6 < personD) return { kind: 'door', door }
    if (person) return { kind: 'person', person }
    return door ? { kind: 'door', door } : null
  }

  /**
   * Open a building up and look inside it.
   *
   * **This is a doll's house, not a doorway you step through**, and that was a design
   * decision forced by arithmetic rather than taste. The village is built at doll's-house
   * scale so the map reads from above: a room comes out about 1.4 units tall against a
   * character 1.25 tall. Walking in first-person into a room barely taller than you puts
   * the camera in the ceiling with a wall filling the frame — there is nothing to see, and
   * no framing fixes it.
   *
   * The alternatives were both worse. Building the interior *larger* than the shell — the
   * usual trick — fails here because the shell is solid and visible from outside, so you
   * end up standing in a field next to the little house you are supposedly inside. Scaling
   * the whole village up until rooms are habitable would wreck the proportions that make
   * the colony legible at a glance, which is the entire point of the overhead view.
   *
   * So the roof lifts off and the camera rises to look down into the room, while your
   * character stays at the door. It reads immediately, it needs no cheats, and it is what
   * this world's scale was always asking for. The thread that lives there walks home and
   * sits down in it, which is the part that actually answers "what is inside".
   */
  enterDoor(door) {
    const result = this.colony?.enterBuilding(door.id)
    if (!result) return false
    // You get off before you go in.
    if (this.mount?.active) this.toggleMount()

    const mesh = door.entry.mesh
    this._inspect = {
      // Remembered so stepping back out returns the camera to exactly where it was.
      azimuth: this.rig.desiredAzimuth,
      polar: this.rig.desiredPolar,
      distance: this.rig.follow?.wanted ?? 5,
    }
    // Off the character and onto the building. The rig is the same one; only what it is
    // pinned to changes, so the move is a glide rather than a cut.
    this.rig.setFollow(() => mesh.position, {
      height: (mesh.userData.height || 2) * 0.42,
      distance: Math.max(4.2, (mesh.userData.height || 2) * 2.1),
      polar: INSPECT_POLAR,
      occluded: null,
    })
    // Square on to the front of the house, so you are looking in through where the roof was
    // rather than at a corner of it.
    this.rig.desiredAzimuth = mesh.rotation.y
    this.rig.desiredPolar = INSPECT_POLAR

    this.door = null
    this.onEnter?.(result)
    return true
  }

  /** Shut the roof and go back to being a person standing in a village. */
  leaveDoor() {
    this.colony?.exitBuilding()
    const back = this._inspect
    this._inspect = null
    this.rig.setFollow(() => this.astronauts.playerPosition(), { occluded: this.occluded })
    if (back) {
      this.rig.desiredAzimuth = back.azimuth
      this.rig.desiredPolar = back.polar
      if (this.rig.follow) this.rig.follow.wanted = back.distance
    }
    this.onEnter?.(null)
  }

  /**
   * Summon the mount, or send it away.
   *
   * Refused indoors, and refused while inspecting a building — a cat the size of a sofa
   * appearing in somebody's front room is funny exactly once, and it would be standing on
   * the furniture the rest of the time.
   */
  toggleMount() {
    if (!this.mount) return false
    const player = this.astronauts.player
    if (!player || this.colony?.openBuilding) return false
    const on = !this.mount.active
    this.mount.setActive(on)
    player.riding = on
    // Both cameras want more room once you are up on something and moving faster.
    if (this.rig.follow) this.rig.follow.wanted = on ? 8.5 : 5
    this.onMount?.(on)
    return on
  }

  /** Enter or leave walk mode. Idempotent, so a key repeat cannot half-toggle it. */
  setActive(on) {
    if (on === this.active) return this.active
    this.active = on
    this.held.clear()
    if (on) {
      const player = this.astronauts.spawnPlayer()
      /**
       * Start near the ship but clear of it.
       *
       * Right at the door is the wrong place, however tempting: the door is where every
       * character arrives and where the crowd is thickest, so you would open the page
       * already buried inside seventy other people with the camera looking at the inside of
       * somebody's hair. A few metres out along the diagonal puts the crowd in front of you
       * — which is what you want to see — with room to turn around.
       */
      const door = this.astronauts.world?.shipDoor?.()
      if (door && !this._placed) {
        const wantX = door.x + 5.5
        const wantZ = door.z + 5.5
        // `nearestFree` answers in *cell* indices, not world units — hence `toWorld`.
        const nav = this.astronauts.nav
        const cell = nav?.nearestFree(wantX, wantZ)
        player.pos.set(
          cell ? nav.toWorld(cell.ix) : wantX,
          player.pos.y,
          cell ? nav.toWorld(cell.iz) : wantZ
        )
        // Facing back toward the ship, so the colony is in shot rather than behind you.
        player.yaw = Math.atan2(door.x - player.pos.x, door.z - player.pos.z)
        player.targetYaw = player.yaw
        this._placed = true
      }
      this.rig.setFollow(() => this.astronauts.playerPosition(), { occluded: this.occluded })
    } else {
      this.rig.setFollow(null)
      this.astronauts.playerInput = null
      // Nobody rides in the map view: the mount is drawn at the player, and the player is
      // not the thing the camera is looking at any more.
      if (this.mount?.active) {
        this.mount.setActive(false)
        if (this.astronauts.player) this.astronauts.player.riding = false
      }
      this.colony?.exitBuilding()
      this.rig.viewBob.set(0, 0, 0)
      // Give the lens back, or the map view keeps whatever field of view you were sprinting
      // with when you pressed Tab.
      this.rig.camera.fov = this.rig.settings.get('fov')
      this.rig.camera.updateProjectionMatrix()
      this.view = 'third'
      if (this.astronauts.player) this.astronauts.player.hidden = false
    }
    this.onToggle?.(on)
    return this.active
  }

  /**
   * Turn the held keys into a world-space intent and hand it to the character.
   *
   * Returns whichever character is now in talking range, so the page can show and hide the
   * prompt without doing its own proximity search.
   */
  /**
   * The two things that make moving feel like moving.
   *
   * **Head bob**, driven from the character's own stride phase rather than from a timer, so
   * the eye drops on the same frame the foot lands and the footstep sound fires — three
   * separate systems agreeing on one number is what sells it. The vertical component runs
   * at twice the rate of the lateral one, because you rise and fall on *every* step and
   * sway left and right over a *pair* of them.
   *
   * **A field-of-view kick when running.** Widening the view as speed comes on is the
   * oldest trick in first-person movement and still the most effective: nothing about the
   * character changes, but the world starts rushing past at the edges.
   *
   * Both fade to nothing when standing still, and both are skipped entirely in third
   * person, where the walk animation already does this job on the body itself.
   */
  _feel(dt) {
    const player = this.astronauts.player
    const cam = this.rig.camera
    const first = this.rig.follow?.mode === 'first'
    const speed = player ? player.groundSpeed || 0 : 0

    // Eased rather than switched, so stepping in and out of first person does not snap the
    // lens, and so slowing to a halt settles instead of stopping dead.
    const wanted = first ? Math.min(1, speed / 3.4) : 0
    this._bobAmount = THREE.MathUtils.damp(this._bobAmount ?? 0, wanted, 6, dt)

    if (this._bobAmount > 0.001 && player) {
      const p = player.phase
      this.rig.viewBob.set(
        Math.sin(p) * BOB_SIDE * this._bobAmount,
        // `abs` of a sine, not a sine: a head rises and falls once per footfall, and it
        // spends more time up than down. A plain sine reads as floating.
        (Math.abs(Math.sin(p * 2)) - 0.5) * BOB_UP * this._bobAmount,
        0
      )
    } else {
      this.rig.viewBob.set(0, 0, 0)
    }

    // The world's own setting still governs the map; the ground gets its own lens.
    const baseFov = first || this.active ? WALK_FOV : this.rig.settings.get('fov')
    const runT = first ? THREE.MathUtils.clamp((speed - 3.4) / 3.8, 0, 1) : 0
    const targetFov = baseFov + runT * RUN_FOV
    if (Math.abs(cam.fov - targetFov) > 0.02) {
      cam.fov = THREE.MathUtils.damp(cam.fov, targetFov, 4, dt)
      cam.updateProjectionMatrix()
    }
  }

  update(dt = 1 / 60) {
    if (!this.active) return null

    // Inspecting a building: the character stays put at the door. Letting WASD drive it
    // while the camera is somewhere else entirely is how you lose your own character.
    if (this._inspect) {
      this.intent.x = 0
      this.intent.z = 0
      this.intent.run = false
      this.astronauts.playerInput = this.intent
      this.rig.viewBob.set(0, 0, 0)
      this.target = null
      this.door = null
      return null
    }

    let x = 0
    let z = 0
    if (this.held.has('forward')) z += 1
    if (this.held.has('back')) z -= 1
    if (this.held.has('left')) x -= 1
    if (this.held.has('right')) x += 1

    if (x || z) {
      // Camera-relative. `forward` is the camera's heading flattened onto the ground; a
      // camera looking steeply down still has a heading, and flattening rather than
      // projecting is what keeps the speed the same at every tilt.
      const cam = this.rig.camera
      cam.getWorldDirection(this._forward)
      this._forward.y = 0
      // Looking straight down, the flattened heading is degenerate; fall back to the rig's
      // own azimuth, which is always meaningful.
      if (this._forward.lengthSq() < 1e-6) {
        this._forward.set(Math.sin(this.rig.azimuth + Math.PI), 0, Math.cos(this.rig.azimuth + Math.PI))
      }
      this._forward.normalize()
      // Right is cross(forward, up), and the sign matters: with +Y up, a character facing
      // +Z has its right hand pointing at −X. Written the other way round — which is the
      // easy mistake, because (z, −x) *looks* like a perpendicular and is one — A and D come
      // out swapped, and strafing takes you the wrong way every single time.
      this._right.set(-this._forward.z, 0, this._forward.x)

      this.intent.x = this._forward.x * z + this._right.x * x
      this.intent.z = this._forward.z * z + this._right.z * x
      // Diagonals must not be faster than the cardinals they are made of.
      const mag = Math.hypot(this.intent.x, this.intent.z)
      if (mag > 1) {
        this.intent.x /= mag
        this.intent.z /= mag
      }
    } else {
      this.intent.x = 0
      this.intent.z = 0
    }
    this.intent.run = this.held.has('run')
    this.astronauts.playerInput = this.intent

    // In first person the character turns with the camera rather than toward where it is
    // walking — you are looking out of its eyes, so its head cannot be facing anywhere
    // else. `azimuth` points from the character *back* to where the camera would sit in
    // third person, so facing is half a turn from it.
    if (this.rig.follow?.mode === 'first') {
      const player = this.astronauts.player
      if (player) {
        player.targetYaw = this.rig.azimuth + Math.PI
        player.yaw = player.targetYaw
      }
    }

    this.mount?.update(dt, this.astronauts.player)
    this._feel(dt)

    const choice = this._reach()
    this.target = choice?.kind === 'person' ? choice.person : null
    this.door = choice?.kind === 'door' ? choice.door : null
    return this.target
  }
}
