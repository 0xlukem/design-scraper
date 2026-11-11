import { CanvasTexture, SRGBColorSpace } from 'three'

// Artwork for the printing plates. The same engravings are imposed on a
// three-column landscape sheet or three rows of a portrait sheet.
const ink = '#1c1d19'
const graphite = '#55564e'
const guide = '#aaa99e'
const stock = '#f4f2e9'
const mono = "'Geist Mono Variable', monospace"
const sans = "'Geist Variable', Arial, sans-serif"
const serif = 'Georgia, serif'

function path(ctx, points, color = ink, width = 1.7) {
  ctx.beginPath()
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
}

function text(ctx, value, x, baseline, font, color = ink) {
  ctx.font = font
  ctx.fillStyle = color
  ctx.fillText(value, x, baseline)
}

function rectangle(ctx, x, y, w, h, fill = stock, stroke = ink, weight = 1.8) {
  ctx.fillStyle = fill
  ctx.fillRect(x, y, w, h)
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = weight
    ctx.strokeRect(x, y, w, h)
  }
}

function hatching(ctx, x, y, w, h, spacing = 7) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  for (let i = -h; i < w; i += spacing) path(ctx, [[x+i, y+h], [x+i+h, y]], graphite, 1.3)
  ctx.restore()
}

function arch(ctx, x, y, w, h) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.fillStyle = ink
  ctx.fillRect(x, y, w, h)
  // Quarter circles continuing into straight bands, as on the Folio site.
  for (let i = 0; i < 5; i++) {
    const radius = w * (.17 + .22 * i)
    const cx = x + w * .75, cy = y + h * 1.01
    ctx.beginPath()
    ctx.arc(cx, cy, radius, Math.PI, Math.PI * 1.5)
    ctx.lineTo(x + w, cy - radius)
    ctx.strokeStyle = stock
    ctx.lineWidth = w * .075
    ctx.stroke()
  }
  ctx.restore()
}

function drawBrowser(ctx, name, domain, alternate = false) {
  // The address field belongs to the window. Its caret remains at the input.
  rectangle(ctx, 8, 31, 334, 195, '#b6b5a9')
  rectangle(ctx, 3, 25, 334, 195)
  rectangle(ctx, 3, 25, 334, 42, ink)
  for (const x of [15, 24, 33]) {
    ctx.beginPath()
    ctx.arc(x, 46, 2.1, 0, 2 * Math.PI)
    ctx.fillStyle = stock
    ctx.fill()
  }
  text(ctx, domain, 45, 53, '20px ' + mono, stock)
  const end = 48 + ctx.measureText(domain).width
  path(ctx, [[end, 36], [end, 57]], stock)
  text(ctx, name, 18, 108, alternate ? 'bold 35px ' + sans : 'bold 39px ' + serif)
  path(ctx, [[18, 118], [321, 118]])
  if (alternate) {
    rectangle(ctx, 19, 133, 99, 70, ink, null)
    hatching(ctx, 130, 133, 84, 70, 7)
    rectangle(ctx, 225, 133, 95, 70, '#bab9ac', null)
  } else {
    text(ctx, 'Aa', 18, 183, '66px ' + serif)
    path(ctx, [[19, 198], [126, 198]], ink, 2.5)
    path(ctx, [[19, 205], [92, 205]], graphite)
    arch(ctx, 161, 131, 160, 72)
  }
}

function inspectType(ctx) {
  // A baseline, cap line and two bearing marks turn the type into a specimen.
  for (const y of [65, 111, 153]) path(ctx, [[9, y], [219, y]], guide, 1.3)
  for (const x of [21, 184]) path(ctx, [[x, 39], [x, 171]], guide, 1.25)
  text(ctx, 'Aa', 18, 153, '133px ' + serif)
  path(ctx, [[18, 153], [188, 153]], ink)
  text(ctx, 'Georgia', 19, 209, '26px ' + serif)
  // Orthogonal dimension with engineer's oblique ticks (no arrowheads).
  const x0 = 238, x1 = 324, y = 162
  path(ctx, [[x0, y], [x1, y]])
  for (const x of [x0, x1]) {
    path(ctx, [[x, y-15], [x, y+15]], graphite)
    path(ctx, [[x-4, y+5], [x+4, y-5]], ink, 2)
  }
  text(ctx, '24 px', 245, 201, '23px ' + mono)
  rectangle(ctx, 232, 52, 97, 44)
  rectangle(ctx, 232, 52, 50, 44, ink)
  hatching(ctx, 282, 52, 47, 44, 6)
  text(ctx, '#BD4028', 228, 122, '22px ' + mono)
}

