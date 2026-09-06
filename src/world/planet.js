import * as THREE from 'three'
import { atlasTexture, hasPart, part } from './kit.js'

/**
 * The worlds, and everything that makes one look like itself.
 *
 * A world is a bag of colours and a couple of switches — terrain, scatter, sky and lighting
 * all read from the same preset, so a new one is a data change rather than a code change.
 * That was true of the space version and it is the reason this fork could swap a moon for a
 * hillside of cherry trees without touching the renderer.
 *
 * `foliage` is the one field added here. The forest pack paints its trees a single summer
 * green, and a per-instance tint over that atlas is what turns the same trees pink for
 * blossom season, rust for autumn, or ghost-blue for the spirit world — one number instead
 * of three more model packs.
 */
export const PLANETS = {
  sakura: {
    id: 'sakura',
    /**
     * Blossom, falling constantly. This is the world's signature and the reason it is the
     * default: a still frame of a village is a diorama, and a still frame of a village with
     * petals coming down is a place with weather in it.
     */
    weather: { kind: 'fall', color: [1.0, 0.72, 0.85], rate: 0.05, size: 0.12, fall: 0.55, sway: 1.5, glow: false, high: 9 },
    name: 'Hanami Hills',
    blurb: 'Blossom season. Pink snow, and nobody doing any work.',
    ground: { low: 0x3f6b3a, high: 0x7fae55, tint: 0x9cc46a },
    rock: 0x8a8378,
    horizon: 0xf2b8cf,
    sky: { top: 0x5f8fd6, bottom: 0xffd4e4 },
    fog: { color: 0xf0c2d4, near: 290, far: 1080 },
    sun: { color: 0xfff2e0, intensity: 2.5, night: 0.14 },
    ambient: { sky: 0xffc8dd, ground: 0x4a6b38, intensity: 1.0 },
    atmosphere: 1,
    craters: 0,
    roughness: 0.8,
    scatter: 'flora',
    foliage: 0xffb3d0,
    companion: { name: 'the moon', color: 0xf6f0e2, size: 3.0, glow: 0xfff8ea },
    dust: 0.35,
  },

  neon: {
    id: 'neon',
    // Rain, hard and vertical, catching the signage on the way down.
    weather: { kind: 'fall', color: [0.55, 0.8, 1.0], rate: 0.012, size: 0.055, fall: 6.5, sway: 0.15, glow: true, high: 11 },
    name: 'Neo-Akihabara',
    blurb: 'Perpetual 2am. Wet asphalt and too many signs.',
    ground: { low: 0x14141f, high: 0x2b2b3f, tint: 0x3a3a54 },
    rock: 0x33334a,
    horizon: 0x2a1240,
    sky: { top: 0x090616, bottom: 0x3d1350 },
    fog: { color: 0x22103a, near: 205, far: 874 },
    // Barely any sun: this world is lit by its own signage, which is what the accent
    // emissives on the buildings become after dark.
    sun: { color: 0xc9b0ff, intensity: 0.85, night: 0.16 },
    ambient: { sky: 0xff3fa4, ground: 0x0d2a44, intensity: 0.85 },
    atmosphere: 0.35,
    craters: 0,
    roughness: 0.5,
    scatter: 'rocks',
    foliage: 0x2de0ff,
    companion: { name: 'the tower', color: 0xff3fa4, size: 2.4, glow: 0xff6fc0 },
    dust: 0.5,
  },

  spirit: {
    id: 'spirit',
    // Spirit lights, drifting upward. The only weather here that rises, which is most of
    // why this world reads as somewhere the rules are different.
    weather: { kind: 'rise', color: [0.55, 1.0, 0.85], rate: 0.06, size: 0.14, fall: -0.5, sway: 0.9, glow: true, high: 1.5 },
    name: 'The Spirit Realm',
    blurb: 'Do not eat anything. Teal dusk, and the lanterns are awake.',
    ground: { low: 0x18323a, high: 0x2f5e63, tint: 0x47867f },
    rock: 0x3c5a5e,
    horizon: 0x7be0d0,
    sky: { top: 0x151a44, bottom: 0x4fbfae },
    fog: { color: 0x2b5560, near: 231, far: 920 },
    sun: { color: 0xd8fff2, intensity: 1.5, night: 0.2 },
    ambient: { sky: 0x66e0cd, ground: 0x1c3a40, intensity: 1.05 },
    atmosphere: 0.75,
    craters: 0,
    roughness: 0.95,
    scatter: 'flora',
    foliage: 0x8ff0d8,
    companion: { name: 'the pale lantern', color: 0xd8fff2, size: 3.6, glow: 0xaaffe8 },
    dust: 0.7,
  },

  festival: {
    id: 'festival',
    // Embers off the lanterns, rising and going out.
    weather: { kind: 'rise', color: [1.0, 0.62, 0.25], rate: 0.07, size: 0.09, fall: -0.85, sway: 0.7, glow: true, high: 1.0 },
    name: 'Summer Festival',
    blurb: 'Sunset, cicadas, and somebody is definitely about to confess.',
    ground: { low: 0x4a3a2c, high: 0x8a6b45, tint: 0xad8a5c },
    rock: 0x7a6350,
    horizon: 0xff9a4f,
    sky: { top: 0x2b2a63, bottom: 0xff9e5c },
    fog: { color: 0xc4713f, near: 257, far: 966 },
    sun: { color: 0xffc48a, intensity: 2.1, night: 0.15 },
    ambient: { sky: 0xffa060, ground: 0x4a3524, intensity: 0.95 },
    atmosphere: 0.95,
    craters: 0,
    roughness: 0.85,
    scatter: 'flora',
    foliage: 0x6f9a4a,
    companion: { name: 'the fireworks', color: 0xffd08a, size: 2.8, glow: 0xffe0b0 },
    dust: 0.45,
  },

  skyward: {
    id: 'skyward',
    // Seed fluff on the updraught, barely falling at all.
    weather: { kind: 'fall', color: [1.0, 1.0, 0.95], rate: 0.09, size: 0.1, fall: 0.18, sway: 1.9, glow: false, high: 10 },
    name: 'Skyward Isles',
    blurb: 'Above the clouds. Enormous sky, and a great deal of green.',
    ground: { low: 0x2f6b40, high: 0x84c060, tint: 0xa4d878, },
    rock: 0x9aa08c,
    horizon: 0xcfe8ff,
    sky: { top: 0x2a72c8, bottom: 0xdff0ff },
    fog: { color: 0xbcd8ee, near: 330, far: 1150 },
    sun: { color: 0xfffaf0, intensity: 2.8, night: 0.12 },
    ambient: { sky: 0xa8d8ff, ground: 0x3f6b34, intensity: 1.05 },
    atmosphere: 1,
    craters: 0,
    roughness: 0.7,
    scatter: 'flora',
    foliage: 0x9fd870,
    companion: { name: 'the castle', color: 0xd8d2c4, size: 3.4, glow: 0xfff4e2 },
    dust: 0.2,
  },

  winter: {
    id: 'winter',
    // Snow: slow, wide, and heavy enough to see through.
    weather: { kind: 'fall', color: [1.0, 1.0, 1.0], rate: 0.03, size: 0.13, fall: 0.9, sway: 1.2, glow: false, high: 12 },
    name: 'The Winter Arc',
    blurb: 'Blue snow and a long silence. Something is about to happen.',
    ground: { low: 0x8a9ab5, high: 0xe4edf7, tint: 0xf4f8ff },
    rock: 0x7f8a9e,
    horizon: 0xbcd2e8,
    sky: { top: 0x2a4a78, bottom: 0xc4dcf0 },
    fog: { color: 0xb0c6dc, near: 238, far: 920 },
    sun: { color: 0xe4f0ff, intensity: 2.0, night: 0.16 },
    ambient: { sky: 0xc4dcf8, ground: 0x8296b0, intensity: 1.1 },
    atmosphere: 0.9,
    craters: 0,
    roughness: 0.75,
    scatter: 'flora',
    foliage: 0xdce8f4,
    companion: { name: 'the moon', color: 0xeef4ff, size: 3.2, glow: 0xffffff },
    dust: 0.6,
  },
}

