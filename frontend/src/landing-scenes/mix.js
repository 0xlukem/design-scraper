import {renderTokenStamps} from './token-stamps.js';
import * as THREE from 'three';
import {FontLoader} from 'three/addons/loaders/FontLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createTimeline} from 'animejs';
import {buildBlender,buildMixToken} from './mix-model.js';
import {createMixInk} from './mix-ink.js';

export function mountMix(root, options={}) {
const hero=options.variant==='hero';
const workspace=hero&&root.classList.contains('mix-workspace');
const host=options.host??root.querySelector('#mix-scene');
const state=options.state??root;
const message=root.querySelector(hero?'.mix-scene-error':'#mix-error');

const BLENDER_X=3.8;
const LOOP=12000,TOKEN_CYCLE=6000,TAU=Math.PI*2;
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
  message.hidden=false;state.dataset.renderer='fallback';state.dataset.playback='still';
  message.textContent='The 3D scene is unavailable. You can still mix references or explore a saved mix.';
  host.dataset.error=error.message;
}
}

function start(font){
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion=reduced.matches;
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));renderer.transmissionResolutionScale=.5;renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  renderer.shadowMap.enabled=!workspace;renderer.shadowMap.type=THREE.PCFShadowMap;host.append(renderer.domElement);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(27.5,1,.1,80);camera.position.set(7,5,14);camera.lookAt(0,-.05,0);
  const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
  const environment=pmrem.fromScene(room,.025);scene.environment=environment.texture;scene.environmentIntensity=1.15;room.dispose();pmrem.dispose();
  const key=new THREE.DirectionalLight(0xfffbf0,2.6);key.position.set(-3,7,6);key.castShadow=!workspace;
  key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-12,right:12,top:9,bottom:-9});key.shadow.bias=-.0003;key.shadow.normalBias=.025;scene.add(key);
  const edge=new THREE.DirectionalLight(0xffffff,1.4);edge.position.set(5,5,-4);scene.add(edge);
  scene.add(new THREE.HemisphereLight(0xf4f3ee,0x12130f,.5));
  const material=(color,roughness=.4,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const m={chrome:material(0xb9bdbd,.17,1),dark:material(0x20231f,.72,.2),ink:material(0x151613,.65),paper:material(0xf3f1e8,.56),pink:material(0xf24cad,.31),acid:material(0xedff7a,.36),blue:material(0x287df1,.3)};
  m.glass=new THREE.MeshPhysicalMaterial({color:0xf6fff9,transmission:1,thickness:.08,roughness:.075,ior:1.46,transparent:true,opacity:1,depthWrite:false,side:THREE.DoubleSide});
  const blender=buildBlender(font,m);scene.add(blender.rig);
  // Bottom of the rubber feet in the model's local coordinates.
  const FLOOR = workspace ? blender.rig.localToWorld(v(0, -2.96, 0)).y : -3.12;
  const floorGeometry=new THREE.PlaneGeometry(80,60);
  // A dark receiver only in Three's offscreen refraction pass prevents its
  // white transparent-target fallback from making the jar milky. It writes no
  // color/depth to the visible canvas, so it cannot cut off the page's paint.
  const receiver=new THREE.Mesh(floorGeometry,new THREE.MeshBasicMaterial({color:0x171815,toneMapped:false,depthWrite:false}));
  receiver.rotation.x=-Math.PI/2;receiver.position.y=FLOOR-.04;
  receiver.onBeforeRender=r=>{receiver.material.colorWrite=r.getRenderTarget()!==null};
  scene.add(receiver);
  let contactTexture;
  if(workspace){
    // A circular footprint in the floor plane projects to an ellipse under the feet.
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
    const ctx=canvas.getContext('2d'),falloff=ctx.createRadialGradient(64,64,0,64,64,64);
    falloff.addColorStop(0,'rgba(0,0,0,.88)');
    falloff.addColorStop(.54,'rgba(0,0,0,.72)');
    falloff.addColorStop(.8,'rgba(0,0,0,.26)');
    falloff.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=falloff;ctx.fillRect(0,0,128,128);
    contactTexture=new THREE.CanvasTexture(canvas);
    const contact=new THREE.Mesh(new THREE.PlaneGeometry(3.75,3.75),new THREE.MeshBasicMaterial({map:contactTexture,transparent:true,depthWrite:false,toneMapped:false}));
    contact.rotation.x=-Math.PI/2;contact.position.y=FLOOR-.012;contact.renderOrder=1;scene.add(contact);
  }else{
    const shadow=new THREE.Mesh(floorGeometry,new THREE.ShadowMaterial({opacity:.34}));
    shadow.rotation.x=-Math.PI/2;shadow.position.y=FLOOR-.035;shadow.receiveShadow=true;scene.add(shadow);
  }
  const tokens=[];
  for(let i=0;i<21;i++){
    const mesh=buildMixToken(font,m,i%7);mesh.traverse(part=>{part.castShadow=false});scene.add(mesh);
    const bounds=new THREE.Box3().setFromObject(mesh).getBoundingSphere(new THREE.Sphere());
    tokens.push({mesh,bound:bounds.radius+bounds.center.length(),offset:i*TOKEN_CYCLE/21,angle:random()*TAU,velocity:v(i%3===0?2.1+random()*3.7:-3.2-random()*3.2,4.5+random()*1.5,.5+random()*1.8),spin:v(1+random()*3,1+random()*4,random()*4-2),size:.60+random()*.12});
  }
  const stamps = workspace ? renderTokenStamps(renderer, scene, [tokens[2].mesh, tokens[4].mesh, tokens[6].mesh]) : [];
  const ink=createMixInk({banner:root,host:renderer.domElement,stamps,
    ...(hero ? { title:root.querySelector('.experience-headline') } : {}),
  });
  const orbitGeometry=new THREE.BoxGeometry(.13,.13,.13),orbiters=[];
  const orbitBatches=[m.pink,m.acid,m.blue,m.paper].map(material=>{
    const batch=new THREE.InstancedMesh(orbitGeometry,material,12);
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);batch.frustumCulled=false;scene.add(batch);return batch;
  });
  for(let i=0;i<48;i++){
    orbiters.push({mesh:new THREE.Object3D(),batch:orbitBatches[i%4],index:Math.floor(i/4),angle:random()*TAU,radius:.19+random()*.47,height:-.70+random()*1.95,turns:32+(i%3)*4});
  }
  let inView=false,mobile=false,blenderX=BLENDER_X,loops=0,contextLost=false,hasRendered=false;
  const clock={ms:0};
  timeline=createTimeline({autoplay:false,loop:true,onUpdate:self=>draw(clock.ms,self.currentTime),onLoop:()=>{loops++;state.dataset.cycle=String(loops)}});
  timeline.add(clock,{ms:[0,LOOP],duration:LOOP,ease:t=>t},0);
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
      orbiter.mesh.updateMatrix();orbiter.batch.setMatrixAt(orbiter.index,orbiter.mesh.matrix);
    }
    orbitBatches.forEach(batch=>{batch.instanceMatrix.needsUpdate=true});
    const canvasBounds=renderer.domElement.getBoundingClientRect();
    if(!hasRendered || reducedMotion || (canvasBounds.bottom>0 && canvasBounds.top<innerHeight)){renderer.render(scene,camera);hasRendered=true}
    host.dataset.drawCalls=String(renderer.info.render.calls);
    renderer.shadowMap.autoUpdate=false;
    ink.render(elapsed,opening.clone().project(camera),{still:reducedMotion});
    host.dataset.time=String(Math.round(hero?elapsed:time));state.dataset.time=host.dataset.time;state.dataset.phase='continuous-mix';host.dataset.airborne=String(airborne);
    state.dataset.cycle=String(loops);host.dataset.triangles=String(renderer.info.render.triangles);
  }
  function resize(){
    const {width,height}=host.getBoundingClientRect();mobile=innerWidth<=760;
    blenderX=mobile?0:Math.min(BLENDER_X,Math.max(.8,.8+(width/height-1)*3.6));
    if(hero){camera.position.set(7,5,mobile?14:16);camera.lookAt(0,mobile?-.05:-.35,0)}
    if(workspace){blenderX=0;camera.position.set(7,5,14);camera.lookAt(0,-.15,0)}
    camera.clearViewOffset();camera.aspect=width/height;camera.fov=workspace ? (mobile ? 25 : 24) : mobile ? 28 : 27.5;camera.updateProjectionMatrix();camera.updateMatrixWorld();
    blender.rig.position.x=blenderX;blender.rig.updateMatrixWorld(true);
    if(workspace){
      // Expand the projection window, not the model: the original column remains
      // the camera's reference frame while airborne pieces cross its edges.
      const shell=root.closest('.experience-shell').getBoundingClientRect();
      const frame=host.getBoundingClientRect();
      // Align the nearest rubber foot with the banner lip in screen space.
      const foot = blender.rig.localToWorld(v(.84, -2.96, .74)).project(camera);
      const lip = root.nextElementSibling.getBoundingClientRect().top;
      const shiftY = lip - frame.top - (1 - foot.y) * height / 2;
      // Project the full ballistic envelopes, including the size of rotating
      // objects. Fixed overscan clips the farthest floor-bound pieces at 4K.
      let minY=0,maxY=height;
      for(const token of tokens){
        const from=blender.rig.localToWorld(orbitPosition(1,token.angle));
        const gravity=9.4,hit=(token.velocity.y+Math.sqrt(token.velocity.y**2+2*gravity*(from.y-FLOOR)))/gravity;
        const radius=token.bound*token.size;
        for(let sample=0;sample<=24;sample++){
          const age=hit*sample/24,center=from.clone().addScaledVector(token.velocity,age);
          center.y-=.5*gravity*age*age;
          for(const x of [-radius,radius])for(const y of [-radius,radius])for(const z of [-radius,radius]){
            const projected=center.clone().add(v(x,y,z)).project(camera);
            if(projected.z<1&&projected.z>-1){const py=(1-projected.y)*height/2;minY=Math.min(minY,py);maxY=Math.max(maxY,py)}
          }
        }
      }
      const left=frame.left-shell.left;
      const top=Math.min(frame.top-shell.top,Math.max(90,-minY-shiftY+40));
      const bottom=Math.min(shell.bottom-frame.bottom,Math.max(180,maxY+shiftY-height+40));
      const canvasWidth=shell.width,canvasHeight=height+top+bottom;
      camera.setViewOffset(width,height,-left,-top-shiftY,canvasWidth,canvasHeight);
      Object.assign(renderer.domElement.style,{position:'absolute',left:`${-left}px`,top:`${-top}px`,width:`${canvasWidth}px`,height:`${canvasHeight}px`,maxWidth:'none'});
      renderer.setSize(canvasWidth,canvasHeight,false);
    }else{camera.clearViewOffset();renderer.setSize(width,height,false)}
    renderer.shadowMap.needsUpdate=true;ink.resize();draw(clock.ms);
  }
  const transition=hero?document.querySelector('.world-transition'):null;
  const sync=()=>{
    if(reducedMotion){timeline.pause();draw(2600,2600)}
    else if(contextLost||pageAway||document.hidden||!inView||['covering','revealing'].includes(transition?.dataset.state))timeline.pause();
    else timeline.resume();
    state.dataset.playback=reducedMotion?'still':timeline.paused?'paused':'playing';
  };
  const preference=event=>{reducedMotion=event.matches;if(!reducedMotion)timeline.seek(0);sync()};
  document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',preference);
  const observer=new ResizeObserver(resize);observer.observe(host);
  // The page can widen while the max-width blender column stays unchanged.
  if(workspace)observer.observe(root.closest('.experience-shell'));
  const visible=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting&&entry.intersectionRatio>0&&(workspace||entry.intersectionRatio>=.15);sync()},{threshold:[0,.0001,.15]});visible.observe(workspace?root.closest('.experience-shell'):root);
  const switching=new MutationObserver(sync);if(transition)switching.observe(transition,{attributes:true,attributeFilter:['data-state']});
  resize();state.dataset.renderer='webgl';host.dataset.ready='true';host.dataset.renderer='Three.js WebGL';host.dataset.engine='Anime.js';host.dataset.loopMs=String(LOOP);
  let count=0;scene.traverse(node=>{if(node.isMesh)count++});host.dataset.meshes=String(count);
  state.dataset.motionReady='';state.dataset.cycle='0';
  const pagehide=()=>{pageAway=true;sync()},pageshow=()=>{pageAway=false;sync()};
  window.addEventListener('pagehide',pagehide);window.addEventListener('pageshow',pageshow);sync();
  const lost=event=>{event.preventDefault();contextLost=true;sync();message.hidden=false;state.dataset.renderer='fallback';state.dataset.playback='still';message.textContent='The 3D context was interrupted. Reload the page to continue.'};
  renderer.domElement.addEventListener('webglcontextlost',lost);
  dispose=()=>{
    timeline.revert();
    window.removeEventListener('pagehide',pagehide);window.removeEventListener('pageshow',pageshow);observer.disconnect();visible.disconnect();switching.disconnect();
    document.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',preference);renderer.domElement.removeEventListener('webglcontextlost',lost);
    const geometries=new Set(),mats=new Set();scene.traverse(node=>{node.shadow?.dispose();if(node.geometry)geometries.add(node.geometry);if(node.material)(Array.isArray(node.material)?node.material:[node.material]).forEach(material=>mats.add(material))});
    ink.dispose();geometries.forEach(geometry=>geometry.dispose());mats.forEach(material=>material.dispose());environment.dispose();contactTexture?.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
  };
}
return ()=>{disposed=true;dispose?.();};
}
