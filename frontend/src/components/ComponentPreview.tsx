import type { CSSProperties } from 'react'
import type { ComponentSpec } from '../types'

// Only presentational properties are eligible. Never load resources from tokens.
const properties = {
  'background-color': 'backgroundColor', 'bg-color': 'backgroundColor', bg: 'backgroundColor',
  'border-radius': 'borderRadius', radius: 'borderRadius',
  'border-color': 'borderColor', 'border-width': 'borderWidth', 'border-style': 'borderStyle', border: 'border',
  'box-shadow': 'boxShadow', shadow: 'boxShadow',
  'font-family': 'fontFamily', 'font-size': 'fontSize', 'font-weight': 'fontWeight',
  'line-height': 'lineHeight', 'letter-spacing': 'letterSpacing',
  'padding-top': 'paddingTop', 'padding-right': 'paddingRight',
  'padding-bottom': 'paddingBottom', 'padding-left': 'paddingLeft', padding: 'padding',
  'text-color': 'color', color: 'color',
} as const
const suffixes = Object.keys(properties).sort((a, b) => b.length - a.length) as (keyof typeof properties)[]

export function componentPreviewStyle(component: ComponentSpec): CSSProperties {
  const style: Record<string, string> = {}
  for (const token of component.values) {
    const name = token.name?.toLowerCase() ?? ''
    const property = suffixes.find(suffix => name === suffix || name.endsWith(`-${suffix}`))
    if (!property || !['string', 'number'].includes(typeof token.value)) continue
    const value = String(token.value)
    if (/url\s*\(|image-set\s*\(|var\s*\(|env\s*\(|[;{}@]/i.test(value)) continue
    // Don't interpret unknown compound names such as border-color as text color.
    style[properties[property]] = value
  }
  return style as CSSProperties
}

function lightText(color: CSSProperties['color']) {
  const value = String(color ?? '').trim().toLowerCase()
  if (value === 'white') return true
  const hex = value.match(/^#([\da-f]{6}|[\da-f]{3})$/i)?.[1]
  const rgb = hex
    ? (hex.length === 3 ? [...hex].map(c => c + c) : hex.match(/../g)!).map(c => parseInt(c, 16))
    : value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/)?.slice(1).map(Number)
  return Boolean(rgb && rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > 180)
}

export default function ComponentPreview({ component }: { component: ComponentSpec }) {
  const name = component.name.toLowerCase()
  const kind = /button|\bbtn\b/.test(name) ? 'button' : /input|field/.test(name) ? 'input' : /card|panel/.test(name) ? 'card' : null
  const style = componentPreviewStyle(component)
  if (!kind || !Object.keys(style).length) return null
  // A generic card with only a radius/border suggests a reconstruction we cannot support.
  if (kind === 'card' || Object.keys(style).length < 3) return <p className="component-preview-unavailable">No component preview: the saved properties are not enough to reconstruct its appearance. Inspect the recorded styles below.</p>

  return <figure className="component-preview" aria-label={`${component.name} property preview`}>
    <div className={`component-preview-stage${lightText(style.color) ? ' component-preview-dark' : ''}`} aria-hidden="true">
      {kind === 'button' ? <button className="component-specimen" type="button" tabIndex={-1} style={style}>Sample button</button>
        : kind === 'input' ? <input className="component-specimen" tabIndex={-1} readOnly value="Sample input" style={style} />
          : null}
    </div>
    <figcaption>Style preview, not the original component. Unrecorded styles use neutral defaults.</figcaption>
  </figure>
}
