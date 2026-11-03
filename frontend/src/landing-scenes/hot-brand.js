import * as THREE from 'three';

export const BRAND_TIMING={start:5400,arrival:6150,contact:6350,release:7850,lift:8150,end:9650,cold:10400};

// An actual extruded iron face, aligned to the live Archivo Black headline.
// It is a brief second WebGL layer; the accepted marble scene stays untouched.
export function createHotBrand(hero, font, environment) {
  const line = hero.querySelector('.line-hot');
  const letters = [...line.querySelectorAll('.headline-glyph')];
  const canvas = document.createElement('canvas');
  canvas.className = 'brand-iron'; canvas.setAttribute('aria-hidden', 'true');
  hero.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(); scene.environment = environment;
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 3000);
  const cameraDistance=1100;
  const key = new THREE.DirectionalLight(0xfff5e7, 3); key.position.set(-200, 500, 700); scene.add(key);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x35312c, 1.8));
  const iron = new THREE.Group(); scene.add(iron);
  const steel = new THREE.MeshStandardMaterial({color:0x626768,metalness:1,roughness:.28});
  const hot = new THREE.MeshStandardMaterial({color:0xff8849,emissive:0xd52c08,emissiveIntensity:1.25,metalness:.65,roughness:.34});
  const rim = new THREE.MeshStandardMaterial({color:0x77432f,emissive:0xa32207,emissiveIntensity:.52,metalness:.8,roughness:.31});
  const grip = new THREE.MeshStandardMaterial({color:0x242321,metalness:.25,roughness:.62});
  const faces = [];
  for (const letter of letters) {
    const geometry = new THREE.ExtrudeGeometry(font.generateShapes(letter.textContent, 1), {
      depth:.075, bevelEnabled:true, bevelSize:.009, bevelThickness:.009, bevelSegments:3, curveSegments:12,
    });
    // The hot contact face points into the page (-Z). The readable steel back
    // and handle face the viewer (+Z), like a real marking iron.
    geometry.clearGroups();
    const normals=geometry.attributes.normal;
    let groupStart=0,previous=-1;
    for(let i=0;i<normals.count;i+=3) {
      const normalZ=(normals.getZ(i)+normals.getZ(i+1)+normals.getZ(i+2))/3;
      const material=normalZ<-.98?0:normalZ>.98?1:2;
      if(material!==previous) {
        if(previous!==-1)geometry.addGroup(groupStart,i-groupStart,previous);
        groupStart=i;previous=material;
      }
    }
    geometry.addGroup(groupStart,normals.count-groupStart,previous);
    const mesh = new THREE.Mesh(geometry, [hot, steel, rim]); iron.add(mesh); faces.push(mesh);
  }
  function rod(a, b, radius, material) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,direction.length(),16),material);
    mesh.position.copy(start).add(end).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize()); iron.add(mesh);
    return mesh;
  }
  const backing = rod([-1,-.23,.13],[1,-.23,.13],.035,steel);
  rod([0,-.23,.13],[.35,-.20,.65],.042,steel);
  rod([.35,-.20,.65],[2.45,-.14,2.1],.042,steel);
  rod([2.45,-.14,2.1],[3.25,-.10,2.95],.105,grip);
  for (let i=0;i<6;i++) {
    const t=i/6;
    rod([2.49+.69*t,-.138+.035*t,2.15+.73*t],[2.51+.69*t,-.137+.035*t,2.17+.73*t],.112,steel);
  }
  const smoke = document.createElementNS('http://www.w3.org/2000/svg','svg');
  smoke.classList.add('brand-smoke'); smoke.setAttribute('viewBox','0 0 300 180'); smoke.setAttribute('aria-hidden','true');
  smoke.innerHTML = '<defs><filter id="smoke-soft"><feGaussianBlur stdDeviation="4"/></filter></defs><g fill="none" stroke="#737873" stroke-linecap="round" filter="url(#smoke-soft)"><path d="M35 164 C4 132 73 108 42 77 S57 30 39 9" stroke-width="12"/><path d="M94 166 C126 139 65 111 103 80 S87 33 111 11" stroke-width="10"/><path d="M151 165 C196 127 117 110 155 78 S147 33 172 12" stroke-width="15"/><path d="M203 166 C176 139 239 112 205 83 S225 38 206 16" stroke-width="11"/><path d="M260 166 C226 133 286 113 259 81 S266 35 251 15" stroke-width="11"/></g>';
  hero.append(smoke);
  const wisps = [...smoke.querySelectorAll('path')];
  const pose = {x:0,y:0,z:.2,rx:-8,ry:-8,rz:-4,scale:1,travel:1};
  let size=1, width=1, originX=0, originY=0;
  function resize() {
    const box=hero.getBoundingClientRect(), first=letters[0].getBoundingClientRect(), last=letters.at(-1).getBoundingClientRect();
    const style=getComputedStyle(letters[0]); size=parseFloat(style.fontSize);
    const context=document.createElement('canvas').getContext('2d'); context.font=`400 ${size}px "Archivo Black"`;
    const metrics=context.measureText('hot.');
    const ascent=metrics.fontBoundingBoxAscent ?? size*.9, descent=metrics.fontBoundingBoxDescent ?? size*.25;
    const baseline=first.top-box.top+(first.height-ascent-descent)/2+ascent;
    width=(last.right-first.left)/size;
    originX=first.left-box.left+width*size/2;
    originY=box.height-baseline+size*.35;
    faces.forEach((mesh,i)=>{
      const letterBox=letters[i].getBoundingClientRect();
      mesh.position.set((letterBox.left-first.left)/size-width/2,-.35,0);
    });
    backing.scale.y=width/2;
    camera.aspect=box.width/box.height;
    camera.fov=2*Math.atan(box.height/(2*cameraDistance))*180/Math.PI;
    camera.position.set(box.width/2,box.height/2,cameraDistance);
    camera.lookAt(box.width/2,box.height/2,0);
    camera.updateProjectionMatrix();
    renderer.setSize(box.width,box.height,false);
    smoke.style.left=`${first.left-box.left-size*.12}px`;
    smoke.style.top=`${baseline-size*1.4}px`;
    smoke.style.width=`${width*size+size*.24}px`;
    smoke.style.height=`${size*1.45}px`;
  }
  function draw(time) {
    const visible=time>=BRAND_TIMING.start && time<BRAND_TIMING.end;
    canvas.style.visibility=visible?'visible':'hidden';
    if(visible) {
      const verticalTravel=originY+size*.9;
      iron.position.set(originX,originY-pose.travel*verticalTravel,pose.z*size);
      iron.rotation.set(pose.rx*Math.PI/180,pose.ry*Math.PI/180,pose.rz*Math.PI/180);
      iron.scale.setScalar(size*pose.scale);
      renderer.render(scene,camera);
    }
    hero.dataset.brandPhase=time<BRAND_TIMING.start?'waiting':time<BRAND_TIMING.contact?'approach':time<BRAND_TIMING.release?'contact':time<BRAND_TIMING.end?'withdrawal':time<BRAND_TIMING.cold?'cooling':'cold';
  }
  resize();
  return {pose, line, wisps, draw, resize, dispose(){
    renderer.dispose(); renderer.forceContextLoss(); scene.traverse(node=>node.geometry?.dispose());
    [steel,hot,rim,grip].forEach(material=>material.dispose()); canvas.remove(); smoke.remove();
  }};
}
