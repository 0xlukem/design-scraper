import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createTimeline } from 'animejs';
import 'animejs/adapters/three';
import { createHotBrand, BRAND_TIMING as brandTime } from './hot-brand.js';

export function mountHero(root) {
const host = root.querySelector('#hero-scene');

const DURATION = 11500;
const fastOut = t => 1 - (1 - t) ** 4;
const inOut = t => t < .5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2;
const linear = t => t;
const steady = t => t * t * (3 - 2 * t);
let renderer, timeline, disposed = false;
const disposers = [];
const originalTitle = root.querySelector('h1').innerHTML;
let pageAway = false;
void boot();
async function boot() {

try {
  await document.fonts.ready;
  if (disposed) return;
  const [font, brandFont] = await Promise.all([
    new FontLoader().loadAsync('/fonts/landing/geist-650.typeface.json'),
    new FontLoader().loadAsync('/fonts/landing/archivo-black-brand.typeface.json'),
  ]);
  if (!disposed) init(font, brandFont);
} catch (error) {
  if (disposed) return;
  const message = root.querySelector('#hero-error');
  message.hidden = false;
  message.textContent = 'The 3D scene is unavailable. You can still analyze a website or explore saved designs.';
  host.dataset.error = error.message;
  root.querySelector('h1').innerHTML = originalTitle;
  root.classList.remove('scene-active');
}
}

function init(font, brandFont) {
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionPreference.matches;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5, 5, 3.5, -3.5, .1, 60);
  camera.position.set(6.4, 3.5, 10.8);
  camera.lookAt(0, -.65, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  scene.environmentIntensity = .45;
  room.dispose(); pmrem.dispose();
  const key = new THREE.DirectionalLight(0xfffbef, 2.35);
  key.position.set(-3.5, 7.5, 6); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -7; key.shadow.camera.right = 7;
  key.shadow.camera.top = 7; key.shadow.camera.bottom = -7;
  key.shadow.camera.near = .1; key.shadow.camera.far = 24;
  key.shadow.bias = -.00035; key.shadow.normalBias = .025;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe5edff, .7);
  fill.position.set(5, 2, -3); scene.add(fill);
  scene.add(new THREE.HemisphereLight(0xfaf8f0, 0x77796e, .35));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: .19 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -2.1; floor.receiveShadow = true; scene.add(floor);
  const rig = new THREE.Group(); rig.position.y = -.35; scene.add(rig);
  const marble = stoneMaterial(0xc8c4b8);
  const edgeStone = stoneMaterial(0xb9b6aa);
  const ink = new THREE.MeshPhysicalMaterial({ color: 0x1a1b18, roughness: .31, metalness: .03, clearcoat: .08 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xf4f3ee, roughness: .65 });
  const blue = new THREE.MeshPhysicalMaterial({ color: 0x0d6efd, roughness: .27, metalness: .02, clearcoat: .3 });
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xcbd0d1, metalness: 1, roughness: .15, anisotropy: .4 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x373d3d, metalness: .95, roughness: .34 });
  const layers = [];
  const layerDepth = .255;
  const pageWidth = 4.6, pageHeight = 3.05;
  const typeShapes = font.generateShapes('Aa', 1.68);
  const textBounds = new THREE.Box2();
  for (const shape of typeShapes) for (const point of shape.getPoints(12)) textBounds.expandByPoint(point);
  const typeOffset = new THREE.Vector2(-1.86 - textBounds.min.x, -.02 - textBounds.min.y);
  const translatedType = typeShapes.map(shape => moveShape(shape, typeOffset.x, typeOffset.y));
  const palettePositions = [-1.61, -.80, .01];
  for (let i = 0; i < 6; i++) {
    const shape = roundedRect(-pageWidth/2, -pageHeight/2, pageWidth, pageHeight, .095);
    if (i === 0) {
      for (const shapeType of translatedType) shape.holes.push(new THREE.Path(shapeType.getPoints(12)));
      palettePositions.forEach(x => shape.holes.push(new THREE.Path(roundedRect(x - .285, -.875, .57, .57, .035).getPoints(8))));
      shape.holes.push(new THREE.Path(roundedRect(1.13, -.98, .58, 2.15, .045).getPoints(8)));
      shape.holes.push(new THREE.Path(roundedRect(-1.92, -1.455, 2.75, .425, .055).getPoints(8)));
    }
    const mesh = extrude(shape, layerDepth, i % 2 ? edgeStone : marble, .026);
    mesh.position.z = .68 - i * .285;
    rig.add(mesh); layers.push(mesh);
    if (i === 0) {
      // Counterforms remain mineral islands inside the actual letter-shaped cavities.
      for (const shapeType of translatedType) for (const hole of shapeType.holes) {
        const island = extrude(new THREE.Shape(hole.getPoints(12)), layerDepth, marble, .012);
        mesh.add(island);
      }
    }
  }
  const aa = new THREE.Group();
  const letterMesh = extrude(translatedType, .24, [ink, marble], .012);
  aa.add(letterMesh); aa.position.z = .75; rig.add(aa);
  const pigments = palettePositions.map((x, i) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(.53, .53, .37, 3, .035), [blue, ink, marble][i]);
    mesh.position.set(x, -.59, .89); mesh.castShadow = mesh.receiveShadow = true; rig.add(mesh); return mesh;
  });
  const ruler = new THREE.Group(); ruler.position.set(1.42, .095, .78); rig.add(ruler);
  ruler.add(extrude(roundedRect(-.26, -1.025, .52, 2.05, .03), .23, [paper, chrome], .01));
  for (let i = 0; i < 12; i++) {
    const tick = box(i % 3 === 0 ? .16 : .085, .017, .009, ink, 0);
    tick.position.set(-.24 + (i % 3 === 0 ? .08 : .043), -.77 + i * .14, .244); ruler.add(tick);
  }
  const measure = word(font, '24', .16, ink, .012); measure.position.set(.035, -.90, .245); ruler.add(measure);
  const button = new THREE.Group(); button.position.set(-.545, -1.245, .80); rig.add(button);
  button.add(extrude(roundedRect(-1.335, -.18, 2.67, .36, .04), .20, [ink, marble], .015));
  const buttonLabel = word(font, 'Create', .17, paper, .012);
  buttonLabel.position.set(-.30, -.065, .22); button.add(buttonLabel);
  const websiteLabel = word(font, 'website', .105, ink, .008);
  websiteLabel.position.set(-1.91, 1.28, layerDepth + .012); layers[0].add(websiteLabel);
  const hairline = box(3.9, .011, .008, ink, 0); hairline.position.set(-.02, 1.21, layerDepth + .012); layers[0].add(hairline);
  const tool = createChisel(chrome, darkSteel); rig.add(tool);
  const toolPose = { x: 1.8, y: 1.1, z: 2.0, tilt: 0 };
  const chips = createChips(rig, marble, edgeStone, ink, blue);
  const allObjects = [];
  scene.traverse(node => { if (node.isMesh) allObjects.push(node) });
  host.dataset.meshes = String(allObjects.length);
  host.dataset.renderer = 'webgl';
  host.dataset.engine = 'three-anime';
  const clock = { ms: 0 };
  timeline = createTimeline({ autoplay: false, defaults: { ease: fastOut }, onUpdate: self => draw(self.currentTime), onComplete: () => { root.dataset.playback = 'complete' } });
  timeline.add(clock, { ms: [0, DURATION], duration: DURATION, ease: linear }, 0);
  const headline = choreographHeadline(timeline, brandFont, environment.texture);
  // Three deliberate, fast sculptor strokes. Each cut precedes its corresponding release.
  const cuts = [
    { time: 1120, point: [-1.48, .95, .98], end: [.12, .28, .98] },
    { time: 2530, point: [1.41, .84, .98], end: [1.41, -.62, .98] },
    { time: 3750, point: [-1.55, -.58, .98], end: [.16, -1.22, .98] },
  ];
  for (const {time, point, end} of cuts) {
    timeline.add(toolPose, { x: point[0] + .2, y: point[1] + .55, z: point[2] + .75, duration: 300, ease: inOut }, time - 450)
      .add(toolPose, { x: point[0], y: point[1], z: point[2] - .02, duration: 115, ease: t => t*t*t }, time - 115)
      .add(toolPose, { x: end[0], y: end[1], z: end[2], duration: 360, ease: inOut }, time)
      .add(toolPose, { y: end[1] + .45, z: end[2] + .8, duration: 220 }, time + 360);
    timeline.add(rig.rotation, { z: [0, -.012, .004, 0], duration: 280, ease: inOut }, time);
  }
  timeline.add(toolPose, { x: 3.8, y: 3.4, z: 2.8, duration: 440, ease: inOut }, 4350);
  // Insets emerge in depth, rather than appearing as overlaid interface cards.
  timeline.add(aa, { z: 2.15, y: .30, rotateY: -17, rotateZ: -8, duration: 460, ease: fastOut }, 1430)
    .add(aa, { z: 1.30, y: -.17, x: -.02, rotateY: 0, rotateZ: 0, duration: 1200, ease: inOut }, 5200);
  timeline.add(ruler, { x: 2.10, y: .65, z: 2.0, rotateZ: -15, rotateY: 20, duration: 480 }, 2880)
    .add(ruler, { x: 1.02, y: -.18, z: 1.04, rotateX: -90, rotateY: 0, rotateZ: 90, duration: 1120, ease: inOut }, 5480);
  pigments.forEach((piece, i) => {
    timeline.add(piece, { y: .35 + i*.23, z: 1.95, rotateX: 18 - i*10, rotateY: -20 + i*18, rotateZ: -18 + i*14, duration: 430 }, 4060 + i*85)
      .add(piece, { x: .63 + i*.65, y: .08, z: -.12, rotateX: 0, rotateY: 0, rotateZ: 0, duration: 1100, ease: inOut }, 5610 + i*100);
  });
  timeline.add(button, { x: -.15, y: -1.0, z: 2.0, rotateY: -10, rotateZ: 9, duration: 420 }, 4230)
    .add(button, { x: 0, y: -1.03, z: 1.57, rotateY: 0, rotateZ: 0, duration: 1200, ease: inOut }, 5650);
  layers.forEach((layer, i) => {
    timeline.add(layer, { z: .68 - i*.40, y: -.04*i, rotateY: i % 2 ? 3 : -3, duration: 430 }, 4560 + i*35)
      .add(layer, { x: -.08*i, y: -1.72 + (5-i)*.27, z: -.10 + i*.06, rotateX: -90, rotateY: 0, rotateZ: 0, scaleX: .72 + i*.056, scaleY: .72 + i*.056, duration: 1280, ease: inOut }, 5030 + i*70);
  });
  timeline.add(rig, { rotateY: 10, duration: 1900, ease: inOut }, 7150);
  timeline.add(rig, { rotateY: 6, duration: 600, ease: inOut }, 9250);
  const dustFloor = -1.72;
  function draw(time) {
    if (disposed) return;
    headline.draw(time);
    const direction = new THREE.Vector3(.28 + toolPose.tilt, 1.0, .65).normalize();
    tool.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), direction);
    tool.position.set(toolPose.x, toolPose.y, toolPose.z).addScaledVector(direction, 1.05);
    tool.visible = time < 4910;
    for (const chip of chips) {
      const elapsed = (time - chip.start) / 1000;
      chip.mesh.visible = elapsed >= 0;
      if (elapsed < 0) continue;
      const { origin: o, velocity: v } = chip;
      const g = 11;
      const hitTime = (v.y + Math.sqrt(v.y*v.y + 2*g*(o.y-dustFloor))) / g;
      let x, y, z;
      if (elapsed <= hitTime) {
        x = o.x + v.x*elapsed; y = o.y + v.y*elapsed - .5*g*elapsed*elapsed; z = o.z + v.z*elapsed;
      } else {
        const rest = Math.min(elapsed-hitTime, .6);
        x = o.x + v.x*hitTime + v.x*.15*(1-Math.exp(-rest*6));
        z = o.z + v.z*hitTime + v.z*.12*(1-Math.exp(-rest*6));
        y = dustFloor + Math.max(0, .55*rest - 4*rest*rest);
      }
      chip.mesh.position.set(x,y,z);
      const turn = Math.min(elapsed,hitTime+.26);
      chip.mesh.rotation.set(chip.spin.x*turn,chip.spin.y*turn,chip.spin.z*turn);
    }
    renderer.render(scene,camera);
    const phase = time < 1000 ? 'object' : time < 1430 ? 'contact' : time < 5030 ? 'extraction' : time < 7000 ? 'assembly' : 'resolution';
    host.dataset.phase = phase;
    root.dataset.phase = phase;
    host.dataset.time = String(Math.round(time));
    host.dataset.triangles = String(renderer.info.render.triangles);
  }
  function resize() {
    const {width,height} = host.getBoundingClientRect();
    const aspect = width/height;
    const vertical = 5.2;
    camera.left = -vertical*aspect/2; camera.right = vertical*aspect/2;
    camera.top = vertical/2; camera.bottom = -vertical/2;
    camera.updateProjectionMatrix(); renderer.setSize(width,height,false);
    headline.resize();
    draw(timeline?.currentTime || 0);
  }
  let inView = false, contextLost = false, cycle = 0;
  root.dataset.cycle = String(cycle);
  const sync = () => {
    if (reducedMotion) { timeline.pause(); timeline.seek(DURATION); draw(DURATION); }
    else if (contextLost || pageAway || document.hidden || !inView) timeline.pause();
    else if (timeline.currentTime < DURATION) timeline.resume();
    root.dataset.playback = reducedMotion ? 'still' : timeline.currentTime >= DURATION ? 'complete' : timeline.paused ? 'paused' : 'playing';
  };
  const preference = event => { reducedMotion = event.matches; if (!reducedMotion) timeline.seek(0); sync(); };
  motionPreference.addEventListener('change',preference); document.addEventListener('visibilitychange',sync);
  const observer = new ResizeObserver(resize); observer.observe(host);
  const visibility = new IntersectionObserver(([entry]) => {
    const entered = entry.isIntersecting && entry.intersectionRatio >= .15;
    if (entered && !inView && !reducedMotion && timeline.currentTime >= DURATION) {
      cycle++; root.dataset.cycle = String(cycle); timeline.seek(0);
    }
    inView = entered; sync();
  }, {threshold:[0,.15]}); visibility.observe(root);
  const lost = event => {event.preventDefault();contextLost=true;sync();root.querySelector('#hero-error').hidden=false;root.querySelector('#hero-error').textContent='The browser lost its 3D context. Reload the page to view the scene.'};
  renderer.domElement.addEventListener('webglcontextlost',lost);
  resize();
  host.dataset.ready = 'true';
  host.dataset.font = 'Geist outlines';
  root.dataset.motionReady = '';
  const pagehide = () => { pageAway=true; sync(); };
  const pageshow = () => { pageAway=false; sync(); };
  window.addEventListener('pagehide',pagehide);
  window.addEventListener('pageshow',pageshow);
  disposers.push(() => {window.removeEventListener('pagehide',pagehide);window.removeEventListener('pageshow',pageshow)});
  sync();
  disposers.push(()=>{observer.disconnect();visibility.disconnect();motionPreference.removeEventListener('change',preference);document.removeEventListener('visibilitychange',sync);renderer.domElement.removeEventListener('webglcontextlost',lost);timeline.revert();environment.dispose();const geometries=new Set(),materials=new Set();scene.traverse(node=>{if(node.geometry)geometries.add(node.geometry);if(node.material)(Array.isArray(node.material)?node.material:[node.material]).forEach(m=>materials.add(m));node.shadow?.dispose()});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove()});
}

