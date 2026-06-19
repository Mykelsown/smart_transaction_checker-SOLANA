import * as fs from "fs";
import * as path from "path";
import { BundleRecord } from "./types";

const LOG_DIR = path.resolve(__dirname, "../../logs");

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

export function writeBundleLog(record: BundleRecord): void {
  ensureLogDir();
  const filename = `${record.bundle_id}.json`;
  const filepath = path.join(LOG_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(record, null, 2));
}

export function readAllLogs(): BundleRecord[] {
  ensureLogDir();
  const files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const content = fs.readFileSync(path.join(LOG_DIR, f), "utf-8");
    return JSON.parse(content) as BundleRecord;
  });
}

export function printSummary(): void {
  const logs = readAllLogs();
  const successful = logs.filter((l) => l.status === "finalized" || l.status === "confirmed");
  const failed = logs.filter((l) => l.status === "failed");

  console.log(`\nLifecycle Log Summary`);
  console.log(`======================`);
  console.log(`Total bundles logged: ${logs.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log(`\nFailure breakdown:`);
    const reasons: Record<string, number> = {};
    failed.forEach((f) => {
      const reason = f.failure_reason || "Unknown";
      reasons[reason] = (reasons[reason] || 0) + 1;
    });
    Object.entries(reasons).forEach(([reason, count]) => {
      console.log(`  ${reason}: ${count}`);
    });
  }
}