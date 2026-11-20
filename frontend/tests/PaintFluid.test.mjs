import { describe, it, expect } from 'vitest';
import { PaintFluid, STEP, fluidPath } from '../src/landing-scenes/paint-fluid.mjs';
const advance=(f,seconds)=>{for(let t=0;t<seconds;t+=STEP)f.step()};
const meanY=f=>f.particles.reduce((s,p)=>s+p.y,0)/f.particles.length;
describe('paint surface physics',()=>{
  it('responds to gravity and retains the film deposited along the flow',()=>{
    const stationary=new PaintFluid({gravity:0,seed:17}),falling=new PaintFluid({gravity:360,seed:17});
    for(const f of [stationary,falling]){f.impact({vy:450});advance(f,3)}
    expect(meanY(falling)-meanY(stationary)).toBeGreaterThan(15);
    expect(falling.film.length).toBeGreaterThan(0);
    expect(fluidPath(falling)).not.toBe(fluidPath(stationary));
  });
  it('an energetic impact spreads farther than a slow impact',()=>{
    const slow=new PaintFluid({gravity:0,seed:42}),fast=new PaintFluid({gravity:0,seed:42});
    slow.impact({vy:30});fast.impact({vy:900});advance(slow,.3);advance(fast,.3);
    expect(fast.bounds().right-fast.bounds().x).toBeGreaterThan((slow.bounds().right-slow.bounds().x)*1.2);
  });
  it('collides with a surface and sleeps without doing further simulation work',()=>{
    const f=new PaintFluid({gravity:900,floor:35,dryAfter:2});f.impact({vy:600});advance(f,3);
    expect(f.collisions).toBeGreaterThan(0);expect(f.sleeping).toBe(true);
    expect(f.particles.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.y<=31)).toBe(true);
    const steps=f.steps,path=fluidPath(f);advance(f,20);
    expect(f.steps).toBe(steps);expect(fluidPath(f)).toBe(path);
  });
  it('bounds include the whole deposited path and material kernel',()=>{
    const f=new PaintFluid({gravity:500});f.impact({x:-50,y:120,vy:800});advance(f,5);
    const b=f.bounds();
    for(const p of [...f.particles,...f.film]){
      expect(p.x-f.radius*2.65).toBeGreaterThan(b.x);expect(p.x+f.radius*2.65).toBeLessThan(b.right);
      expect(p.y-f.radius*2.65).toBeGreaterThan(b.y);expect(p.y+f.radius*2.65).toBeLessThan(b.bottom);
    }
  });
});
