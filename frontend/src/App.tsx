import SharedBudget from './components/SharedBudget'
import ProviderRates from './components/ProviderRates'
import './components/activity.css'
import { AnalysisError, makeIssue, toIssue } from './analysisError'
import SessionUsage, { type UsageEntry } from './components/SessionUsage'
import SessionRun from './components/SessionRun'
import DesignLibrary from './components/DesignLibrary'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { analyzeWebsite, mixWebsites } from './api'
import MixForm from './components/MixForm'
import ModeToggle from './components/ModeToggle'
import ResultPanel from './components/ResultPanel'
import SingleForm from './components/SingleForm'
import SiteFooter from './components/SiteFooter'
import StudioScene from './components/StudioScene'
import MixWorld from './components/MixWorld'
import WorldTransition from './components/WorldTransition'
import HeroReveal from './components/HeroReveal'
import AllowanceHint from './components/AllowanceHint'
import { librarySuggestions, type LibraryExample } from './library'
import { ArrowDown, ArrowUpRight, Globe } from '@phosphor-icons/react'
import ProviderControls from './components/ProviderControls'
import type { ByokCredentials } from './byok'
import type {
  AnalysisResult,
  AnalysisProgress,
  AnalysisTelemetry,
  AppAction,
  AppMode,
  AppState,
  MixBias,
} from './types'

const initialRequest = {
  loading: false,
  error: null,
  result: null,
}

const initialState: AppState = {
  mode: 'single',
  single: {
    ...initialRequest,
    url: '',
  },
  mix: {
    ...initialRequest,
    url1: '',
    url2: '',
    bias: 0,
  },
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'set-mode':
      return { ...state, mode: action.mode }
    case 'set-single-url':
      return { ...state, single: { ...state.single, url: action.value } }
    case 'set-mix-url':
      return {
        ...state,
        mix: { ...state.mix, [action.field]: action.value },
      }
    case 'set-bias':
      return { ...state, mix: { ...state.mix, bias: action.value } }
    case 'request-progress':
      return { ...state, [action.mode]: { ...state[action.mode], progress: action.progress } }
    case 'request-start':
      return {
        ...state,
        [action.mode]: {
          ...state[action.mode],
          loading: true,
          startedAt: action.startedAt,
          progress: undefined,
          cancelled: false,
          error: null,
          result: null,
        },
      }
    case 'request-success':
      return {
        ...state,
        [action.mode]: {
          ...state[action.mode],
          loading: false,
          error: null,
          result: action.result,
        },
      }
    case 'request-error':
      return {
        ...state,
        [action.mode]: {
          ...state[action.mode],
          loading: false,
          error: action.message,
          result: null,
        },
      }
    case 'request-cancel':
      return {
        ...state,
        [action.mode]: {
          ...state[action.mode],
          loading: false,
          error: null,
          cancelled: true,
        },
      }
    default:
      return state
  }
}

const singleSuggestions = librarySuggestions('single', 3).map(example => ({ id: example.id, label: new URL(example.sources[0]).hostname.replace(/^www\./, ''), urls: example.sources }))
const mixSuggestions = librarySuggestions('mix', 2).map(example => ({ id: example.id, label: example.name, urls: example.sources }))
const sculptureArtwork = '/images/mix-it-paint-sculpture.webp'

