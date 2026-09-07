import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry } from './planet.js'
import { buildVillage, kindsForStyle, VILLAGE_KINDS } from './village.js'
import { ATLAS, CELL, atlasTexture, cellMask, part } from './kit.js'
import { applyGrain } from './surfaces.js'

/**
 * Colony buildings — one per thread, assembled out of KayKit's *Space Base Bits* (CC0) and
 * seeded from the thread's own id, so a given session always builds the same structure on
 * every reload and on every planet.
 *
 * The pack is a modular one, which is the whole reason the ten kinds below can stay short:
 * a habitat is a base module with a roof module on it, a workshop is the garage variant
 * with a rover parked outside. Every part shares one gradient atlas, so a nine-part
 * greenhouse still merges down to a single geometry and a single draw call.
 *
 * Three things ride on top of the pack's own art:
 *
 * 1. **Construction progress sinks the building into the ground.** The vertex stage lowers
 *    the whole structure and the fragment stage discards whatever ends up below the deck, so
 *    a thread's building rises as it grows without ever touching a vertex buffer — and what
 *    is on screen is always a *complete* building, part of it buried. Slicing the top off
 *    instead, which is what this used to do, guts a kit of closed shells: at two-thirds
 *    finished a biodome loses its entire dome and becomes an empty ring.
 * 2. **The accent is a repainted atlas cell.** Kay's gold trim band is cell 11 of the 8x4
 *    atlas; the fragment stage swaps its hue for the repo's accent while keeping the
 *    swatch's own light-to-dark gradient. One repo, one colour, no extra material.
 * 3. **PBR comes from the atlas too.** Roughness and metalness are looked up per cell, so
 *    the grey structural swatch behaves like brushed metal and the solar swatch like glass
 *    even though both arrive as flat colour in a single texture.
 */

/** Shared across every building, so night falling is one uniform write for the whole colony. */
export const buildingUniforms = {
  uNight: { value: 0 },
  /** Seconds, for anything that turns. One write drives every rotor in the colony. */
  uTime: { value: 0 },
}

/**
 * Every structure is authored on the pack's 2-unit module grid and scaled once, here.
 *
 * The number is set against the crew, not the plot: an astronaut is about 1.1 units tall,
 * and a habitat you can see over is not a habitat. At 1.45 a base module clears the crew's
 * heads and a mast is three of them, while the widest footprint still leaves a walkable
 * gap at the plot's 4.4-unit slot spacing.
 */
/**
 * Village geometry is authored in metres — a townhouse is about three units across — where
 * the space kit it replaced was authored on the pack's own module grid and needed scaling up
 * by nearly half. Building slots sit roughly four and a half units apart, so anything much
 * over three across starts overlapping its neighbour's roof, and these roofs overhang.
 */
/**
 * Village geometry is authored in metres — a townhouse is about three units across — and
 * then trimmed to fit seven of them round one cell with room to walk between.
 *
 * The number is set by navigation, not by looks. Seven slots sit on a ring about four and a
 * half units across, so two neighbours have that much between their centres; a building
 * whose no-go radius is much over one and a third leaves no gap at all, and a deck with no
 * gaps is a deck the crew cannot cross. At full size the plots measured sixty-five per cent
 * impassable and characters could barely leave their own slot.
 */
/**
 * A thread's building, against the city it stands in.
 *
 * Matched to `SCENERY_SCALE` on purpose. These now sit *in* the terrace rather than on an
 * empty street of their own, and a house four fifths the height of the two either side of it
 * does not read as important — it reads as a mistake in the model. What marks a thread out is
 * its badge, its resident and its door, none of which the terrace has.
 */
const BUILDING_SCALE = 0.95

/** The top face of a base module — where roof modules and masts stack. */
const DECK = 1.0

