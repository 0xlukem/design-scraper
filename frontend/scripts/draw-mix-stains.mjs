// Static, reproducible paint assets. Independent silhouettes and gravity-led runs;
// no per-frame filters, layout work, or random changes while using the mixer.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const output = resolve(import.meta.dirname, '../public/images');
const colors = { pink: '#f24cad', blue: '#287df1', cyan: '#74e9ee', coral: '#ff7547', acid: '#efff76' };
const fmt = n => Number(n.toFixed(2));
function seeded(seed) {
  let state = seed >>> 0;
  return (min = 0, max = 1) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return min + (state / 4294967296) * (max - min);
  };
}
function contour(random, cx, cy, rx, ry, roughness = 1) {
  // Correlated undulations form a puddle; fine noise breaks the machine-smooth edge.
  const phases = Array.from({ length: 5 }, () => random(0, Math.PI * 2));
  const count = Math.min(72, Math.max(9, Math.ceil(Math.max(rx,ry)*2)));
  const points = Array.from({ length: count }, (_, i) => {
    const a = i / count * Math.PI * 2;
    const r = 1 + .21 * Math.sin(3 * a + phases[0]) + .13 * Math.sin(5 * a + phases[1])
      + .07 * Math.sin(9 * a + phases[2]) + random(-.055, .055) * roughness;
    return [cx + Math.cos(a) * rx * r + Math.sin(a * 2 + phases[3]) * rx * .13,
      cy + Math.sin(a) * ry * r + Math.cos(a * 3 + phases[4]) * ry * .12];
  });
  return 'M' + points.map(p => p.map(fmt).join(' ')).join('L') + 'Z';
}
function run(random, x, y, length, width) {
  const drift = random(-3, 3), bottom = y + length, neck = width * random(.22, .43);
  // Wide pooled root narrows to a wandering rivulet, then an unequal weighted tip.
  const d = `M${fmt(x-width)} ${fmt(y)} C${fmt(x-width*.7)} ${fmt(y+18)} ${fmt(x-neck)} ${fmt(y+20)} ${fmt(x-neck)} ${fmt(y+length*.42)}
    C${fmt(x-neck+drift)} ${fmt(y+length*.7)} ${fmt(x+drift-width*.6)} ${fmt(bottom-8)} ${fmt(x+drift-width*.55)} ${fmt(bottom)}
    C${fmt(x+drift-width*.4)} ${fmt(bottom+width*1.3)} ${fmt(x+drift+width*.85)} ${fmt(bottom+width*.9)} ${fmt(x+drift+width*.65)} ${fmt(bottom-2)}
    C${fmt(x+drift+neck)} ${fmt(y+length*.73)} ${fmt(x+neck)} ${fmt(y+length*.55)} ${fmt(x+neck)} ${fmt(y+length*.34)}
    C${fmt(x+neck)} ${fmt(y+13)} ${fmt(x+width*.8)} ${fmt(y+8)} ${fmt(x+width)} ${fmt(y)}Z`;
  return `<path d="${d}"/>`;
}
function stain(seed, color, cx, cy, rx, ry, longest) {
  const r = seeded(seed), shapes = [], highlights = [];
  shapes.push(`<path d="${contour(r,cx,cy,rx,ry)}"/>`);
  // Unequal fused pools and thin impact streaks give each spill a direction.
  for (let i=0; i<7; i++) {
    const x=cx+r(-rx*.95,rx*.95), y=cy+r(-ry*.75,ry*.6);
    shapes.push(`<path d="${contour(r,x,y,r(3,rx*.4),r(2,ry*.75))}"/>`);
  }
  const count = Math.round(r(3,6));
  for (let i=0;i<count;i++) {
    const x = cx + (i / (count-1) - .5) * rx * 1.3 + r(-6,6);
    const y = cy + r(0,ry*.35), length = i===1 ? longest : r(18,longest*.76), width=r(1.7,4.8);
    shapes.push(run(r,x,y,length,width));
    if (length>60) highlights.push(`<path d="M${fmt(x-.5)} ${fmt(y+19)}q-1 ${fmt(length*.24)} 0 ${fmt(length*.52)}" fill="none" stroke="#ffffff" stroke-opacity=".15" stroke-width=".7"/>`);
    if (r()>.45) shapes.push(`<path d="${contour(r,x+r(-2,2),y+length+r(15,30),r(1.1,2.7),r(2,5))}"/>`);
  }
  // Specks cluster along impact trajectories instead of forming a circular halo.
  for(let i=0;i<70;i++) {
    const side = r()>.38?1:-1;
    const reach = r(.25,1.75), x=cx+side*rx*reach+r(-15,15), y=cy+r(-ry*2.9,ry*1.9);
    const radius = r()>.8?r(1.4,3.9):r(.35,1.3);
    shapes.push(`<path d="${contour(r,x,y,radius,radius*r(.5,2.4),.7)}"/>`);
  }
  // Small unpainted pinholes break up large areas, like a splash on a dry surface.
  const pores = Array.from({length:20},()=>`<path d="${contour(r,cx+r(-rx*.65,rx*.65),cy+r(-ry*.55,ry*.55),r(.4,1.7),r(.3,1.1))}"/>`).join('');
  return `<g fill="${color}">${shapes.join('')}</g><g fill="#171815" opacity=".42">${pores}</g>${highlights.join('')}`;
}
const specs = {
  left: {w:180,h:2370, marks:[
    [133,'pink',22,130,66,25,153], [817,'blue',9,635,80,29,209],
    [421,'pink',41,1070,84,34,204], [937,'blue',28,1640,63,19,163],
    [203,'acid',-5,2090,49,16,115],
  ]},
  right: {w:180,h:2690, marks:[
    [574,'coral',154,95,57,27,127], [623,'pink',174,720,40,17,81],
    [904,'cyan',147,1150,76,23,236], [731,'coral',165,1750,66,33,182],
    [112,'blue',171,2310,75,24,141],
  ]},
  banner: {w:230,h:270, marks:[[661,'blue',91,48,98,25,173],[283,'pink',20,73,32,13,72]]},
  'banner-right': {w:230,h:270, marks:[[782,'coral',166,38,75,30,190],[904,'cyan',210,69,25,13,98]]},
};
for (const [name,{w,h,marks}] of Object.entries(specs)) {
  const body = marks.map(([seed,color,...geometry])=>stain(seed,colors[color],...geometry)).join('');
  await writeFile(resolve(output,`mix-paint-${name}.svg`),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>\n`);
}
