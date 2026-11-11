import { bakeDraftingData } from './bake-drafting-data.mjs'
// Regenerate the vector frames with the Anatomy checkout at its pinned revision.
// node scripts/draw-adana.mjs /path/to/anatomy  (1482e8469b0a9e0d8cc18ea2740a01423d29ae80)
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {gzipSync} from 'node:zlib'
import {camera,project,renderLines} from '../src/components/letterpress/adana-lines.mjs'
import {makePress,pressPose,linkage,linkLength,bedPoint,platenHalfWidth,cheekInner,cheekProfile} from '../src/components/letterpress/adana-model.mjs'
import {viewBox} from '../src/components/letterpress/adana-playback.mjs'
import assert from 'node:assert/strict'
const kit=await import(pathToFileURL(resolve(process.argv[2],'kit/iso-kit.mjs')))
const model=makePress(kit), dir=new URL('../public/images/adana/',import.meta.url)
mkdirSync(dir,{recursive:true})
const cols={outline:10.5,edge:6,detail:6,impression:11}
const style='fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"'
for(const part of model)for(const p of part.verts){
  const q=kit.iso(p,camera), r=project(p);assert.ok(Math.hypot(q[0]-r[0],q[1]-r[1])<1e-8)
}
assert.equal(cheekInner-platenHalfWidth,3)
function pointToEdge(p,a,b){
  const v=b.map((n,i)=>n-a[i])
  const u=Math.max(0,Math.min(1,((p[0]-a[0])*v[0]+(p[1]-a[1])*v[1])/(v[0]*v[0]+v[1]*v[1])))
  return Math.hypot(...p.map((n,i)=>n-a[i]-u*v[i]))
}
for(let i=0;i<=360;i++){
  const {joint,pin}=linkage(i/360)
  assert.ok(Math.abs(Math.hypot(joint[0]-pin[0],joint[1]-pin[1])-linkLength)<1e-8)
  // The pin starts above the cheek. An uninterrupted positive gap along its
  // swept path guarantees it stays outside the casting throughout the stroke.
  const distance=Math.min(...cheekProfile.map((p,j)=>pointToEdge(joint,p,cheekProfile[(j+1)%cheekProfile.length])))
  assert.ok(distance-4.8>3.5,'Follower pin clips the frame')
}
const contact=pressPose(0,1,0),open=linkage(0)
for(const [x,t] of [[-84,17],[84,17],[84,122],[-84,122]]){
  const beta=open.platen*Math.PI/180,d=-8
  const card=[x,t*Math.sin(beta)+d*Math.cos(beta),50+t*Math.cos(beta)-d*Math.sin(beta)]
  const target=bedPoint(x,t,d)
  assert.ok(Math.hypot(...contact.transforms.paper(card).map((v,i)=>v-target[i]))<.0001)
}
function segments(d){
  return new Set([...d.matchAll(/M([\d. -]+)L([\d. -]+)/g)].map(m=>{
    const coords=p=>p.trim().split(' ').map(n=>Math.round(Number(n)*10)).join(' ')
    const a=coords(m[1]),b=coords(m[2])
    return a<b?a+';'+b:b+';'+a
  }).filter(s=>{const [a,b]=s.split(';');return a!==b}))
}
function stitch(edges){
  const adjacent=new Map(),used=new Set(),parts=[]
  for(const edge of edges){
    const [a,b]=edge.split(';')
    for(const [p,q] of [[a,b],[b,a]]){
      if(!adjacent.has(p))adjacent.set(p,[])
      adjacent.get(p).push([q,edge])
    }
  }
  function walk(start,next,first){
    const coords=p=>p.split(' ').map(Number)
    const points=[coords(start)],extend=(p)=>{
      const last=points.at(-1),prev=points.at(-2)
      if(prev){const dx=p[0]-prev[0],dy=p[1]-prev[1],dist=Math.hypot(dx,dy)
        if(dist && Math.abs((last[0]-prev[0])*dy-(last[1]-prev[1])*dx)/dist<.59 &&
          (last[0]-prev[0])*(p[0]-last[0])+(last[1]-prev[1])*(p[1]-last[1])>=0)points.pop()
      }
      points.push(p)
    }
    let current=next,edge=first
    while(!used.has(edge)){
      used.add(edge);extend(coords(current))
      const list=adjacent.get(current)
      if(list.length!==2)break
      const step=list.find(([,key])=>!used.has(key))
      if(!step)break
      ;[current,edge]=step
    }
    parts.push('M'+points[0].join(' ')+'l')
    for(let i=1;i<points.length;i++){
      const dx=points[i][0]-points[i-1][0],dy=points[i][1]-points[i-1][1]
      parts.push((i>1 && dx>=0?' ':'')+dx+(dy>=0?' ':'')+dy)
    }
  }
  for(const [p,list] of adjacent)if(list.length!==2)for(const [q,key] of list)if(!used.has(key))walk(p,q,key)
  for(const edge of edges)if(!used.has(edge)){const [a,b]=edge.split(';');walk(a,b,edge)}
  return parts.join('')
}
const path=(style,edges)=>edges.size?'<path stroke-width="'+cols[style]+'" stroke-opacity="'+({outline:1,edge:.84,detail:.74,impression:1}[style])+'" d="'+stitch(edges)+'"/>':''
const draw=(args)=>Object.fromEntries(Object.entries(renderLines(model,pressPose(...args))).map(([k,d])=>[k,segments(d)]))
const plate=(paths,ink=false)=>Object.entries(paths).filter(([k])=>ink||k!=='impression').map(([k,s])=>path(k,s)).join('')
const standalone=(name,geometry,ink)=>{
  const mark=path('impression',geometry.impression)
  const body='<g transform="scale(.1)" id="plate" '+style+'>'+plate(geometry)+'</g>'
  const impression='<g transform="scale(.1)" id="mark" '+style+'>'+mark+'</g>'
  writeFileSync(new URL(name,dir),'<svg xmlns="http://www.w3.org/2000/svg" color="#5b5e54" viewBox="'+viewBox(0)+'"><title>Hand platen printing press</title><defs>'+body+impression+'</defs><use href="#plate"/>'+(ink?'<use href="#mark"/>':'')+'</svg>')
}
standalone('registered.svg',draw([0,0,0]),false)
standalone('proof.svg',draw([0,0,1]),true)
// Each physical edge has fixed 3D endpoints. Only its changing visible intervals
// are stored. The browser computes the actual perspective-free projection for
// every displayed pose; the samples describe occlusion, never motion timing.
const data = bakeDraftingData(model, { explosion: 128, pressure: 96, delivery: 48 })
const json = JSON.stringify(data)
writeFileSync(new URL('lines.json', dir), json)
console.log(data.edges.length + ' visible edges, ' + data.points.length / 4 + ' vertices, ' + json.length + ' bytes, ' + gzipSync(json).length + ' gzip')