/**
 * Surface response per atlas cell. The pack ships one material for everything; this is what
 * gives a colony made of it any specular variety at all under the environment map.
 *
 * Metalness is kept deliberately low almost everywhere. These are *painted* surfaces, and a
 * fully metallic one has no diffuse term at all — with only a soft sky to reflect, the grey
 * structural swatch is the largest surface in the pack and turns black the moment it is
 * treated as bare metal. A quarter is enough to pick up the horizon along an edge.
 *
 * Defaults are Kay's own (roughness 0.6, metalness 0) so an unlisted swatch still looks right.
 */
const SURFACE = {
  [CELL.WHITE]: [0.55, 0.0], // painted hull panel
  [CELL.GREY]: [0.46, 0.22], // structural frame — painted metal, not bare
  [CELL.SLATE]: [0.5, 0.3],
  [CELL.BLACK]: [0.6, 0.18],
  [CELL.ROCK]: [0.95, 0.0], // regolith and terrain chunks — never shiny
  [CELL.TRIM]: [0.42, 0.08], // painted trim, semi-gloss
  [CELL.RED]: [0.55, 0.04],
  [CELL.SOLAR_A]: [0.16, 0.7], // photovoltaic glass, and dark on purpose
  [CELL.SOLAR_B]: [0.16, 0.7],
}

const CELL_COUNT = ATLAS.cols * ATLAS.rows
const ROUGHNESS = new Float32Array(CELL_COUNT).fill(0.6)
const METALNESS = new Float32Array(CELL_COUNT).fill(0.0)
for (const [cell, [r, m]] of Object.entries(SURFACE)) {
  ROUGHNESS[cell] = r
  METALNESS[cell] = m
}

/** The one swatch the accent repaints, and the one that lights up after dark. */
const ACCENT_MASK = cellMask([CELL.TRIM])

// ── composition ───────────────────────────────────────────────────────────────────────

/**
 * A tiny placement helper. Parts are baked to the building's own frame as they are added,
 * each carrying a per-vertex emissive flag, so the whole lot merges into one buffer.
 */
class Composer {
  constructor() {
    this.parts = []
  }

  /**
   * @param {string} name  a node name from the kit
   * @param {object} [o]   `x`/`y`/`z` offset, `ry` yaw, `s` uniform scale, `emissive` 0..1
   */
  add(name, o = {}) {
    const geo = part(name, 'base', { solo: o.solo })
    const s = o.s ?? 1
    if (s !== 1) geo.scale(s, s, s)
    if (o.ry) geo.rotateY(o.ry)
    geo.translate(o.x || 0, o.y || 0, o.z || 0)

    const count = geo.attributes.position.count
    geo.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(count).fill(o.emissive || 0), 1))

    // Rotors turn in the vertex shader rather than as child meshes, so a turbine is still
    // one merged geometry and one draw call. Each spinning vertex carries the hub it turns
    // about and how fast, which is what lets one building hold several of them.
    const rate = o.spin || 0
    const spin = new Float32Array(count).fill(rate)
    const pivot = new Float32Array(count * 3)
    if (rate) {
      for (let i = 0; i < count; i++) {
        pivot[i * 3] = o.x || 0
        pivot[i * 3 + 1] = o.y || 0
        pivot[i * 3 + 2] = o.z || 0
      }
    }
    geo.setAttribute('aSpin', new THREE.BufferAttribute(spin, 1))
    geo.setAttribute('aPivot', new THREE.BufferAttribute(pivot, 3))

    this.parts.push(geo)
    return this
  }

  /** Scatter `count` copies of a part around a ring, jittered so it never reads as a pattern. */
  ring(name, count, radius, rand, o = {}) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.5
      const r = radius * (0.85 + rand() * 0.3)
      this.add(name, { ...o, x: Math.cos(a) * r, z: Math.sin(a) * r, ry: a + Math.PI / 2 })
    }
    return this
  }

  finish() {
    const merged = BufferGeometryUtils.mergeGeometries(this.parts, false)
    for (const p of this.parts) p.dispose()
    merged.computeBoundingBox()
    return merged
  }
}

