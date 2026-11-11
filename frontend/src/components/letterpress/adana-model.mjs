// Adana Eight-Five, basic hand platen (factory instruction manual, pp. 2–3).
// https://drukwerkindemarge.org/download/documentatie/adana_8x5_manual.pdf
// The documented 203 × 127 mm chase, bowed impression handle, lay gauge, twin
// rollers, ink disc and hinged platen anchor this schematic. Link dimensions
// below are reconstructed to close the planes; they are not factory tolerances.
import {prism,turned,engraving} from './adana-lines.mjs'
const rad=Math.PI/180
const sin=d=>Math.sin(d*rad),cos=d=>Math.cos(d*rad)
export const hinge=[0,50], drive=[76,105], crankRadius=59.35911, linkLength=54.44985
export const platenHalfWidth=109, cheekInner=112, cheekOuter=122
// The cheek's open throat clears the follower pin along the entire closing arc.
export const cheekProfile=[[-127,20],[-126,41],[-119,105],[-118,117],[-115,123],[-110,128],[-100,131],[-84,134],[-77,130],[-72,117],[-84,79],[-59,59],[-5,56],[20,53],[51,54],[59,76],[65,101],[68,113],[76,118],[84,114],[91,100],[94,78],[100,20]]
const closed=-13, operating=38, followerRadius=55
const polar=([y,z],r,t)=>[y+r*sin(t),z+r*cos(t)]
const move=(p,v)=>p.map((n,i)=>n+v[i])
const rot=(angle,origin,p)=>{
  const dy=p[1]-origin[0],dz=p[2]-origin[1]
  return [p[0],origin[0]+dy*cos(angle)+dz*sin(angle),origin[1]-dy*sin(angle)+dz*cos(angle)]
}
const plane=(angle,x,t,d)=>[x,hinge[0]+t*sin(angle)+d*cos(angle),hinge[1]+t*cos(angle)-d*sin(angle)]
export const bedPoint=(x,t,d)=>plane(closed,x,t,d)
export function linkage(pressure) {
  const handle=operating+74*pressure, pin=polar(drive,crankRadius,handle+120)
  const y=pin[0]-hinge[0],z=pin[1]-hinge[1],r=Math.hypot(y,z)
  const platen=Math.atan2(y,z)/rad-Math.acos((r*r+followerRadius**2-linkLength**2)/(2*r*followerRadius))/rad
  const joint=polar(hinge,followerRadius,platen)
  const rod=Math.atan2(joint[0]-pin[0],joint[1]-pin[1])/rad
  return {handle,platen,pin,joint,rod}
}
const open=linkage(0), rest=open.platen
const carriagePin=[-108,117]
const rollerAt=(s)=>bedPoint(0,30+188*s,2).slice(1)
const vectorAngle=(a,b)=>Math.atan2(b[0]-a[0],b[1]-a[1])/rad
const smooth=t=>t*t*(3-2*t)
const clamp=t=>Math.max(0,Math.min(1,t))
const ease=(p,a,b)=>smooth(clamp((p-a)/(b-a)))
export function pressPose(explode=0,pressure=0,pull=0) {
  const state=linkage(pressure), roller=rollerAt(pressure)
  const cast=[0,0,0]
  const slide=(v)=>v.map(x=>x*explode)
  const rollerShift=slide([202,-100,148]), leverShift=slide([-185,150,86]), platenShift=slide([18,60,193])
  const shift=v=>p=>move(p,v)
  const spin=(origin,angle,offset)=>p=>move(rot(angle,origin,p),offset)
  const transforms={
    base:shift(cast), frame:shift(slide([0,0,24])), disc:shift(slide([15,-70,126])),
    bed:shift(slide([-28,-95,73])), forme:shift(slide([-178,10,178])),
    drive:spin(drive,state.handle-operating,leverShift),
    platen:spin(hinge,state.platen-rest,platenShift),
    link:spin(open.pin,state.rod-open.rod,move(slide([110,-52,22]),[0,state.pin[0]-open.pin[0],state.pin[1]-open.pin[1]])),
    rollers:shift(move(rollerShift,[0,roller[0]-rollerAt(0)[0],roller[1]-rollerAt(0)[1]])),
    arm:spin(carriagePin,vectorAngle(carriagePin,roller)-vectorAngle(carriagePin,rollerAt(0)),rollerShift),
    paper:p=>{
      // The card is lifted along the platen after opening, then tipped towards
      // the reader. It remains registered on the platen throughout impression.
      const releaseAngle=20*ease(pull,.15,1)
      const tipped=rot(releaseAngle,hinge,rot(state.platen-rest,hinge,p))
      return move(tipped,[platenShift[0],platenShift[1]+pull*111,platenShift[2]+pull*39])
    },
  }
  // Steel draw-rods telescope within the spring-loaded roller arms.
  const seat=rollerAt(0), theta=vectorAngle(carriagePin,roller)-vectorAngle(carriagePin,seat)
  transforms.shuttle=spin(seat,theta,[rollerShift[0],rollerShift[1]+roller[0]-seat[0],rollerShift[2]+roller[1]-seat[1]])
  return {transforms,...state}
}
export function makePress(kit) {
  const model=[]
  const add=(item)=>model.push(item)
  const rounded=(x,y,w,d,r)=>kit.roundedPlan({x,y,w,d,r},4)
  const slab=(g,x,y,w,d,z,h,r)=>add(prism(g,rounded(x,y,w,d,r).map(([u,v])=>[u,v,z]),[0,0,h]))
  const side=(g,x,width,profile)=>add(prism(g,profile.map(([y,z])=>[x,y,z]),[width,0,0]))
  const flat=(g,beta,x,t,w,h,d,depth,r=1.5)=>{
    const o=plane(beta,0,0,0),n=plane(beta,0,0,depth).map((v,i)=>v-o[i])
    add(prism(g,rounded(x,t,w,h,r).map(([u,v])=>plane(beta,u,v,d)),n))
  }
  const axle=(g,x,y,z,len,r,profile)=>add(turned(g,[x,y,z],[1,0,0],profile??[[0,r],[len,r]]))
  const shaft=(g,p,q,r,feature)=>{
    const v=q.map((n,i)=>n-p[i])
    const part=turned(g,p,v,[[0,r],[Math.hypot(...v),r]],24)
    if(feature)part.feature=feature
    add(part)
  }
  const link=(g,x,width,p,q,r)=>{
    const u=Math.atan2(q[1]-p[1],q[0]-p[0]), points=[]
    for(const [center,start] of [[p,u+Math.PI/2],[q,u-Math.PI/2]]){
      for(let j=0;j<=12;j++){const a=start+j*Math.PI/12;points.push([center[0]+r*Math.cos(a),center[1]+r*Math.sin(a)])}
    }
    side(g,x,width,points)
  }
  const engrave=(g,pts,style)=>add(engraving(g,pts,style))
  const pinCap=(g,x,y,z,sign,r)=>{
    const start=sign>0?x:x-4
    axle(g,start,y,z,4,r,[[0,.88*r],[.7,r],[3.3,r],[4,.88*r]])
    engrave(g,[[x+sign*4,y-r*.48,z-r*.24],[x+sign*4,y+r*.48,z+r*.24]])
  }
  // Cast foot, four recessed mounting-hole rims and two reinforced side cheeks.
  slab('base',-133,-148,266,284,0,11,9)
  slab('frame',-124,-132,248,244,11,9,6)
  for (const x of [-123,123])for(const y of [-135,122]){
    for(const r of [3.4,5.2])engrave('base',kit.circleRing(x,y,r,32).map(([u,v])=>[u,v,11.05]).concat([[x+r,y,11.05]]))
  }
  for(const sign of [-1,1]){
    const x=sign<0?-cheekOuter:cheekInner, thickness=cheekOuter-cheekInner
    side('frame',x,thickness,cheekProfile)
    for(const [p,r] of [[drive,15],[hinge,12],[carriagePin,9]]){
      axle('frame',x-(sign<0?1.5:0),...p,thickness+1.5,r)
    }
  }
  // The bed's pressure is reacted by a crosspiece and four adjustable screws.
  // Their axes are normal to the bed, with a retaining shoulder against it.
  for (const x of [-77,77]){
    const foot=bedPoint(x,17,-45),top=bedPoint(x,130,-45)
    shaft('frame',[x,-103,23],top,7)
    shaft('frame',foot,top,7.5)
    for(const t of [23,118]){
      const p=bedPoint(x,t,-49),q=bedPoint(x,t,-25)
      shaft('frame',p,q,4.2); shaft('frame',bedPoint(x,t,-43),bedPoint(x,t,-38),7)
    }
  }
  // A solid cross-shaft here would intersect the middle of the rotating
  // platen. Two coaxial stub axles carry the lever outside the 218 mm platen.
  // Their common grip couples them; the cheek leaves 3 mm of side clearance.
  axle('frame',-135,...drive,135-cheekInner,8)
  axle('frame',cheekInner,...drive,135-cheekInner,8)
  axle('frame',-cheekOuter,...hinge,2*cheekOuter,8)
  // Fixed bed has rails level with the surface of the type. The chase opening
  // is 203 by 127; the furniture locks the four relief sorts within this area.
  flat('bed',closed,-121,0,242,152,-25,8,3)
  for(const x of [-121,112])flat('bed',closed,x,0,9,158,-17,9,2)
  for(const x of [-111.5,101.5])flat('forme',closed,x,7,10,139,-16,7)
  for(const t of [7,140])flat('forme',closed,-101.5,t,203,6,-16,7)
  flat('forme',closed,-100.5,14,201,125,-16,4,1)
  for(const t of [37,96])flat('forme',closed,-79,t,158,9,-12,3,.8)
  const text=(group, point, style)=>{
    // Lowercase slab-serif sorts, read from the front of the finished card.
    const w=[[0,0],[10,0],[10,1.8],[7.7,2.4],[12,15],[16.6,3],[14,1.8],[14,0],[24,0],[24,1.8],[21.9,2.5],[26,15],[30,2.7],[27.8,1.8],[27.8,0],[35,0],[35,1.8],[32.8,2.7],[26.5,22],[23.1,22],[17.8,7],[12.6,22],[9.1,22],[2.1,2.5],[0,1.8],[0,0]]
    for(let i=0;i<3;i++)engrave(group,w.map(([x,t])=>point(-59+i*36+x,57+t)),style)
    const pts=kit.circleRing(54,76.4,2.9,24); engrave(group,[...pts,pts[0]].map(([x,t])=>point(x,t)),style)
  }
  for(let i=0;i<4;i++){
    const left=-61+i*36
    flat('forme',closed,left,51,i===3?13:35.6,37,-12,4,0)
  }
  text('forme',(x,t)=>bedPoint(x,t,-7.98),'detail')
  // An inclined ink disc shares the roller track plane. Its arbor is supported
  // on a cast fork behind the bed; each roller can travel onto the lower disc.
  for(const sign of [-1,1]){
    shaft('bed',bedPoint(sign*88,95,-23),bedPoint(sign*15,249,-33),5,'disc-support')
  }
  const diskAxis=bedPoint(0,0,1).map((n,i)=>n-bedPoint(0,0,0)[i])
  add(turned('disc',bedPoint(0,248,-36),diskAxis,[[0,12],[9,12],[11,22],[19,22],[20,96],[22,100],[27,100],[28,98.5]],84))
  // The padded platen and the two lay-gauge fingers all rotate as one rigid body.
  flat('platen',rest,-platenHalfWidth,4,2*platenHalfWidth,145,-6,12,4)
  flat('platen',rest,-106,6,212,141,-7.4,1.4,2.2)
  for(const sign of [-1,1]){
    const x=sign>0?97:-107
    link('platen',x,10,hinge,open.joint,9)
    axle('platen',x-1,...hinge,12,10)
    flat('platen',rest,sign*91-4,14,8,19,-8.12,1,1.3)
  }
  flat('platen',rest,-104,12,208,4,-8.2,1.5,.6)
  flat('paper',rest,-84,17,168,105,-8,.6,.8)
  text('paper',(x,t)=>plane(rest,x,t,-8.07),'impression')
  // Paired bowed levers and their hardwood handgrip share one transverse shaft.
  const grip=polar(drive,177,operating)
  for(const sign of [-1,1]){
    const x=sign>0?123:-133
    const sweep=(t,side)=>{
      const y=drive[0]+(grip[0]-drive[0])*t+19*Math.sin(Math.PI*t),
        z=drive[1]+(grip[1]-drive[1])*t+11*Math.sin(Math.PI*t)
      const w=8-3*t
      return [y+side*w*cos(operating),z-side*w*sin(operating)]
    }
    const curve=Array.from({length:13},(_,i)=>sweep(i/12,-1)).concat(Array.from({length:13},(_,i)=>sweep(1-i/12,1)))
    side('drive',x,10,curve)
    link('drive',x,10,drive,open.pin,8)
    axle('drive',x-1,...drive,12,11)
    pinCap('drive',sign*132,...drive,sign,8)
    link('link',sign>0?134:-142,8,open.pin,open.joint,7)
    for(const [p,inner] of [[open.pin,123],[open.joint,102]]){
      axle('link',sign>0?inner:-143,...p,143-inner,4.8)
      pinCap('link',sign*143,...p,sign,6)
    }
  }
  axle('drive',-133,...grip,266,6)
  axle('drive',-114,...grip,228,9,[[0,7],[2,9],[8,9.8],[18,9.2],[210,9.2],[220,9.8],[226,9],[228,7]])
  for(const sign of [-1,1])pinCap('drive',sign*133,...grip,sign,6.4)
  for(const t of [30,55]){
    const [_,y,z]=bedPoint(0,t,2)
    axle('rollers',-133,y,z,266,3.8)
    axle('rollers',-105,y,z,210,10,[[0,8.8],[1.2,10],[208.8,10],[210,8.8]])
    for(const sign of [-1,1]){
      axle('rollers',sign<0?-118:109,y,z,9,10,[[0,9],[1,10],[8,10],[9,9]])
      pinCap('rollers',sign*133,y,z,sign,4.6)
    }
  }
  const seat=rollerAt(0), second=bedPoint(0,55,2).slice(1)
  for(const sign of [-1,1]){
    const x=sign*126
    link('rollers',x-3,6,seat,second,5.5)
    const v=seat.map((n,i)=>n-carriagePin[i]),length=Math.hypot(...v),unit=v.map(n=>n/length)
    const point=(r)=>[x,carriagePin[0]+r*unit[0],carriagePin[1]+r*unit[1]]
    axle('arm',x-6,...carriagePin,12,8)
    shaft('arm',point(0),point(62),5.2); shaft('arm',point(55),point(65),6)
    shaft('shuttle',point(length-112),point(length),3)
  }
  return model
}
