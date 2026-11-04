import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function block(w,h,d,material,r=.045){
  const mesh=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,3,Math.min(r,w/3,h/3,d/3)),material);
  mesh.castShadow=mesh.receiveShadow=true;return mesh;
}
export function text(font,label,size,material,depth=.018){
  const geometry=new THREE.ExtrudeGeometry(font.generateShapes(label,size),{depth,bevelEnabled:true,bevelSize:.003,bevelThickness:.003,bevelSegments:2,curveSegments:8});
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;return mesh;
}
function tube(points,radius,material){return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),32,radius,12,false),material)}

export function buildBlender(font,materials){
  const {chrome,dark,ink,paper,glass,blue}=materials;
  const rig=new THREE.Group();
  const base=block(2.12,1.29,1.74,chrome,.16);base.position.y=-2.05;rig.add(base);
  const boot=block(2.02,.17,1.65,dark,.055);boot.position.y=-2.755;rig.add(boot);
  for(const x of [-.75,.75])for(const z of [-.55,.55]){
    const foot=new THREE.Mesh(new THREE.CylinderGeometry(.19,.21,.12,24),dark);foot.position.set(x,-2.9,z);rig.add(foot);
  }
  const upper=new THREE.Mesh(new THREE.CylinderGeometry(.96,1.0,.2,64),chrome);upper.position.y=-1.32;rig.add(upper);
  const gasket=new THREE.Mesh(new THREE.CylinderGeometry(.82,.88,.1,64),dark);gasket.position.y=-1.18;rig.add(gasket);
  const profile=[[.74,0],[.82,.09],[.86,.35],[.98,1.6],[1.12,2.72],[1.13,2.78],[1.065,2.78],[1.055,2.70],[.915,1.6],[.795,.35],[.765,.1],[.74,.08]].map(p=>new THREE.Vector2(...p));
  const jar=new THREE.Mesh(new THREE.LatheGeometry(profile,64),glass);jar.position.y=-1.13;jar.renderOrder=3;rig.add(jar);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(1.10,.035,12,80),chrome);rim.rotation.x=Math.PI/2;rim.position.y=1.64;rig.add(rim);
  const jarFoot=new THREE.Mesh(new THREE.CylinderGeometry(.79,.79,.075,64),chrome);jarFoot.position.y=-1.04;rig.add(jarFoot);
  const handle=tube([[.99,1.30,0],[1.50,1.3,0],[1.70,.84,0],[1.64,-.42,0],[1.16,-.70,0],[.87,-.64,0]],.095,chrome);rig.add(handle);
  for(const y of [-.62,1.30]){const connector=block(.3,.18,.24,dark,.035);connector.position.set(1.02,y,0);rig.add(connector)}
  for(let i=0;i<4;i++){
    const mark=block(.16,.012,.014,paper,.003);mark.position.set(.26,-.55+i*.45,.90+i*.025);rig.add(mark);
  }
  const dial=new THREE.Group();dial.position.set(.56,-2.04,.91);rig.add(dial);
  const bezel=new THREE.Mesh(new THREE.CylinderGeometry(.27,.27,.085,48),dark);bezel.rotation.x=Math.PI/2;dial.add(bezel);
  const knob=new THREE.Mesh(new THREE.CylinderGeometry(.22,.22,.15,48),chrome);knob.rotation.x=Math.PI/2;knob.position.z=.075;dial.add(knob);
  for(let i=0;i<28;i++){
    const angle=i*Math.PI/14;const ridge=block(.018,.045,.11,dark,.003);ridge.position.set(Math.sin(angle)*.22,Math.cos(angle)*.22,.08);ridge.rotation.z=-angle;dial.add(ridge);
  }
  const pointer=block(.022,.10,.012,ink,.003);pointer.position.set(0,.11,.16);dial.add(pointer);
  const label=text(font,'mix it.',.19,ink,.006);label.position.set(-.83,-2.1,.89);rig.add(label);
  const ledMaterial=blue.clone();ledMaterial.emissive=new THREE.Color(0x0d6efd);ledMaterial.emissiveIntensity=0;
  const led=new THREE.Mesh(new THREE.CircleGeometry(.034,20),ledMaterial);led.position.set(-.80,-2.32,.89);rig.add(led);
  for(let i=0;i<6;i++){const vent=block(.025,.42,.022,dark,.004);vent.position.set(-.99,-2.05,-.48+i*.16);rig.add(vent)}
  const blade=new THREE.Group();blade.position.set(0,-.91,0);rig.add(blade);
  const hub=new THREE.Mesh(new THREE.CylinderGeometry(.14,.18,.17,24),chrome);blade.add(hub);
  for(let i=0;i<4;i++){
    const shape=new THREE.Shape();shape.moveTo(.08,-.09);shape.lineTo(.60,-.18);shape.lineTo(.70,.035);shape.lineTo(.1,.10);shape.closePath();
    const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.025,bevelEnabled:true,bevelSize:.008,bevelThickness:.008,bevelSegments:2,steps:1}),chrome);
    mesh.rotation.x=-Math.PI/2;const arm=new THREE.Group();arm.rotation.y=i*Math.PI/2;arm.rotation.z=i%2?.1:-.1;arm.add(mesh);blade.add(arm);
  }
  rig.scale.setScalar(1.08);rig.position.set(3.0,.03,0);
  return {rig,blade,dial,led:ledMaterial};
}

