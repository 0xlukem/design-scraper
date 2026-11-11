// Orthographic hidden-line renderer. Each stroke is clipped against the actual
// faces ahead of it. Consequently letters, rollers and linkage can pass behind
// one another at any point in the stroke, including during the exploded view.
const add = (a,b) => a.map((v,i)=>v+b[i])
const sub = (a,b) => a.map((v,i)=>v-b[i])
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0)
const unit = a => a.map(v=>v/Math.hypot(...a))
export const camera = {azimuth:42,elevation:23,origin:[0,0],scale:1/Math.sqrt(1.6)}
const rad = Math.PI/180, ca=Math.cos(camera.azimuth*rad),sa=Math.sin(camera.azimuth*rad)
const ce=Math.cos(camera.elevation*rad),se=Math.sin(camera.elevation*rad)
export const project = ([x,y,z]) => [x*sa-y*ca,(x*ca+y*sa)*se-z*ce,(x*ca+y*sa)*ce+z*se]

function mesh(group,verts,faces) {
  const edges = new Map()
  const normals=faces.map(ids=>unit(cross(sub(verts[ids[1]],verts[ids[0]]),sub(verts[ids[2]],verts[ids[0]]))))
  faces.forEach((ids,f)=>ids.forEach((i,k)=>{
    const j=ids[(k+1)%ids.length], key=i<j?i+':'+j:j+':'+i
    if(!edges.has(key))edges.set(key,{i,j,faces:[]})
    edges.get(key).faces.push(f)
  }))
  for(const edge of edges.values()){
    const [a,b]=edge.faces
    edge.crease=b===undefined || dot(normals[a],normals[b]) < .92
  }
  return {group,verts,faces,edges:[...edges.values()]}
}
export function prism(group,ring,delta) {
  const winding=ring.reduce((sum,p,i)=>add(sum,cross(p,ring[(i+1)%ring.length])),[0,0,0])
  const profile=dot(winding,delta)>0?ring:[...ring].reverse()
  const n=profile.length, ids=Array.from({length:n},(_,i)=>i)
  const turn=(i,j,k)=>dot(cross(sub(profile[j],profile[i]),sub(profile[k],profile[i])),delta)
  const caps=[]
  if(ids.every(i=>turn((i+n-1)%n,i,(i+1)%n)>-.000001))caps.push(ids)
  else {
    const todo=[...ids]
    while(todo.length>3){
      const slot=todo.findIndex((j,k)=>{
        const i=todo[(k+todo.length-1)%todo.length], h=todo[(k+1)%todo.length]
        return turn(i,j,h)>.000001 && !todo.some(v=>v!==i && v!==j && v!==h &&
          turn(i,j,v)>=0 && turn(j,h,v)>=0 && turn(h,i,v)>=0)
      })
      if(slot<0)throw new Error('Invalid concave profile: '+group)
      caps.push([todo[(slot+todo.length-1)%todo.length],todo[slot],todo[(slot+1)%todo.length]])
      todo.splice(slot,1)
    }
    caps.push(todo)
  }
  return mesh(group,[...profile,...profile.map(p=>add(p,delta))],[
    ...caps.map(p=>[...p].reverse()),...caps.map(p=>p.map(i=>i+n)),
    ...ids.map(i=>{const j=(i+1)%n;return [i,j,j+n,i+n]})])
}
export function turned(group,base,axis,profile,steps=32) {
  const dir=unit(axis)
  const b=unit(cross(dir,Math.abs(dir[2])<.8?[0,0,1]:[0,1,0]))
  const c=cross(dir,b), verts=[],faces=[]
  const at=(p,k)=>p*steps+(k+steps)%steps
  profile.forEach(([t,r],i)=>{
    for(let j=0;j<steps;j++){
      const angle=2*Math.PI*j/steps
      verts.push(base.map((v,k)=>v+t*dir[k]+r*(Math.cos(angle)*b[k]+Math.sin(angle)*c[k])))
      if(i)faces.push([at(i-1,j),at(i-1,j+1),at(i,j+1),at(i,j)])
    }
  })
  const cap=Array.from({length:steps},(_,i)=>i)
  faces.push([...cap].reverse(),cap.map(j=>at(profile.length-1,j)))
  return mesh(group,verts,faces)
}
export function engraving(group,points,style='detail') {
  return {group,verts:points,faces:[],edges:points.slice(1).map((_,i)=>({i,j:i+1,faces:[],crease:true,style}))}
}
const area = points=>points.reduce((s,a,i)=>{const b=points[(i+1)%points.length];return s+a[0]*b[1]-b[0]*a[1]},0)
function occluder(points,sign) {
  const p=sign>0?points:[...points].reverse()
  // Face winding points out of the solid. Only camera-facing surfaces occlude.
  const a=p[0],b=p[1]
  let normal
  for(let k=2;k<p.length;k++){normal=cross(sub(b,a),sub(p[k],a));if(Math.abs(normal[2])>.00001)break}
  if(!normal||Math.abs(normal[2])<.00001)return null
  const zx=-normal[0]/normal[2],zy=-normal[1]/normal[2]
  return {points:p,sides:p.map((v,i)=>{const w=p[(i+1)%p.length],x=v[1]-w[1],y=w[0]-v[0];return[x,y,-x*v[0]-y*v[1]]}),
    zx,zy,zc:a[2]-zx*a[0]-zy*a[1],bounds:[Math.min(...p.map(q=>q[0])),Math.min(...p.map(q=>q[1])),Math.max(...p.map(q=>q[0])),Math.max(...p.map(q=>q[1]))]}
}
const cell=24
const cellKey=(x,y)=>(x+1000)*2048+y+1000
const pretty=n=>String(Math.round(n*100)/100)
export function renderLines(model, pose, onVisible) {
  const grid=new Map(), edges=[]
  for(const solid of model){
    const transform=pose.transforms[solid.group]
    const pts=solid.verts.map(p=>project(transform?transform(p):p))
    const facing=[]
    for(const face of solid.faces){
      const polygon=face.map(i=>pts[i]), signed=area(polygon)
      facing.push(signed>.00001)
      if(signed<=.00001)continue
      const f=occluder(polygon,signed)
      if(!f)continue
      const [x,y,X,Y]=f.bounds.map(v=>Math.floor(v/cell))
      for(let i=x;i<=X;i++)for(let j=y;j<=Y;j++){
        const key=cellKey(i,j)
        if(!grid.has(key))grid.set(key,[])
        grid.get(key).push(f)
      }
    }
    for(const edge of solid.edges){
      const [first,second]=edge.faces
      const silhouette=first!==undefined && facing[first]!==facing[second]
      if(edge.faces.length && !facing[first] && !facing[second])continue
      if(silhouette || edge.crease)edges.push({a:pts[edge.i],b:pts[edge.j],edge,style:edge.style??(silhouette?'outline':'edge')})
    }
  }
  const paths={outline:[],edge:[],detail:[],impression:[]}
  let serial=0
  for(const {a,b,style,edge} of edges){
    serial++
    const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2]
    if(Math.hypot(dx,dy)<.08)continue
    let intervals=[]
    const x=Math.floor(Math.min(a[0],b[0])/cell),X=Math.floor(Math.max(a[0],b[0])/cell)
    const y=Math.floor(Math.min(a[1],b[1])/cell),Y=Math.floor(Math.max(a[1],b[1])/cell)
    for(let i=x;i<=X;i++)for(let j=y;j<=Y;j++)for(const f of grid.get(cellKey(i,j))??[]){
      if(f.serial===serial)continue
      f.serial=serial
      let lo=0,hi=1
      // Clip by face depth and all projected edge half-planes.
      const h0=f.zx*a[0]+f.zy*a[1]+f.zc-a[2]-.035
      const h1=h0+f.zx*dx+f.zy*dy-dz
      if(h0<0 && h1<0)continue
      if(h0<0)lo=h0/(h0-h1)
      else if(h1<0)hi=h0/(h0-h1)
      for(const [u,v,w] of f.sides){
        const s=u*a[0]+v*a[1]+w,t=u*b[0]+v*b[1]+w
        if(s<-.00001 && t<-.00001){hi=-1;break}
        if(s<-.00001)lo=Math.max(lo,s/(s-t))
        else if(t<-.00001)hi=Math.min(hi,s/(s-t))
        if(hi<=lo)break
      }
      if(hi>lo)intervals.push([lo,hi])
    }
    intervals.sort((p,q)=>p[0]-q[0]);intervals.push([1,1])
    let end=0
    for(const [start,stop] of intervals){
      if(start-end>.0002){
        if(onVisible)onVisible(edge,style,end,start)
        else paths[style].push('M'+pretty(a[0]+dx*end)+' '+pretty(a[1]+dy*end)+'L'+pretty(a[0]+dx*start)+' '+pretty(a[1]+dy*start))
      }
      end=Math.max(end,stop)
      if(end>=1)break
    }
  }
  return Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,p.join('')]))
}
