import { BundleRecord, FailureReason } from "./types";

// Simulates a real Jito/RPC environment for testing the tracker
// without spending real SOL. Swap this module for realSource.ts
// once Phase 3 (real mainnet submission) is funded and ready.

let mockSlotCounter = 318_500_000;

function nextSlot(advance: number = 1): number {
  mockSlotCounter += advance;
  return mockSlotCounter;
}

function randomTip(): number {
  // Realistic lamport range based on observed Jito tip floor data
  const tiers = [1000, 5000, 12000, 25000, 50000];
  return tiers[Math.floor(Math.random() * tiers.length)];
}

function randomLatency(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

// Simulates submitting one bundle and returns a fully-formed record
// as if it had gone through Jito + Yellowstone tracking in real time.
export async function submitMockBundle(
  forceFailure: FailureReason = null
): Promise<BundleRecord> {
  const bundleId = `mock-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const submittedSlot = nextSlot(0);
  const submittedAt = new Date().toISOString();
  const tip = randomTip();

  const record: BundleRecord = {
    bundle_id: bundleId,
    tip_amount_lamports: tip,
    agent_reasoning: null,
    submitted_at: submittedAt,
    submitted_slot: submittedSlot,
    processed_at: null,
    processed_slot: null,
    confirmed_at: null,
    confirmed_slot: null,
    finalized_at: null,
    finalized_slot: null,
    status: "submitted",
    failure_reason: null,
    latency_processed_ms: null,
    latency_confirmed_ms: null,
    latency_finalized_ms: null,
  };

  // -- Simulate failure cases
  if (forceFailure) {
    record.status = "failed";
    record.failure_reason = forceFailure;
    return record;
  }

  // -- Simulate successful lifecycle progression with realistic delays
  const processedDelay = randomLatency(400, 1500);
  await sleep(processedDelay);
  record.processed_at = new Date().toISOString();
  record.processed_slot = nextSlot(1);
  record.latency_processed_ms = processedDelay;

  const confirmedDelay = randomLatency(1000, 4000);
  await sleep(confirmedDelay);
  record.confirmed_at = new Date().toISOString();
  record.confirmed_slot = nextSlot(2);
  record.status = "confirmed";
  record.latency_confirmed_ms = processedDelay + confirmedDelay;

  const finalizedDelay = randomLatency(12000, 18000);
  await sleep(finalizedDelay);
  record.finalized_at = new Date().toISOString();
  record.finalized_slot = nextSlot(30);
  record.status = "finalized";
  record.latency_finalized_ms = processedDelay + confirmedDelay + finalizedDelay;

  return record;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}