import { Connection, clusterApiUrl } from "@solana/web3.js";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  // Connect to your Helius RPC
  const rpcUrl = process.env.RPC_URL!;
  const connection = new Connection(rpcUrl, "confirmed");

  console.log("Connecting to Solana devnet via Helius...");
  console.log(`RPC URL: ${rpcUrl}`); // no API key to hide

  // Fetch current slot
  const slot = await connection.getSlot("confirmed");
  console.log(`\nCurrent slot: ${slot}`);

  // Fetch a few more details to confirm connection is real
  const blockHeight = await connection.getBlockHeight("confirmed");
  console.log(`Current block height: ${blockHeight}`);

  const version = await connection.getVersion();
  console.log(`Solana version: ${version["solana-core"]}`);

  console.log("\nConnection working. Your RPC is live.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});