/**
 * The terrain plane. Widened with the colony: a nine-cell lattice at seventeen units a cell
 * reaches past a hundred and twenty, and ground that stops before the outermost town does
 * leaves it standing on the void.
 */
/**
 * How much ground there is, all told.
 *
 * Grew with the lattice. Cities are three times the size they were and three times as far
 * apart, so a five-hundred-unit plane that used to run well past the outermost zone now stops
 * short of it — and the edge of the ground plane is the one thing in a world like this that
 * cannot be explained away.
 */
const GROUND_SIZE = 1300
/** Everything inside this radius is the buildable colony, and is kept nearly flat. */
export const COLONY_RADIUS = 250
// Segment counts had to rise with the plane or the ground would have lost more than half
// its resolution per unit — the swell would read as facets you can see the edges of.
const DETAIL_SEGMENTS = { low: 110, medium: 180, high: 260 }

/**
 * Terrain is one plane, displaced and vertex-coloured on the CPU at build time. Doing it
 * once and baking it into the buffer means the GPU only ever sees static geometry — no
 * displacement map sample, no per-frame work — and vertex colours give the surface its
 * mottling for free rather than costing a texture fetch.
 */
export function createTerrain(planet, detail, seed = 1337) {
  const segments = DETAIL_SEGMENTS[detail] || DETAIL_SEGMENTS.medium
  const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, segments, segments)
  geo.rotateX(-Math.PI / 2)

  const noise = makeNoise(seed)
  const craters = makeCraters(planet.craters, seed)
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)

  const low = new THREE.Color(planet.ground.low)
  const high = new THREE.Color(planet.ground.high)
  const tint = new THREE.Color(planet.ground.tint)
  const c = new THREE.Color()

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const dist = Math.hypot(x, z)

    // Flat where the colony lives, then hills that ramp in over the next forty metres —
    // so nothing ever builds on a slope but the horizon still has shape to it.
    const outside = THREE.MathUtils.smoothstep(dist, COLONY_RADIUS - 6, COLONY_RADIUS + 40)
    /**
     * The long swell the whole country sits on.
     *
     * The colony floor used to be held nearly flat inside `COLONY_RADIUS` — sensible when
     * everything had to stand on it, and the single biggest thing making the world feel
     * small. A flat plane has no horizon of its own: from anywhere on it you can see
     * everywhere else on it, so however far the ground runs there is nothing left to
     * discover and no sense of distance covered.
     *
     * This is a very low frequency — one rise every eighty units or so — with enough
     * amplitude to put a town out of sight behind it and not so much that walking between
     * two of them is mountaineering. Applied everywhere rather than faded in at the edge, so
     * there is no seam between the colony and the country around it.
     */
    const swell = fbm(noise, x * 0.0072, z * 0.0072, 3) * 7.5
    const gentle = fbm(noise, x * 0.035, z * 0.035, 3) * 0.5
    const hills = fbm(noise, x * 0.012, z * 0.012, 4) * 9 + fbm(noise, x * 0.05, z * 0.05, 2) * 1.4
    let y =
      swell * planet.roughness +
      gentle * planet.roughness * (1 - outside) +
      hills * outside * planet.roughness

    for (const crater of craters) {
      const d = Math.hypot(x - crater.x, z - crater.z)
      if (d > crater.r * 1.5) continue
      // A bowl with a raised rim — the rim is what makes it read as an impact.
      const t = d / crater.r
      if (t < 1) y -= (1 - t * t) * crater.depth
      else y += (1 - Math.abs(t - 1.22) / 0.28) * crater.depth * 0.32
    }

    pos.setY(i, y)

    // Colour: height-driven blend, mottled with a second noise band so it never bands.
    const shade = THREE.MathUtils.clamp(0.42 + y * 0.09 + fbm(noise, x * 0.09, z * 0.09, 2) * 0.5, 0, 1)
    c.copy(low).lerp(high, shade)
    const speck = fbm(noise, x * 0.55, z * 0.55, 1)
    c.lerp(tint, Math.max(0, speck) * 0.22)
    // Darken the far field hard so the eye settles on the colony and the hills read as a
    // silhouette rather than as more ground competing with the plots for attention.
    c.multiplyScalar(1 - THREE.MathUtils.smoothstep(dist, COLONY_RADIUS * 0.7, GROUND_SIZE * 0.35) * 0.75)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.97,
    metalness: 0,
    // Flat-ish shading keeps the low-poly read; a dielectric surface with no spec highlight
    // is what sells "dust" rather than "plastic".
    envMapIntensity: 0.3,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.receiveShadow = true
  mesh.name = 'terrain'

  // Sampler so anything placed later can sit exactly on the surface.
  mesh.userData.heightAt = (x, z) => sampleHeight(x, z, noise, craters, planet)
  return mesh
}

