import * as THREE from 'three';
import {FontLoader} from 'three/addons/loaders/FontLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createTimeline} from 'animejs';
import {buildBlender,buildMixToken} from './mix-model.js';
import {createMixInk} from './mix-ink.js';

export function mountMix(root) {
const host=root.querySelector('#mix-scene');

const BLENDER_X=3.8;
const LOOP=12000,TOKEN_CYCLE=6000,DROP_CYCLE=3000,TAU=Math.PI*2,FLOOR=-3.12;
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{const t=clamp(x);return t*t*(3-2*t)};
const v=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
let seed=2602;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296};
let renderer,timeline,dispose,disposed=false,pageAway=false;
void boot();
async function boot(){

try{
  await document.fonts.ready;
  if(disposed)return;
  const font=await new FontLoader().loadAsync('/fonts/landing/geist-650.typeface.json');
  if(!disposed)start(font);
}catch(error){
  if(disposed)return;
  const message=root.querySelector('#mix-error');message.hidden=false;
  message.textContent='The 3D scene is unavailable. You can still mix references or explore a saved mix.';
  host.dataset.error=error.message;
}
}

function start(font){
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion=reduced.matches;
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;host.append(renderer.domElement);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(27.5,1,.1,80);camera.position.set(7,5,14);camera.lookAt(0,-.05,0);
  const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
  const environment=pmrem.fromScene(room,.025);scene.environment=environment.texture;scene.environmentIntensity=1.15;room.dispose();pmrem.dispose();
  const key=new THREE.DirectionalLight(0xfffbf0,2.6);key.position.set(-3,7,6);key.castShadow=true;
  key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-12,right:12,top:9,bottom:-9});key.shadow.bias=-.0003;key.shadow.normalBias=.025;scene.add(key);
  const edge=new THREE.DirectionalLight(0xffffff,1.4);edge.position.set(5,5,-4);scene.add(edge);
  scene.add(new THREE.HemisphereLight(0xf4f3ee,0x12130f,.5));
  const material=(color,roughness=.4,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const m={chrome:material(0xb9bdbd,.17,1),dark:material(0x20231f,.72,.2),ink:material(0x151613,.65),paper:material(0xf3f1e8,.56),pink:material(0xf24cad,.31),acid:material(0xedff7a,.36),blue:material(0x287df1,.3)};
  m.glass=new THREE.MeshPhysicalMaterial({color:0xf6fff9,transmission:1,thickness:.08,roughness:.075,ior:1.46,transparent:true,opacity:1,depthWrite:false,side:THREE.DoubleSide});
  const floorGeometry=new THREE.PlaneGeometry(80,60);
  const floor=new THREE.Mesh(floorGeometry,new THREE.MeshBasicMaterial({color:0x171815,toneMapped:false}));floor.rotation.x=-Math.PI/2;floor.position.y=FLOOR-.04;scene.add(floor);
  const shadow=new THREE.Mesh(floorGeometry,new THREE.ShadowMaterial({opacity:.34}));shadow.rotation.x=-Math.PI/2;shadow.position.y=FLOOR-.035;shadow.receiveShadow=true;scene.add(shadow);
  const blender=buildBlender(font,m);scene.add(blender.rig);
  const ink=createMixInk({banner:root,host,camera,rig:blender.rig});
  const tokens=[];
  for(let i=0;i<21;i++){
    const mesh=buildMixToken(font,m,i%7);scene.add(mesh);
    tokens.push({mesh,offset:i*TOKEN_CYCLE/21,angle:random()*TAU,velocity:v(i%3===0?2.1+random()*3.7:-3.2-random()*3.2,4.5+random()*1.5,.5+random()*1.8),spin:v(1+random()*3,1+random()*4,random()*4-2),size:.60+random()*.12});
  }
  const orbitGeometry=new THREE.BoxGeometry(.13,.13,.13),orbiters=[];
  for(let i=0;i<48;i++){
    const mesh=new THREE.Mesh(orbitGeometry,[m.pink,m.acid,m.blue,m.paper][i%4]);mesh.castShadow=true;scene.add(mesh);
    orbiters.push({mesh,angle:random()*TAU,radius:.19+random()*.47,height:-.70+random()*1.95,turns:32+(i%3)*4});
  }
  const dropGeometry=new THREE.LatheGeometry([[0,-1.25],[.18,-.85],[.47,-.20],[.61,.30],[.47,.76],[.20,.98],[0,1.03]].map(point=>new THREE.Vector2(...point)),12);
  const paints=[0xf0209e,0xe5ff50,0x1168f5].map(color=>new THREE.MeshPhysicalMaterial({color,roughness:.26,clearcoat:.5,clearcoatRoughness:.18,envMapIntensity:.5}));
  const drops=[];
  for(let i=0;i<132;i++){
    const mesh=new THREE.Mesh(dropGeometry,paints[i%3]);mesh.castShadow=true;scene.add(mesh);
    drops.push({mesh,offset:i*DROP_CYCLE/132,size:.035+random()*.075,angle:random()*TAU,velocity:v(-6.8+random()*12.2,3.6+random()*3.2,-1.8+random()*4.5)});
  }
  let inView=false,mobile=false,blenderX=BLENDER_X,loops=0,contextLost=false;
  const clock={ms:0};
  timeline=createTimeline({autoplay:false,loop:true,onUpdate:self=>draw(clock.ms,self.currentTime),onLoop:()=>{loops++;root.dataset.cycle=String(loops)}});
  timeline.add(clock,{ms:[0,LOOP],duration:LOOP,ease:t=>t},0);
  const up=v(0,1,0),flightDirection=v();
  const orbitPosition=(u,angle)=>{
    const turn=angle+TAU*2.5*u,radius=.38+.18*smooth(u);
    return v(Math.cos(turn)*radius,-.55+2.27*smooth(u),Math.sin(turn)*radius);
  };
  function draw(ms,elapsed=timeline?.currentTime??ms){
    if(disposed)return;
    const time=((ms%LOOP)+LOOP)%LOOP,phase=time/LOOP;
    blender.rig.position.x=blenderX+Math.sin(TAU*96*phase)*.010;
    blender.rig.rotation.z=Math.sin(TAU*84*phase)*.003;
    blender.blade.rotation.y=TAU*96*phase;blender.dial.rotation.z=-.55;
    blender.led.emissiveIntensity=1.7+.15*Math.sin(TAU*4*phase);
    blender.rig.updateMatrixWorld(true);
    const opening=blender.rig.localToWorld(v(0,1.72,0));
    let airborne=0;
    for(const token of tokens){
      const local=(time+token.offset)%TOKEN_CYCLE;
      if(local<2100){
        const u=local/2100;token.mesh.position.copy(blender.rig.localToWorld(orbitPosition(u,token.angle)));
        token.mesh.rotation.set(u*4,token.angle+TAU*2.5*u,-u*2);
        token.mesh.scale.setScalar(token.size*smooth(local/380));token.mesh.visible=true;
      }else{
        const age=(local-2100)/1000,from=blender.rig.localToWorld(orbitPosition(1,token.angle));
        const gravity=9.4,hit=(token.velocity.y+Math.sqrt(token.velocity.y**2+2*gravity*(from.y-FLOOR)))/gravity;
        const flight=Math.min(age,hit),rest=Math.max(0,age-hit);
        token.mesh.position.copy(from).addScaledVector(token.velocity,flight);token.mesh.position.y-=.5*gravity*flight*flight;
        if(rest>0){token.mesh.position.x+=token.velocity.x*.08*(1-Math.exp(-rest*4));token.mesh.position.y=FLOOR+.055+Math.max(0,.6*rest-4*rest*rest)}
        token.mesh.rotation.set(4+token.spin.x*flight,token.angle+TAU*2.5+token.spin.y*flight,-2+token.spin.z*flight);
        const scale=token.size*(1-smooth((local-4800)/950));token.mesh.scale.setScalar(scale);token.mesh.visible=scale>.002;
        if(age<hit)airborne++;
      }
    }
    for(const orbiter of orbiters){
      const angle=orbiter.angle+TAU*orbiter.turns*phase;
      orbiter.mesh.position.copy(blender.rig.localToWorld(v(Math.cos(angle)*orbiter.radius,orbiter.height+.06*Math.sin(TAU*8*phase+orbiter.angle),Math.sin(angle)*orbiter.radius)));
      orbiter.mesh.rotation.set(angle*.5,angle,angle*.25);
    }
    for(const drop of drops){
      const age=((time+drop.offset)%DROP_CYCLE)/1000;
      const from=opening.clone().add(v(Math.cos(drop.angle)*.40,-.08,Math.sin(drop.angle)*.40));
      const gravity=9.8,hit=(drop.velocity.y+Math.sqrt(drop.velocity.y**2+2*gravity*(from.y-FLOOR)))/gravity;
      const flight=Math.min(age,hit),rest=Math.max(0,age-hit);
      drop.mesh.position.copy(from).addScaledVector(drop.velocity,flight);drop.mesh.position.y-=.5*gravity*flight*flight;
      const appear=smooth(age/.065),fade=1-smooth((rest-.12)/.7),size=drop.size*appear*fade;
      if(rest>0){drop.mesh.position.y=FLOOR+drop.size*.14;drop.mesh.quaternion.identity();drop.mesh.scale.set(size*2.1,size*.22,size*1.7)}
      else{flightDirection.copy(drop.velocity);flightDirection.y-=gravity*age;drop.mesh.quaternion.setFromUnitVectors(up,flightDirection.normalize());drop.mesh.scale.set(size*.75,size*(1.9-.6*clamp(age)),size*.75)}
      drop.mesh.visible=size>.001;
    }
    renderer.render(scene,camera);
    ink.render(elapsed,opening.clone().project(camera),{still:reducedMotion});
    host.dataset.time=String(Math.round(time));root.dataset.phase='continuous-mix';host.dataset.airborne=String(airborne);
    root.dataset.cycle=String(loops);host.dataset.triangles=String(renderer.info.render.triangles);
  }
  function resize(){
    const {width,height}=host.getBoundingClientRect();mobile=innerWidth<=760;
    blenderX=mobile?0:Math.min(BLENDER_X,Math.max(.8,.8+(width/height-1)*3.6));
    camera.aspect=width/height;camera.fov=mobile?28:27.5;camera.updateProjectionMatrix();
    blender.rig.position.x=blenderX;blender.rig.updateMatrixWorld(true);
    renderer.setSize(width,height,false);ink.resize();draw(clock.ms);
  }
  const sync=()=>{
    if(reducedMotion){timeline.pause();draw(2600,2600)}
    else if(contextLost||pageAway||document.hidden||!inView)timeline.pause();
    else timeline.resume();
    root.dataset.playback=reducedMotion?'still':timeline.paused?'paused':'playing';
  };
  const preference=event=>{reducedMotion=event.matches;if(!reducedMotion)timeline.seek(0);sync()};
  document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',preference);
  const observer=new ResizeObserver(resize);observer.observe(host);
  const visible=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting&&entry.intersectionRatio>=.15;sync()},{threshold:[0,.15]});visible.observe(root);
  resize();host.dataset.ready='true';host.dataset.renderer='Three.js WebGL';host.dataset.engine='Anime.js';host.dataset.loopMs=String(LOOP);
  let count=0;scene.traverse(node=>{if(node.isMesh)count++});host.dataset.meshes=String(count);
  root.dataset.motionReady='';root.dataset.cycle='0';
  const pagehide=()=>{pageAway=true;sync()},pageshow=()=>{pageAway=false;sync()};
  window.addEventListener('pagehide',pagehide);window.addEventListener('pageshow',pageshow);sync();
  const lost=event=>{event.preventDefault();contextLost=true;sync();const message=root.querySelector('#mix-error');message.hidden=false;message.textContent='The 3D context was interrupted. Reload the page to continue.'};
  renderer.domElement.addEventListener('webglcontextlost',lost);
  dispose=()=>{
    timeline.revert();
    window.removeEventListener('pagehide',pagehide);window.removeEventListener('pageshow',pageshow);observer.disconnect();visible.disconnect();
    document.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',preference);renderer.domElement.removeEventListener('webglcontextlost',lost);
    const geometries=new Set(),mats=new Set();scene.traverse(node=>{node.shadow?.dispose();if(node.geometry)geometries.add(node.geometry);if(node.material)(Array.isArray(node.material)?node.material:[node.material]).forEach(material=>mats.add(material))});
    ink.dispose();geometries.forEach(geometry=>geometry.dispose());mats.forEach(material=>material.dispose());environment.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
  };
}
return ()=>{disposed=true;dispose?.();};
}
