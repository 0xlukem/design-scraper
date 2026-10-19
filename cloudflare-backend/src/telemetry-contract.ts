// Public transport metadata; independent of the canonical DesignSystem schema.
export interface Usage {
  funding?: "demo" | "byok";
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  reasoning_tokens: number | null;
  status: "exact" | "estimated";
  estimated_cost_usd: number | null;
  cost_status: "estimated" | "unavailable";
  pricing_source: string | null;
  sources_count: number;
  screenshots_sent: number;
  notes: string[];
}
export interface AnalysisTelemetry {
  funding: 'demo' | 'byok';
  provider: string;
  model: string;
  provider_calls: number;
  generation_attempts: number;
  auxiliary_calls: number;
  final: boolean;
  usage_status: 'pending' | 'not_called' | 'reported' | 'unavailable';
  usage: Usage | null;
  demo_budget: {
    tokens_charged_or_reserved: number;
    micro_usd_charged_or_reserved: number;
    conservative: boolean;
  } | null;
  browser_ms: number | null;
  browser_reserved_ms: number;
}
export interface AnalysisProgress {
  stage: 'admitted' | 'capture' | 'counting_tokens' | 'analyzing' | 'exporting' | 'complete' | 'failed';
  source: string | null;
  completed_steps: number;
  total_steps: number;
  percent: number;
  telemetry: AnalysisTelemetry;
}

export interface PublicQuota {
  day: string;
  resets_at: string;
  analyses: { used: number; limit: number; remaining: number };
  capture: { used_or_reserved_ms: number; limit_ms: number; remaining_ms: number };
  concurrency: { active: number; limit: number };
  per_ip: { hourly_limit: number; daily_limit: number };
  demo_budget_available: boolean;
}
export interface BudgetStatus {
  day: string;
  admitted: number;
  dailyLimit: number;
  ipHourlyLimit: number;
  ipDailyLimit: number;
  browserMsUsedOrReserved: number;
  browserMsLimit: number;
  tokensUsedOrReserved: number;
  dailyTokenLimit: number;
  dailyMicroUsdUsedOrReserved: number;
  totalMicroUsdUsedOrReserved: number;
  dailyMicroUsdLimit: number;
  totalMicroUsdLimit: number;
  costStatus: 'estimated';
  active: number;
  activeReservations: { browserMs: number; tokens: number; microUsd: number };
  demoCalls: { since: string; daily: { generation: number; auxiliary: number }; total: { generation: number; auxiliary: number } };
}
