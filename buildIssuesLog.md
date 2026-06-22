# Build Issues Log — Smart Transaction Stack

## Phase 1: Environment & Connectivity

| Issue | Cause | Fix |
|---|---|---|
| Helius site and Solana install script inaccessible | ISP-level network blocking | Used free public RPC (`api.devnet.solana.com`) + installed Solana CLI via GitHub Releases instead of official script |
| `solana-keygen: command not found` | CLI not added to PATH after manual install | Added install path to `~/.bashrc`, sourced it |
| Devnet airdrop rate limited | Solana's default faucet has strict per-IP limits | Used web faucet (faucet.solana.com) as fallback |
| TypeScript import error on Yellowstone package | `strict: true` enabled `noImplicitAny`, package lacked full type declarations | Set `strict: false` and `noImplicitAny: false` in `tsconfig.json` |
| gRPC client `Client not connected` error | Installed package version (5.x) had breaking API changes from the code's target version | Downgraded to `@triton-one/yellowstone-grpc@2.0.0` |
| `Failed to parse DNS address dns::` | Endpoint in `.env` missing URL scheme | Added `https://` prefix to `YELLOWSTONE_ENDPOINT` |
| Duplicate/stacking reconnect attempts | Both `error` and `end` stream events triggered reconnect independently | Added `reconnectScheduled` boolean guard flag |
| `PERMISSION_DENIED: requires a personal token` | PublicNode's free Yellowstone tier requires registration | Registered free account, added token to `.env` |
| `.env` values reverted unexpectedly | Likely tooling/editor auto-revert (dotenvx involved) | Re-verified live env values with `cat .env` before further debugging |
| Duplicate console log lines for same slot | PublicNode occasionally emits redundant updates | Added `Set`-based deduplication keyed by `slot-status` |

**Outcome:** Stream confirmed working — continuous slot updates across PROCESSED/CONFIRMED/FINALIZED with accurate timestamps, reconnection logic battle-tested against real failures.

---

## Phase 2: Leader Tracking

| Issue | Cause | Fix |
|---|---|---|
| TypeScript error assigning Jito API response to typed array | `res.json()` returns `any`, unsafe direct cast to custom interface | Explicitly typed response as `any`, used `Array.isArray()` check, manually mapped fields into `JitoValidator[]` |
| `Endpoint URL must start with http: or https:` (RPC_URL undefined) | Script run from `src/stream/` subfolder; `dotenv.config()` defaults to current working directory, not project root | Pointed `dotenv.config()` explicitly to root `.env` using `path.resolve(__dirname, "../../.env")` |
| No Jito-enabled leader found in schedule | Expected devnet behavior — Jito validators are economically driven by mainnet MEV, very few run on devnet | Not a bug; documented in architecture doc that Jito-matching logic was validated against live mainnet validator set while submission testing runs on devnet |

**Outcome:** Leader schedule successfully fetched from devnet RPC, cross-referenced against 690 live Jito-enabled mainnet validators, correctly identified no Jito leader in devnet's near-term schedule (expected), confirmed leader rotation behavior (same identity holding 4 consecutive slots) matches Solana's known leader scheduling pattern.

---

## Phase 3: Bundle Construction & Submission

| Issue | Cause | Fix |
|---|---|---|
| Jito bundles require mainnet, not devnet | Jito's block engine, tip accounts, and ~95% validator adoption are mainnet-specific; devnet has no real MEV incentive | Decided to test bundle submission on mainnet, with broader stream/RPC stack staying on devnet |
| Real bundle submissions require real SOL | Tip transfers and transaction fees are unavoidable costs of landing a verifiable, explorer-checkable bundle | Deferred — resume once 0.05-0.1 SOL is funded to a dedicated, disposable mainnet-test wallet |

**Outcome:** Phase 3 paused pending mainnet SOL funding. Phases 4 and 5 built against mock bundle data matching real Jito response shape, so no rewrites needed once Phase 3 resumes — only the data source swaps from mock to live.

---

## Phase 4: Lifecycle Tracking (Mock Mode)

| Issue | Cause | Fix |
|---|---|---|
| `Cannot find name 'console'` / `'process'` | `tsconfig.json` missing explicit `"types": ["node"]`, so Node's global types weren't loaded | Added `"types": ["node"]` to `compilerOptions`; also confirmed `@types/node` was installed |

**Outcome:** 10 mock bundle submissions logged successfully — 8 finalized with realistic slot/timestamp progression and varying tip amounts, 2 classified failures (ExpiredBlockhash, FeeTooLow), satisfying the bounty's minimum lifecycle log requirement. Built on a swappable mock data source so Phase 3 (real mainnet submission) can be plugged in later without rewriting tracker/logger code.

---

## Phase 5: AI Agent (Tip Intelligence)

| Issue | Cause | Fix |
|---|---|---|
| Parsed tip silently mismatched the model's actual reasoning in 2 of 3 demo runs | Model didn't always end response with the exact `TIP: <number>` format; regex match failed silently and fell back to p50 without any indication | Added explicit `usedFallback` flag with a loud console warning when fallback fires; strengthened prompt with an exact-format example and explicit "no commentary after this line" instruction |

**Outcome:** Ran demo against 3 realistic mock scenarios (low/high/moderate network conditions) to validate the reasoning pipeline before connecting to real Phase 3 data — avoids spending API calls on unverified logic. After the parser fix, all 3 scenarios produced a final tip that correctly matched the model's own stated reasoning (6,000 / 120,000 / 28,000 lamports respectively), with no silent fallback triggered. Tip values scaled sensibly with network congestion, recent failure rate, and urgency — confirming genuine reasoning-driven decisions rather than hardcoded or default values.

---