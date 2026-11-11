import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { createTimeline } from 'animejs'
import { makePaperInk } from './proof-art.js'

export function createProofPress(host, canvas, labels, mode) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.setClearColor(0, 0)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = .98
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 70)
  const room = new RoomEnvironment()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const environment = pmrem.fromScene(room, .055)
  scene.environment = environment.texture
  scene.environmentIntensity = .74
  room.dispose()
  pmrem.dispose()

  const aluminum = new THREE.MeshStandardMaterial({ color: 0x969b95, metalness: .78, roughness: .39 })
  const machined = new THREE.MeshStandardMaterial({ color: 0xa8afa9, metalness: .90, roughness: .28 })
  const graphite = new THREE.MeshStandardMaterial({ color: 0x30312e, metalness: .48, roughness: .42 })
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1b1c19, metalness: .09, roughness: .67 })
  const slot = new THREE.MeshStandardMaterial({ color: 0x10110e, roughness: .74 })
  let ink = makePaperInk(labels, mode)
  const paper = new THREE.MeshStandardMaterial({ color: 0xffffff, map: ink.texture, side: THREE.DoubleSide, roughness: .97, metalness: 0, envMapIntensity: .25 })
  const mutedContact = new THREE.ShadowMaterial({ opacity: .145 })
  const press = new THREE.Group()
  const roll = new THREE.Group()
  scene.add(press)
  press.add(roll)
  const paperGeometry = new THREE.PlaneGeometry(1, 1, 40, 32)
  const page = new THREE.Mesh(paperGeometry, paper)
  page.castShadow = page.receiveShadow = true
  scene.add(page)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), mutedContact)
  floor.position.z = -.12
  floor.receiveShadow = true
  scene.add(floor)
  const sun = new THREE.DirectionalLight(0xfffaf1, 1.8)
  sun.position.set(-4, 5.5, 16)
  sun.shadow.radius = 3.6
  sun.castShadow = true
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, far: 36 })
  sun.target.position.y = -3
  scene.add(sun.target)
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.bias = -.0005
  sun.shadow.normalBias = .015
  scene.add(sun, new THREE.HemisphereLight(0xf6f7f5, 0xd2d0c8, 1.14))

  let narrow, sheetAspect, paperWidth, sheetLength
  let lastFeed = -1
  const pose = { feed: .10, plate: 0, step0: 0, step1: 0, step2: 0 }
  const timeline = createTimeline({ autoplay: false, defaults: { ease: 'linear' } })
    .add(pose, { feed: [.10, 1], duration: 345, ease: 'inOutSine' }, 0)
    .add(pose, { plate: [0, 1], duration: 220 }, 115)
    .add(pose, { step0: [0, 1], duration: 155 }, 355)
    .add(pose, { step1: [0, 1], duration: 155 }, 565)
    .add(pose, { step2: [0, 1], duration: 155 }, 775)

  function mesh(group, geometry, material, x, y, z) {
    const part = new THREE.Mesh(geometry, material)
    part.position.set(x, y, z)
    part.castShadow = part.receiveShadow = true
    group.add(part)
    return part
  }
  function cylinder(group, material, x, y, z, radius, length, sides = 64) {
    const part = mesh(group, new THREE.CylinderGeometry(radius, radius, length, sides), material, x, y, z)
    part.rotation.z = Math.PI / 2
    return part
  }
  function box(group, material, x, y, z, w, d, h, radius = .025) {
    return mesh(group, new RoundedBoxGeometry(w, d, h, 2, radius), material, x, y, z)
  }
  // The same press has a shorter platen for the portrait proof.
  function rebuildRoller() {
    press.traverse(child => child.geometry?.dispose())
    press.clear()
    roll.clear()
    press.add(roll)
    const scale = narrow ? .58 : .76
    press.scale.setScalar(scale)
    const rollerWidth = paperWidth / scale
    const half = rollerWidth / 2
    const radius = .37
    const center = radius + .105
    roll.position.set(0, 0, center)
    cylinder(roll, aluminum, 0, 0, 0, radius, rollerWidth + .04)
    for (const side of [-1, 1]) {
      const x = side * (half + .21)
      box(press, graphite, x, .1, .2, .46, .92, .44, .072)
      box(press, rubber, x, .13, -.008, .53, .85, .095, .035)
      cylinder(press, graphite, x, 0, center, radius * 1.12, .34)
      cylinder(press, machined, side * (half + .425), 0, center, radius * .77, .13)
      cylinder(press, graphite, side * (half + .525), 0, center, radius * .55, .10, 12)
      cylinder(press, machined, side * (half + .584), 0, center, radius * .20, .032, 6)
      cylinder(roll, machined, side * (half - .09), 0, 0, radius * 1.015, .14)
      for (let i = 0; i < 3; i++) cylinder(roll, graphite, side * (half - .18 - .06 * i), 0, 0, radius * 1.004, .014)
      const fastener = mesh(press, new THREE.CylinderGeometry(.051, .051, .022, 16), machined, x, -.255, .43)
      fastener.rotation.x = Math.PI / 2
      box(press, slot, x, -.255, .443, .062, .008, .005, .002)
    }
    // A narrow scribe on the rotating metal makes the sheet feed visible.
    box(roll, machined, 0, radius * .62, radius * .78, rollerWidth * .91, .014, .014, .003)
    box(press, graphite, 0, .4, .13, rollerWidth + .31, .85, .26, .055)
    box(press, machined, 0, .78, .28, rollerWidth + .12, .135, .12)
    for (const side of [-1, 1]) box(press, rubber, side * (half + .13), .46, .16, .28, .85, .29, .045)
  }
  function advancePaper(feed) {
    if (lastFeed === feed) return
    lastFeed = feed
    // A little overrun lets the trailing edge clear the roller in the final pose.
    const clearance = press.scale.y * .65
    const travel = (sheetLength + clearance) * feed
    const extent = Math.min(travel, sheetLength)
    const top = extent - travel
    const position = paperGeometry.getAttribute('position')
    const uv = paperGeometry.getAttribute('uv')
    // Show just the length that has passed the nip, at the paper's true scale.
    ink.texture.repeat.y = extent / sheetLength
    for (let i = 0; i < position.count; i++) {
      const u = uv.getX(i), t = 1 - uv.getY(i)
      const y = top - extent * t
      const nip = Math.exp(5 * y) * .085
      const lift = t ** 6 * (.035 + u ** 3 * .15) * (1 + .8 * (1 - feed))
      position.setXYZ(i, (u - .5) * paperWidth, y, .018 + nip + lift)
    }
    position.needsUpdate = true
    paperGeometry.computeVertexNormals()
    paperGeometry.computeBoundingSphere()
    roll.rotation.x = -travel / (.37 * press.scale.y)
    renderer.shadowMap.needsUpdate = true
  }
  function render(progress) {
    if (narrow === undefined) return
    timeline.seek(progress * 1000, true)
    advancePaper(pose.feed)
    ink.update(pose)
    host.dataset.ink = pose.plate.toFixed(3)
    host.dataset.printed = String([pose.step0, pose.step1, pose.step2].filter(value => value >= .999).length)
    renderer.render(scene, camera)
  }

  function frameFullSheet(aspect) {
    // A near-front elevation keeps type and measurements true while the grazing
    // angle on the roller and the lifted edge still describe a physical object.
    camera.position.set(.75, -2.6, 17)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const bounds = new THREE.Box3().setFromObject(press)
    bounds.expandByPoint(new THREE.Vector3(-paperWidth / 2, -sheetLength - .65 * press.scale.y, -.12))
    bounds.expandByPoint(new THREE.Vector3(paperWidth / 2, 0, .22))
    const screen = new THREE.Box3()
    const corner = new THREE.Vector3()
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          screen.expandByPoint(corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse))
        }
      }
    }
    const size = screen.getSize(new THREE.Vector3())
    const center = screen.getCenter(new THREE.Vector3())
    const height = Math.max(size.y / .92, size.x / (aspect * .95))
    const width = height * aspect
    camera.left = center.x - width / 2
    camera.right = center.x + width / 2
    camera.top = center.y + height / 2
    camera.bottom = center.y - height / 2
    camera.updateProjectionMatrix()
  }
  function resize(width, height) {
    const aspect = width / Math.max(1, height)
    const compact = aspect <= 1
    const cut = !compact ? 1.95 : aspect <= .58 ? .48 : .60
    if (cut !== sheetAspect) {
      if (narrow !== undefined) {
        // The new cut has different texture dimensions. WebGL texture storage is immutable.
        ink.texture.dispose()
        ink = makePaperInk(labels, mode)
        paper.map = ink.texture
      }
      narrow = compact
      sheetAspect = cut
      paperWidth = narrow ? 5.3 : 10.25
      sheetLength = paperWidth / sheetAspect
      ink.layout(narrow, sheetAspect)
      rebuildRoller()
      lastFeed = -1
    }
    frameFullSheet(aspect)
    // Cap the buffer as well as DPR now that this canvas fills a whole viewport.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4400000 / (width * height))))
    renderer.setSize(width, height, false)
  }
  return { render, resize, dispose() {
    timeline.cancel()
    scene.traverse(node => node.geometry?.dispose())
    for (const material of [aluminum, machined, graphite, rubber, slot, paper, mutedContact]) material.dispose()
    ink.texture.dispose()
    environment.dispose()
    sun.shadow.dispose()
    renderer.dispose()
  } }
}
