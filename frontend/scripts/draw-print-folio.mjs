// Rebuild the transparent ink plates with: node scripts/draw-print-folio.mjs /path/to/anatomy
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const kit = await import(pathToFileURL(resolve(process.argv[2], 'kit/iso-kit.mjs')))
const plates = []
// The artwork is consumed as a luminance mask. Dark faces hide the ink on
// surfaces behind them; only the light strokes become ink on the page.
const ink = (d, width = .7) => d ? `<path d="${d}" stroke="white" stroke-width="${width}" fill="none"/>` : ''
const maskFace = d => `<path d="${d}" fill="black"/>`
const plate = (id, geometry) => plates.push(`<g id="${id}">${geometry}</g>`)
const plane = (matrix, content) => `<g transform="${matrix}">${content}</g>`
const rect = (x, y, w, h, r = 0, width = .75) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="black" stroke="white" stroke-width="${width}"/>`
const dot = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="black" stroke="white" stroke-width=".65"/>`
const lettering = (label, x, y, size, serif = false) =>
  `<text x="${x}" y="${y}" fill="white" font-family="${serif ? 'Georgia,serif' : 'monospace'}" font-size="${size}">${label}</text>`
const range = (n, make) => Array.from({length:n}, (_, i) => make(i)).join('')
const camera = elevation => ({ origin: [0, 0], scale: 1, azimuth: 65, elevation })
function workshop(P) {
  const solid = ({fill, outline, crease, bevel}) => maskFace(fill) + ink(outline, 1.02) + ink(crease, .65) + ink(bevel, .42)
  return {
    slab: (x,y,w,d,z,h,r=0,bevel=0) => solid(kit.slabOf({x,y,w,d,r}, z,h,P,5,bevel)),
    round: (x,y,r,z,h) => solid(kit.cylinder(x,y,r,z,h,P,32)),
    flat: (x,y,z,content) => plane(kit.topMatrix([x,y],z,P),content),
    front: (x,y,z,content) => plane(kit.sideMatrix([x,y],z,P,'left'),content),
    line: dots => ink(kit.pathOf(dots.map(v => kit.iso(v,P))), .75),
  }
}
const punchCamera = camera(29)
const punch = workshop(punchCamera)
function screw(x,y,z,r) {
  return punch.round(x,y,r,z,.55) + punch.flat(x,y,z+.56, ink(`M${-r*.65} ${r*.35}L${r*.65} ${-r*.35}`,.65))
}
// A rectangular copper matrix is trapped between the two bolted cheeks
// of a bench block. The punch's smallest face registers with its center.
plate('matrix-block',
  punch.slab(-55,-26,110,52,0,5,3,1) +
  punch.slab(-50,-23,100,46,5,12,2) +
  punch.slab(-30,-18,60,36,17,8,.8,.65) +
  [-47,30].map(x => punch.slab(x,-20,17,40,17,9,1,.7) +
    screw(x+8.5,-12,26,2.9) + screw(x+8.5,12,26,2.9)).join('')
)
const letter = 'M-13 -8h7v1.5h-1.8l3.2 10 2.6-7.1L-3.7-6.5h-1.4V-8h7.3v1.5H.5L4 3.8 7.4-6.5H5.3V-8h6.5v1.5H9.7L4.8 8H2.5L-1.3-2.4-5.1 8h-2.4l-4.1-14.5H-13Z'
plate('matrix-letter', punch.flat(0,0,25.1, ink(letter,.95) + ink('M-7.5 6.2l-3.7-11.8M4.4 6.4l4-12.1',.5)))
// The pear-shaped turned handle seats inside a metal ferrule on the die.
const ferruleTop = 50
const [, handleY] = kit.iso([0, 0, ferruleTop], punchCamera)
const handleOutline = [
  'M-8 0 C-8 -8 -10 -12 -16 -19',
  'C-21 -25 -26 -32 -26 -39',
  'C-26 -49 -15 -55 0 -55',
  'C15 -55 26 -49 26 -39',
  'C26 -32 21 -25 16 -19',
  'C10 -12 8 -8 8 0 A8 3.9 0 0 1 -8 0Z',
].join(' ')
// Long, irregular grain follows the curve into the neck. The metal has clean edges.
const woodGrain = [
  'M-20 -43 C-22 -34 -12 -30 -8 -22 C-6 -18 -6 -14 -5 -12',
  'M-16 -45 C-19 -38 -11 -32 -8 -30',
  'M2 -50 C11 -48 14 -42 12 -36 C10 -31 5 -29 6 -23',
  'M5 -46 C11 -43 10 -38 8 -36 C6 -38 6 -42 5 -46Z',
  'M19 -35 C18 -27 11 -24 9 -20',
].join(' ')
plate('hand-punch',
  punch.slab(-15, -10, 30, 20, 25, 10, 1.5, .8) +
  punch.front(-3, 10.02, 27, lettering('w', 0, 0, 7.5, true)) +
  punch.round(0, 0, 5.6, 35, 9) +
  punch.round(0, 0, 8.4, 43, ferruleTop - 43) +
  punch.round(0, 0, 8.9, 44, 1.2) +
  `<g transform="translate(0 ${handleY})">${maskFace(handleOutline)}${ink(handleOutline, 1.1)}${ink(woodGrain, .65)}</g>`
)

