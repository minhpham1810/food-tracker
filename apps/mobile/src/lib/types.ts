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
  advice: string;
}

export interface TelemetryState {
  timestamp: number | null;
  temperature: number | null;
  humidity: number | null;
  gas_resistance: number | null;
  /** null means "no baseline yet" -- never render this as evidence of freshness. */
  gas_anomaly: number | null;
  door_open: boolean | null;
  burn_multiplier: number | null;
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
