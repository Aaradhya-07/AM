import {
  PROJECT_SCHEMA_ID,
  PROJECT_SCHEMA_VERSION,
  ProjectContractSchema,
  type ProjectContract,
} from "@anvilmark/project-contract/browser";
import {
  architectureConflict,
  buildDraftArchitecture,
  type ArchitecturePattern,
} from "./architecture-guide";
import type { WorkloadKind } from "./model-starters";

export type DemoCandidate = {
  model: string;
  version: string;
  deployment: "local" | "managed_api" | "self_hosted";
  provider: string;
  region: string;
};

export type DemoDraft = {
  name: string;
  idea: string;
  user: string;
  workload: string;
  workloadKind: WorkloadKind;
  inputClassification: string;
  output: "plain_text" | "cited_text" | "ranked_document_refs";
  callsPerMonth: string;
  privacy: "local_only" | "remote_allowed";
  architecturePattern: ArchitecturePattern;
  monthlyBudget: string;
  qualityMetric: string;
  qualityMinimum: string;
  candidates: DemoCandidate[];
};

export const emptyDraft: DemoDraft = {
  name: "",
  idea: "",
  user: "",
  workload: "",
  workloadKind: "classification",
  inputClassification: "project_input",
  output: "plain_text",
  callsPerMonth: "",
  privacy: "local_only",
  architecturePattern: "local",
  monthlyBudget: "",
  qualityMetric: "",
  qualityMinimum: "",
  candidates: [
    { model: "", version: "", deployment: "local", provider: "", region: "" },
    { model: "", version: "", deployment: "local", provider: "", region: "" },
  ],
};

export const demoExample: DemoDraft = {
  name: "Support Triage",
  idea: "Classify support tickets so agents can route them to the right team.",
  user: "Support agents",
  workload: "Ticket classification",
  workloadKind: "classification",
  inputClassification: "customer_ticket",
  output: "plain_text",
  callsPerMonth: "",
  privacy: "local_only",
  architecturePattern: "local",
  monthlyBudget: "",
  qualityMetric: "classification_f1",
  qualityMinimum: "0.9",
  candidates: [
    {
      model: "Qwen/Qwen3-4B",
      version: "",
      deployment: "local",
      provider: "",
      region: "",
    },
    {
      model: "claude-haiku-5-5",
      version: "claude-haiku-5-5",
      deployment: "managed_api",
      provider: "anthropic",
      region: "",
    },
  ],
};

