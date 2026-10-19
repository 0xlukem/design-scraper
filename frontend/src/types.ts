import type { AnalysisTelemetry, AnalysisProgress } from '../../cloudflare-backend/src/telemetry-contract'
export type { AnalysisTelemetry, AnalysisProgress } from '../../cloudflare-backend/src/telemetry-contract'
import type { AnalysisIssue } from './analysisError'
export type AppMode = 'single' | 'mix'
export type MixBias = -50 | -25 | 0 | 25 | 50

export interface AnalyzeMetadata {
  url: string
  title: string
  description?: string
  colors_extracted?: number
  fonts_extracted?: number
  usage?: AnalysisUsage | null
}

export interface SourceMetadata {
  slot: 'web_1' | 'web_2'
  url: string
  influence: number
  status: 'analyzed' | 'excluded'
  title: string
  description: string
  colors_extracted: number
  fonts_extracted: number
}

export interface MixMetadata {
  mode: 'mix'
  bias: MixBias
  weights: {
    web_1: number
    web_2: number
  }
  sources: SourceMetadata[]
  usage?: AnalysisUsage | null
}

export interface TechnicalExports {
  css_variables: string
  tailwind: string
  design_tokens: string
}

export interface AnalysisUsage {
  funding?: 'demo' | 'byok'
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  reasoning_tokens: number | null
  status: 'exact' | 'estimated'
  estimated_cost_usd: number | null
  cost_status: 'estimated' | 'unavailable'
  pricing_source: string | null
  sources_count: number
  screenshots_sent: number
  notes: string[]
}

export type EvidenceStatus = 'detected' | 'inferred' | 'interpreted'

export interface EvidenceToken {
  name?: string
  value: unknown
  role: string
  source: string[]
  confidence: number
  status: EvidenceStatus
}

export interface TypographySpec {
  name: string
  family: EvidenceToken | null
  size: EvidenceToken | null
  weight: EvidenceToken | null
  line_height: EvidenceToken | null
  letter_spacing: EvidenceToken | null
  use: string
}

export interface ComponentState {
  name: string
  values: EvidenceToken[]
  observed: boolean
}

export interface ComponentSpec {
  name: string
  description: string
  values: EvidenceToken[]
  states: ComponentState[]
  source: string[]
  confidence: number
  status: EvidenceStatus
}

export interface KnownGap {
  code: string
  message: string
  source: string[]
}

export interface EvidenceSource {
  label: 'web_1' | 'web_2'
  url: string
  weight: number
  status: 'analyzed' | 'excluded'
}

export interface DesignSystem {
  metadata: Record<string, unknown>
  overview: {
    identity: string
    tone: string[]
    personality: string[]
    density: string
    layout_philosophy: string
    summary: string
  }
  colors: {
    brand: EvidenceToken[]
    accent: EvidenceToken[]
    surfaces: EvidenceToken[]
    text: EvidenceToken[]
    borders: EvidenceToken[]
    gradients: EvidenceToken[]
  }
  typography: {
    families: EvidenceToken[]
    scale: TypographySpec[]
    principles: string[]
    substitutes: string[]
  }
  spacing: {
    base_unit: EvidenceToken | null
    tokens: EvidenceToken[]
    section_padding: EvidenceToken[]
    card_padding: EvidenceToken[]
    button_padding: EvidenceToken[]
  }
  layout: {
    values: EvidenceToken[]
    container: EvidenceToken[]
    grid: EvidenceToken[]
    whitespace_philosophy: string
  }
  elevation: {
    tokens: EvidenceToken[]
    borders: EvidenceToken[]
    philosophy: string
  }
  shapes: {
    radii: EvidenceToken[]
    image_geometry: EvidenceToken[]
    aspect_ratios: EvidenceToken[]
    cropping: string
  }
  components: ComponentSpec[]
  surfaces: {
    levels: EvidenceToken[]
    philosophy: string
  }
  imagery: {
    elements: EvidenceToken[]
    visual_language: string
    photography: string
    iconography: string
  }
  responsive: {
    breakpoints: EvidenceToken[]
    touch_targets: EvidenceToken[]
    changes: EvidenceToken[]
    image_behavior: string[]
  }
  guidelines: {
    dos: string[]
    donts: string[]
  }
  iteration_guide: string[]
  agent_prompt_guide: string[]
  similar_brands: EvidenceToken[]
  quick_start: string[]
  known_gaps: KnownGap[]
  evidence: {
    sources: EvidenceSource[]
    notes: string[]
  }
}

export type OutputFormat =
  | 'markdown'
  | 'tailwind'
  | 'css_variables'
  | 'design_tokens'

export interface AnalysisResult {
  telemetry?: AnalysisTelemetry
  success: true
  design_md: string
  design_system?: DesignSystem | null
  // Document variants. The existing design_md is the Extended variant.
  documents?: {
    compact: string
    extended: string
  } | null
  // Technical exports rendered from the same normalized model.
  exports?: TechnicalExports | null
  metadata: AnalyzeMetadata | MixMetadata
}

export interface RequestState {
  loading: boolean
  progress?: AnalysisProgress
  startedAt?: number
  cancelled?: boolean
  error: AnalysisIssue | null
  result: AnalysisResult | null
}

export interface SingleState extends RequestState {
  url: string
}

export interface MixState extends RequestState {
  url1: string
  url2: string
  bias: MixBias
}

export interface AppState {
  mode: AppMode
  single: SingleState
  mix: MixState
}

export type AppAction =
  | { type: 'set-mode'; mode: AppMode }
  | { type: 'set-single-url'; value: string }
  | { type: 'set-mix-url'; field: 'url1' | 'url2'; value: string }
  | { type: 'set-bias'; value: MixBias }
  | { type: 'request-start'; mode: AppMode; startedAt: number }
  | { type: 'request-progress'; mode: AppMode; progress: AnalysisProgress }
  | { type: 'request-success'; mode: AppMode; result: AnalysisResult }
  | { type: 'request-error'; mode: AppMode; message: AnalysisIssue }
  | { type: 'request-cancel'; mode: AppMode }

export const BIAS_WEIGHTS: Record<MixBias, [number, number]> = {
  [-50]: [100, 0],
  [-25]: [75, 25],
  [0]: [50, 50],
  [25]: [25, 75],
  [50]: [0, 100],
}
