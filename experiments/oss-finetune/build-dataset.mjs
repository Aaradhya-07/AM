#!/usr/bin/env node
/**
 * Builds deterministic SFT, DPO, and Neural-Router training & validation datasets
 * for AnvilMark open-source planner & router models (`aara@am-server`).
 *
 * Outputs in `experiments/oss-finetune/data/`:
 *   - triage-sft.jsonl      (Stage 1 domain-fork clarification & proportional briefs)
 *   - architect-sft.jsonl   (Stage 2 multi-wave 1..10 vertical slice plans)
 *   - architect-dpo.jsonl   (DPO chosen vs. 3-slice/Astra-misrouted rejected pairs)
 *   - router-train.jsonl    (Slice + stack + model -> empirical pass probability)
 *   - router-val.jsonl      (Disjoint held-out validation split)
 *
 * Also ingests `.anvilmark/development/slice-outcomes.jsonl` if present in `--repo`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(rootDir, "experiments/oss-finetune/data");
mkdirSync(outDir, { recursive: true });

const TRIAGE_SYSTEM =
  "You are AnvilMark, a sharp software architecture & model-routing assistant. Return ONE JSON object with mode (chat | clarify | plan), reply, questions, and elevatedBrief.";

const ARCHITECT_SYSTEM =
  "You are AnvilMark's principal software architect and coding-model router. Decompose work into proportional vertical capability slices (never a lazy 3-slice horizontal template), tag projectScale, kind, and complexity, and assign 2 quality-calibrated models per slice.";

const triageExamples = [
  {
    prompt: { conversation: [{ role: "user", content: "hey what can you do?" }] },
    completion: {
      mode: "chat",
      reply:
        "I turn rough software ideas into vetted architecture decisions, right-sized vertical implementation slices, two calibrated model options per slice, and ready-to-apply coding-agent contracts. What are you planning to build today?",
      questions: [],
      elevatedBrief: "",
    },
  },
  {
    prompt: { conversation: [{ role: "user", content: "build a todo app" }] },
    completion: {
      mode: "clarify",
      reply:
        "Let's lock down storage scope and workflow depth first so we keep your todo app fast and clean without unnecessary infrastructure.",
      questions: [
        {
          id: "storage-scope",
          question: "Where should tasks be stored and accessed in v1?",
          why: "Decides between zero-auth local persistence vs. authenticated cloud sync.",
          options: [
            "Local SQLite / browser storage on one device",
            "Single-user cloud sync with login",
            "Shared team lists with invites",
          ],
          allowMultiple: false,
        },
        {
          id: "task-features",
          question: "Which task capabilities belong in v1?",
          why: "Shapes schema columns, filter queries, and UI state complexity.",
          options: [
            "Tasks, due dates, tags & Today/Completed filters",
            "Recurring schedules & subtasks",
            "Markdown notes & keyboard quick-add",
          ],
          allowMultiple: true,
        },
      ],
      elevatedBrief: "",
    },
  },
  {
    prompt: {
      conversation: [
        { role: "user", content: "build a todo app" },
        {
          role: "assistant",
          content:
            "Let's lock down storage scope first.\n\nClarifying questions asked:\n- Where should tasks be stored?",
        },
        {
          role: "user",
          content:
            "- Where should tasks be stored?: Local SQLite on one device\n- Which task capabilities?: Tasks, due dates, tags & filters",
        },
      ],
    },
    completion: {
      mode: "plan",
      reply:
        "Got it—a focused local-first SQLite todo app with tag and due-date filters, kept lean without cloud auth bloat.",
      questions: [],
      elevatedBrief:
        "Project scale: small_app. Target users: solo user managing daily tasks locally. Core workflows: (1) SQLite tasks table with Zod input validation for title, dueDate, tags, and completed state; (2) interactive task list with quick-add bar and Today/Completed/Tag filters; (3) persistence and filter regression tests. Explicit non-goals: multi-user authentication, cloud sync queues, distributed workers.",
    },
  },
  {
    prompt: {
      conversation: [
        {
          role: "user",
          content:
            "Add CSV product imports to our Next.js + Postgres inventory app",
        },
      ],
    },
    completion: {
      mode: "clarify",
      reply:
        "Before designing the import pipeline, let's clarify duplicate handling and validation failure rules so retries stay idempotent.",
      questions: [
        {
          id: "duplicate-sku-policy",
          question: "When an uploaded CSV contains an existing SKU, what should happen?",
          why: "Determines UPSERT conflict rules vs. strict rejection.",
          options: [
            "Idempotent upsert (update changed fields per workspace)",
            "Skip existing SKUs and report skipped count",
            "Reject the batch if any duplicate SKU appears",
          ],
          allowMultiple: false,
        },
        {
          id: "invalid-row-handling",
          question: "How should malformed rows affect the import batch?",
          why: "Chooses all-or-nothing DB transaction rollback vs. partial row import.",
          options: [
            "Block commit until preview errors are fixed (all-or-nothing)",
            "Import valid rows and export rejected rows CSV",
          ],
          allowMultiple: false,
        },
      ],
      elevatedBrief: "",
    },
  },
  {
    prompt: {
      conversation: [
        {
          role: "user",
          content:
            "Build a multi-tenant B2B feature-flag evaluation service in TypeScript + Postgres + Redis with SDK key auth, percentage rollouts, audit logs, and an operator dashboard.",
        },
      ],
    },
    completion: {
      mode: "plan",
      reply:
        "Your requirements are clear—I structured this across tenant-isolated Postgres storage, deterministic Murmur/SHA rollout bucketing, SDK key auth caching, and an audited operator UI.",
      questions: [],
      elevatedBrief:
        "Project scale: complex_system. Target users: engineering teams managing B2B feature rollouts and backend/client SDKs evaluating flags at low latency. Subsystems: (1) Postgres schema for organizations, environments, flags, targeting rules, SDK hashed keys, and immutable audit_logs; (2) hashed SDK bearer-key authentication & tenant isolation middleware; (3) deterministic stateless rollout hashing engine (consistent userId+flagKey bucketing); (4) Redis-cached flag snapshot read endpoint with ETag support; (5) transactional operator mutation API writing flag changes + audit log entries atomically; (6) operator dashboard for rule targeting & rollout sliders; (7) instant cache invalidation pub/sub hook; (8) cross-tenant isolation & bucketing determinism test suite. Explicit non-goals: billing metering, client analytics warehouse.",
    },
  },
];

function makeChosenAndRejectedPair({
  idea,
  scale,
  chosenTasks,
  rejectedTasks,
  title,
  goal,
}) {
  const basePlan = {
    title,
    goal,
    users: "Engineering & product users",
    projectScale: scale,
    scope: chosenTasks.map((t) => t.title),
    nonGoals: ["Unrelated third-party billing"],
    assumptions: ["TypeScript + Vitest workspace"],
    questions: [],
    architecture: [
      {
        title: "Explicit boundary validation",
        decision: "Validate external inputs with strict schemas at module entry.",
        why: "Prevents malformed state propagation.",
        alternative: "Ad-hoc inline checks.",
        tradeoff: "Slightly more upfront schema code.",
      },
    ],
    flows: [
      {
        from: "Client / Caller",
        to: "Application Boundary",
        data: "Validated request payload",
        boundary: "Schema & auth boundary",
      },
    ],
    security: [],
  };

  return {
    idea,
    chosen: { ...basePlan, tasks: chosenTasks },
    rejected: {
      ...basePlan,
      projectScale: "complex_system",
      tasks: rejectedTasks,
    },
  };
}

const dpoScenarios = [
  makeChosenAndRejectedPair({
    idea: "Build a personal SQLite todo app with tags and due-date filters",
    scale: "small_app",
    title: "Local SQLite Todo App",
    goal: "Manage personal tasks, tags, and due-date filters cleanly.",
    chosenTasks: [
      {
        id: "todo-schema",
        title: "Add SQLite tasks schema and Zod validation",
        outcome: "Typed task CRUD helpers pass unit checks.",
        dependsOn: [],
        kind: "schema_types",
        complexity: "low",
        acceptance: ["Rejects empty task titles cleanly"],
        checks: ["pnpm test"],
        model: "gpt-6-luna",
        why: "GPT-6 Luna executes bounded schema and Zod types fast at minimal cost.",
        alternatives: [
          {
            model: "gpt-6.1-sol",
            tradeoff: "Step up to balanced workhorse if adding search indexes.",
          },
        ],
        inputTokens: 8000,
        outputTokens: 1500,
        estimateBasis: "Schema + unit test.",
      },
      {
        id: "todo-ui-filters",
        title: "Build interactive task list, quick-add form, and tag/date filters",
        outcome: "Users add, toggle, filter, and delete tasks smoothly.",
        dependsOn: ["todo-schema"],
        kind: "crud_ui",
        complexity: "low",
        acceptance: ["Tag and Today filters update list accurately"],
        checks: ["pnpm test"],
        model: "gpt-6.1-sol",
        why: "GPT-6.1 Sol keeps interactive UI state and route wiring reliable at 5x lower cost than Astra.",
        alternatives: [
          {
            model: "gpt-6-luna",
            tradeoff: "Leaner fast option if UI stays minimal.",
          },
        ],
        inputTokens: 12000,
        outputTokens: 2600,
        estimateBasis: "UI components + route handler.",
      },
    ],
    rejectedTasks: [
      {
        id: "backend",
        title: "Build backend database",
        outcome: "Backend is built.",
        dependsOn: [],
        kind: "concurrency_algorithms",
        complexity: "high",
        acceptance: ["Works"],
        checks: ["pnpm test"],
        model: "gpt-6-astra",
        why: "Astra is the strongest frontier model.",
        alternatives: [{ model: "gpt-6.1-sol", tradeoff: "Cheaper" }],
        inputTokens: 25000,
        outputTokens: 5000,
        estimateBasis: "Backend.",
      },
      {
        id: "frontend",
        title: "Build frontend UI",
        outcome: "Frontend is built.",
        dependsOn: ["backend"],
        kind: "crud_ui",
        complexity: "high",
        acceptance: ["Works"],
        checks: ["pnpm test"],
        model: "gpt-6-astra",
        why: "Astra handles todo UI.",
        alternatives: [{ model: "gpt-6.1-sol", tradeoff: "Cheaper" }],
        inputTokens: 25000,
        outputTokens: 5000,
        estimateBasis: "Frontend.",
      },
      {
        id: "tests",
        title: "Write tests",
        outcome: "Tests pass.",
        dependsOn: ["frontend"],
        kind: "tests_docs",
        complexity: "high",
        acceptance: ["Tests pass"],
        checks: ["pnpm test"],
        model: "gpt-6-astra",
        why: "Astra writes todo tests.",
        alternatives: [{ model: "gpt-6-luna", tradeoff: "Faster" }],
        inputTokens: 20000,
        outputTokens: 4000,
        estimateBasis: "Tests.",
      },
    ],
  }),
  makeChosenAndRejectedPair({
    idea: "Build a multi-tenant B2B feature-flag service with Postgres RLS, SDK key auth, deterministic rollout hashing, Redis ETag caching, audited operator mutations, and targeting UI",
    scale: "complex_system",
    title: "Multi-Tenant Feature Flag Platform",
    goal: "Evaluate tenant-isolated flags deterministically with audited operator controls.",
    chosenTasks: [
      {
        id: "flag-audit-schema",
        title: "Create Postgres schema for tenants, flags, rules, and immutable audit log",
        outcome: "Migrations enforce tenant foreign keys and append-only audit rows.",
        dependsOn: [],
        kind: "schema_types",
        complexity: "low",
        acceptance: ["Migrations apply cleanly"],
        checks: ["pnpm test"],
        model: "claude-haiku-5-5",
        why: "Bounded DDL schema slice fits fast tier cleanly.",
        alternatives: [
          {
            model: "claude-sonnet-5-5",
            tradeoff: "Balanced step-up for custom SQL triggers.",
          },
        ],
        inputTokens: 11000,
        outputTokens: 2200,
        estimateBasis: "Schema & migrations.",
      },
      {
        id: "sdk-auth-rls",
        title: "Implement SHA-256 SDK key verification and Postgres RLS tenant isolation",
        outcome: "Requests authenticate hashed SDK keys and isolate tenant rows.",
        dependsOn: ["flag-audit-schema"],
        kind: "auth_security",
        complexity: "high",
        acceptance: ["Cross-tenant flag queries return 0 rows"],
        checks: ["pnpm test"],
        model: "claude-opus-5-5",
        why: "Frontier reasoning safeguards tenant RLS and constant-time key verification.",
        alternatives: [
          {
            model: "claude-sonnet-5-5",
            tradeoff: "Balanced option once RLS policy template is fixed.",
          },
        ],
        inputTokens: 22000,
        outputTokens: 4500,
        estimateBasis: "Auth guard & RLS policies.",
      },
      {
        id: "rollout-hash-engine",
        title: "Implement deterministic consistent-hash percentage rollout evaluator",
        outcome: "Identical (flagKey, subjectId) pairs evaluate identically across SDKs.",
        dependsOn: ["flag-audit-schema"],
        kind: "concurrency_algorithms",
        complexity: "high",
        acceptance: ["10k subject rollout matches target percentage within 1%"],
        checks: ["pnpm test"],
        model: "claude-opus-5-5",
        why: "Frontier precision ensures monotonic bucketing invariants without rollout resets.",
        alternatives: [
          {
            model: "gpt-6.1-sol",
            tradeoff: "Balanced option if porting an existing hash spec.",
          },
        ],
        inputTokens: 18000,
        outputTokens: 3800,
        estimateBasis: "Evaluator engine & property tests.",
      },
      {
        id: "redis-etag-endpoint",
        title: "Build Redis-cached SDK flag snapshot endpoint with ETag 304 support",
        outcome: "SDKs poll flag snapshots with sub-5ms cache hits and stampede protection.",
        dependsOn: ["sdk-auth-rls", "rollout-hash-engine"],
        kind: "feature_integration",
        complexity: "medium",
        acceptance: ["Matching If-None-Match returns 304 with zero DB queries"],
        checks: ["pnpm test"],
        model: "claude-sonnet-5-5",
        why: "Strong balanced workhorse for Redis caching and HTTP ETag headers.",
        alternatives: [
          {
            model: "claude-opus-5-5",
            tradeoff: "Frontier step-up for distributed cache-stampede leases.",
          },
        ],
        inputTokens: 16000,
        outputTokens: 3200,
        estimateBasis: "Read route & cache layer.",
      },
      {
        id: "audited-operator-api",
        title: "Build transactional flag rule mutation API with atomic audit-log writes",
        outcome: "Every rollout change records actor, before/after diff, and invalidates cache.",
        dependsOn: ["sdk-auth-rls"],
        kind: "feature_integration",
        complexity: "medium",
        acceptance: ["Failed audit insert rolls back flag mutation"],
        checks: ["pnpm test"],
        model: "gpt-6.1-sol",
        why: "Dependable multi-file TypeScript accuracy on transactional API routes.",
        alternatives: [
          {
            model: "claude-opus-5-5",
            tradeoff: "Frontier step-up for optimistic version conflict merging.",
          },
        ],
        inputTokens: 17000,
        outputTokens: 3500,
        estimateBasis: "Mutation API & cache invalidator.",
      },
      {
        id: "operator-targeting-ui",
        title: "Build operator dashboard with rule builder and rollout slider",
        outcome: "Operators configure segment rules, rollout percentages, and inspect audit history.",
        dependsOn: ["audited-operator-api"],
        kind: "crud_ui",
        complexity: "medium",
        acceptance: ["Unsaved rollout changes prompt confirmation before publish"],
        checks: ["pnpm test"],
        model: "claude-sonnet-5-5",
        why: "Balanced workhorse keeps interactive form state and diff preview clean.",
        alternatives: [
          {
            model: "gpt-6.1-sol",
            tradeoff: "Comparable balanced peer.",
          },
        ],
        inputTokens: 19000,
        outputTokens: 4100,
        estimateBasis: "Dashboard components.",
      },
    ],
    rejectedTasks: [
      {
        id: "db-and-auth",
        title: "Set up database, auth, and rollout engine",
        outcome: "Backend core works.",
        dependsOn: [],
        kind: "schema_types",
        complexity: "low",
        acceptance: ["Works"],
        checks: ["pnpm test"],
        model: "claude-haiku-5-5",
        why: "Cheap fast model.",
        alternatives: [{ model: "claude-sonnet-5-5", tradeoff: "Slower" }],
        inputTokens: 15000,
        outputTokens: 3000,
        estimateBasis: "Backend.",
      },
      {
        id: "api-and-ui",
        title: "Build API endpoints and operator UI",
        outcome: "UI works.",
        dependsOn: ["db-and-auth"],
        kind: "crud_ui",
        complexity: "low",
        acceptance: ["Works"],
        checks: ["pnpm test"],
        model: "claude-haiku-5-5",
        why: "Fast model.",
        alternatives: [{ model: "claude-sonnet-5-5", tradeoff: "Higher cost" }],
        inputTokens: 15000,
        outputTokens: 3000,
        estimateBasis: "UI.",
      },
      {
        id: "all-tests",
        title: "Add tests",
        outcome: "Tests pass.",
        dependsOn: ["api-and-ui"],
        kind: "tests_docs",
        complexity: "low",
        acceptance: ["Pass"],
        checks: ["pnpm test"],
        model: "claude-haiku-5-5",
        why: "Fast tests.",
        alternatives: [{ model: "claude-sonnet-5-5", tradeoff: "More tokens" }],
        inputTokens: 10000,
        outputTokens: 2000,
        estimateBasis: "Tests.",
      },
    ],
  }),
];

// Write SFT & DPO JSONL files
writeFileSync(
  join(outDir, "triage-sft.jsonl"),
  triageExamples
    .map((ex) =>
      JSON.stringify({
        messages: [
          { role: "system", content: TRIAGE_SYSTEM },
          { role: "user", content: JSON.stringify(ex.prompt) },
          { role: "assistant", content: JSON.stringify(ex.completion) },
        ],
      }),
    )
    .join("\n") + "\n",
);

writeFileSync(
  join(outDir, "architect-sft.jsonl"),
  dpoScenarios
    .map((sc) =>
      JSON.stringify({
        messages: [
          { role: "system", content: ARCHITECT_SYSTEM },
          { role: "user", content: JSON.stringify({ idea: sc.idea }) },
          { role: "assistant", content: JSON.stringify(sc.chosen) },
        ],
      }),
    )
    .join("\n") + "\n",
);

writeFileSync(
  join(outDir, "architect-dpo.jsonl"),
  dpoScenarios
    .map((sc) =>
      JSON.stringify({
        prompt: `${ARCHITECT_SYSTEM}\n\nUser request:\n${JSON.stringify({ idea: sc.idea })}`,
        chosen: JSON.stringify(sc.chosen),
        rejected: JSON.stringify(sc.rejected),
      }),
    )
    .join("\n") + "\n",
);

// Generate Neural Router feature dataset (combining domain telemetry + repo outcomes if available)
const SLICE_KINDS = [
  "schema_types",
  "crud_ui",
  "feature_integration",
  "auth_security",
  "concurrency_algorithms",
  "tests_docs",
];
const COMPLEXITIES = ["trivial", "low", "medium", "high"];
const SCALES = ["micro", "small_app", "multi_feature", "complex_system"];
const STACKS = [
  { id: "web_ts", isWebTs: 1, isSystems: 0, isMonorepo: 0 },
  { id: "monorepo_ts", isWebTs: 1, isSystems: 1, isMonorepo: 1 },
  { id: "systems_backend", isWebTs: 0, isSystems: 1, isMonorepo: 0 },
];

const MODEL_CARDS = [
  {
    model: "claude-opus-5-5",
    tier: "frontier",
    isLocal: 0,
    isHeavySpecialist: 0,
    isWeakLocal: 0,
    costNorm: 0.4,
    arenaNorm: 0.98,
    webAffinity: 0.92,
    systemsAffinity: 0.95,
  },
  {
    model: "gpt-6-astra",
    tier: "frontier",
    isLocal: 0,
    isHeavySpecialist: 1,
    isWeakLocal: 0,
    costNorm: 1.0,
    arenaNorm: 0.94,
    webAffinity: 0.85,
    systemsAffinity: 0.96,
  },
  {
    model: "gemini-4-argon",
    tier: "frontier",
    isLocal: 0,
    isHeavySpecialist: 0,
    isWeakLocal: 0,
    costNorm: 0.2,
    arenaNorm: 0.9,
    webAffinity: 0.91,
    systemsAffinity: 0.89,
  },
  {
    model: "claude-sonnet-5-5",
    tier: "balanced",
    isLocal: 0,
    isHeavySpecialist: 0,
    isWeakLocal: 0,
    costNorm: 0.2,
    arenaNorm: 0.95,
    webAffinity: 0.93,
    systemsAffinity: 0.88,
  },
  {
    model: "gpt-6.1-sol",
    tier: "balanced",
    isLocal: 0,
    isHeavySpecialist: 0,
    isWeakLocal: 0,
    costNorm: 0.2,
    arenaNorm: 0.92,
    webAffinity: 0.9,
    systemsAffinity: 0.92,
  },
  {
    model: "qwen3-coder-30b-a3b",
    tier: "balanced",
    isLocal: 1,
    isHeavySpecialist: 0,
    isWeakLocal: 0,
    costNorm: 0.0,
    arenaNorm: 0.78,
    webAffinity: 0.76,
    systemsAffinity: 0.85,
  },
  {
    model: "claude-haiku-5-5",
    tier: "fast",
    isLocal: 0,
    isHeavySpecialist: 0,
    isWeakLocal: 0,
    costNorm: 0.01,
    arenaNorm: 0.66,
    webAffinity: 0.68,
    systemsAffinity: 0.65,
  },
  {
    model: "gpt-6-luna",
    tier: "fast",
    isLocal: 0,
    isHeavySpecialist: 0,
    isWeakLocal: 0,
    costNorm: 0.01,
    arenaNorm: 0.65,
    webAffinity: 0.66,
    systemsAffinity: 0.66,
  },
  {
    model: "gemini-3.8-flash",
    tier: "fast",
    isLocal: 0,
    isHeavySpecialist: 0,
    isWeakLocal: 0,
    costNorm: 0.075,
    arenaNorm: 0.7,
    webAffinity: 0.72,
    systemsAffinity: 0.66,
  },
  {
    model: "qwen3.5-9b",
    tier: "fast",
    isLocal: 1,
    isWeakLocal: 1,
    isHeavySpecialist: 0,
    costNorm: 0.0,
    arenaNorm: 0.58,
    webAffinity: 0.55,
    systemsAffinity: 0.58,
  },
];

function computeTargetUtility(kind, complexity, scale, stack, m, repoWinRate) {
  const compIdx = COMPLEXITIES.indexOf(complexity); // 0..3
  const scaleIdx = SCALES.indexOf(scale); // 0..3

  // Quality capability vs task demand
  const demand =
    compIdx * 0.24 +
    scaleIdx * 0.08 +
    (kind === "auth_security" || kind === "concurrency_algorithms" ? 0.2 : 0) +
    (kind === "feature_integration" ? 0.1 : 0);

  const capability =
    (m.tier === "frontier" ? 0.94 : m.tier === "balanced" ? 0.83 : 0.62) +
    (stack.isWebTs ? (m.webAffinity - 0.75) * 0.25 : 0) +
    (stack.isSystems ? (m.systemsAffinity - 0.75) * 0.25 : 0) +
    (stack.isMonorepo && m.tier === "fast" ? -0.08 : 0) +
    (m.isWeakLocal && compIdx >= 2 ? -0.22 : 0);

  // Quality drop penalty if capability < demand
  const shortfall = Math.max(0, demand - capability);
  const qualityScore = Math.min(0.98, capability - shortfall * 1.45);

  // Mindful cost / overkill penalty (e.g. GPT-6 Astra on small/low/medium tasks)
  let overkillPenalty = 0;
  if (m.isHeavySpecialist && (compIdx < 3 || scaleIdx <= 1)) {
    overkillPenalty += 0.42;
  } else if (m.tier === "frontier" && compIdx <= 1 && scaleIdx <= 1) {
    overkillPenalty += 0.22;
  } else if (m.tier === "balanced" && compIdx === 0) {
    overkillPenalty += 0.08;
  }

  // Blend in observed repository win-rate strongly when available
  const blended =
    repoWinRate !== null
      ? 0.45 * (qualityScore - overkillPenalty) + 0.55 * repoWinRate
      : qualityScore - overkillPenalty - m.costNorm * (compIdx <= 1 ? 0.12 : 0.03);

  return Number(Math.min(0.98, Math.max(0.05, blended)).toFixed(4));
}

function encodeFeatureVector(kind, complexity, scale, stack, m, repoWinRate, hasRepoObs) {
  return [
    // Slice kind one-hot (6)
    ...SLICE_KINDS.map((k) => (k === kind ? 1 : 0)),
    // Complexity ordinal + high flag (2)
    COMPLEXITIES.indexOf(complexity) / 3,
    complexity === "high" ? 1 : 0,
    // Project scale ordinal + small flag (2)
    SCALES.indexOf(scale) / 3,
    scale === "micro" || scale === "small_app" ? 1 : 0,
    // Stack fingerprint (3)
    stack.isWebTs,
    stack.isSystems,
    stack.isMonorepo,
    // Model attributes (8)
    m.tier === "fast" ? 1 : 0,
    m.tier === "balanced" ? 1 : 0,
    m.tier === "frontier" ? 1 : 0,
    m.isLocal,
    m.isHeavySpecialist,
    m.isWeakLocal,
    m.costNorm,
    m.arenaNorm,
    // Repo empirical history features (2) -> total 23 features
    hasRepoObs,
    repoWinRate ?? m.arenaNorm * 0.85,
  ];
}

const trainRows = [];
const valRows = [];
let idx = 0;

for (const kind of SLICE_KINDS) {
  for (const complexity of COMPLEXITIES) {
    for (const scale of SCALES) {
      for (const stack of STACKS) {
        for (const m of MODEL_CARDS) {
          for (const repoObsCase of [null, 0.25, 0.6, 0.92]) {
            const hasObs = repoObsCase === null ? 0 : 1;
            const features = encodeFeatureVector(
              kind,
              complexity,
              scale,
              stack,
              m,
              repoObsCase,
              hasObs,
            );
            const target = computeTargetUtility(
              kind,
              complexity,
              scale,
              stack,
              m,
              repoObsCase,
            );
            const row = JSON.stringify({
              features,
              target,
              meta: { kind, complexity, scale, stack: stack.id, model: m.model },
            });
            // Deterministic 85/15 split across scenario combinations
            if (idx % 7 === 0) valRows.push(row);
            else trainRows.push(row);
            idx += 1;
          }
        }
      }
    }
  }
}

// Also ingest real `.anvilmark/development/slice-outcomes.jsonl` if present
const realOutcomesPath = join(
  rootDir,
  ".anvilmark/development/slice-outcomes.jsonl",
);
let ingestedReal = 0;
if (existsSync(realOutcomesPath)) {
  const lines = readFileSync(realOutcomesPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      const matchedCard = MODEL_CARDS.find(
        (c) => c.model === (rec.served_model ?? rec.configured_model),
      );
      if (!matchedCard) continue;
      const win =
        rec.status === "accepted"
          ? Math.max(0.2, 1 - 0.5 * (rec.rework_ratio ?? 0) - 0.2 * (rec.retries ?? 0))
          : 0.08;
      const mappedKind =
        rec.task_category === "frontend"
          ? "crud_ui"
          : rec.task_category === "architecture"
            ? "auth_security"
            : rec.task_category === "tests"
              ? "tests_docs"
              : "feature_integration";
      const features = encodeFeatureVector(
        mappedKind,
        "medium",
        "multi_feature",
        STACKS[1],
        matchedCard,
        win,
        1,
      );
      trainRows.push(
        JSON.stringify({
          features,
          target: Number(win.toFixed(4)),
          meta: { source: "repo_ledger", model: matchedCard.model },
        }),
      );
      ingestedReal += 1;
    } catch {
      // Skip malformed line
    }
  }
}

writeFileSync(join(outDir, "router-train.jsonl"), trainRows.join("\n") + "\n");
writeFileSync(join(outDir, "router-val.jsonl"), valRows.join("\n") + "\n");

console.log(
  JSON.stringify(
    {
      outDir,
      triageSftCount: triageExamples.length,
      architectSftCount: dpoScenarios.length,
      architectDpoCount: dpoScenarios.length,
      routerTrainCount: trainRows.length,
      routerValCount: valRows.length,
      ingestedRepoOutcomes: ingestedReal,
    },
    null,
    2,
  ),
);
