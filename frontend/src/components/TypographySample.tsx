import type { CSSProperties } from 'react'
import type { TypographySpec } from '../types'

function value(token: TypographySpec['size']) {
  return typeof token?.value === 'string' || typeof token?.value === 'number' ? String(token.value) : undefined
}

export default function TypographySample({ spec }: { spec: TypographySpec }) {
  const size = value(spec.size)
  const family = value(spec.family)
  const weight = value(spec.weight)
  const lineHeight = value(spec.line_height)
  const letterSpacing = value(spec.letter_spacing)
  const canPreview = Boolean(size && family)
  const style: CSSProperties = {
    fontFamily: family,
    fontSize: size,
    fontWeight: weight,
    lineHeight,
    letterSpacing,
  }
  const missing = [!size && 'size', !family && 'family', !weight && 'weight', !lineHeight && 'line height', !letterSpacing && 'letter spacing'].filter(Boolean)
  return <article className="type-sample">
    {canPreview ? <p className="type-specimen" style={style}>Aa — Design systems stay coherent.</p>
      : <p className="type-unavailable">No visual sample: font family or size was not recorded.</p>}
    <div className="type-metadata">
      <strong>{spec.name}</strong>
      <span>{spec.use}</span>
      <dl className="type-metrics">
        <div className="type-family"><dt>Font family</dt><dd>{family ?? 'Not recorded'}</dd></div>
        <div><dt>Size</dt><dd>{size ?? '—'}</dd></div>
        <div><dt>Weight</dt><dd>{weight ?? '—'}</dd></div>
        <div><dt>Line height</dt><dd>{lineHeight ?? '—'}</dd></div>
        <div><dt>Letter spacing</dt><dd>{letterSpacing ?? '—'}</dd></div>
      </dl>
      {missing.length > 0 && <small>Not recorded: {missing.join(', ')}.</small>}
    </div>
  </article>
}
