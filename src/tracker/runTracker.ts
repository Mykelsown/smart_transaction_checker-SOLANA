import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { submitRealBundle } from "./realSource";
import { writeBundleLog, printSummary } from "./logger";

// Required by the bounty: at least 10 submissions, at least 2 failures.
// In real mode, failures are not forced, they reflect actual network
// and infrastructure conditions encountered during live submission.

const TOTAL_SUBMISSIONS = 10;

async function main() {
  console.log("Smart Transaction Stack — Phase 4: Lifecycle Tracking");
  console.log("=======================================================\n");
  console.log("NOTE: Running in REAL mode. Submitting live bundles to");
  console.log("Solana mainnet via Jito. Each attempt spends real SOL.\n");

  const logDir = path.resolve(__dirname, "../../logs");

  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < TOTAL_SUBMISSIONS; i++) {
    console.log(`Submitting bundle ${i + 1}/${TOTAL_SUBMISSIONS}...`);

    try {
      const record = await submitRealBundle(logDir);
      writeBundleLog(record);

      if (record.status === "failed") {
        failureCount++;
        console.log(`  -> FAILED: ${record.failure_reason}\n`);
      } else {
        successCount++;
        console.log(
          `  -> ${record.status.toUpperCase()} | slot ${record.submitted_slot} | tip ${record.tip_amount_lamports} lamports\n`,
        );
      }
    } catch (err: any) {
      failureCount++;
      console.error(`  -> FATAL ERROR on this attempt: ${err.message}\n`);
    }

    // Small pause between real submissions to avoid hitting global rate limits,
    // observed directly during development (Jito error code -32097).
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  console.log(`\nCompleted ${TOTAL_SUBMISSIONS} attempts.`);
  console.log(`Successes: ${successCount} | Failures: ${failureCount}\n`);

  printSummary();
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});