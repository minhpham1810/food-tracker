export interface ItemState {
  id: string;
  name: string;
  profile_id: string;
  created_at: number;
  t_eff: number;
  opened: boolean;
  freshness_fraction: number;
  track_a_days_left: number;
  days_left: number;
  confidence: 'high' | 'med' | 'low';
  status: 'fresh' | 'check_early' | 'past_budget_quiet' | 'discard_quality_signal';
  placeholder_profile: boolean;
  advice: string;
  color_score: number | null;
  gas_anomaly: number | null;
  brand?: string | null;
  printed_date?: string | null;
  package_size?: string | null;
  lot_code?: string | null;
  /** True when the item was scanned and the backend kept the label photo. */
  has_photo?: boolean;
  data_gap_hours?: number;
  t_eff_incomplete: boolean;
  history_message: string | null;
  outside_model_range: boolean;
  model_message: string | null;
  profile_name: string;
  d0_source: string;
  q10_source: string;
  projection_temperature_c: number;
  estimate_message: string | null;
  /** Current aging speed vs 4C. null = no usable reading; never render as 1.0x. */
  aging_rate: number | null;
  fusion_uncertainty: {
    used_for_estimate: boolean;
    sigma_a: number;
    sigma_b: number;
    sigma_a_source: 'placeholder' | 'fitted';
    sigma_b_source: 'placeholder' | 'fitted';
    sigma_b_reason: string;
  };
}

/** Mirrors ProfileOut in apps/api/schemas.py -- served from engine/foods.json. */
export interface FoodProfile {
  id: string;
  name: string;
  d0_days: number;
  opened_d0_days: number;
  q10: number;
  /** Hackathon placeholder coefficients, not validated data. Surface this. */
  placeholder: boolean;
  source: string;
  q10_source: string | null;
  advice: string;
}

export interface TelemetryState {
  reading_age_seconds: number | null;
  connected: boolean;
  iaq_accuracy: number | null;
  baseline_residual_sigma: number | null;
  timestamp: number | null;
  temperature: number | null;
  humidity: number | null;
  gas_resistance: number | null;
  /** null means "no baseline yet" -- never render this as evidence of freshness. */
  gas_anomaly: number | null;
  /** Fridge-level aging speed vs 4C. null = no usable reading. */
  aging_rate: number | null;
  aging_rate_reference_q10: number;
}

export interface Alert {
  code: string;
  message: string;
  severity: string;
}

export interface AppState {
  telemetry: TelemetryState;
  items: ItemState[];
  alerts: Alert[];
  active_scenario: string | null;
  telemetry_paused: boolean;
}

export interface OCRResult {
  product_name: string;
  brand: string | null;
  printed_date: string | null;
  package_size: string | null;
  lot_code: string | null;
  raw_text: string;
  confidence: number;
  suggested_profile_id: string | null;
  /** Claim ticket for the scan's stored photo; hand it back on confirm. */
  scan_id: string | null;
}

export interface AssistantToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
}

export interface AssistantReply {
  reply: string;
  tool_calls: AssistantToolCall[];
}
