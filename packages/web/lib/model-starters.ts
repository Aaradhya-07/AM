import type { DemoCandidate, DemoDraft } from "./draft-contract";

export type WorkloadKind =
  "classification" | "extraction" | "drafting" | "reasoning" | "other";

export interface ModelStarter {
  readonly id: string;
  readonly label: string;
  readonly deployment: DemoCandidate["deployment"];
  readonly provider: string;
  readonly version: string;
  readonly workloadKinds: readonly WorkloadKind[];
  readonly strength: string;
  readonly verify: string;
  readonly sourceUrl: string;
}

/**
 * Small, sourced starting set. These are documented capabilities, not measured
 * quality for the visitor's workload. Review the source before deployment.
 */
export const MODEL_STARTERS: readonly ModelStarter[] = [
  {
    id: "Qwen/Qwen3-4B",
    label: "Qwen3 4B · local",
    deployment: "local",
    provider: "",
    version: "",
    workloadKinds: ["classification", "extraction", "drafting"],
    strength:
      "Compact open-weight text model with multilingual support and a non-thinking mode.",
    verify:
      "Measure quality and latency on your data; record the exact weight revision and hardware fit.",
    sourceUrl: "https://huggingface.co/Qwen/Qwen3-4B",
  },
  {
    id: "openai/gpt-oss-20b",
    label: "gpt-oss 20B · local",
    deployment: "local",
    provider: "",
    version: "",
    workloadKinds: ["reasoning", "extraction", "drafting"],
    strength:
      "Open-weight reasoning model with structured-output support and configurable reasoning effort.",
    verify:
      "Check runtime support, exact weight revision, memory use, and workload results.",
    sourceUrl: "https://huggingface.co/openai/gpt-oss-20b",
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 mini · managed API",
    deployment: "managed_api",
    provider: "openai",
    version: "gpt-5.4-mini-2026-03-17",
    workloadKinds: ["extraction", "drafting", "reasoning"],
    strength:
      "Managed text model designed for high-volume work; supports structured outputs.",
    verify:
      "Check provider data handling, region, effective cost, and quality on your data.",
    sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.4-mini",
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5 · managed API",
    deployment: "managed_api",
    provider: "anthropic",
    version: "claude-haiku-5-5",
    workloadKinds: ["classification", "extraction", "drafting"],
    strength:
      "Managed model described for high-volume classification, routing, and extraction.",
    verify:
      "Check provider data handling, region, effective cost, and quality on your data.",
    sourceUrl: "https://platform.claude.com/docs/en/models/haiku-5-5/overview",
  },
];

export function getModelStarter(model: string): ModelStarter | undefined {
  return MODEL_STARTERS.find((starter) => starter.id === model);
}

export function starterFit(
  starter: ModelStarter,
  draft: Pick<DemoDraft, "privacy" | "workloadKind" | "architecturePattern">,
  deployment: DemoCandidate["deployment"] = starter.deployment,
): string {
  if (deployment !== "local" && draft.privacy === "local_only") {
    return draft.architecturePattern === "redacted_remote"
      ? "Requires verified redaction before remote use"
      : "Conflicts with the current local data boundary";
  }
  if (deployment !== "local" && draft.architecturePattern === "local") {
    return "Requires a remote architecture path";
  }
  if (deployment === "local" && draft.architecturePattern !== "local") {
    return "Requires the local architecture path";
  }
  return starter.workloadKinds.includes(draft.workloadKind)
    ? "Relevant capability to test"
    : "Other capability to compare";
}

export function candidateFromStarter(starter: ModelStarter): DemoCandidate {
  return {
    model: starter.id,
    version: starter.version,
    deployment: starter.deployment,
    provider: starter.provider,
    region: "",
  };
}
