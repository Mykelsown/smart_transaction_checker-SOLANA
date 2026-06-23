import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Waits until a Jito-enabled leader is close (reuses Phase 2 loic for mainnet this time)
async function waitForJitoLeaderWindow(connection: Connection): Promise<void> {
  const JITO_VALIDATORS_URL = "https://kobe.mainnet.jito.network/api/v1/validators";

  console.log("Loading live Jito validator list...");
  const res = await fetch(JITO_VALIDATORS_URL);
  const data = (await res.json()) as { validators: { vote_account: string; running_jito: boolean }[] };
  const jitoVoteAccounts = new Set(
    data.validators.filter((v) => v.running_jito).map((v) => v.vote_account)
  );
  console.log(`Loaded ${jitoVoteAccounts.size} Jito-enabled validators.\n`);

  const voteAccounts = await connection.getVoteAccounts();
  const identityToVote = new Map<string, string>();
  [...voteAccounts.current, ...voteAccounts.delinquent].forEach((v) => {
    identityToVote.set(v.nodePubkey, v.votePubkey);
  });

  const MAX_WAIT_CHECKS = 20;
  for (let attempt = 0; attempt < MAX_WAIT_CHECKS; attempt++) {
    const currentSlot = await connection.getSlot("confirmed");
    const leaders = await connection.getSlotLeaders(currentSlot, 8);

    for (let i = 0; i < leaders.length; i++) {
      const voteAccount = identityToVote.get(leaders[i].toBase58());
      const isJito = voteAccount ? jitoVoteAccounts.has(voteAccount) : false;
      if (isJito && i <= 2) {
        console.log(`Jito leader found ${i} slot(s) away (slot ${currentSlot + i}). Proceeding now.\n`);
        return;
      }
    }

    console.log(`No close Jito leader yet (check ${attempt + 1}/${MAX_WAIT_CHECKS}). Waiting 2s...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error("No Jito leader window found within wait limit. Try again shortly.");
}

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL!;
const MAINNET_KEYPAIR_PATH = process.env.MAINNET_KEYPAIR_PATH!;
const JITO_BLOCK_ENGINE_URL = process.env.JITO_BLOCK_ENGINE_URL!;

// Load the funded mainnet keypair 
function loadKeypair(filePath: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

// Fetch live tip accounts from Jito (no hardcoded addresses)
async function getTipAccounts(): Promise<string[]> {
  const res = await fetch(`${JITO_BLOCK_ENGINE_URL.replace("/bundles", "")}/random_tip_account`);
  if (!res.ok) {
    // Fallback endpoint shape — some Jito deployments expose getTipAccounts via RPC-style call
    const altRes = await fetch(JITO_BLOCK_ENGINE_URL.replace("/bundles", "/getTipAccounts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTipAccounts", params: [] }),
    });
    const altData = await altRes.json() as { result: string[] };
    return altData.result;
  }
  const data = await res.json() as string[] | string;
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

  // Get live tip accounts
  console.log("Fetching live Jito tip accounts...");
  const tipAccounts = await getTipAccounts();
  console.log(`Got ${tipAccounts.length} tip accounts.`);
  const tipAccount = new PublicKey(tipAccounts[Math.floor(Math.random() * tipAccounts.length)]);
  console.log(`Selected tip account: ${tipAccount.toBase58()}\n`);

  // Decide tip amount (placeholder for now - Phase 5 agent plugs in here)
  const tipLamports = 1_500_000; // TEMPORARY - will be replaced with agent's decideTip() output
  console.log(`Tip amount: ${tipLamports} lamports (placeholder — agent integration next)\n`);

   // Wait for a near Jito leader window before locking in any blockhash 
  await waitForJitoLeaderWindow(connection);

  //  Fetch a fresh blockhash at 'confirmed' commitment 
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  console.log(`Blockhash: ${blockhash}`);
  console.log(`Valid until block height: ${lastValidBlockHeight}\n`);

  // Build the transaction — a tiny self-transfer + tip
  const instructions = [
  SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: payer.publicKey,
    lamports: 1000,
  }),
  SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: tipAccount,
    lamports: tipLamports,
  }),
];

const messageV0 = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: blockhash,
  instructions,
}).compileToV0Message();

const transaction = new VersionedTransaction(messageV0);
transaction.sign([payer]);

const serializedTx = Buffer.from(transaction.serialize()).toString("base64");

  // Submit as a Jito bundle
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
        params: [[serializedTx], { encoding: "base64" }],
    }),
  });

  const bundleData = await bundleRes.json() as { error?: any; result?: string };

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