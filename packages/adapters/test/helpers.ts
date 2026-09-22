import { ADAPTER_PROTOCOL_VERSION } from "../src/index.js";
import type { AdapterIdentity } from "../src/index.js";

/** A node one-liner stands in for an external tool. No network, no install. */
export const NODE = process.execPath;

export function nodeScript(source: string): readonly string[] {
  return ["-e", source];
}

export function identity(
  overrides: Partial<AdapterIdentity> = {},
): AdapterIdentity {
  return {
    id: "test-tool",
    kind: "hardware_fit",
    version: "1.0.0",
    execution: "local",
    protocol_version: ADAPTER_PROTOCOL_VERSION,
    ...overrides,
  };
}

export const FIXED_TIMES = [
  "2026-08-20T00:00:00.000Z",
  "2026-08-20T00:00:01.000Z",
] as const;

// --- contract fixture -----------------------------------------------------

import {
  PROJECT_SCHEMA_ID,
  PROJECT_SCHEMA_VERSION,
  unwrap,
  validateProjectContract,
} from "@anvilmark/project-contract";
import type { ProjectContract } from "@anvilmark/project-contract";

/**
 * A small contract with a declared target, two candidates, and both a hard
 * quality constraint and a soft cost constraint, so adapter behaviour can be
 * exercised against something a real project would look like.
 */
export function contractDocument(): Record<string, unknown> {
  return structuredClone({
    schema: PROJECT_SCHEMA_ID,
    schema_version: PROJECT_SCHEMA_VERSION,
    project: {
      id: "adapter-fixture",
      name: "Adapter Fixture",
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
      contract_revision: 1,
      state: "draft",
      priority_order: ["privacy", "quality", "cost"],
    },
    intent: {
      summary: "Classify tickets.",
      users: ["support_agent"],
      outcomes: [],
      non_goals: [],
      unresolved_questions: [],
    },
    constraints: [
      {
        id: "quality.classification_f1",
        domain: "quality",
        severity: "hard",
        subject: "workload.classification.metric.macro_f1",
        operator: "gte",
        value: 0.9,
        source: "user",
      },
      {
        id: "cost.monthly",
        domain: "cost",
        severity: "soft",
        direction: "minimize",
        subject: "project.ai_effective_cost_monthly_usd",
        operator: "lte",
        value: 500,
        source: "user",
      },
    ],
    workloads: [
      {
        id: "classification",
        name: "Ticket classification",
        input_classification: "raw_ticket",
        output_contract: { kind: "json_schema", ref: "./schemas/c.json" },
        expected_usage: {
          basis: "user_assumption",
          calls_per_month: 1000,
          input_tokens_per_call: 900,
          output_tokens_per_call: 60,
        },
        quality_gates: [
          {
            metric: "macro_f1",
            minimum: 0.9,
            evaluation_ref: "eval.classification.v1",
          },
        ],
        current_decision_ref: null,
      },
    ],
    resources: {
      hardware: [
        {
          id: "hardware.declared_target",
          evidence_kind: "user_declared",
          cpu: { cores: 16 },
          ram_gb: 64,
          accelerators: [{ vendor: "nvidia", model: "RTX 4090", vram_gb: 24 }],
          backend: "cuda",
          operating_system: "linux",
          evidence_refs: [],
        },
        {
          id: "hardware.detected_matching",
          evidence_kind: "deterministic_observation",
          cpu: { cores: 16 },
          ram_gb: 64,
          accelerators: [{ vendor: "nvidia", model: "RTX 4090", vram_gb: 24 }],
          backend: "cuda",
          operating_system: "linux",
          evidence_refs: [],
        },
      ],
      budgets: [
        {
          currency: "USD",
          period: "month",
          amount: 500,
          scope: "ai_inference",
        },
      ],
    },
    evidence_policy: { floors: {} },
    candidates: [
      {
        id: "candidate.local",
        workload_ref: "classification",
        component_kind: "model_runtime",
        model: { family: "example-open-model", version: "2026-05-01" },
        deployment: {
          mode: "local",
          runtime: "example-runtime",
          hardware_ref: "hardware.declared_target",
        },
        measurements: {},
        estimates: {},
        constraint_results: [],
        status: "viable",
      },
      {
        id: "candidate.remote",
        workload_ref: "classification",
        component_kind: "model_runtime",
        model: { family: "example-managed-model", version: "2026-06-01" },
        deployment: {
          mode: "managed_api",
          provider: "example-provider",
          region: null,
        },
        measurements: {},
        estimates: {},
        constraint_results: [],
        status: "viable",
      },
    ],
    evidence_refs: [],
    decisions: [],
    architecture: {
      authority: "anvilmark",
      nodes: [
        {
          id: "intake",
          kind: "service",
          name: "Intake",
          trust_boundary: "local",
        },
      ],
      relationships: [],
      generated: { calm_1_2: null, mermaid: null },
      decision_bindings: [],
    },
    repository_bindings: [],
    conformance_rules: [],
    integrations: [
      {
        id: "intelligence.user_agent",
        kind: "intelligence",
        adapter: "user_selected",
        credential_ref: "existing_session_or_environment",
      },
    ],
    remote_intelligence_policy: {
      default_allow: [
        "intent",
        "constraints",
        "workloads",
        "budgets",
        "non_identifying_hardware_capabilities",
        "candidates",
        "evidence_metadata_without_local_locators",
        "decisions",
        "conformance_rule_definitions",
      ],
      default_deny: ["repository_roots", "file_contents", "owners"],
      show_payload_before_remote_send: true,
      scan_outbound_payload_for_secrets: true,
    },
    approvals: [],
  });
}

export function fixtureContract(
  mutate: (document: Record<string, unknown>) => void = () => {},
): ProjectContract {
  const document = contractDocument();
  mutate(document);
  return unwrap(validateProjectContract(document));
}

export const DECLARED_TARGET = {
  id: "hardware.declared_target",
  evidence_kind: "user_declared" as const,
  cpu: { cores: 16, model: null },
  ram_gb: 64,
  accelerators: [
    { vendor: "nvidia", model: "RTX 4090", vram_gb: 24, count: 1 },
  ],
  backend: "cuda",
  operating_system: "linux" as const,
  evidence_refs: [],
};