function sampleHeight(x, z, noise, craters, planet) {
  const dist = Math.hypot(x, z)
  const outside = THREE.MathUtils.smoothstep(dist, COLONY_RADIUS - 6, COLONY_RADIUS + 40)
  // Must match `createTerrain` term for term: this is what every character, road and town
  // stands on, and a sampler that disagrees with the mesh puts the whole colony underground.
  const swell = fbm(noise, x * 0.0072, z * 0.0072, 3) * 7.5
  const gentle = fbm(noise, x * 0.035, z * 0.035, 3) * 0.5
  const hills = fbm(noise, x * 0.012, z * 0.012, 4) * 9 + fbm(noise, x * 0.05, z * 0.05, 2) * 1.4
  let y =
    swell * planet.roughness +
    gentle * planet.roughness * (1 - outside) +
    hills * outside * planet.roughness
  for (const crater of craters) {
    const d = Math.hypot(x - crater.x, z - crater.z)
    if (d > crater.r * 1.5) continue
    const t = d / crater.r
    if (t < 1) y -= (1 - t * t) * crater.depth
    else y += (1 - Math.abs(t - 1.22) / 0.28) * crater.depth * 0.32
  }
  return y
}

/** Craters only ever land outside the colony, so they never eat a build plot. */
function makeCraters(count, seed) {
  const rand = mulberry(seed ^ 0x9e37)
  const out = []
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2
    const d = COLONY_RADIUS + 14 + rand() * 110
    const r = 4 + rand() * 16
    out.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r, depth: r * (0.18 + rand() * 0.16) })
  }
  return out
}