function choreographHeadline(master, brandFont, environment) {
  // Real text throughout. A single accessible name survives the visual letter split.
  for (const line of root.querySelectorAll('.headline-line')) {
    const glyphs = [...line.textContent].map(character => {
      const glyph = document.createElement('span');
      glyph.className = character === ' ' ? 'headline-space' : 'headline-glyph';
      glyph.textContent = character === ' ' ? '\u00a0' : character;
      return glyph;
    });
    line.replaceChildren(...glyphs);
  }
  const scrape = root.querySelectorAll('.line-scrape .headline-glyph');
  const connector = root.querySelectorAll('.line-like .headline-glyph');
  const hot = root.querySelectorAll('.line-hot .headline-glyph');
  const closed = 'polygon(0% 0%, 0% 0%, -24% 100%, 0% 100%)';
  const open = 'polygon(0% 0%, 124% 0%, 100% 100%, 0% 100%)';
  scrape.forEach((glyph, i) => {
    master.add(glyph, {
      clipPath: [closed, open], translateX: [14, 0], skewX: [-9, 0],
      duration: 900, ease: steady,
    }, 100 + i * 128);
  });
  connector.forEach((glyph, i) => {
    master.add(glyph, { clipPath: [closed, open], duration: 650, ease: steady }, 780 + i * 75);
  });
  root.classList.add('scene-active');
  const brand=createHotBrand(root,brandFont,environment);
  disposers.push(()=>brand.dispose());
  master.add(brand.pose,{travel:.1,z:.10,rx:-2,ry:-2,rz:0,scale:1,duration:brandTime.arrival-brandTime.start,ease:steady},brandTime.start)
    .add(brand.pose,{travel:0,z:0,rx:0,ry:0,rz:0,scale:1,duration:brandTime.contact-brandTime.arrival,ease:steady},brandTime.arrival)
    // The face leaves its impression, lifts from the page, then retraces its vertical entry.
    .add(brand.pose,{z:.2,rx:-2,ry:-2,rz:0,duration:brandTime.lift-brandTime.release,ease:steady},brandTime.release)
    .add(brand.pose,{travel:1,z:.2,rx:-8,ry:-8,rz:-4,duration:brandTime.end-brandTime.lift,ease:steady},brandTime.lift);
  // Contact creates a sharp red impression. It stays red through withdrawal,
  // then cools directly to ink without a glow, outline or aged treatment.
  master.add(hot,{opacity:[0,1],duration:60,ease:linear},brandTime.contact+30)
    .add(hot,{color:['#e3292e','#191a17'],duration:650,ease:steady},brandTime.lift+500);
  brand.wisps.forEach((wisp,i)=>{
    master.add(wisp,{opacity:[0,.24],duration:400,ease:fastOut},brandTime.contact+60+i*110)
      .add(wisp,{opacity:0,translateY:[0,-60-i*7],translateX:[0,12-i*7],scale:[.8,1.22],duration:2300,ease:steady},brandTime.contact+460+i*110);
  });
  return brand;
}

