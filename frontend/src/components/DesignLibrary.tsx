import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { AnalysisResult } from '../types'
import { formatLibraryDate, libraryExamples, type LibraryExample } from '../library'
import ResultPanel from './ResultPanel'
import { downloadFile, savedContent } from '../download'
import './library.css'

function readDesignId() {
  return window.location.hash.startsWith('#/library/') ? window.location.hash.slice('#/library/'.length) : null
}
function plainClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}
interface Props {
  active?: boolean
  busy?: boolean
  onUseReference?: (example: LibraryExample, result: AnalysisResult) => void
}
export default function DesignLibrary({ active = true, busy = false, onUseReference }: Props) {
  const [id, setId] = useState(readDesignId)
  const [loaded, setLoaded] = useState<{ id: string; result: AnalysisResult } | null>(null)
  const [error, setError] = useState<{ id: string; message: string } | null>(null)
  const [revision, setRevision] = useState(0)
  const [download, setDownload] = useState<{ id: string; status: 'loading' | 'done' | 'error' } | null>(null)
  const listScroll = useRef(0)
  const preview = useRef<HTMLDivElement>(null)
  const lastOpened = useRef<string | null>(null)
  const selected = libraryExamples.find(example => example.id === id)
  const result = loaded?.id === id ? loaded.result : null
  const message = error?.id === id ? error.message : ''
  useEffect(() => {
    if (!active) return
    const sync = () => setId(readDesignId())
    sync(); window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [active])
  useEffect(() => {
    if (!active) return
    if (!selected) {
      setLoaded(null); setError(null)
      if (!id && lastOpened.current) {
        document.getElementById(`open-${lastOpened.current}`)?.focus({ preventScroll: true })
        window.scrollTo?.({ top: listScroll.current, behavior: 'instant' })
      }
      return
    }
    let cancelled = false
    lastOpened.current = selected.id
    setLoaded(null); setError(null)
    preview.current?.focus({ preventScroll: true })
    preview.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
    selected.load().then(value => {
      if (!cancelled) setLoaded({ id: selected.id, result: value })
    }).catch(() => {
      if (!cancelled) setError({ id: selected.id, message: 'This design could not be opened. Check your connection and try again.' })
    })
    return () => { cancelled = true }
  }, [active, id, selected, revision])
  function navigate(event: MouseEvent<HTMLAnchorElement>, nextId: string | null) {
    if (!plainClick(event)) return
    event.preventDefault()
    if (nextId) listScroll.current = window.scrollY
    window.location.hash = nextId ? `/library/${nextId}` : '/library'
    setId(nextId)
  }
  async function downloadReference(example: LibraryExample) {
    setDownload({ id: example.id, status: 'loading' })
    try {
      const saved = await example.load()
      const content = savedContent(saved, 'extended')
      if (!content) throw new Error('Unavailable')
      downloadFile(content, `${example.id}-design.md`, 'text/markdown;charset=utf-8')
      setDownload({ id: example.id, status: 'done' })
    } catch { setDownload({ id: example.id, status: 'error' }) }
  }
  return <section id="design-library" className="design-library" aria-label="Design library">
    {!selected ? <>
      <div className="page-intro library-intro"><h1>Design library</h1><p>Saved designs, ready to explore. No analysis needed.</p></div>
      {id && <p role="alert" className="form-notice">This saved design was not found. Choose a design below.</p>}
      <div className="library-grid">{libraryExamples.map(example => <article key={example.id} className={`design-card design-card-${example.id}`}>
        <div className="library-cover"><img src={example.cover.src} alt={example.cover.alt} width={960} height={504} loading="lazy" decoding="async" /></div>
        <div className="card-meta"><span>{example.mode === 'mix' ? 'Mix' : example.category}</span><time dateTime={example.date}>{formatLibraryDate(example.date)}</time></div>
        <h2>{example.name}</h2>
        <p className="library-domains">{example.sources.map(url => new URL(url).hostname.replace(/^www\./, '')).join(' + ')}</p>
        <div className="library-preview-facts"><div className="library-palette" aria-label="Palette from the saved analysis">{example.preview.colors.map(color => <span key={color} style={{ background: color }} title={color} />)}</div><p title={example.preview.fonts.join(', ')}>{example.preview.fonts[0] || 'Font family not recorded'}{example.preview.fonts.length > 1 && ` +${example.preview.fonts.length - 1}`}</p></div>
        {example.preview.weights && <p className="library-mix-weights">{example.sources.map((source, index) => `${example.preview.weights![index]}% ${new URL(source).hostname.replace(/^www\./, '')}`).join(' · ')}</p>}
        <div className="library-card-actions"><a id={`open-${example.id}`} href={`#/library/${example.id}`} onClick={event => navigate(event, example.id)} className="action-button" aria-label={`View ${example.name} design`}>View design</a><button type="button" className="text-button" aria-label={`Download ${example.name} design.md`} disabled={download?.id === example.id && download.status === 'loading'} onClick={() => downloadReference(example)}>{download?.id === example.id && download.status === 'loading' ? 'Preparing…' : 'Download .md'}</button></div>
        {download?.id === example.id && download.status !== 'loading' && <p role="status" className="library-download-status">{download.status === 'done' ? 'Download prepared.' : 'Download failed. Try again or open the design.'}</p>}
      </article>)}</div>
    </> : <div id="saved-design-preview" ref={preview} tabIndex={-1} className="saved-preview" aria-label={`${selected.name} saved design`}>
      <div className="library-detail-nav"><a href="#/library" className="text-button" onClick={event => navigate(event, null)}>← Back to library</a>{onUseReference && <button className="text-button" type="button" disabled={!result || busy} onClick={() => result && !busy && onUseReference(selected, result)} title={busy ? 'Wait for the current analysis to finish' : undefined}>Use as reference</button>}</div>
      <p className="library-snapshot">Saved {formatLibraryDate(selected.date)} · Reflects the analysis date.</p>
      {!result && <h1 className="library-loading-title">{selected.name}</h1>}
      {!result && !message && <p role="status">Opening saved design…</p>}
      {message && <p role="alert">{message} <button type="button" onClick={() => setRevision(value => value + 1)} className="text-button">Try again</button></p>}
      {result && <ResultPanel active={active} headingLevel="h1" title={selected.name} mode={selected.mode} loading={false} error={null} result={result} historical onRetry={() => {}} />}
    </div>}
  </section>
}