// ── scatter ───────────────────────────────────────────────────────────────────────────

/**
 * How many pieces of ground scatter the whole world gets.
 *
 * Trimmed when the map grew: the budget is a total, not a density, so spreading the same
 * nine hundred over two and a half times the area thinned it out anyway — and the towns
 * now bring their own copses, which is where the planting actually reads.
 */
/**
 * How many scattered props the ground gets.
 *
 * Raised to 900 when the world was 1300 units across and lowered again with it: the cities
 * were packed back together afterwards, so the same budget was covering two thirds the
 * ground at half again the density, for foliage that is mostly seen from a moving camera at
 * fifty units.
 */
const SCATTER_BUDGET = 520

/**
 * Rocks, boulders and plants. All instanced, all placed with a deterministic RNG so the
 * same planet always looks the same, and all kept clear of the plots and walkways.
 */
/**
 * What grows on a world, and how it is planted.
 *
 * `weight` is how often a shape comes up relative to its siblings, `size` the range of its
 * base scale, and `sink` how far into the ground it settles as a fraction of that scale.
 * A boulder half-buried reads as bedrock; a tree buried by the same amount reads as a
 * mistake, so the two want very different numbers.
 *
 * All of it comes from KayKit's Forest Nature Pack, which is why the same list can dress a
 * meadow and a crater field: its boulders are painted neutral grey, so a per-instance tint
 * takes them to lunar dust or Martian rust without touching the atlas.
 */
const SCATTER = {
  flora: [
    { part: 'Tree_1_A_Color1', weight: 3, size: [0.35, 0.6], sink: 0.02, upright: true },
    { part: 'Tree_3_A_Color1', weight: 3, size: [0.35, 0.6], sink: 0.02, upright: true },
    { part: 'Tree_4_A_Color1', weight: 2, size: [0.3, 0.55], sink: 0.02, upright: true },
    { part: 'Tree_1_C_Color1', weight: 1, size: [0.25, 0.4], sink: 0.02, upright: true },
    { part: 'Tree_3_C_Color1', weight: 1, size: [0.22, 0.38], sink: 0.02, upright: true },
    { part: 'Tree_4_C_Color1', weight: 1, size: [0.2, 0.35], sink: 0.02, upright: true },
    { part: 'Bush_1_E_Color1', weight: 3, size: [0.5, 1.1], sink: 0.06, upright: true },
    { part: 'Bush_3_B_Color1', weight: 3, size: [0.5, 1.1], sink: 0.06, upright: true },
    { part: 'Grass_2_D_Color1', weight: 4, size: [0.6, 1.3], sink: 0.05, upright: true },
    { part: 'Rock_1_D_Color1', weight: 2, size: [0.4, 0.9], sink: 0.3, tint: true },
  ],
  rocks: [
    { part: 'Rock_1_D_Color1', weight: 4, size: [0.5, 1.2], sink: 0.3, tint: true },
    { part: 'Rock_2_C_Color1', weight: 4, size: [0.5, 1.2], sink: 0.3, tint: true },
    { part: 'Rock_3_E_Color1', weight: 3, size: [0.6, 1.4], sink: 0.15, tint: true },
    { part: 'Rock_1_J_Color1', weight: 1, size: [0.3, 0.7], sink: 0.25, tint: true },
    { part: 'Rock_2_G_Color1', weight: 1, size: [0.3, 0.7], sink: 0.25, tint: true },
    { part: 'Rock_3_L_Color1', weight: 2, size: [0.4, 0.9], sink: 0.12, tint: true },
    { part: 'Rock_3_Q_Color1', weight: 1, size: [0.25, 0.55], sink: 0.1, tint: true },
  ],
}

