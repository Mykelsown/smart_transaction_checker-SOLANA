// import { submitMockBundle } from "./mockSource";
import { submitRealBundle } from "./realSource"; 
import { writeBundleLog, printSummary } from "./logger";
import { FailureReason } from "./types";
import * as path from "path"

// Making 8 successful + 2 forced failures = 10 total

const TOTAL_SUBMISSIONS = 10;
const FAILURE_INDEXES = [3, 7]; // which attempts simulate failure
const FAILURE_TYPES: FailureReason[] = ["ExpiredBlockhash", "FeeTooLow"];

async function main() {
  console.log("Smart Transaction Stack — Phase 4: Lifecycle Tracking");
  console.log("=======================================================\n");
  console.log("NOTE: Running in MOCK mode. Replace mockSource with realSource");
  console.log("once Phase 3 (real mainnet bundle submission) is funded.\n");

  let failureCount = 0;

  for (let i = 0; i < TOTAL_SUBMISSIONS; i++) {
    console.log(`Submitting bundle ${i + 1}/${TOTAL_SUBMISSIONS}...`);

    let forceFailure: FailureReason = null;
    if (FAILURE_INDEXES.includes(i)) {
      forceFailure = FAILURE_TYPES[failureCount];
      failureCount++;
    }

    // const record = await submitMockBundle(forceFailure);
    const record = await submitRealBundle(path.resolve(__dirname, "../../logs"));
    writeBundleLog(record);

    if (record.status === "failed") {
      console.log(`  -> FAILED: ${record.failure_reason}\n`);
    } else {
      console.log(`  -> ${record.status.toUpperCase()} | slot ${record.submitted_slot} | tip ${record.tip_amount_lamports} lamports\n`);
    }
  }

  printSummary();
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});