// Actual solid design fragments: layouts, glyphs, swatches, spacing and buttons.
export function buildMixToken(font,m,kind){
  const group=new THREE.Group();
  const add=(mesh,x=0,y=0,z=0)=>{mesh.position.set(x,y,z);group.add(mesh);return mesh};
  if(kind===0){
    add(block(1.40,1.05,.065,m.paper,.035));
    add(block(.40,.035,.015,m.ink,.005),-.36,.37,.045);
    add(block(.77,.085,.025,m.blue,.008),-.16,.13,.05);
    add(block(.56,.045,.015,m.ink,.005),-.27,-.04,.05);
    add(block(.41,.033,.015,m.ink,.005),-.34,-.14,.05);
    add(block(.44,.15,.035,m.acid,.02),-.31,-.34,.055);
    add(new THREE.Mesh(new THREE.CylinderGeometry(.21,.21,.055,32),m.pink),.37,-.18,.07).rotation.x=Math.PI/2;
  }else if(kind===1){
    add(block(1.08,1.43,.065,m.paper,.035));
    add(text(font,'Aa',.54,m.ink,.035),-.40,-.04,.05);
    add(block(.73,.038,.02,m.blue,.005),0,.49,.05);
    add(block(.73,.20,.04,m.pink,.01),0,-.44,.055);
  }else if(kind===2){
    [m.pink,m.acid,m.blue].forEach((color,i)=>add(block(.33,.67,.16,color,.045),(i-1)*.34));
  }else if(kind===3){
    const glyph=text(font,'Aa',.77,m.blue,.12);glyph.geometry.computeBoundingBox();
    const center=glyph.geometry.boundingBox.getCenter(new THREE.Vector3());glyph.geometry.translate(-center.x,-center.y,-center.z);add(glyph);
  }else if(kind===4){
    add(block(1.20,.23,.12,m.paper,.025));
    for(let i=0;i<9;i++)add(block(.018,i%2?.06:.11,.015,m.ink,.003),-.49+i*.12,.05,.071);
  }else if(kind===5){
    add(block(1.03,.37,.13,m.ink,.06));
    add(text(font,'Create',.17,m.paper,.012),-.29,-.055,.08);
  }else{
    add(new THREE.Mesh(new THREE.TorusGeometry(.29,.10,12,36),m.pink));
  }
  return group;
}