const pick = (rand, list) => list[Math.floor(rand() * list.length)]

// ── the building catalogue ────────────────────────────────────────────────────────────

/**
 * Each generator gets a placer, a seeded RNG and the repo's accent. They stay deliberately
 * varied in silhouette — dome, mast, slab, derrick — so a plot full of them reads as a town
 * rather than a row of the same shed.
 */
const KINDS = {
  habitat(c, rand) {
    c.add(pick(rand, ['basemodule_A', 'basemodule_B', 'basemodule_C', 'basemodule_D']))
    c.add(pick(rand, ['roofmodule_base', 'roofmodule_cargo_A', 'roofmodule_cargo_B']), { y: DECK })
    if (rand() > 0.45) c.add('lights', { x: 1.15, z: 0.85, s: 0.85, ry: rand() * 6.28 })
    if (rand() > 0.6) c.add('containers_A', { x: -1.15, z: 0.9, ry: rand() * 6.28 })
    return 'Habitat'
  },

  solar(c, rand) {
    const cols = 2 + Math.floor(rand() * 2)
    const rows = 2 + Math.floor(rand() * 2)
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        c.add('solarpanel', {
          x: (i - (cols - 1) / 2) * 1.05,
          z: (j - (rows - 1) / 2) * 0.62,
          // A whole field tilted the same way is what makes an array read as an array.
          ry: 0.06 * (rand() - 0.5),
        })
      }
    }
    c.add('lights', { x: cols * 0.6, z: -rows * 0.4, s: 0.8 })
    c.add('containers_B', { x: -cols * 0.6, z: rows * 0.35, ry: 0.4 })
    return 'Solar array'
  },

  antenna(c, rand) {
    // The tall turbine mast — the only silhouette in the pack that breaks the skyline. The
    // tower is taken *solo* so the rotor can be put back on as a part that turns.
    const tall = rand() > 0.3
    const [tower, hub] = tall ? ['windturbine_tall', 2.05] : ['windturbine_low', 0.89]
    c.add(tower, { solo: true })
    // Slow: a turbine that whips round reads as a desk fan. A little over half a minute a
    // turn, jittered so a row of them never falls into step.
    c.add(`${tower}_fan`, { y: hub, spin: 0.17 + rand() * 0.09 })
    c.add('containers_C', { x: 0.9, z: 0.75, ry: rand() * 6.28 })
    if (rand() > 0.5) c.add('lights', { x: -0.95, z: -0.7, s: 0.8 })
    return 'Relay mast'
  },

  silo(c, rand) {
    c.add(pick(rand, ['cargodepot_A', 'cargodepot_B', 'cargodepot_C']))
    if (rand() > 0.5) c.add(pick(rand, ['cargo_A_stacked', 'cargo_B_stacked']), { x: 1.35, z: 0.4, ry: rand() * 6.28 })
    return 'Storage'
  },

  greenhouse(c, rand) {
    // The geodesic-topped module — the pack's own biodome.
    c.add('basemodule_E')
    c.ring('containers_D', 2 + Math.floor(rand() * 2), 1.45, rand)
    return 'Greenhouse'
  },

  reactor(c, rand) {
    c.add('drill_structure')
    c.ring('cargo_A', 3, 1.35, rand)
    if (rand() > 0.5) c.add('lights', { x: -1.2, z: 1.0, s: 0.9 })
    return 'Reactor'
  },

  tower(c, rand) {
    c.add('structure_tall')
    c.add('lights', { y: 2.0, s: 0.7 })
    if (rand() > 0.5) c.add('containers_A', { x: 1.15, z: 0.95, ry: rand() * 6.28 })
    return 'Tower'
  },

  workshop(c, rand) {
    c.add('basemodule_garage')
    c.add('roofmodule_solarpanels', { y: DECK })
    // Something parked outside: an empty forecourt reads as unfinished.
    if (rand() > 0.3) {
      c.add(pick(rand, ['spacetruck', 'spacetruck_large']), { x: 1.55, z: 0.3, ry: Math.PI / 2 + (rand() - 0.5) * 0.5 })
    }
    if (rand() > 0.5) c.add('spacetruck_trailer', { x: 1.55, z: 1.35, ry: Math.PI / 2 })
    return 'Workshop'
  },

  pad(c, rand) {
    c.add(rand() > 0.35 ? 'landingpad_large' : 'landingpad_small')
    if (rand() > 0.4) c.add(pick(rand, ['lander_A', 'lander_B']), { y: 0.5, ry: rand() * 6.28 })
    else c.add('lander_base', { y: 0.5, ry: rand() * 6.28 })
    return 'Landing pad'
  },

  lab(c, rand) {
    c.add(pick(rand, ['basemodule_C', 'basemodule_A']))
    c.add('roofmodule_cargo_C', { y: DECK })
    c.ring(pick(rand, ['containers_B', 'containers_C']), 2, 1.4, rand)
    return 'Lab'
  },
}