function roundedRect(x,y,w,h,r) {
  const s=new THREE.Shape();
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;
}
function moveShape(shape,x,y) {
  const out=new THREE.Shape(shape.getPoints(12).map(p=>new THREE.Vector2(p.x+x,p.y+y)));
  out.holes=shape.holes.map(h=>new THREE.Path(h.getPoints(12).map(p=>new THREE.Vector2(p.x+x,p.y+y))));return out;
}
function extrude(shape,depth,material,bevel=.02) {
  const geometry=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:bevel>0,bevelSegments:2,steps:1,bevelSize:bevel,bevelThickness:bevel,curveSegments:8});
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=mesh.receiveShadow=true;return mesh;
}
function box(w,h,d,material,r=.02) {
  const mesh=new THREE.Mesh(r?new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/3,h/3,d/3)):new THREE.BoxGeometry(w,h,d),material);
  mesh.castShadow=mesh.receiveShadow=true;return mesh;
}
function word(font,text,size,material,depth=.01) {return extrude(font.generateShapes(text,size),depth,material,.002)}
function createChisel(chrome,darkSteel) {
  const group=new THREE.Group();
  const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.108,.108,1.42,6),chrome);shaft.position.y=.22;shaft.castShadow=true;group.add(shaft);
  const collar=new THREE.Mesh(new THREE.CylinderGeometry(.165,.15,.16,24),chrome);collar.position.y=.97;collar.castShadow=true;group.add(collar);
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(.18,.165,.055,32),darkSteel);cap.position.y=1.075;cap.castShadow=true;group.add(cap);
  for(let i=0;i<9;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(.111,.008,6,24),darkSteel);ring.rotation.x=Math.PI/2;ring.position.y=.20+i*.055;group.add(ring)}
  const points=[new THREE.Vector3(-.105,-.49,-.095),new THREE.Vector3(.105,-.49,-.095),new THREE.Vector3(.105,-.49,.095),new THREE.Vector3(-.105,-.49,.095),new THREE.Vector3(-.145,-1.05,-.015),new THREE.Vector3(.145,-1.05,-.015),new THREE.Vector3(.145,-1.05,.015),new THREE.Vector3(-.145,-1.05,.015)];
  const indices=[0,1,2,0,2,3,4,7,6,4,6,5,0,4,5,0,5,1,3,2,6,3,6,7,0,3,7,0,7,4,1,5,6,1,6,2];
  let geometry=new THREE.BufferGeometry().setFromPoints(points);geometry.setIndex(indices);geometry=geometry.toNonIndexed();geometry.computeVertexNormals();
  const blade=new THREE.Mesh(geometry,chrome);blade.castShadow=blade.receiveShadow=true;group.add(blade);return group;
}
function createChips(parent,stone,edge,ink,blue) {
  let seed=831;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
  const contact=[[-1.48,.95,1.0],[1.41,.84,1.0],[-1.55,-.58,1.0]], times=[1130,2540,3760],result=[];
  for(let burst=0;burst<3;burst++)for(let i=0;i<10;i++){
    const size=.035+random()*.095;
    const mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(1,0),i===0?blue:i===1?ink:i%2?stone:edge);
    mesh.scale.set(size*(.7+random()),size*(.4+random()),size*(.5+random()));mesh.castShadow=true;mesh.visible=false;parent.add(mesh);
    result.push({mesh,start:times[burst]+i*19,origin:new THREE.Vector3(...contact[burst]),velocity:new THREE.Vector3((random()-.35)*2.9,1.0+random()*2.7,.4+random()*2.0),spin:new THREE.Vector3(random()*9,random()*12,random()*9)});
  }return result;
}
function stoneMaterial(color) {
  const material=new THREE.MeshPhysicalMaterial({color,roughness:.53,metalness:0,clearcoat:.13,clearcoatRoughness:.28});
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 vStonePoint;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvStonePoint = position;');
    shader.fragmentShader='varying vec3 vStonePoint;\nfloat stoneHash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}\nfloat stoneNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(stoneHash(i),stoneHash(i+vec3(1,0,0)),f.x),mix(stoneHash(i+vec3(0,1,0)),stoneHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(stoneHash(i+vec3(0,0,1)),stoneHash(i+vec3(1,0,1)),f.x),mix(stoneHash(i+vec3(0,1,1)),stoneHash(i+vec3(1,1,1)),f.x),f.y),f.z);}\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nvec3 st=vStonePoint*1.4; float n=stoneNoise(st*2.)+.4*stoneNoise(st*6.); float vein=pow(1.-abs(sin(st.x*2.2+st.y*1.1+st.z*.9+n*3.5)),18.);float grain=stoneNoise(st*85.);diffuseColor.rgb *= 1.-vein*.30-(grain-.5)*.035;');
  };
  material.customProgramCacheKey=()=> 'mineral-v1';return material;
}
function dispose(){if(disposed)return;disposed=true;disposers.forEach(fn=>fn())}
return () => {dispose();root.querySelector('h1').innerHTML=originalTitle;root.classList.remove('scene-active');};
}