function foldedDocument(ctx, x, y, w, h) {
  const fold = 20
  const contour = [[x, y], [x+w-fold, y], [x+w, y+fold], [x+w, y+h], [x, y+h], [x, y]]
  ctx.beginPath()
  contour.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))
  ctx.fillStyle = stock
  ctx.fill()
  path(ctx, contour, ink, 2)
  path(ctx, [[x+w-fold, y], [x+w-fold, y+fold], [x+w, y+fold]], ink, 1.6)
}

function exportStack(ctx, mixed) {
  foldedDocument(ctx, 102, 10, 205, 160)
  text(ctx, 'tokens.json', 117, 40, '550 21px ' + mono)
  foldedDocument(ctx, 67, 55, 255, 150)
  text(ctx, 'design-variables.css', 80, 85, '550 19px ' + mono)
  foldedDocument(ctx, 31, 101, 231, 132)
  text(ctx, mixed ? 'mixed-design.md' : 'design.md', 44, 134, (mixed ? '550 21px ' : '550 24px ') + mono)
  path(ctx, [[45, 146], [247, 146]], graphite)
  text(ctx, 'Aa', 45, 203, '62px ' + serif)
  if (mixed) {
    arch(ctx, 155, 162, 43, 45)
    hatching(ctx, 198, 162, 43, 45, 5)
  } else arch(ctx, 155, 162, 86, 45)
  path(ctx, [[46, 217], [243, 217]], graphite, 1.2)
}

function sourcePair(ctx) {
  ctx.save()
  ctx.translate(4, -3)
  ctx.scale(.74, .74)
  drawBrowser(ctx, 'Folio', 'folio.example')
  ctx.restore()
  ctx.save()
  ctx.translate(87, 70)
  ctx.scale(.74, .74)
  drawBrowser(ctx, 'Grid', 'grid.example', true)
  ctx.restore()
}

function mixBalance(ctx) {
  // The blocks reproduce the actual 75/25 stop, with each source's pattern.
  const x = 16, y = 43, w = 314, h = 101, cut = x + w * .75
  arch(ctx, x, y, w * .75, h)
  hatching(ctx, cut, y, w * .25, h)
  ctx.lineWidth = 1.8
  ctx.strokeStyle = ink
  ctx.strokeRect(x, y, w, h)
  path(ctx, [[cut, y], [cut, y+h]])
  path(ctx, [[x, 166], [330, 166]], ink, 3)
  for (let stop = 0; stop <= 4; stop++) {
    const xStop = x + w * stop / 4
    path(ctx, [[xStop, 158], [xStop, 174]], graphite)
  }
  rectangle(ctx, cut-4, 153, 8, 26, ink)
  text(ctx, '75%', x, 215, '32px ' + mono)
  ctx.save()
  ctx.textAlign = 'right'
  text(ctx, '25%', x+w, 215, '32px ' + mono)
  ctx.restore()
}

function register(ctx, x, y) {
  path(ctx, [[x-6, y], [x+6, y]], graphite, 1.35)
  path(ctx, [[x, y-6], [x, y+6]], graphite, 1.35)
}

// The first pass is a pencil plan, without any of the later solid ink or
// captions. Its contours register with the browser, specimen and files above it.
function construction(ctx, stage, mixed) {
  const lead = '#8a8c82'
  const draw = points => path(ctx, points, lead, 1.7)
  function outline(x, y, w, h) {
    draw([[x,y], [x+w,y], [x+w,y+h], [x,y+h], [x,y]])
  }
  function browserFrame() {
    outline(3,25,334,195)
    outline(12,31,316,30)
    draw([[18,118], [321,118]])
    outline(161,131,160,72)
    draw([[18,179], [131,179]])
    draw([[18,198], [105,198]])
  }
  if (stage === 0 && mixed) {
    for (const [x,y] of [[4,-3],[87,70]]) {
      ctx.save(); ctx.translate(x,y); ctx.scale(.74,.74); browserFrame(); ctx.restore()
    }
  } else if (stage === 0) {
    browserFrame()
  } else if (stage === 1 && mixed) {
    outline(16,43,314,101)
    draw([[251.5,40], [251.5,177]])
    draw([[16,166], [330,166]])
    for (let t=0;t<=4;t++) draw([[16+t*78.5,158], [16+t*78.5,174]])
  } else if (stage === 1) {
    for (const y of [65,111,153]) draw([[9,y],[219,y]])
    for (const x of [21,184]) draw([[x,39],[x,171]])
    draw([[21,153],[61,65],[99,153]])
    outline(232,52,97,44)
    draw([[238,148],[238,176]]); draw([[324,148],[324,176]])
    draw([[233,162],[329,162]])
  } else {
    for (const [x,y,w,h] of [[102,10,205,160],[67,55,255,150],[31,101,231,132]]) {
      ctx.fillStyle = stock; ctx.fillRect(x,y,w,h)
      draw([[x,y],[x+w-20,y],[x+w,y+20],[x+w,y+h],[x,y+h],[x,y]])
      draw([[x+w-20,y],[x+w-20,y+20],[x+w,y+20]])
      draw([[x+14,y+35],[x+w-44,y+35]])
    }
  }
}

