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
  low: "Keep the initial plan brief and focus on the first actionable step.",
  medium:
    "Cover the main architectural decisions and the implementation checks.",
  max: "Explore meaningful architecture alternatives, tradeoffs, and edge cases that would change the implementation.",
};
