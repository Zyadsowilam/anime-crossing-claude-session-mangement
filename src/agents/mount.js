import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Something to ride.
 *
 * The map got large when the lattice opened out, and large is only good if crossing it is
 * good. Running works and takes about half a minute corner to corner, which is exactly long
 * enough to stop being a journey and start being a commute — the classic open-world problem,
 * and it has a classic answer.
 *
 * This one is a big cat, because the alternative was a vehicle and a vehicle needs a road.
 * A cat goes over the grass, fits the setting, and — the part that actually matters — is
 * *animated by its own movement*: the legs cycle from the distance travelled, so it never
 * looks like a prop being dragged along the ground. Summoning it is instant and dismissing
 * it is instant, because a mount you have to walk back to is a mount nobody uses twice.
 *
 * It is drawn as one merged, vertex-coloured mesh with the legs as separate children, so the
 * whole thing is four draw calls whether it is standing still or at a full run.
 */

const FUR = 0xc9a06b
const FUR_DARK = 0x8a6a44
const BELLY = 0xf2e2c8
const NOSE = 0xd98a8a
const EYE = 0x2b2118

/** How much faster than running. Enough to be worth summoning, not so fast it overshoots. */
export const MOUNT_SPEED = 13.5
/** Where the rider sits, above the mount's own origin. */
export const SADDLE_HEIGHT = 0.92

const paint = (geo, hex) => {
  const count = geo.attributes.position.count
  const c = new THREE.Color(hex)
  const arr = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  geo.deleteAttribute('uv')
  return geo
}

const at = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
  if (rx) geo.rotateX(rx)
  if (ry) geo.rotateY(ry)
  if (rz) geo.rotateZ(rz)
  geo.translate(x, y, z)
  return geo
}

const rounded = (w, h, d) => {
  const g = new THREE.SphereGeometry(0.5, 12, 9)
  g.scale(w, h, d)
  return g
}

export class Mount {
  constructor(scene) {
    this.scene = scene
    this.group = new THREE.Group()
    this.group.name = 'mount'
    this.group.visible = false
    scene.add(this.group)

    this.active = false
    this.phase = 0
    this._build()
  }

  _build() {
    const body = []
    // Barrel body, a little deeper at the shoulder than the hip.
    body.push(paint(at(rounded(0.78, 0.7, 1.85), 0, 0.72, 0), FUR))
    body.push(paint(at(rounded(0.6, 0.42, 0.9), 0, 0.5, 0.1), BELLY))
    // Head, muzzle and the ears that make it a cat rather than a dog.
    body.push(paint(at(rounded(0.62, 0.58, 0.6), 0, 1.05, 1.02), FUR))
    body.push(paint(at(rounded(0.34, 0.26, 0.3), 0, 0.94, 1.32), BELLY))
    body.push(paint(at(new THREE.SphereGeometry(0.075, 8, 6), 0, 0.98, 1.46), NOSE))
    for (const sx of [-1, 1]) {
      const ear = new THREE.ConeGeometry(0.19, 0.34, 4)
      body.push(paint(at(ear, sx * 0.24, 1.42, 0.98, 0, Math.PI / 4, sx * 0.22), FUR))
      body.push(paint(at(new THREE.SphereGeometry(0.07, 7, 5), sx * 0.19, 1.1, 1.28), EYE))
    }
    // Saddle blanket, so it reads as something meant to be ridden.
    body.push(paint(at(rounded(0.86, 0.16, 0.86), 0, 0.99, -0.1), FUR_DARK))

    const mesh = new THREE.Mesh(
      BufferGeometryUtils.mergeGeometries(body.map((g) => (g.index ? g.toNonIndexed() : g)), false),
      new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true })
    )
    mesh.castShadow = true
    this.group.add(mesh)
    body.forEach((g) => g.dispose())

    /**
     * The legs, as four children rather than part of the merge.
     *
     * They have to swing, and swinging means a transform per leg per frame — which is four
     * matrix writes, against the alternative of rebuilding the body's vertex buffer sixty
     * times a second. The pivot is at the shoulder, so each leg is authored hanging *below*
     * its own origin and rotates about it.
     */
    this.legs = []
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const g = paint(at(rounded(0.24, 0.62, 0.26), 0, -0.31, 0), FUR_DARK)
        const paw = paint(at(rounded(0.26, 0.18, 0.3), 0, -0.6, 0.04), BELLY)
        const leg = new THREE.Mesh(
          BufferGeometryUtils.mergeGeometries([g, paw].map((x) => (x.index ? x.toNonIndexed() : x)), false),
          new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true })
        )
        leg.castShadow = true
        leg.position.set(sx * 0.33, 0.66, sz * 0.62)
        // Diagonal pairs move together, which is what a four-legged animal actually does and
        // the reason a naive left/right split reads as a pantomime horse.
        leg.userData.offset = sx * sz > 0 ? 0 : Math.PI
        this.group.add(leg)
        this.legs.push(leg)
        g.dispose()
        paw.dispose()
      }
    }

    // The tail: three segments, each swinging a little more than the one before it.
    this.tail = []
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Mesh(
        paint(rounded(0.16 - i * 0.03, 0.16 - i * 0.03, 0.34), FUR),
        new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true })
      )
      seg.position.set(0, 0.9 + i * 0.12, -0.95 - i * 0.3)
      this.group.add(seg)
      this.tail.push(seg)
    }
  }

  /** Put it under the rider, or take it away. */
  setActive(on) {
    this.active = on
    this.group.visible = on
  }

  /**
   * Follow the rider.
   *
   * The mount is drawn *at* the player rather than simulated separately: the player is the
   * thing with collision, pathing and a position everything else already agrees on, and a
   * mount with its own physics would immediately disagree with it about where the pair
   * actually are. So this is presentation — the animation is driven by how far the player
   * genuinely travelled, which is the same number the footstep audio and the head bob use.
   */
  update(dt, player) {
    if (!this.active || !player) return
    this.group.position.set(player.pos.x, player.pos.y, player.pos.z)
    this.group.rotation.y = player.yaw

    const speed = player.groundSpeed || 0
    this.phase += dt * (1.6 + speed * 0.85)

    for (const leg of this.legs) {
      // Amplitude from speed, so a standing mount has still legs rather than idling ones.
      const swing = Math.min(0.85, speed * 0.13)
      leg.rotation.x = Math.sin(this.phase * 2 + leg.userData.offset) * swing
    }
    // A trot bounces; a stand does not.
    this.group.position.y += Math.abs(Math.sin(this.phase * 2)) * Math.min(0.09, speed * 0.014)

    this.tail.forEach((seg, i) => {
      seg.rotation.y = Math.sin(this.phase * 0.9 - i * 0.5) * 0.32
      seg.rotation.x = -0.35 + Math.sin(this.phase * 0.7 - i * 0.4) * 0.12
    })
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose()
        o.material.dispose()
      }
    })
    this.scene.remove(this.group)
  }
}
