export type FailureReason =
  | "ExpiredBlockhash"
  | "FeeTooLow"
  | "ComputeExceeded"
  | "BundleFailure"
  | null;

export type BundleStatus =
  | "submitted"
  | "processed"
  | "confirmed"
  | "finalized"
  | "failed";

export interface BundleRecord {
  bundle_id: string;
  tip_amount_lamports: number;
  agent_reasoning: string | null;

  submitted_at: string;
  submitted_slot: number;

  processed_at: string | null;
  processed_slot: number | null;

  confirmed_at: string | null;
  confirmed_slot: number | null;

  finalized_at: string | null;
  finalized_slot: number | null;

  status: BundleStatus;
  failure_reason: FailureReason;

  latency_processed_ms: number | null;
  latency_confirmed_ms: number | null;
  latency_finalized_ms: number | null;
}