const KIND_IDS = Object.keys(KINDS)

// ── the reveal shader ─────────────────────────────────────────────────────────────────

/**
 * Everything the atlas makes possible, in one `onBeforeCompile`.
 *
 * Progress lowers the building and discards whatever falls below ground, with the band just
 * above that line painted in the accent — the "under construction" glow.
 * The accent also replaces the gold trim swatch outright, and per-cell roughness and
 * metalness turn one flat texture into a surface with metal, paint and glass in it.
 */
function decorate(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aEmissive;
         attribute float aSpin;
         attribute vec3 aPivot;
         varying float vEmissive;
         varying vec2 vAtlasUv;
         varying float vLocalY;
         uniform float uProgress;
         uniform float uMaxY;
         uniform float uMinY;
         uniform float uTime;

         // Turn a point about the Z axis through a hub. The pack's rotors are modelled as
         // vertical discs facing along Z, which is the axis a wind turbine actually turns on.
         vec3 botSpin( vec3 p, vec3 hub, float angle ) {
           vec3 r = p - hub;
           float s = sin( angle );
           float c = cos( angle );
           return hub + vec3( r.x * c - r.y * s, r.x * s + r.y * c, r.z );
         }`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         if ( aSpin > 0.0 ) objectNormal = botSpin( objectNormal, vec3( 0.0 ), uTime * aSpin );`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vEmissive = aEmissive;
         // Our own copy of the UV: three renames its map varying between versions, and the
         // cell lookup below has to survive that.
         vAtlasUv = uv;
         if ( aSpin > 0.0 ) transformed = botSpin( transformed, aPivot, uTime * aSpin );
         // Measured *after* the rotor has turned, so a blade sweeping past the ground line
         // is revealed and hidden by the same rule as everything else.
         vLocalY = transformed.y;
         // The whole structure is lowered into the ground, and the fragment stage throws
         // away whatever ends up below the deck. What is on screen is therefore always a
         // *complete* building, part of it buried — never a sliced one.
         transformed.y -= ( 1.0 - uProgress ) * ( uMaxY - uMinY );`
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying float vEmissive;
         varying vec2 vAtlasUv;
         varying float vLocalY;
         uniform float uProgress;
         uniform float uMaxY;
         uniform float uMinY;
         uniform vec3 uAccent;
         uniform float uNight;
         uniform float uCellAccent[ ${CELL_COUNT} ];
         uniform float uCellRoughness[ ${CELL_COUNT} ];
         uniform float uCellMetalness[ ${CELL_COUNT} ];

         // Which swatch of the 8x4 gradient atlas this fragment landed in.
         int atlasCell() {
           int cx = int( clamp( floor( vAtlasUv.x * ${ATLAS.cols}.0 ), 0.0, ${ATLAS.cols - 1}.0 ) );
           int cy = int( clamp( floor( vAtlasUv.y * ${ATLAS.rows}.0 ), 0.0, ${ATLAS.rows - 1}.0 ) );
           return cy * ${ATLAS.cols} + cx;
         }`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         // Ground level, in the building's own frame, as it sinks. Measured from the
         // geometry's real floor rather than from zero: a few parts of the kit — a rover's
         // wheels, a crate's skids — sit a little proud of it, and testing against zero
         // would cut them off a building that is otherwise finished.
         float ground = uMinY + ( 1.0 - uProgress ) * ( uMaxY - uMinY );
         if ( vLocalY < ground - 0.001 ) discard;
         int cell = atlasCell();`
      )
      // The accent repaint. Luminance carries the swatch's own gradient across, so the trim
      // keeps its shading instead of going flat the moment it changes colour.
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float accentAmount = uCellAccent[ cell ];
         if ( accentAmount > 0.0 ) {
           float lum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
           diffuseColor.rgb = mix( diffuseColor.rgb, uAccent * clamp( lum * 1.9, 0.3, 1.5 ), accentAmount );
         }`
      )
      // Per-cell PBR: painted panels, brushed metal and photovoltaic glass in one texture.
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = uCellRoughness[ cell ];')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = uCellMetalness[ cell ];')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         // Lamps and beacons, flagged per vertex when the recipe placed them.
         totalEmissiveRadiance += diffuseColor.rgb * vEmissive * ( 0.25 + uNight * 2.4 );
         // Window strips and trim come on after dark, in the repo's own colour.
         totalEmissiveRadiance += uAccent * uCellAccent[ cell ] * uNight * 1.15;
         // The construction line: a bright band riding just above the ground it rises from.
         float band = 1.0 - smoothstep( 0.0, 0.22, vLocalY - ground );
         totalEmissiveRadiance += uAccent * band * ( 1.0 - step( 0.999, uProgress ) ) * 1.5;`
      )
  }
  return material
}

/**
 * Shadows are rendered with three's own depth material, which knows nothing about the
 * sink — so without this a building at ten percent still casts its finished silhouette from
 * its finished position. The depth pass gets the same offset and the same discard, reading
 * the very same uniform objects.
 */
function depthMaterial(uniforms) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aSpin;
         attribute vec3 aPivot;
         varying float vLocalY;
         uniform float uProgress;
         uniform float uMaxY;
         uniform float uMinY;
         uniform float uTime;

         vec3 botSpin( vec3 p, vec3 hub, float angle ) {
           vec3 r = p - hub;
           float s = sin( angle );
           float c = cos( angle );
           return hub + vec3( r.x * c - r.y * s, r.x * s + r.y * c, r.z );
         }`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         if ( aSpin > 0.0 ) transformed = botSpin( transformed, aPivot, uTime * aSpin );
         vLocalY = transformed.y;
         transformed.y -= ( 1.0 - uProgress ) * ( uMaxY - uMinY );`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying float vLocalY;
         uniform float uProgress;
         uniform float uMaxY;
         uniform float uMinY;`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         if ( vLocalY < uMinY + ( 1.0 - uProgress ) * ( uMaxY - uMinY ) - 0.001 ) discard;`
      )
  }
  return mat
}

/**
 * Build one structure. `seed` is derived from the thread id, so the same session always
 * gets the same building; `kind` can be forced, otherwise the seed picks it.
 *
 * Requires `loadKit()` to have resolved — boot awaits it before the first roster arrives.
 */
/**
 * A village building, sunk into the ground by its own progress.
 *
 * This replaced a version that assembled space-kit modules out of a texture atlas, and the
 * change is bigger than it looks: the old material read roughness, metalness and the accent
 * repaint out of *which cell of the atlas* a fragment landed in, none of which exists here.
 * Village geometry is vertex-coloured and carries its own per-vertex roughness/metalness in
 * `aSurface`, so it needs its own decorator — `decorateVillage` below — while keeping the
 * reveal behaviour identical, because the reveal is the part that carries meaning.
 *
 * That reveal is worth restating: progress *lowers the whole building into the ground* and
 * the fragment stage throws away whatever ends up below the deck. What is on screen is
 * always a complete building, part of it buried. Slicing the top off instead would gut every
 * closed shell in the set and turn a half-finished roof into an empty ring.
 */
export function createBuilding({ seed = 1, accent = 0xc96442, kind = null, style = 'sakura', fill = 0.6 } = {}) {
  const rand = mulberry(seed)
  // The world decides which kinds are on the table; the thread id decides which of them it
  // gets. Drawn from the world's own list rather than filtered out of the full catalogue,
  // so a world can weight a kind by naming it twice — a street of Neo-Akihabara is mostly
  // blocks and arcades because its list says so.
  const catalogue = kindsForStyle(style)
  const chosen = kind && VILLAGE_KINDS[kind] ? kind : catalogue[Math.floor(rand() * catalogue.length)]

  const built = buildVillage(chosen, rand, accent, style, { fill })
  const geo = built.geometry
  geo.scale(BUILDING_SCALE, BUILDING_SCALE, BUILDING_SCALE)
  geo.computeBoundingBox()
  const height = geo.boundingBox.max.y
  /**
   * The footprint the generator declared, not the one the bounding box implies.
   *
   * They are very different numbers for this architecture, and taking the wrong one nearly
   * broke the colony. These roofs overhang their walls by up to seven-tenths of a unit on
   * every side, so a bounding box round a house is close to twice the width of the house —
   * and that number goes straight into the navigation grid as a no-go circle. Measured that
   * way, sixty-five per cent of every deck was impassable: characters could not walk under
   * an eave, could barely leave their own slot, and a player warped onto a plot could end up
   * with four of eight directions blocked and no route out.
   *
   * Each generator returns the radius it actually wants kept clear, which is its walls plus
   * a little. Eaves are for walking under.
   */
  const footprint = built.footprint * BUILDING_SCALE

  // One uniform block, shared by the surface pass and the shadow pass.
  const uniforms = {
    uProgress: { value: 1 },
    uMaxY: { value: height },
    uMinY: { value: geo.boundingBox.min.y },
    uAccent: { value: new THREE.Color(accent) },
    uNight: buildingUniforms.uNight,
    uTime: buildingUniforms.uTime,
    /** 0 shut, 1 fully open: how far the roof has lifted off. See `setOpen`. */
    uOpen: { value: 0 },
    uLift: { value: Math.max(1.6, height * 0.55) },
  }

  const material = decorateVillage(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0,
      emissive: 0x000000, // additions in the shader are the only emission
      // Single-sided. Every one of these is a stack of closed boxes, which puts a floor and
      // the ceiling under it in the same plane all over the village: drawn double-sided,
      // both halves of each such pair rasterise at identical depth and the winner is
      // decided by floating-point noise, which is a whole street of flickering surfaces.
      side: THREE.FrontSide,
    }),
    uniforms
  )

  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  const depth = villageDepthMaterial(uniforms)
  depth.side = THREE.BackSide
  mesh.customDepthMaterial = depth

  mesh.userData.kind = chosen
  mesh.userData.label = built.label
  mesh.userData.height = height
  mesh.userData.footprint = footprint
  mesh.userData.uniforms = uniforms
  /**
   * The interior, and the roof that comes off to show it.
   *
   * Kept as a second mesh rather than as more triangles in the first, because it is hidden
   * almost all of the time — one `visible = false` costs nothing, where the same geometry
   * merged into the shell would be transformed and rasterised for every building in the
   * colony forever.
   */
  if (built.interior) {
    // Scaled exactly like the shell, because it is the inside of the shell.
    built.interior.scale(BUILDING_SCALE, BUILDING_SCALE, BUILDING_SCALE)
    const room = new THREE.Mesh(built.interior, decorateVillage(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.85,
        metalness: 0,
        emissive: 0x000000,
        // Double-sided: you are looking at the *inside* of a room, and half of what is in
        // here — mats, the wall scroll, the back of the shelf — faces away from you.
        side: THREE.DoubleSide,
      }),
      uniforms
    ))
    room.castShadow = false
    room.receiveShadow = true
    room.visible = false
    mesh.add(room)
    mesh.userData.room = room
    mesh.userData.door = (built.door || 1) * BUILDING_SCALE
    // How far in to stand when you walk through. Measured off the room rather than the
    // shell, because the room is the thing you are standing in.
    built.interior.computeBoundingBox()
    mesh.userData.roomDepth = Math.abs(built.interior.boundingBox.max.z)
  }

  mesh.userData.open = 0
  /**
   * Open the building up, or shut it.
   *
   * The roof lifts rather than vanishing, and it lifts rather than fading because a roof
   * that fades reads as a rendering fault while a roof that rises reads as somebody taking
   * the lid off — which is exactly the doll's-house feeling this is after.
   */
  mesh.userData.setOpen = (t) => {
    const v = THREE.MathUtils.clamp(t, 0, 1)
    mesh.userData.open = v
    uniforms.uOpen.value = v
    if (mesh.userData.room) mesh.userData.room.visible = v > 0.02
  }

  mesh.userData.progress = 1
  mesh.userData.setProgress = (p) => {
    const v = THREE.MathUtils.clamp(p, 0, 1)
    mesh.userData.progress = v
    uniforms.uProgress.value = v
    mesh.visible = v > 0.02
  }

  return mesh
}

/**
 * The village material: the same sink-and-discard reveal as before, over vertex colours and
 * per-vertex surface properties instead of atlas cells.
 *
 * The one thing kept from the old accent logic is the *construction band* — a bright line in
 * the repo's colour riding just above the ground a building is rising out of. It is the only
 * signal that says "somebody is at this site right now", and it reads from across the map.
 */
function decorateVillage(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec2 aSurface;
         attribute float aRoof;
         varying vec2 vSurface;
         varying float vLocalY;
         varying float vRoof;
         uniform float uProgress;
         uniform float uMaxY;
         uniform float uMinY;
         uniform float uOpen;
         uniform float uLift;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vSurface = aSurface;
         vRoof = aRoof;
         // Exactly 1 is roof. The room is tagged 2 and must not lift with the lid.
         float isRoof = step( 0.5, aRoof ) * step( aRoof, 1.5 );
         // Measured before the roof lifts, so opening a building never changes which of it
         // is above the construction line.
         vLocalY = transformed.y;
         // The lid comes off. Only vertices the generator flagged as roof move, and they
         // move together, so the roof stays a rigid object rather than stretching.
         transformed.y += isRoof * uOpen * uLift;
         transformed.y -= ( 1.0 - uProgress ) * ( uMaxY - uMinY );`
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec2 vSurface;
         varying float vLocalY;
         varying float vRoof;
         uniform float uProgress;
         uniform float uMaxY;
         uniform float uMinY;
         uniform float uOpen;
         uniform vec3 uAccent;
         uniform float uNight;`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         // Ground level in the building's own frame, as it sinks. Measured from the real
         // floor rather than from zero, because a veranda post or a set of steps can sit a
         // little proud of it and testing against zero would clip them off a finished house.
         float ground = uMinY + ( 1.0 - uProgress ) * ( uMaxY - uMinY );
         if ( vLocalY < ground - 0.001 ) discard;
         /**
          * Once the lid is off, the walls stand down and the room takes over.
          *
          * A house you can see into needs its near wall gone, and picking *which* wall is
          * near means knowing where the camera is — per fragment, every frame, for every
          * building. Dropping the shell's walls entirely is the same result for one
          * comparison: the interior brings three walls of its own, so what you are left
          * looking at is a doll's-house cutaway with the roof floating over it.
          *
          * Roof fragments are exempt, which is what keeps the lifted lid visible above.
          */
         if ( vRoof < 0.5 && uOpen > 0.55 ) discard;`
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurface.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurface.y;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         // Paper glows from within after dark: this is what turns a street of houses into a
         // street of *lit* houses, and it costs one luminance test.
         float paper = smoothstep( 0.72, 0.9, dot( diffuseColor.rgb, vec3( 0.32, 0.34, 0.2 ) ) );
         totalEmissiveRadiance += diffuseColor.rgb * paper * uNight * 0.9;
         // The construction line: a bright band riding just above the ground it rises from.
         float band = 1.0 - smoothstep( 0.0, 0.22, vLocalY - ground );
         totalEmissiveRadiance += uAccent * band * ( 1.0 - step( 0.999, uProgress ) ) * 1.5;`
      )
    // Surface grain, applied last and on its own line — it rewrites both shaders in place
    // and returns nothing, so it cannot be part of the chain above.
    applyGrain(shader)
  }
  return material
}

/**
 * Shadows use three's own depth material, which knows nothing about the sink — so without
 * this a building at ten percent still casts its finished silhouette from its finished
 * position. The depth pass gets the same offset and the same discard, reading the very same
 * uniform objects.
 */
function villageDepthMaterial(uniforms) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aRoof;
         varying float vLocalY;
         varying float vRoof;
         uniform float uProgress;
         uniform float uMaxY;
         uniform float uMinY;
         uniform float uOpen;
         uniform float uLift;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vLocalY = transformed.y;
         vRoof = aRoof;
         float isRoof = step( 0.5, aRoof ) * step( aRoof, 1.5 );
         // The shadow has to lift with the roof, or an opened house keeps casting a closed
         // one on the ground beside it.
         transformed.y += isRoof * uOpen * uLift;
         transformed.y -= ( 1.0 - uProgress ) * ( uMaxY - uMinY );`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying float vLocalY;
         varying float vRoof;
         uniform float uProgress;
         uniform float uMaxY;
         uniform float uMinY;
         uniform float uOpen;`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         float ground = uMinY + ( 1.0 - uProgress ) * ( uMaxY - uMinY );
         if ( vLocalY < ground - 0.001 ) discard;
         // A lifted roof stops casting. Moving it up was not enough on its own: it hangs
         // directly over the room it came off, so the room stayed in its shadow and looking
         // into an opened house showed a dark box. Once the lid is off it is scenery, and
         // scenery that shades the one thing you opened it to see is worse than no lid.
         if ( vRoof > 0.5 && vRoof < 1.5 && uOpen > 0.35 ) discard;`
      )
  }
  return mat
}

/** Scaffolding around anything still going up. One instanced mesh for the whole colony. */
export class Scaffolds {
  constructor(scene, capacity = 256) {
    const geo = new THREE.CylinderGeometry(0.045, 0.045, 1, 5)
    geo.translate(0, 0.5, 0) // pivot at the foot, so scaling grows it upward
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xb08d52, roughness: 0.85, flatShading: true }),
      capacity
    )
    this.mesh.castShadow = true
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(this.mesh)
    this.scene = scene
    this.capacity = capacity
    this._dummy = new THREE.Object3D()
  }

  /** `sites` are `{ x, y, z, radius, height }` for every building not yet finished. */
  update(sites) {
    const d = this._dummy
    let n = 0
    for (const site of sites) {
      for (let i = 0; i < 4 && n < this.capacity; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.78
        d.position.set(site.x + Math.cos(a) * site.radius, site.y, site.z + Math.sin(a) * site.radius)
        d.rotation.set(0, a, 0)
        d.scale.set(1, Math.max(0.4, site.height), 1)
        d.updateMatrix()
        this.mesh.setMatrixAt(n++, d.matrix)
      }
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.scene.remove(this.mesh)
  }
}
