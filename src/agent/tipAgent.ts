import Anthropic from "@anthropic-ai/sdk";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface TipDecisionInput {
  tipPercentiles: { p25: number; p50: number; p75: number; p95: number };
  currentSlot: number;
  slotsUntilJitoLeader: number;
  recentOutcomes: ("landed" | "failed")[]; // last 5 bundle outcomes
  networkCondition: "low" | "moderate" | "high";
}

export interface TipDecisionOutput {
  tipLamports: number;
  reasoning: string;
}

