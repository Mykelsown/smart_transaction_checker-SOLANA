import { Connection } from "@solana/web3.js";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const RPC_URL = process.env.RPC_URL!;
const connection = new Connection(RPC_URL, "confirmed");

// How many upcoming slots to check (one leader can hold 4 consecutive slots)
const LOOKAHEAD_SLOTS = 20;

// Jito validator list endpoint (mainnet — devnet has few/no Jito validators,
// this is fetched for logic-testing purposes per the bounty's architecture requirements)
const JITO_VALIDATORS_URL = "https://kobe.mainnet.jito.network/api/v1/validators";

interface JitoValidator {
  vote_account: string;
  running_jito: boolean;
}

let jitoVoteAccounts = new Set<string>();

// Fetches the list of Jito-running validators
async function loadJitoValidators(): Promise<void> {
  try {
    const res = await fetch(JITO_VALIDATORS_URL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data: any = await res.json();
    const rawList: any[] = Array.isArray(data) ? data : data.validators;

    const validators: JitoValidator[] = rawList.map((v: any) => ({
    vote_account: v.vote_account,
    running_jito: v.running_jito,
    }));

    jitoVoteAccounts = new Set(
      validators
        .filter((v: JitoValidator) => v.running_jito)
        .map((v: JitoValidator) => v.vote_account)
    );

    console.log(`Loaded ${jitoVoteAccounts.size} Jito-enabled validators.\n`);
  } catch (err: any) {
    console.warn(`Could not load Jito validator list: ${err.message}`);
    console.warn(`Continuing without Jito-matching — leader schedule tracking will still work.\n`);
  }
}

// Map vote account -> identity pubkey (leader schedule uses identity, not vote account) 
async function getValidatorIdentityMap(): Promise<Map<string, string>> {
  const voteAccounts = await connection.getVoteAccounts();
  const all = [...voteAccounts.current, ...voteAccounts.delinquent];

  const map = new Map<string, string>();
  for (const v of all) {
    map.set(v.nodePubkey, v.votePubkey);
  }
  return map;
}

// Main leader tracking loop
async function trackLeaders() {
  console.log("Smart Transaction Stack — Leader Tracking");
  console.log("====================================================\n");

  await loadJitoValidators();

  const identityToVote = await getValidatorIdentityMap();

  const currentSlot = await connection.getSlot("confirmed");
  console.log(`Current slot: ${currentSlot}`);

  const leaders = await connection.getSlotLeaders(currentSlot, LOOKAHEAD_SLOTS);

  console.log(`\nUpcoming ${LOOKAHEAD_SLOTS} slot leaders:`);
  console.log("----------------------------------------------------");

  let nextJitoSlot: number | null = null;
  let nextJitoLeader: string | null = null;

  leaders.forEach((leaderIdentity, index) => {
    const slot = currentSlot + index;
    const voteAccount = identityToVote.get(leaderIdentity.toBase58());
    const isJito = voteAccount ? jitoVoteAccounts.has(voteAccount) : false;

    const marker = isJito ? "[JITO]" : "      ";
    console.log(`Slot ${slot}  ${marker}  ${leaderIdentity.toBase58()}`);

    if (isJito && nextJitoSlot === null) {
      nextJitoSlot = slot;
      nextJitoLeader = leaderIdentity.toBase58();
    }
  });

  console.log("----------------------------------------------------\n");

  if (nextJitoSlot !== null) {
    const slotsAway = nextJitoSlot - currentSlot;
    console.log(`Next Jito-enabled leader: slot ${nextJitoSlot} (${slotsAway} slots away)`);
    console.log(`Leader identity: ${nextJitoLeader}`);
  } else {
    console.log(`No Jito-enabled leader found in the next ${LOOKAHEAD_SLOTS} slots.`);
    console.log(`This is expected on devnet — most Jito validators run on mainnet only.`);
  }
}

// Run once, then repeat every 5 seconds to show it updating live
async function main() {
  await trackLeaders();

  setInterval(async () => {
    console.log("\n\nRefreshing leader schedule...\n");
    await trackLeaders();
  }, 5000);
}

process.on("SIGINT", () => {
  console.log("\n\nStopped by user.");
  process.exit(0);
});

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});