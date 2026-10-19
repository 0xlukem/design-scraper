import { useRef, useState, type CSSProperties } from 'react'
import type { AnalysisResult, AppMode } from '../types'
import { downloadFile, downloadFormats, savedContent } from '../download'
import { formatLibraryDate, libraryExamples, type LibraryExample } from '../library'
import ResultPanel from './ResultPanel'

const mainDocument = downloadFormats.find(item => item.id === 'extended')!

function DesignCard({ example, onOpen }: { example: LibraryExample; onOpen: () => void }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  async function download() {
    if (busy) return
    setBusy(true); setNotice('')
    try {
      const result = await example.load()
      const content = savedContent(result, 'extended')
      if (!content) throw new Error('Unavailable format')
      downloadFile(content, mainDocument.label, mainDocument.mime)
      setNotice(`${mainDocument.label} downloaded.`)
    } catch { setNotice('Download unavailable. Try again.') }
    finally { setBusy(false) }
  }
  const style = { '--cover-tone': example.tone, '--swatch-1': example.palette[0], '--swatch-2': example.palette[1], '--swatch-3': example.palette[2], '--swatch-4': example.palette[3] } as CSSProperties
  return <article className={`design-card design-card-${example.id}`} style={style}>
    <div className="library-cover" aria-hidden="true"><div className="cover-orbit" /><span className="cover-type">{example.initials}</span><div className="cover-palette"><i /><i /><i /><i /></div><span className="cover-label">{example.mode === 'mix' ? 'THE COMBINATION' : 'THE DESIGN STUDY'}</span></div>
    <div className="card-meta"><span>{example.category}</span><time dateTime={example.date}>{formatLibraryDate(example.date)}</time></div>
    <h2>{example.name}</h2>
    <p>{example.description}</p>
    <div className="card-sources">{example.sources.map(url => <a key={url} href={url} target="_blank" rel="noreferrer">{new URL(url).hostname}<span className="sr-only"> (opens in a new tab)</span></a>)}</div>
    <div className="card-actions">
      <button id={`open-${example.id}`} type="button" className="action-button" onClick={onOpen} aria-label={`View ${example.name} design`}>View design</button>
      <button type="button" className="text-button" disabled={busy} onClick={() => void download()} aria-label={`Download ${example.name} ${mainDocument.label}`}>{busy ? 'Preparing download…' : `Download ${mainDocument.label}`}</button>
      <p role="status" className="field-help">{notice}</p>
    </div>
  </article>
}

export default function DesignLibrary({ onUseSources, busy = false }: { onUseSources?: (mode: AppMode, sources: string[]) => void; busy?: boolean }) {
  const [selected, setSelected] = useState<LibraryExample | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const version = useRef(0)
  const preview = useRef<HTMLDivElement>(null)
  async function open(example: LibraryExample) {
    const current = ++version.current
    setSelected(example); setResult(null); setLoading(true); setError('')
    requestAnimationFrame(() => { preview.current?.focus(); preview.current?.scrollIntoView({ block: 'start' }) })
    try {
      const payload = await example.load()
      if (current === version.current) setResult(payload)
    } catch { if (current === version.current) setError('This design could not be opened. Check your connection and try again.') }
    finally { if (current === version.current) setLoading(false) }
  }
  function close() {
    const id = selected?.id
    version.current++; setSelected(null); setResult(null); setLoading(false)
    requestAnimationFrame(() => document.getElementById(`open-${id}`)?.focus())
  }
  return <section id="design-library" className="design-library" aria-labelledby="library-title">
    <div className="page-intro library-intro"><span className="section-kicker">A few good starting points</span><h1 id="library-title">Design library</h1><p>Open a reference. Take a closer look. Make something new.</p><p className="field-help">Saved designs from previously analyzed websites. Opening or downloading one needs no key and uses no analysis quota. Each design reflects its analysis date.</p></div>
    <div className="library-grid">{libraryExamples.map(example => <DesignCard key={example.id} example={example} onOpen={() => void open(example)} />)}</div>
    {selected && <div id="saved-design-preview" ref={preview} tabIndex={-1} className="saved-preview" aria-label={`${selected.name} saved design`}>
      <div className="saved-notice"><p><strong>{selected.name}</strong><br />Analyzed {selected.date}. A saved snapshot, not an official brand guide.</p><button className="secondary-button" type="button" onClick={close}>Close design</button></div>
      {loading && <p role="status">Opening saved design…</p>}
      {error && <p role="alert">{error} <button type="button" onClick={() => void open(selected)} className="text-button">Try again</button></p>}
      {result && <ResultPanel mode={selected.mode} loading={false} error={null} result={result} historical onRetry={() => {}} />}
      {onUseSources && <button type="button" className="secondary-button mt-5" disabled={busy} onClick={() => { onUseSources(selected.mode, selected.sources); close() }}>Use these URLs in the form</button>}
    </div>}
  </section>
}
