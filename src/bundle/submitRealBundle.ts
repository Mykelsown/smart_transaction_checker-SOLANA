import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL!;
const MAINNET_KEYPAIR_PATH = process.env.MAINNET_KEYPAIR_PATH!;
const JITO_BLOCK_ENGINE_URL = process.env.JITO_BLOCK_ENGINE_URL!;

// ─── Load the funded mainnet keypair ───────────────────────────────────────
function loadKeypair(filePath: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

// ─── Fetch live tip accounts from Jito (no hardcoded addresses) ───────────
async function getTipAccounts(): Promise<string[]> {
  const res = await fetch(`${JITO_BLOCK_ENGINE_URL.replace("/bundles", "")}/random_tip_account`);
  if (!res.ok) {
    // Fallback endpoint shape — some Jito deployments expose getTipAccounts via RPC-style call
    const altRes = await fetch(JITO_BLOCK_ENGINE_URL.replace("/bundles", "/getTipAccounts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTipAccounts", params: [] }),
    });
    const altData = await altRes.json();
    return altData.result;
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [data];
}

async function main() {
  console.log("Smart Transaction Stack — Phase 3: Real Bundle Submission");
  console.log("=============================================================\n");

  const connection = new Connection(MAINNET_RPC_URL, "confirmed");
  const payer = loadKeypair(MAINNET_KEYPAIR_PATH);

  console.log(`Wallet: ${payer.publicKey.toBase58()}`);

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / 1_000_000_000} SOL\n`);

  if (balance < 5000) {
    throw new Error("Insufficient balance to cover fees and tip. Aborting before spending anything.");
  }

  // ── Step 1: Get live tip accounts ─────────────────────────────────────
  console.log("Fetching live Jito tip accounts...");
  const tipAccounts = await getTipAccounts();
  console.log(`Got ${tipAccounts.length} tip accounts.`);
  const tipAccount = new PublicKey(tipAccounts[Math.floor(Math.random() * tipAccounts.length)]);
  console.log(`Selected tip account: ${tipAccount.toBase58()}\n`);

  // ── Step 2: Decide tip amount (placeholder for now — Phase 5 agent plugs in here) ──
  const tipLamports = 5000; // TEMPORARY — will be replaced with agent's decideTip() output
  console.log(`Tip amount: ${tipLamports} lamports (placeholder — agent integration next)\n`);

  // ── Step 3: Fetch a fresh blockhash at 'confirmed' commitment ──────────
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  console.log(`Blockhash: ${blockhash}`);
  console.log(`Valid until block height: ${lastValidBlockHeight}\n`);

  // ── Step 4: Build the transaction — a tiny self-transfer + tip ─────────
  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: payer.publicKey,
  });

  // Minimal self-transfer (1000 lamports to self — just needs to be a valid instruction)
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: payer.publicKey,
      lamports: 1000,
    })
  );

  // Tip transfer to Jito's tip account
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: tipAccount,
      lamports: tipLamports,
    })
  );

  transaction.sign(payer);

  const serializedTx = transaction.serialize().toString("base64");

  // ── Step 5: Submit as a Jito bundle ─────────────────────────────────────
  console.log("Submitting bundle to Jito block engine...");
  const submittedAt = new Date().toISOString();
  const submittedSlot = await connection.getSlot("confirmed");

  const bundleRes = await fetch(JITO_BLOCK_ENGINE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [[serializedTx]],
    }),
  });

  const bundleData = await bundleRes.json();

  if (bundleData.error) {
    console.error("Bundle submission failed:", bundleData.error);
    process.exit(1);
  }

  const bundleId = bundleData.result;
  console.log(`\nBundle submitted successfully!`);
  console.log(`Bundle ID: ${bundleId}`);
  console.log(`Submitted at: ${submittedAt}`);
  console.log(`Submitted slot: ${submittedSlot}`);
  console.log(`\nCheck status: https://explorer.jito.wtf/bundle/${bundleId}`);
  console.log(`Or check your wallet on Solana Explorer:`);
  console.log(`https://explorer.solana.com/address/${payer.publicKey.toBase58()}`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});