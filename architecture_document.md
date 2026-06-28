# Smart Transaction Stack
## Architecture & Design Document

**Project:** Real-time Solana transaction infrastructure with Jito bundle execution and autonomous tip pricing
**Bounty:** Superteam Nigeria — Advanced Infrastructure Challenge
**Author:** Mykels (Samuel Micheal Pelumi) · [github.com/Mykelsown](https://github.com/Mykelsown)
**Repository:** [github.com/Mykelsown/Smart_Transaction_Checker-solana](https://github.com/Mykelsown/Smart_Transaction_Checker-solana)

---

## Abstract

Landing a transaction on Solana is a multi-stage problem, not a single API call. Between submission and finalization, a transaction passes through leader scheduling, TPU ingestion, block inclusion, and successive commitment thresholds — each a point of potential failure under real network conditions.

This system treats transaction submission as a control problem rather than a fire-and-forget action. It observes live network state (slots, leader schedule, Jito validator presence), makes a priced decision (tip amount, via an LLM-backed reasoning agent) informed by that state, executes through Jito's bundle infrastructure, and closes the loop by tracking the outcome back into the decision process for the next submission.

The result is a small, observable, self-correcting transaction pipeline — not a transaction sender with logging bolted on.

---

## 1. System Goals and Non-Goals

**In scope:**
- Real-time slot and leader observation via Yellowstone gRPC
- Leader-aware Jito bundle construction and submission on Solana mainnet
- Full lifecycle tracking across `processed → confirmed → finalized`, with latency instrumentation
- Autonomous, LLM-driven tip pricing with auditable reasoning
- Structured failure classification, not just success-path logging

**Explicitly out of scope:**
- General-purpose RPC failover or multi-provider load balancing (single-provider per environment by design, swappable via config)
- MEV strategy beyond tip pricing (no sandwich/arbitrage logic — tip intelligence only)
- Custom validator or shred-level networking — this consumes existing Yellowstone/Jito infrastructure rather than reimplementing it

Stating non-goals matters here as much as goals: the bounty rewards depth in a focused slice of the stack over shallow coverage of everything adjacent to it.

---

## 2. Architecture

### 2.1 Component Diagram

| Layer | Component | Source |
|---|---|---|
| **Observation** | Slot stream (Yellowstone gRPC) | `src/stream/slotStream.ts` |
| **Observation** | Leader schedule + Jito validator cross-reference | `src/stream/leaderTracker.ts` |
| **Decision** | Tip Intelligence agent (Claude) | `src/agent/tipAgent.ts` |
| **Execution** | Bundle construction & submission | `src/bundle/submitRealBundle.ts` |
| **Feedback** | Lifecycle tracking & structured logging | `src/tracker/{types,logger,realSource}.ts` |

Data flows in one direction through observation → decision → execution → feedback, with feedback looping back into the next decision cycle:

```
 Yellowstone gRPC          Mainnet RPC                Jito Validator API
 (slot stream)             (leader schedule)          (running_jito set)
        │                        │                            │
        └────────────┬───────────┴─────────────┬──────────────┘
                      ▼                         ▼
              ┌───────────────────────────────────────┐
              │   Leader Window Evaluator              │
              │   "Is a Jito leader within N slots?"   │
              └────────────────┬────────────────────────┘
                               │  yes
                               ▼
              ┌───────────────────────────────────────┐
              │   Tip Intelligence Agent (Claude)       │
              │   in: percentiles, urgency, history     │
              │   out: tip (lamports) + reasoning        │
              └────────────────┬────────────────────────┘
                               ▼
              ┌───────────────────────────────────────┐
              │   Bundle Builder                        │
              │   fresh blockhash → VersionedTransaction │
              │   → sign → base64                        │
              └────────────────┬────────────────────────┘
                               ▼
              ┌───────────────────────────────────────┐
              │   Jito Block Engine (sendBundle)         │
              └────────────────┬────────────────────────┘
                               ▼
              ┌───────────────────────────────────────┐
              │   Lifecycle Tracker                      │
              │   getBundleStatuses polling               │
              │   → JSON log (/logs/*.json)               │
              └────────────────┬────────────────────────┘
                               │
                               └──── recent outcomes feed back into
                                     next Tip Intelligence call
```

### 2.2 Why This Shape

The leader-window evaluator sits in front of everything else by design. Jito bundles have an effective expiry on the order of two slots once submitted — submitting without first confirming a Jito-enabled leader is imminent is the single most common cause of "accepted by the API, never landed on-chain," a failure mode this project encountered and diagnosed directly during development (Section 5.3). Gating submission on leader proximity rather than retrying blindly after the fact is the more defensible design.

The tip decision is deliberately positioned *after* leader-window confirmation and *before* blockhash fetch — so the agent's urgency input (slots remaining) reflects the real window the transaction will be racing against, not a stale estimate.

---

## 3. Data Flow — Single Submission Cycle

1. **Leader evaluation.** Current slot and the next ~8 leaders are fetched from RPC. Each leader identity is cross-referenced against the live Jito validator set (`running_jito = true`). If no Jito leader is within the proximity threshold, the system polls and waits rather than submitting.
2. **Tip decision.** Once a Jito leader window is confirmed, the agent is invoked with: live tip percentiles (p25–p95), slots remaining until the leader window, the last five submission outcomes, and a qualitative congestion signal. The agent returns a lamport amount and its full reasoning trace.
3. **Bundle construction.** A fresh blockhash is fetched at `confirmed` commitment — deliberately not `finalized`, which would consume roughly 30 of the transaction's ~150-slot validity window before submission even occurs (Section 6, Q2). A `VersionedTransaction` is built containing the core instruction and a tip transfer to a tip account selected at random from Jito's live `getTipAccounts` response.
4. **Submission.** The signed transaction is base64-encoded and submitted via `sendBundle` with explicit encoding metadata. The block engine returns a bundle ID immediately; this does not imply landing.
5. **Lifecycle tracking.** The bundle ID is polled against `getBundleStatuses` until a terminal state (landed or definitively absent) is reached. Slot numbers and timestamps are captured at each observed transition and written to a structured JSON record.
6. **Feedback.** The outcome of this cycle becomes part of the "recent outcomes" input to the next tip decision, closing the loop.

---

## 4. Infrastructure Decisions

### 4.1 Network Split: Devnet for Observation, Mainnet for Execution

Jito's bundle auction is an economic mechanism — validators run Jito-Solana to capture MEV, an incentive that does not meaningfully exist on devnet. This was verified empirically, not assumed: cross-referencing the live Jito validator set against the devnet leader schedule returned zero matches across repeated sampling.

Consequently, the system splits its operating network by function rather than running everything on one network for convenience:

| Function | Network | Rationale |
|---|---|---|
| Slot streaming, leader-schedule mechanics | Devnet | Free, safe, identical mechanics to mainnet for observation purposes |
| Jito bundle submission, tip economics | Mainnet | The only environment where Jito's auction and validator set are real |

This is the correct engineering tradeoff, not a workaround: it isolates the cost of real execution (mainnet SOL) to only the component that requires it, while keeping the bulk of iteration cycles free.

### 4.2 Infrastructure Provider Selection

RPC and Yellowstone gRPC access were sourced from public, zero-signup endpoints (Solana Foundation's public RPC; PublicNode's public Yellowstone gRPC) rather than a single committed vendor. This was a direct response to inconsistent reachability of specific commercial providers during development, and it has a useful side effect: every endpoint is injected via environment variables with no code-level coupling to a specific provider's SDK quirks, so swapping in a dedicated provider (Helius, Triton, QuickNode) for production use is a config change, not a refactor.

### 4.3 Leader-Window-Gated Submission

The first end-to-end submission attempts were accepted by the block engine (a bundle ID was returned) but never appeared in `getBundleStatuses`, and wallet balances were unaffected — the signature of a bundle that missed its window rather than one that was rejected outright. The fix was architectural, not cosmetic: submission was restructured to actively wait for proximity to a confirmed Jito leader before fetching a blockhash, rather than submitting opportunistically and treating failures as random noise to retry past. This is documented in detail in Section 5.3 as a worked example of the system's failure-diagnosis process.

---

## 5. Failure Handling

### 5.1 Classification Table

| Failure | Detection | Response |
|---|---|---|
| `ExpiredBlockhash` | Submission attempted against a blockhash past its `lastValidBlockHeight` | Logged, fresh blockhash fetched, resubmitted |
| `FeeTooLow` | Bundle accepted by the API but absent from `getBundleStatuses` after the polling window closes | Logged; feeds into next tip decision as a failure signal |
| `ComputeExceeded` | Simulation or execution error from RPC | Logged with raw error context |
| `BundleFailure` | Non-specific rejection from the block engine | Logged with raw error context |
| No Jito leader in range | Leader schedule vs. live Jito validator set, checked pre-submission | Submission deferred, not attempted |
| Yellowstone stream drop | `error` / `end` / `close` stream events | Exponential backoff reconnect, capped, single-flight guarded |

### 5.2 Design Principle

Failures are written to the same log schema as successes — same fields, `status: "failed"` and a populated `failure_reason` instead of commitment timestamps. This was a deliberate choice over a separate error log: it makes failure rate trivially computable from one dataset, and it's what the tip agent actually consumes as its "recent outcomes" signal.

### 5.3 Worked Example: Diagnosing a Silent Bundle Drop

An early version of the submission script fetched a blockhash and submitted immediately, with no check on leader proximity. Two consecutive submissions returned successful bundle IDs from the API, but neither produced any on-chain balance change, and `getBundleStatuses` returned an empty result set for both — not an error, simply no record.

This ruled out the obvious candidates: insufficient balance (verified via pre-flight balance check), malformed encoding (verified — the same encoding fix had already resolved an earlier, distinct `could not be decoded` error), and tip-too-low (ruled out by raising the tip 300× on the second attempt with identical results). The remaining explanation was timing: bundles submitted with no Jito leader imminent simply expire unseen. Adding an explicit wait-for-leader-window step before blockhash fetch was the fix, and it reflects a general principle applied throughout this project — when a fix doesn't change the outcome, that's signal to revisit the diagnosis, not to apply a larger version of the same fix.

---

## 6. README Question Responses

**Q1 — What does the delta between `processed_at` and `confirmed_at` indicate about network health?**

This delta measures how long it took for a supermajority of stake-weighted validators to vote on the block containing the transaction. A short delta indicates validators are receiving and voting on blocks promptly — a healthy gossip and voting path. A delta that grows materially under load indicates either network-wide congestion or localized issues (slow validators, partial network partitions) delaying vote propagation. Tracked over multiple submissions, this delta is a more honest real-time health signal than slot time alone, since slot production can remain nominally on schedule while confirmation lags.

**Q2 — Why should `finalized` commitment never be used to fetch a blockhash for a time-sensitive transaction?**

A blockhash's validity window is approximately 150 slots from the moment it was produced. `finalized` commitment, by construction, reflects state from roughly 30+ slots in the past — Solana intentionally finalizes conservatively to guarantee irreversibility. Fetching a blockhash at `finalized` commitment therefore starts the transaction's validity clock already ~30 slots into its 150-slot lifetime, before the transaction has even been built or submitted. Under any retry pressure or submission delay, this materially increases the odds of hitting `BlockhashNotFound`. `confirmed` commitment gives a blockhash that is both recent (near the full validity window) and safe (backed by supermajority vote, not just a single block producer).

**Q3 — What happens to a bundle if the Jito leader skips its slot?**

The bundle is not retried automatically — it is simply not seen by the block that gets produced. Jito's block engine routes bundles to the specific leader scheduled for the targeted slot window; if that leader misses its slot (offline, skipped, or otherwise faulted), block production passes to the next scheduled validator, who may not run Jito-Solana at all and therefore has no visibility into the bundle queue. From the submitter's perspective, this is indistinguishable at the API layer from a bundle that simply lost the tip auction — both present as "accepted, never landed." This is precisely why the system gates submission on leader-window proximity (Section 4.3) rather than relying on Jito to handle leader misses transparently.

---

## 7. Limitations and Future Work

- **Single-provider dependency per network.** RPC/Yellowstone failover across multiple providers is not implemented; a provider outage degrades to manual reconfiguration rather than automatic fallback.
- **Tip agent latency is not yet bounded.** The Claude API call sits on the critical path before blockhash fetch; under degraded API latency this could itself eat into the leader window. A bounded-timeout fallback path (not a hardcoded tip — a timeout-classified failure) would be the next hardening step.
- **Single-bundle, low-instruction-count submissions.** The system currently submits minimal-instruction bundles; extending to multi-transaction bundles (up to Jito's 5-transaction limit) for atomic multi-step operations is straightforward given the existing builder, but untested here.

Listing these honestly is intentional — a system with no stated limitations has usually not been examined closely enough.

---

## 8. Repository and Reproduction

All source code, the lifecycle logs referenced above, and setup instructions are available at:

**[github.com/Mykelsown/Smart_Transaction_Checker-solana](https://github.com/Mykelsown/Smart_Transaction_Checker-solana)**

See the repository README for environment configuration and run instructions.