function canvas() { return document.createElement('canvas') }

export function makePaperInk(labels, mode) {
  const image = canvas(), structure = canvas(), figures = canvas()
  const ctx = image.getContext('2d')
  const texture = new CanvasTexture(image)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  const mixed = mode === 'mix'
  const engravings = mixed
    ? [sourcePair, mixBalance, ctx => exportStack(ctx, true)]
    : [ctx => drawBrowser(ctx, 'Folio', 'folio.example'), inspectType, ctx => exportStack(ctx, false)]
  let cells = [], inkKey

  function layout(compact, sheetAspect) {
    const W = compact ? 600 : 1560, H = Math.round(W / sheetAspect)
    const density = compact ? 1.6 : 1.25
    const areas = [image, structure, figures]
    for (const area of areas) {
      area.width = Math.round(W * density)
      area.height = Math.round(H * density)
    }
    const base = structure.getContext('2d'), art = figures.getContext('2d')
    for (const layer of [base, art]) layer.scale(density, density)
    const left = compact ? 34 : 62, top = compact ? 54 : 103
    const right = W-left, bottom = H-(compact ? 38 : 75)
    for (const x of [left, right]) for (const y of [top, bottom]) register(base, x, y)
    cells = []
    for (let i=0; i<3; i++) {
      const cellW = (right-left) / (compact ? 1 : 3)
      const cellH = (bottom-top) / (compact ? 3 : 1)
      const x = left + (compact ? 0 : i*cellW), y = top + (compact ? i*cellH : 0)
      if (i > 0) {
        if (compact) path(base, [[left, y], [right, y]], guide, 1)
        else path(base, [[x, top+16], [x, bottom-16]], guide, 1.15)
      }
      const scale = compact ? Math.min((cellW-56)/350, (cellH-62)/245) : (cellW - 48) / 350
      const drawingX = x + (cellW - 350*scale) / 2
      const drawingY = y + (compact ? 1 : (cellH-245*scale)*.43 - 29)
      base.save()
      base.translate(drawingX, drawingY)
      base.scale(scale, scale)
      construction(base, i, mixed)
      base.restore()
      art.save()
      art.translate(drawingX, drawingY)
      art.scale(scale, scale)
      art.fillStyle = stock
      art.fillRect(-4, -4, 358, 250)
      engravings[i](art)
      art.restore()
      const titleSize = compact ? 35 : 39
      const countSize = compact ? 27 : 29
      const captionY = compact ? y+cellH-24 : drawingY+245*scale+76
      art.font = '500 ' + countSize + 'px ' + mono
      const ordinal = '0'+(i+1)
      const ordinalW = art.measureText(ordinal).width
      art.font = '560 ' + titleSize + 'px ' + sans
      const labelW = art.measureText(labels[i]).width
      const gap = compact ? 18 : 20
      const captionX = x + (cellW - ordinalW - gap - labelW)/2
      text(art, ordinal, captionX, captionY, '500 '+countSize+'px '+mono, graphite)
      text(art, labels[i], captionX+ordinalW+gap, captionY, '560 '+titleSize+'px '+sans)
      cells.push({ x: Math.floor(x*density), y: Math.floor(y*density), w: Math.ceil(cellW*density), h: Math.ceil(cellH*density) })
    }
    inkKey = undefined
  }

  function update(pose) {
    const { width, height } = image
    const amounts = [pose.plate, pose.step0, pose.step1, pose.step2]
    const key = amounts.map(v => Math.round(v * 1000)).join('/')
    if (key === inkKey) return
    inkKey = key
    ctx.fillStyle = stock
    ctx.fillRect(0, 0, width, height)
    if (pose.plate > 0) {
      const h = height * pose.plate
      ctx.drawImage(structure, 0, height-h, width, h, 0, height-h, width, h)
    }
    // A common left-to-right ink pass gives each caption and its drawing
    // the same onset, regardless of the orientation of the paper.
    cells.forEach(({ x, y, w, h }, i) => {
      const reveal = amounts[i+1]
      if (reveal <= 0) return
      const strip = Math.ceil(w * reveal)
      ctx.drawImage(figures, x, y, strip, h, x, y, strip, h)
    })
    texture.needsUpdate = true
  }
  return { texture, layout, update }
}
