import { z } from "zod";

export const betaDraftKey = "anvilmark.beta.prompt";
export const betaIdeaMin = 10;
export const betaIdeaMax = 12000;

export const betaEfforts = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "max", label: "Max effort" },
] as const;

export const betaDraft = z.object({
  idea: z.string().trim().min(betaIdeaMin).max(betaIdeaMax),
  provider: z.enum(["configured", "google", "openai"]),
  effort: z.enum(["low", "medium", "max"]),
});

export const betaPlanningDepth = {
  low: "Keep the plan lean with compact vertical slices focused on the fastest clean path to a working v1.",
  medium:
    "Decompose every distinct user workflow and architectural boundary into right-sized vertical slices with verification checks.",
  max: "Deeply decompose subsystems, parallelizable slice waves, concurrency/security invariants, and architectural tradeoffs.",
};
