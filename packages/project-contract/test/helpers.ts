import { PROJECT_SCHEMA_ID, PROJECT_SCHEMA_VERSION } from "../src/index.js";

/**
 * A small but complete contract used as the base for mutation tests.
 *
 * Unlike the Atlas fixture, this one deliberately DOES contain candidates,
 * evidence, and a decision, so that approval and evidence-floor behaviour can
 * be exercised. It is returned fresh on every call so a test can mutate it
 * without affecting any other test.
 */
export function baseDocument(): Record<string, unknown> {
  return structuredClone({
    schema: PROJECT_SCHEMA_ID,
    schema_version: PROJECT_SCHEMA_VERSION,
    project: {
      id: "sample-project",
      name: "Sample Project",
      created_at: "2026-08-17T00:00:00Z",
      updated_at: "2026-08-17T00:00:00Z",
      contract_revision: 1,
      state: "draft",
      repository_roots: [],
      priority_order: ["privacy", "quality", "cost"],
    },
    intent: {
      summary: "Classify inbound tickets and draft replies.",
      users: ["support_agent"],
      outcomes: [
        {
          id: "faster_resolution",
          measure: "median_handle_time",
          target: "<= 8 minutes",
        },
      ],
      non_goals: ["autonomous_sending"],
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
        id: "privacy.raw_remote",
        domain: "privacy",
        severity: "hard",
        subject: "data.raw_ticket",
        operator: "must_not_leave",
        value: "local_trust_boundary",
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
        output_contract: {
          kind: "json_schema",
          ref: "./schemas/classification.json",
        },
        expected_usage: {
          basis: "user_assumption",
          calls_per_month: 1000,
          input_tokens_per_call: 900,
          output_tokens_per_call: 60,
        },
        latency: { percentile: "p95", maximum_ms: 1000 },
        quality_gates: [
          {
            metric: "macro_f1",
            minimum: 0.9,
            evaluation_ref: "evidence.eval.classification",
          },
        ],
        current_decision_ref: null,
      },
      {
        id: "drafting",
        name: "Reply drafting",
        input_classification: "redacted_ticket",
        output_contract: { kind: "cited_text" },
        expected_usage: { basis: "user_assumption", calls_per_month: 1000 },
        quality_gates: [],
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
          // A deterministic observation of a machine that genuinely has the
          // declared target's capabilities. Separate id, separate evidence
          // kind: the two subjects are never collapsed.
          id: "hardware.detected_matching",
          evidence_kind: "deterministic_observation",
          cpu: { cores: 16 },
          ram_gb: 64,
          accelerators: [{ vendor: "nvidia", model: "RTX 4090", vram_gb: 24 }],
          backend: "cuda",
          operating_system: "linux",
          evidence_refs: [],
        },
        {
          id: "hardware.detected_local",
          evidence_kind: "deterministic_observation",
          cpu: { cores: 8 },
          ram_gb: 16,
          accelerators: [],
          operating_system: "macos",
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
        id: "candidate.classification.local",
        workload_ref: "classification",
        component_kind: "model_runtime",
        model: { family: "example-open-model", version: "2026-05-01" },
        deployment: {
          mode: "local",
          runtime: "example-runtime",
          hardware_ref: "hardware.declared_target",
        },
        measurements: {
          quality_result_ref: "evidence.eval.classification",
          expected_evaluation: {
            provider_id: "example-provider",
            configuration_hash: "cfg-1",
          },
        },
        estimates: {},
        constraint_results: [
          {
            constraint_ref: "quality.classification_f1",
            status: "pass",
            evidence_refs: ["evidence.eval.classification"],
            determinism: "deterministic",
          },
        ],
        status: "viable",
      },
      {
        id: "candidate.classification.remote",
        workload_ref: "classification",
        component_kind: "model_runtime",
        model: { family: "example-managed-model", version: "2026-06-01" },
        deployment: {
          mode: "managed_api",
          provider: "example-provider",
          region: "eu",
        },
        measurements: {},
        estimates: {},
        constraint_results: [],
        status: "viable",
      },
      {
        id: "candidate.drafting.local",
        workload_ref: "drafting",
        component_kind: "model_runtime",
        model: { family: "example-open-model", version: "2026-05-01" },
        deployment: {
          mode: "local",
          runtime: "example-runtime",
          hardware_ref: null,
        },
        measurements: {},
        estimates: {},
        constraint_results: [],
        status: "viable",
      },
    ],
    evidence_refs: [
      {
        id: "evidence.eval.classification",
        kind: "measured_evaluation",
        subject: "candidate.classification.local.quality",
        producer: { name: "example-eval-runner", version: "1.0.0" },
        observed_at: "2026-08-17T00:00:00Z",
        source: { type: "local_command", locator: "redacted-command-manifest" },
        applies_to: {
          candidate_ref: "candidate.classification.local",
          workload_ref: "classification",
          constraint_refs: ["quality.classification_f1"],
        },
        value: {
          dataset_ref: "dataset.classification",
          dataset_version: "v1",
          candidate_ref: "candidate.classification.local",
          configuration_hash: "cfg-1",
          identity: {
            workload_ref: null,
            dataset_hash: `sha256:${"a".repeat(64)}`,
            prompt_hash: `sha256:${"b".repeat(64)}`,
            evaluator_hash: `sha256:${"c".repeat(64)}`,
            model_configuration_hash: `sha256:${"d".repeat(64)}`,
            config_digest: `sha256:${"e".repeat(64)}`,
            provider_id: "example-provider",
          },
          metrics: { macro_f1: 0.93 },
          result_artifact_hash: "artifact-1",
        },
        confidence: "high",
        caveats: [],
        refresh: { policy: "on_hardware_or_model_change" },
      },
      {
        id: "evidence.vendor.claim",
        kind: "vendor_claim",
        subject: "candidate.classification.remote.quality",
        producer: { name: "example-provider" },
        observed_at: "2026-08-17T00:00:00Z",
        source: { type: "url", locator: "https://example.invalid/model-card" },
        applies_to: { candidate_ref: "candidate.classification.remote" },
        value: { claimed_macro_f1: 0.95 },
        confidence: "low",
        caveats: ["vendor self-reported"],
        refresh: { policy: "periodic" },
      },
    ],
    decisions: [
      {
        id: "decision.classification.v1",
        revision: 1,
        status: "proposed",
        scope: { kind: "workload", workload_ref: "classification" },
        selected_candidate_ref: "candidate.classification.local",
        alternatives: ["candidate.classification.remote"],
        satisfies_constraints: ["quality.classification_f1"],
        unresolved_constraints: [],
        evidence_refs: ["evidence.eval.classification"],
        rationale: {
          summary: "Local candidate met the declared quality gate.",
          generated_by: "intelligence_adapter.example",
          reviewed_by_user: true,
        },
        created_at: "2026-08-17T00:00:00Z",
      },
    ],
    architecture: {
      authority: "anvilmark",
      nodes: [
        {
          id: "intake",
          kind: "service",
          name: "Intake",
          trust_boundary: "local",
        },
        {
          id: "redactor",
          kind: "service",
          name: "Redactor",
          trust_boundary: "local",
        },
        {
          id: "remote-provider",
          kind: "external_system",
          name: "Remote Provider",
          trust_boundary: "remote_provider",
        },
      ],
      relationships: [
        {
          id: "intake-to-redactor",
          kind: "connects",
          source: "intake",
          destination: "redactor",
          workload_ref: "classification",
          data_classification: "raw_ticket",
        },
      ],
      generated: {
        calm_1_2: "./architecture/calm.json",
        mermaid: "./architecture/view.mmd",
      },
      decision_bindings: [
        { decision_ref: "decision.classification.v1", node_refs: ["redactor"] },
      ],
    },
    repository_bindings: [],
    conformance_rules: [
      {
        id: "rule.raw_never_remote",
        kind: "forbid_dataflow",
        severity: "error",
        constraint_ref: "privacy.raw_remote",
        from: { data_classification: "raw_ticket" },
        to: { trust_boundary: "remote_provider" },
        unless: { passes_through: [{ component_ref: "redactor" }] },
      },
      {
        id: "rule.classification_allowlist",
        kind: "provider_allowlist",
        severity: "error",
        workload_ref: "classification",
        allowed_candidate_refs: ["candidate.classification.local"],
      },
    ],
    integrations: [
      {
        id: "intelligence.user_agent",
        kind: "intelligence",
        adapter: "user_selected",
        credential_ref: "existing_session_or_environment",
      },
    ],
    remote_intelligence_policy: {
      default_allow: ["intent", "constraints", "workloads"],
      default_deny: ["repository_roots", "file_contents"],
      show_payload_before_remote_send: true,
      scan_outbound_payload_for_secrets: true,
    },
    approvals: [],
  });
}

/** Narrow an unknown nested value to a mutable record. */
export function at(
  root: unknown,
  ...path: (string | number)[]
): Record<string, unknown> {
  let current: unknown = root;
  for (const segment of path) {
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current as Record<string, unknown>;
}