function App() {
  // The requested world; the paint transition decides when `state.mode` follows.
  const [targetMode, setTargetMode] = useState<AppMode>('single')
  const [allowanceRequested, setAllowanceRequested] = useState(false)
  const [usageEntries, setUsageEntries] = useState<UsageEntry[]>([])
  const requestId = useRef(0)
  const [state, dispatch] = useReducer(reducer, initialState)
  const controllers = useRef<Partial<Record<AppMode, AbortController>>>({})
  const providerAccess = useRef<ByokCredentials | null | undefined>(undefined)
  const [providerReady, setProviderReady] = useState(true)
  const [usingOwnKey, setUsingOwnKey] = useState(false)
  const [activityTab, setActivityTab] = useState<'activity' | 'models'>('activity')
  const setProviderAccess = useCallback((value: ByokCredentials | null | undefined) => {
    if (providerAccess.current?.key !== value?.key || providerAccess.current?.provider !== value?.provider || providerAccess.current !== value && !value) {
      setKeyStatus('unverified')
      setKeyError('')
    }
    providerAccess.current = value
    setProviderReady(value !== null)
    setUsingOwnKey(value !== undefined)
  }, [])
  const [section, setSection] = useState(() => readSection())
  const [runId, setRunId] = useState(readRunId)
  const previousRun = useRef<number | null>(null)
  const [keyStatus, setKeyStatus] = useState<'unverified' | 'checking' | 'verified' | 'error'>('unverified')
  const [keyError, setKeyError] = useState('')
  const [settingsRevision, setSettingsRevision] = useState(0)
  const [retryNow, setRetryNow] = useState(Date.now)
  const retryAt = Math.max(state.single.error?.retryAt || 0, state.mix.error?.retryAt || 0)
  const retryRemaining = Math.max(0, Math.ceil((retryAt - retryNow) / 1000))
  useEffect(() => {
    setRetryNow(Date.now())
    if (retryAt <= Date.now()) return
    const timer = window.setInterval(() => {
      const now = Date.now()
      setRetryNow(now)
      if (now >= retryAt) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [retryAt])
  const main = useRef<HTMLElement>(null)
  useEffect(() => {
    const sync = () => { setSection(readSection()); setRunId(readRunId()) }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  useEffect(() => {
    main.current?.focus({ preventScroll: true })
    window.scrollTo?.({ top: 0, behavior: 'instant' })
    if (section === 'activity' && runId === null && previousRun.current !== null) document.getElementById(`open-run-${previousRun.current}`)?.focus()
    previousRun.current = runId
  }, [section, runId])
  useEffect(() => {
    const brand = state.mode === 'mix' ? 'Mix It' : 'Design Scraper'
    document.title = section === 'analyze' ? `${brand} · ${state.mode === 'mix' ? 'Two references. Something new.' : 'Design, decoded.'}` : `${section === 'library' ? 'Design library' : 'Activity & costs'} · ${brand}`
  }, [section, state.mode])
  const reviewSettings = () => { setSettingsRevision(n => n + 1) }


  useEffect(
    () => () => {
      controllers.current.single?.abort()
      controllers.current.mix?.abort()
      providerAccess.current = undefined
    },
    [],
  )

  const runRequest = async (
    mode: AppMode,
    request: (signal: AbortSignal, onProgress: (progress: AnalysisProgress) => void) => Promise<AnalysisResult>,
  ) => {
    if (controllers.current.single || controllers.current.mix || Date.now() < retryAt) return
    const controller = new AbortController()
    controllers.current[mode] = controller
    const id = ++requestId.current
    const startedAt = Date.now()
    const previousKeyStatus = keyStatus
    const sources = mode === 'single' ? [state.single.url.trim()] : [state.mix.url1.trim(), state.mix.url2.trim()]
    if (providerAccess.current) { setKeyStatus('checking'); setKeyError('') }
    const funding = providerAccess.current ? 'byok' as const : 'demo' as const
    const provider = providerAccess.current?.provider || 'gemini'
    let lastTelemetry: AnalysisTelemetry | undefined
    const recordUsage = (outcome: UsageEntry['outcome'], usage?: AnalysisResult['metadata']['usage'], telemetry?: AnalysisTelemetry, requestSent?: boolean, result?: AnalysisResult, issue?: UsageEntry['issue']) =>
      setUsageEntries(entries => [...entries, { id, mode, bias: mode === 'mix' ? state.mix.bias : undefined, sources, startedAt, durationMs: Date.now() - startedAt, funding, provider: usage?.provider || provider, outcome, usage, telemetry, requestSent, result, issue }])
    dispatch({ type: 'request-start', mode, startedAt: Date.now() })

    try {
      if (providerAccess.current === null) throw new AnalysisError(makeIssue('BYOK_SETTINGS_REQUIRED', 'Complete your provider settings and accept the terms before analyzing.', false, null, { funding: 'byok', requestSent: false }))
      const result = await request(controller.signal, progress => {
        lastTelemetry = progress.telemetry
        dispatch({ type: 'request-progress', mode, progress })
      })
      if (controllers.current[mode] !== controller) return
      if (funding === 'byok' && providerAccess.current) setKeyStatus('verified')
      recordUsage('completed', result.metadata.usage, result.telemetry, true, result)
      dispatch({ type: 'request-success', mode, result })
    } catch (error) {
      if (controllers.current[mode] !== controller) return
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (funding === 'byok') setKeyStatus(previousKeyStatus === 'verified' ? 'verified' : 'unverified')
        recordUsage('cancelled', undefined, lastTelemetry ? { ...lastTelemetry, final: false, usage_status: 'unavailable' } : undefined)
        dispatch({ type: 'request-cancel', mode })
      } else {
        const issue = toIssue(error, funding)
        if (funding === 'byok') {
          if (/^PROVIDER_/.test(issue.code)) {
            setKeyStatus('error')
            setKeyError(issue.code === 'PROVIDER_AUTH_ERROR' ? 'Key rejected. Check your key and provider.' : 'Provider unavailable. Check account limits and model access.')
          } else setKeyStatus(previousKeyStatus === 'verified' ? 'verified' : 'unverified')
        }
        recordUsage('failed', issue.telemetry?.usage, issue.telemetry || lastTelemetry, issue.requestSent, undefined, issue)
        dispatch({ type: 'request-error', mode, message: issue })
      }
    } finally {
      if (controllers.current[mode] === controller) {
        delete controllers.current[mode]
      }
    }
  }

  const submitSingle = () =>
    runRequest('single', (signal, onProgress) =>
      analyzeWebsite(state.single.url.trim(), signal, providerAccess.current || undefined, onProgress),
    )

  const submitMix = () =>
    runRequest('mix', (signal, onProgress) =>
      mixWebsites(
        state.mix.url1.trim(),
        state.mix.url2.trim(),
        state.mix.bias,
        signal,
        providerAccess.current || undefined,
        onProgress,
      ),
    )

  const cancel = (mode: AppMode) => controllers.current[mode]?.abort()

  const busy = state.single.loading || state.mix.loading
  const restoreRun = (entry: UsageEntry, settings = false) => {
    if (busy) return
    const mode = entry.mode || 'single'
    if (mode === 'single') dispatch({ type: 'set-single-url', value: entry.sources?.[0] || '' })
    else {
      dispatch({ type: 'set-mix-url', field: 'url1', value: entry.bias === 50 ? '' : entry.sources?.[0] || '' })
      dispatch({ type: 'set-mix-url', field: 'url2', value: entry.bias === 50 ? entry.sources?.[0] || '' : entry.sources?.[1] || '' })
      dispatch({ type: 'set-bias', value: entry.bias || 0 })
    }
    dispatch({ type: 'set-mode', mode }); setTargetMode(mode)
    window.location.hash = '/analyze'; setSection('analyze'); setRunId(null)
    requestAnimationFrame(() => {
      if (settings) reviewSettings()
      else document.getElementById(mode === 'single' ? 'single-url' : entry.bias === 50 ? 'mix-url-2' : 'mix-url-1')?.focus()
    })
  }
  const requestAllowance = useCallback(() => setAllowanceRequested(true), [])
  const changeMode = (mode: AppMode) => {
    if (mode === 'mix') new Image().src = sculptureArtwork
    setTargetMode(mode)
  }
  const switchExperience = (mode: AppMode) => {
    changeMode(mode)
    if (section !== 'analyze') window.location.hash = '/analyze'
    window.scrollTo?.({ top: 0, behavior: 'instant' })
    main.current?.focus({ preventScroll: true })
  }
  const useReference = (example: LibraryExample, result: AnalysisResult) => {
    if (busy) return
    if (example.mode === 'mix' && 'mode' in result.metadata) {
      const first = result.metadata.sources.find(source => source.slot === 'web_1')
      const second = result.metadata.sources.find(source => source.slot === 'web_2')
      if (!first || !second) return
      dispatch({ type: 'set-mix-url', field: 'url1', value: first.url })
      dispatch({ type: 'set-mix-url', field: 'url2', value: second.url })
      dispatch({ type: 'set-bias', value: result.metadata.bias })
    } else {
      dispatch({ type: 'set-single-url', value: example.sources[0] })
    }
    dispatch({ type: 'set-mode', mode: example.mode }); setTargetMode(example.mode)
    window.location.hash = '/analyze'; setSection('analyze')
    requestAnimationFrame(() => document.getElementById(example.mode === 'mix' ? 'mix-url-1' : 'single-url')?.focus())
  }

  return <div data-experience={state.mode} className={`app-shell experience-shell min-h-[100dvh] ${state.mode === 'mix' ? 'theme-wild' : 'theme-sober'}`}>
    <WorldTransition target={targetMode} current={state.mode} paused={false} onCovered={mode => dispatch({ type: 'set-mode', mode })} />
    <header className="site-header">
      <a href="#main-content" className="skip-link" onClick={e => { e.preventDefault(); main.current?.focus() }}>Skip to content</a>
      <div className="nav-inner">
        <a className="brand-link" href="#/analyze" aria-label={state.mode === 'single' ? 'Design Scraper home' : 'Mix It home'} onClick={() => window.scrollTo?.({ top: 0, behavior: 'instant' })}>
          {state.mode === 'single' ? <><span className="studio-mark" aria-hidden="true"><i /><i /><i /><i /></span><span className="studio-wordmark">design<br />scraper<span className="brand-period">®</span></span></> : <span className="mix-wordmark">mix it<span>.</span></span>}
        </a>
        <nav aria-label="Main navigation">
          {sections.map(item => <a key={item.id} href={`#/${item.id}`} aria-current={section === item.id ? 'page' : undefined}>{item.label}</a>)}
        </nav>
        <button type="button" className="experience-switch" aria-label={state.mode === 'single' ? 'Enter Mix It' : 'Back to Design Scraper'} onClick={() => switchExperience(state.mode === 'single' ? 'mix' : 'single')}>
          {state.mode === 'single' ? <><span className="portal-dot" aria-hidden="true" /> Mix It <ArrowUpRight size={17} aria-hidden="true" /></> : <><span aria-hidden="true">←</span> Design Scraper</>}
        </button>
      </div>
    </header>
    <main ref={main} tabIndex={-1} id="main-content" className="workspace-main" data-page={section}>
      {section === 'activity' && <div className="page-intro activity-intro"><h1>Activity &amp; costs</h1></div>}
      <div className="activity-content" hidden={section !== 'activity'}>
        {runId !== null ? <SessionRun entry={usageEntries.find(entry => entry.id === runId)} busy={busy} onRestore={restoreRun} /> : <>
        {busy && <p role="status" className="form-notice">An analysis is running. <a href="#/analyze">View progress</a></p>}
        <div className="activity-tabs" role="tablist" aria-label="Activity and model information" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 'activity' : event.key === 'End' ? 'models' : activityTab === 'activity' ? 'models' : 'activity'
          setActivityTab(next); document.getElementById(`activity-tab-${next}`)?.focus()
        }}>{(['activity', 'models'] as const).map(tab => <button key={tab} id={`activity-tab-${tab}`} type="button" role="tab" aria-selected={activityTab === tab} aria-controls={`activity-panel-${tab}`} tabIndex={activityTab === tab ? 0 : -1} onClick={() => setActivityTab(tab)}>{tab === 'activity' ? 'Activity' : 'Models & rates'}</button>)}</div>
        <div id="activity-panel-activity" role="tabpanel" aria-labelledby="activity-tab-activity" hidden={activityTab !== 'activity'}><SessionUsage entries={usageEntries} /></div>
        <div id="activity-panel-models" role="tabpanel" aria-labelledby="activity-tab-models" hidden={activityTab !== 'models'}><ProviderRates active={section === 'activity' && activityTab === 'models'} /></div>
        </>}
      </div>
      <div className={section === 'analyze' ? 'analysis-controls' : 'activity-settings'} hidden={section === 'library' || section === 'activity' && runId !== null}>
      {section === 'analyze' && <HeroReveal mode={state.mode} paused={false}>
        <div className="section-kicker"><span className="kicker-dot" /> {state.mode === 'single' ? 'A tool for people who notice design' : 'Two references. Zero rules for good taste.'}</div>
        <h1 className="experience-headline">{state.mode === 'single' ? <>Design,<br /><span>decoded.</span></> : <><span className="mix-line-one">MIX</span><br /><span className="mix-line-two">IT UP.</span></>}</h1>
        <p className="analysis-description">{state.mode === 'single'
          ? 'Look beyond the pixels. Turn any website into a design system you can actually work with.'
          : 'A little from here. A little from there. Pour two websites together and see what happens.'}</p>
        <div className="hero-actions">
          <a href="#/library" className="hero-library-link">{state.mode === 'single' ? 'Explore the design library' : 'Borrow some inspiration'} <ArrowUpRight size={18} aria-hidden="true" /></a>
          <a href="#analysis-form" className="hero-lab-link" onClick={event => {
            event.preventDefault()
            document.getElementById('analysis-form')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
            document.getElementById(state.mode === 'single' ? 'single-url' : 'mix-url-1')?.focus({ preventScroll: true })
          }}>Go to the lab <ArrowDown size={16} aria-hidden="true" /></a>
        </div>
        {state.mode === 'single' ? <StudioScene paused={false} /> : <MixWorld paused={false} />}
        <ul className="analysis-capabilities" aria-label="Analysis capabilities">
          <li><span>01</span> CSS evidence</li><li><span>02</span> AI vision</li><li><span>03</span> Five exports</li>
        </ul>
      </HeroReveal>}
      <div className={section === 'analyze' ? 'reference-box' : 'activity-access'}>
      {section === 'analyze' && <><div className="reference-topline"><span>{state.mode === 'single' ? 'DESIGN SCRAPER / WORKSPACE' : 'THE MIXING DESK'}</span><span>{state.mode === 'single' ? '01—05' : 'MAKE A BEAUTIFUL MESS'}</span></div><ModeToggle mode={state.mode} onChange={changeMode} /></>}
      {section === 'analyze' && <div className="reference-heading">
        <div><span className="reference-step">{state.mode === 'single' ? 'START WITH A WEBSITE' : '01 / POUR IN YOUR INGREDIENTS'}</span><h2>{state.mode === 'single' ? 'One URL. The whole system.' : 'Good things collide.'}</h2></div>
        <Globe size={24} aria-hidden="true" />
      </div>}
      <div hidden={section !== 'analyze'}>
        <section id="analysis-form" role="tabpanel" aria-labelledby={`mode-${state.mode}`}>
          {state.mode === 'single' ? <SingleForm url={state.single.url} loading={state.single.loading} disabled={!providerReady || busy || retryRemaining > 0}
            suggestions={singleSuggestions} onIntent={requestAllowance}
            onUrlChange={value => dispatch({ type: 'set-single-url', value })} onSubmit={submitSingle} onCancel={() => cancel('single')} />
            : <MixForm url1={state.mix.url1} url2={state.mix.url2} bias={state.mix.bias} loading={state.mix.loading} disabled={!providerReady || busy || retryRemaining > 0}
              suggestions={mixSuggestions} onIntent={requestAllowance}
              onUrlChange={(field, value) => dispatch({ type: 'set-mix-url', field, value })}
              onBiasChange={(value: MixBias) => dispatch({ type: 'set-bias', value })} onSubmit={submitMix} onCancel={() => cancel('mix')} />}
          <AllowanceHint requested={allowanceRequested} revision={usageEntries.length} />
        </section>
        {retryRemaining > 0 && <p className="form-notice" role="status">New analyses are available in {retryRemaining}s. You can edit your URLs or browse saved designs while you wait.</p>}
        {!providerReady && <p className="form-notice" role="status">Finish setting up your key, or use Design Scraper to analyze.</p>}
        {busy && !state[state.mode].loading && <p role="status" className="form-notice">An analysis is running in the other mode. Switch back to see its progress.</p>}
      </div>
      {section === 'activity' && <SharedBudget revision={usageEntries.length} active usingOwnKey={usingOwnKey} onUseKey={reviewSettings} />}
      <ProviderControls busy={busy} onChange={setProviderAccess} status={keyStatus} statusError={keyError} openRevision={settingsRevision} />
      {section === 'analyze' && <div className="reference-footnote"><span aria-hidden="true">↳</span> {state.mode === 'single' ? 'Colors, type, components. Ready for your next build.' : 'Two design languages. One entirely new direction.'}</div>}
      </div>
      </div>
      <div hidden={section !== 'analyze'}>
        <div className="analysis-results">
          {(['single', 'mix'] as const).map(mode => <div key={mode} hidden={state.mode !== mode}>
            <ResultPanel mode={mode} loading={state[mode].loading} error={state[mode].error} result={state[mode].result}
              progress={state[mode].progress} startedAt={state[mode].startedAt} retryDisabled={!providerReady || busy || retryRemaining > 0}
              active={section === 'analyze' && state.mode === mode} cancelled={state[mode].cancelled} onCancel={() => cancel(mode)}
              onRetry={mode === 'single' ? submitSingle : submitMix} onReviewSettings={reviewSettings}
              onReviewUrl={() => document.getElementById(mode === 'single' ? 'single-url' : state.mix.bias === 50 ? 'mix-url-2' : 'mix-url-1')?.focus()} />
          </div>)}
        </div>
      </div>
      <div hidden={section !== 'library'}><DesignLibrary active={section === 'library'} busy={busy} onUseReference={useReference} /></div>
    </main>
    <SiteFooter isMix={state.mode === 'mix'} onSwitch={() => switchExperience(state.mode === 'single' ? 'mix' : 'single')} />
  </div>
}

const sections = [
  { id: 'analyze', label: 'Analyze' },
  { id: 'library', label: 'Design library' },
  { id: 'activity', label: 'Activity & costs' },
] as const
function readSection(): 'analyze' | 'library' | 'activity' {
  const value = window.location.hash.slice(2)
  return value === 'library' || value.startsWith('library/') ? 'library' : value === 'activity' || value.startsWith('activity/') ? 'activity' : 'analyze'
}
function readRunId() {
  const match = window.location.hash.match(/^#\/activity\/(\d+)$/)
  return match ? Number(match[1]) : null
}
export default App