// A sheet of type and baseline specimens, two ink tools and a low workbench.
// The cards rotate in the tabletop plane about their one binding rivet.
const deskCamera = camera(36)
const desk = workshop(deskCamera)
const ticks = range(29,i=>ink(`M${i*2.35+4} 1v${i%5===0?5:i%2===0?3:2}`,.6))
const specimen = lettering('Aa',6,27,27,true) +
  lettering('Ag',53,24,11,true) + ink('M53 28h19M53 31h15M6 34h66',.55) +
  ink('M6 40h46M6 43h54M6 46h39M6 49h48',.8) +
  ink('M3 3h3M4.5 1.5v3M73 51h3M74.5 49.5v3',.5)
const legs = [[-65,-33],[57,-33],[-65,27],[57,27]]
plate('proof-table',
  legs.map(([x,y])=>desk.slab(x,y,6,6,0,29,.5)).join('') +
  desk.slab(-65,-33,128,66,22,7,1) +
  desk.slab(-70,-38,140,76,29,4.4,2,1) +
  desk.slab(-62,-30,79,55,33.4,.6,.3) +
  desk.flat(-62,-30,34.1,specimen)
)
// Fan blades are drawn in local plan coordinates. Engraved line screens show
// different ink densities without adding colored or filled swatches.
for(let n=0;n<4;n++){
  const thumb = rect(-3,-3,16,49,2,.95)
  const samples = [0,1,2].map((_,i)=>{
    const y=8+i*11
    const pattern=range(3+i+n%2,j=>ink(`M-.2 ${y+j*1.18}H9.8`,.52))
    return rect(-.5,y-1,10.6,8,0,.55)+pattern
  }).join('')
  plate('swatch-'+n,thumb+samples+dot(3.3,.8,1.1))
}
plate('type-rule', rect(0,0,76,10,.8,.85)+ticks+ink('M4 8.1h65',.4)+dot(72.5,5,1.2))

// Print-shop dispatch cabinet. Five shelves and their covers interleave the
// moving sheets in depth order so each slips behind the shelf above it.
const cabinetCamera = camera(18)
const cabinet = workshop(cabinetCamera)
plate('dispatch-back',
  cabinet.slab(-55,-20,110,45,0,5,1,1) +
  cabinet.slab(-55,-20,110,3,5,88) +
  cabinet.slab(-55,-17,3,42,5,88)
)
for(const [i,label] of ['MD EXT','MD CMP','CSS','TW v4','JSON'].entries()){
  const z=5+i*17.5
  plate('shelf-'+i, cabinet.slab(-52,-17,104,42,z,2.5) )
  const faceZ=z+3.15
  plate('sheet-'+i,
    cabinet.slab(-22,-9,68,39,faceZ-.65,.65,.8) +
    cabinet.flat(-22,-9,faceZ, ink('M4 4h27M4 6.5h20M4 30h40M4 32.5h26',.45) +
    ink('M61 35h4M63 33v4',.5))
  )
  const labelY=25.5
  plate('tag-'+i,
    cabinet.slab(-52,-17,24,42,z+2.5,15) +
    cabinet.front(-50,labelY,z+14,rect(0,0,20,9,.8,.55)+
    dot(1.6,4.6,.5)+dot(18.4,4.6,.5)+
    `<text x="10" y="6.1" text-anchor="middle" fill="white" font-family="monospace" font-size="3.4">${label}</text>`)
  )
}
plate('dispatch-casing',
  cabinet.slab(52,-17,3,42,5,88) +
  cabinet.slab(-56,-21,112,47,93,3.7,1,.5)
)

const directory = new URL('../public/images/', import.meta.url)
writeFileSync(new URL('workshop-plates.svg',directory),
  `<svg xmlns="http://www.w3.org/2000/svg"><defs stroke-linecap="round" stroke-linejoin="round">${plates.join('')}</defs></svg>\n`)
const views=[
  {box:'-82 -164 164 198', strokeTravel:kit.screenRise(43,punchCamera)},
  {box:'-105 -87 210 135', fan:kit.topMatrix([25,-25],33.9,deskCamera), rule:kit.topMatrix([-59,13],34.7,deskCamera)},
  {box:'-83 -139 164 163', sheetTravel:kit.axisVector(cabinetCamera,[0,30,0])},
]
writeFileSync(new URL('../src/components/letterpress/workshop-views.json',import.meta.url),JSON.stringify(views,null,2)+'\n')