export function draftId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function optionalNonnegative(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} must be a nonnegative number.`);
  }
  return number;
}

/** Build a schema-valid, unapproved project contract from browser inputs. */
export function createDraftContract(
  input: DemoDraft,
  now: string,
): ProjectContract {
  const name = required(input.name, "Project name");
  const idea = required(input.idea, "Project idea");
  const workloadName = required(input.workload, "Workload");
  const projectId = draftId(name);
  const workloadId = draftId(workloadName);
  const redactionWorkloadId = `redaction-${workloadId}`;
  const redactedClassification = `redacted_${input.inputClassification}`;
  if (!projectId || !workloadId)
    throw new Error("Project and workload names need letters or numbers.");
  if (!/^[a-z0-9][a-z0-9_]*$/.test(input.inputClassification)) {
    throw new Error("Input classification must use lower_snake_case.");
  }
  if (input.candidates.length < 2)
    throw new Error("Add at least two candidates to compare.");
  const topologyError = architectureConflict(input);
  if (topologyError) throw new Error(topologyError);
  const calls = optionalNonnegative(input.callsPerMonth, "Monthly calls");
  const budget = optionalNonnegative(input.monthlyBudget, "Monthly budget");
  const qualityMinimum = optionalNonnegative(
    input.qualityMinimum,
    "Quality minimum",
  );
  if (qualityMinimum !== null && !input.qualityMetric.trim()) {
    throw new Error("Name the quality metric before setting its minimum.");
  }
  const candidateNames = input.candidates.map((candidate, index) =>
    required(candidate.model, `Candidate ${index + 1} model`),
  );

  const document = {
    schema: PROJECT_SCHEMA_ID,
    schema_version: PROJECT_SCHEMA_VERSION,
    project: {
      id: projectId,
      name,
      created_at: now,
      updated_at: now,
      contract_revision: 1,
      state: "draft",
      repository_roots: [],
      owners: [],
      priority_order: ["privacy", "quality", "cost"],
    },
    intent: {
      summary: idea,
      users: input.user.trim() ? [input.user.trim()] : [],
      outcomes: [],
      non_goals: [],
      unresolved_questions: [
        "Which candidate meets the quality gate on our own evaluation set?",
        "What are measured latency and effective monthly cost at expected usage?",
        ...(input.architecturePattern === "redacted_remote"
          ? [
              "Does the local redactor remove prohibited data before remote transfer?",
              "Which remote provider and region may receive the transformed data?",
            ]
          : input.architecturePattern === "direct_remote"
            ? ["Which remote provider and region may receive the input data?"]
            : ["Which local runtime and hardware can serve the chosen model?"]),
      ],
    },
    workloads: [
      ...(input.architecturePattern === "redacted_remote"
        ? [
            {
              id: redactionWorkloadId,
              name: `Redact input for ${workloadName}`,
              input_classification: input.inputClassification,
              output_classification: redactedClassification,
              output_contract: { kind: "plain_text" },
              expected_usage: {
                basis: calls === null ? "unknown" : "user_assumption",
                calls_per_month: calls,
                input_tokens_per_call: null,
                output_tokens_per_call: null,
                reasoning_tokens_per_call: null,
              },
              latency: null,
              quality_gates: [],
              fallback: null,
              current_decision_ref: null,
            },
          ]
        : []),
      {
        id: workloadId,
        name: workloadName,
        input_classification:
          input.architecturePattern === "redacted_remote"
            ? redactedClassification
            : input.inputClassification,
        output_classification: null,
        output_contract: { kind: input.output },
        expected_usage: {
          basis: calls === null ? "unknown" : "user_assumption",
          calls_per_month: calls,
          input_tokens_per_call: null,
          output_tokens_per_call: null,
          reasoning_tokens_per_call: null,
        },
        latency: null,
        quality_gates:
          qualityMinimum === null
            ? []
            : [
                {
                  metric: input.qualityMetric.trim(),
                  minimum: qualityMinimum,
                  evaluation_ref: `evaluation.${workloadId}`,
                },
              ],
        fallback: null,
        current_decision_ref: null,
      },
    ],
    constraints: [
      ...(input.privacy === "local_only"
        ? [
            {
              id: `privacy.${workloadId}.local_only`,
              domain: "privacy",
              severity: "hard",
              subject: `data.${input.inputClassification}`,
              operator: "must_not_leave",
              value: "local_trust_boundary",
              source: "user",
              rationale:
                "User requires this input data to stay within the local trust boundary.",
              condition: null,
              exceptions: [],
            },
          ]
        : []),
      ...(budget === null
        ? []
        : [
            {
              id: `budget.${workloadId}.monthly`,
              domain: "cost",
              severity: "soft",
              direction: "minimize",
              subject: `workload.${workloadId}.monthly_effective_cost_usd`,
              operator: "lte",
              value: budget,
              source: "user",
              rationale:
                "User-entered planning budget; candidate costs are not measured yet.",
              condition: null,
              exceptions: [],
            },
          ]),
    ],
    candidates: input.candidates.map((candidate, index) => ({
      id: `candidate.${workloadId}.${index + 1}`,
      workload_ref: workloadId,
      component_kind: "model_runtime",
      model: {
        family: candidateNames[index],
        version: candidate.version.trim() || null,
        version_mutability: candidate.version.trim() ? "pinned" : "floating",
        quantization: null,
        license_evidence_ref: null,
      },
      deployment:
        candidate.deployment === "local"
          ? {
              mode: "local",
              runtime: candidate.provider.trim() || null,
              hardware_ref: null,
            }
          : {
              mode: candidate.deployment,
              provider: candidate.provider.trim() || null,
              region: candidate.region.trim() || null,
              ...(candidate.deployment === "self_hosted"
                ? { runtime: null }
                : {}),
            },
      measurements: {},
      estimates: {},
      constraint_results: [],
      status: "unevaluated",
    })),
    architecture: buildDraftArchitecture(
      input.architecturePattern,
      workloadId,
      input.inputClassification,
      redactionWorkloadId,
    ),
    integrations: [
      {
        id: "intelligence.selected",
        kind: "intelligence",
        adapter: "none",
        credential_ref: null,
        default_data_projection: "public_decision_layer",
        additional_data_requires_consent: [],
      },
    ],
  };
  const validated = ProjectContractSchema.safeParse(document);
  if (!validated.success) {
    throw new Error(
      validated.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    );
  }
  return validated.data;
}
