import type { AnalysisTelemetry } from './types'
export interface AnalysisIssue {
  telemetry?: AnalysisTelemetry
  funding?: 'demo' | 'byok'
  // Only false proves that a local preflight guard prevented dispatch.
  requestSent?: boolean
  code: string
  message: string
  retryable: boolean
  retryAt: number | null
  category: string
  guidance: string
}

export class AnalysisError extends Error {
  constructor(public issue: AnalysisIssue) {
    super(issue.message)
    this.name = 'AnalysisError'
  }
}

interface IssueContext {
  funding?: 'demo' | 'byok'
  telemetry?: AnalysisTelemetry
  requestSent?: boolean
}

function consumptionGuidance({ telemetry, requestSent }: IssueContext) {
  if (requestSent === false) return 'This request was not sent. No AI provider was called and no analysis quota was used.'
  if (telemetry?.final && telemetry.usage_status === 'not_called') return 'No AI provider was called: AI consumption is 0 tokens / US$0. Capture or admission limits may still have been used.'
  if (telemetry?.usage) {
    const detail = telemetry.usage.cost_status === 'estimated'
      ? 'Reported usage and its estimated cost are available in Activity & costs.'
      : 'Token usage was recovered, but cost is unavailable because pricing is not configured.'
    return `${detail}${!telemetry.final ? ' Final consumption is unknown; remote work may continue.' : telemetry.generation_attempts > 1 ? ' Earlier attempts may add cost.' : ''}`
  }
  return telemetry?.final && telemetry.provider_calls > 0
    ? 'The provider was called, but final token usage and cost are unavailable.'
    : 'Final usage is unavailable. Work already started may have consumed quota.'
}

export function makeIssue(code: string, message: string, retryable = false, retryAt: number | null = null, context: IssueContext = {}): AnalysisIssue {
  const funding = context.funding || context.telemetry?.funding
  let category = 'Analysis interrupted'
  let guidance = 'Review the issue or explore the design library.'
  if (/^BYOK_LOCAL_/.test(code)) {
    category = 'This tab’s allowance reached'
    guidance = 'Wait until the displayed retry time or open a saved design. Changing keys does not reset the tab’s limits.'
  } else if (code === 'BYOK_REQUEST_ACTIVE') {
    category = 'An analysis is already running'
    guidance = 'Wait for the current request to finish before starting another analysis.'
  } else if (['RATE_LIMITED', 'IP_DAILY_LIMIT_REACHED', 'DAILY_LIMIT_REACHED', 'BROWSER_QUOTA_EXHAUSTED', 'DAILY_AI_BUDGET_EXHAUSTED', 'AI_BUDGET_REACHED', 'PROJECT_BUDGET_EXHAUSTED', 'CAPACITY_REACHED', 'DUPLICATE_ANALYSIS'].includes(code)) {
    category = code === 'CAPACITY_REACHED' || code === 'DUPLICATE_ANALYSIS' ? 'Processing capacity is busy' : 'Design Scraper limit reached'
    guidance = code === 'PROJECT_BUDGET_EXHAUSTED'
      ? 'Included AI capacity needs the site owner’s attention. Your own key can fund AI, but shared capture and admission limits still apply.'
      : 'Wait until the allowance renews or open a saved design. Your own key still shares capture and admission limits.'
  } else if (/^(CAPTURE_|SCRAPE_|SCREENSHOT_|BROWSER_CLOSE)/.test(code) || code === 'AI_INPUT_LIMIT') {
    category = /LIMIT|TOO_LARGE/.test(code) ? 'Website exceeds capture limits' : /TIMEOUT/.test(code) ? 'Website capture timed out' : 'Website capture interrupted'
    if (code === 'AI_INPUT_LIMIT') category = 'Website exceeds analysis input limits'
    guidance = code === 'AI_INPUT_LIMIT'
      ? 'Try a lighter public page with less captured evidence, or open a saved design. Changing your key does not increase the analysis input limit.'
      : 'Try a lighter public page or a saved design. Required styles, fonts and images must load before AI analysis can begin. Some sites block automated access.'
  } else if (/^(UNSAFE_URL|INVALID_REQUEST)/.test(code)) {
    category = 'This URL cannot be analyzed'
    guidance = 'Use a public HTTP or HTTPS page without embedded credentials or private network addresses.'
  } else if (/AUTH|BYOK_|MODEL_UNAVAILABLE|REQUEST_REJECTED/.test(code)) {
    category = funding === 'demo' && !code.startsWith('BYOK_') ? 'Design Scraper needs attention' : 'Provider settings need attention'
    guidance = funding === 'demo' && !code.startsWith('BYOK_')
      ? 'Design Scraper’s AI service needs the site owner’s attention. You can use your own key or explore a saved design.'
      : 'Check the selected provider, key and model permissions. Your key is never replaced automatically with Design Scraper.'
  } else if (code === 'AI_FAILED' || code === 'INVALID_RESULT') {
    category = 'The design result could not be validated'
    guidance = 'The provider response could not be completed or validated. Retry if available, or open a saved design. This does not mean your key was rejected.'
  } else if (/^PROVIDER_|^AI_/.test(code)) {
    category = /QUOTA/.test(code) ? funding === 'demo' ? 'Included AI limit reached' : 'Provider quota reached' : 'AI provider interrupted'
    guidance = funding === 'demo'
      ? 'Design Scraper’s AI service is unavailable. Wait before retrying; persistent configuration or quota issues need the site owner’s attention. You can use your own key or a saved design.'
      : 'Check your selected provider’s account limits and availability before retrying.'
  } else if (/LIMIT|BUDGET|QUOTA|BUSY/.test(code)) {
    category = 'Design Scraper limit reached'
    guidance = 'Your own key also uses the site’s analysis and capture limits. Wait until the allowance renews or open a saved design without using analysis quota.'
  } else if (/TIMEOUT|NETWORK|UNREADABLE/.test(code)) {
    category = 'The result could not be received'
    guidance = 'The server may still be working. Check your connection before trying again; a new analysis can consume additional quota.'
  }
  return { code, message, retryable, retryAt, category, guidance: `${guidance} ${consumptionGuidance(context)}`, ...context, funding }
}

export function toIssue(error: unknown, funding?: 'demo' | 'byok'): AnalysisIssue {
  if (error instanceof AnalysisError) {
    const issue = error.issue
    return makeIssue(issue.code, issue.message, issue.retryable, issue.retryAt, { funding: funding || issue.funding, telemetry: issue.telemetry, requestSent: issue.requestSent })
  }
  return makeIssue('REQUEST_INTERRUPTED', error instanceof Error ? error.message : 'The request could not be completed.', false, null, { funding })
}

export function retryDeadline(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  const seconds = Number(value)
  const date = Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : Date.parse(value)
  return Number.isFinite(date) ? Math.max(now, date) : null
}