/** The fallback when the kit has not loaded: the primitives this used to be made of. */
function fallbackShapes(isFlora) {
  const shapes = isFlora
    ? [new THREE.IcosahedronGeometry(0.5, 0), new THREE.ConeGeometry(0.42, 1.5, 5), new THREE.SphereGeometry(0.5, 6, 4)]
    : [
        new THREE.DodecahedronGeometry(0.55, 0),
        new THREE.IcosahedronGeometry(0.6, 0),
        new THREE.TetrahedronGeometry(0.72, 0),
      ]
  for (const g of shapes) g.computeVertexNormals()
  return shapes.map((geo) => ({ geo, sink: 0.25, size: [0.28, 0.83], tint: true, upright: false }))
}

export function createScatter(planet, density, keepClear = [], seed = 4242) {
  const group = new THREE.Group()
  group.name = 'scatter'
  const count = Math.round(SCATTER_BUDGET * THREE.MathUtils.clamp(density, 0, 1))
  if (count <= 0) return group

  const rand = mulberry(seed)
  const isFlora = planet.scatter === 'flora'
  const recipe = SCATTER[planet.scatter] || SCATTER.rocks
  const ready = recipe.every((r) => hasPart(r.part, 'forest'))

  const kinds = ready
    ? recipe.map((r) => ({ ...r, geo: part(r.part, 'forest'), weight: r.weight }))
    : fallbackShapes(isFlora).map((r) => ({ ...r, weight: 1 }))

  // One material for the lot. The pack's atlas carries the greens and the greys, and the
  // per-instance colour is a *tint* on top of it — white for anything already the right
  // colour, the planet's own rock for a boulder that has to belong to this world.
  const atlas = ready ? atlasTexture('forest') : null
  const material = new THREE.MeshStandardMaterial({
    map: atlas,
    color: 0xffffff,
    roughness: isFlora ? 0.82 : 0.95,
    metalness: 0,
    flatShading: !ready,
  })
  /**
   * Desaturate the atlas before the per-instance tint multiplies it.
   *
   * The pack paints its leaves one summer green, and a tint is a *multiply* — so asking for
   * pink blossom over green foliage gives pink times green, which is a muddy olive and not
   * pink at anything. Collapsing the sampled colour most of the way to its own luminance
   * first turns the atlas into what it needs to be here: a shading map, holding all the
   * light and shadow Kay painted into it while surrendering the hue to the world preset.
   * That one line is the difference between six worlds and six worlds that are all green.
   */
  if (atlas) {
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         // Keep the atlas's light and shade, throw its hue away entirely. What is left is a
         // shading term, and the per-instance colour that color_fragment multiplies in
         // immediately below becomes the actual colour of the leaf — so the tint is the
         // answer rather than a filter over green. Recentred on 1.0, because a shading term
         // averaging 0.45 would otherwise halve every colour it touched.
         float leafLuma = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
         diffuseColor.rgb = vec3( 0.62 + leafLuma * 0.85 );`
      )
    }
  }

  const total = kinds.reduce((sum, k) => sum + k.weight, 0)
  const meshes = kinds.map((k) =>
    new THREE.InstancedMesh(k.geo, material, Math.ceil((count * k.weight) / total) + 8)
  )

  const rock = new THREE.Color(planet.rock)
  // Anything not tinted to the world's rock takes its foliage tint instead, so one pack of
  // summer-green trees dresses a blossom hillside and a frozen one from the same atlas.
  const foliage = new THREE.Color(planet.foliage || 0xffffff)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  const fill = new Array(kinds.length).fill(0)

  // Pick by weight: a cumulative table beats a uniform index when a fir should be rarer
  // than a grass tuft.
  const pickKind = () => {
    let roll = rand() * total
    for (let i = 0; i < kinds.length; i++) {
      roll -= kinds[i].weight
      if (roll <= 0) return i
    }
    return kinds.length - 1
  }

  for (let i = 0; i < count; i++) {
    // Bias outward: a ring is thicker where there is more area, which √ gives for free.
    const a = rand() * Math.PI * 2
    const d = 9 + Math.sqrt(rand()) * 150
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    if (keepClear.some((p) => Math.hypot(x - p.x, z - p.z) < p.r)) continue

    const which = pickKind()
    const kind = kinds[which]
    const mesh = meshes[which]
    const slot = fill[which]
    if (slot >= mesh.instanceMatrix.count) continue

    // Far-field props are allowed to be much bigger, which reads as distance.
    const far = THREE.MathUtils.smoothstep(d, COLONY_RADIUS, 130)
    const [lo, hi] = kind.size
    const s = (lo + rand() * (hi - lo)) * (1 + far * 1.9)

    dummy.position.set(x, sampleY(x, z, planet, seed) - s * kind.sink, z)
    // A tree that leans is a fallen tree. Boulders may lie however they landed.
    if (kind.upright) dummy.rotation.set(0, rand() * Math.PI * 2, 0)
    else dummy.rotation.set((rand() - 0.5) * 0.5, rand() * Math.PI * 2, (rand() - 0.5) * 0.5)
    const jitter = kind.upright ? 0.14 : 0.35
    dummy.scale.set(
      s * (1 - jitter / 2 + rand() * jitter),
      s * (1 - jitter / 2 + rand() * jitter),
      s * (1 - jitter / 2 + rand() * jitter)
    )
    dummy.updateMatrix()
    mesh.setMatrixAt(slot, dummy.matrix)

    // Rock takes the world's stone; everything growing takes its foliage tint. Both are
    // lifted because they *multiply* the atlas rather than replacing it — the pack's stone
    // is a mid grey and its leaves a mid green, so a tint applied at face value comes out
    // far darker than the ground it is standing on.
    // Both are now the *final* colour rather than a filter, because the shader above has
    // already reduced the atlas to shading. No compensating boost, and none wanted.
    if (kind.tint) color.copy(rock)
    else color.copy(foliage)
    color.offsetHSL((rand() - 0.5) * 0.03, (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.14)
    mesh.setColorAt(slot, color)
    fill[which] = slot + 1
  }

  meshes.forEach((mesh, i) => {
    mesh.count = fill[i]
    /**
     * Ground scatter does not cast shadows.
     *
     * Measured, not guessed: the scatter was 539k triangles against a city of 286k — the
     * largest single block of geometry in the world, and it was being drawn a second time
     * into the shadow map. What a grass tuft casts is a smudge on the grass beside it, at a
     * sun angle that makes it nearly invisible, in a scene whose shadow camera is thirty
     * units wide. It still *receives*, so buildings and characters still shadow onto it and
     * the ground keeps its shape.
     */
    mesh.castShadow = false
    mesh.receiveShadow = true
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    group.add(mesh)
  })
  return group
}

/**
 * Terrain height at a world point — the same field the mesh was built from, evaluated on
 * demand. Used to place scatter, and to keep anything that walks on the ground *on* it.
 */
export function terrainHeight(x, z, planet) {
  return sampleY(x, z, planet, 1337)
}

// A private terrain sampler for scatter placement — the same field the mesh was built from.
const _samplers = new Map()
function sampleY(x, z, planet, seed) {
  let s = _samplers.get(planet.id)
  if (!s) {
    s = { noise: makeNoise(1337), craters: makeCraters(planet.craters, 1337) }
    _samplers.set(planet.id, s)
  }
  return sampleHeight(x, z, s.noise, s.craters, planet)
}

// ── noise ─────────────────────────────────────────────────────────────────────────────

/** Small deterministic PRNG — same seed, same world, every reload. */
export function mulberry(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Value noise on a hashed lattice with smoothstep interpolation — cheap and smooth enough. */
function makeNoise(seed) {
  const rand = mulberry(seed)
  const size = 256
  const table = new Float32Array(size * size)
  for (let i = 0; i < table.length; i++) table[i] = rand() * 2 - 1

  return function noise(x, y) {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const u = xf * xf * (3 - 2 * xf)
    const v = yf * yf * (3 - 2 * yf)
    const at = (a, b) => table[(((a % size) + size) % size) * size + (((b % size) + size) % size)]
    const a = at(xi, yi)
    const b = at(xi + 1, yi)
    const c = at(xi, yi + 1)
    const d = at(xi + 1, yi + 1)
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
  }
}

function fbm(noise, x, y, octaves) {
  let sum = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp
    norm += amp
    amp *= 0.5
    freq *= 2.07
  }
  return sum / norm
}
