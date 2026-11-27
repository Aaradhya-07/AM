import type { ProjectScale } from "./planner";
import { resolveProjectScale, type RoutableModelLike } from "./slice-router";

export interface GoldTriageExemplar {
  id: string;
  tags: readonly string[];
  userPrompt: string;
  output: {
    mode: "clarify" | "plan";
    reply: string;
    questions: Array<{
      id: string;
      question: string;
      why: string;
      options: string[];
      allowMultiple: boolean;
    }>;
    elevatedBrief: string;
  };
}

interface ExemplarSlotTask {
  id: string;
  title: string;
  outcome: string;
  dependsOn: string[];
  kind:
    | "schema_types"
    | "crud_ui"
    | "feature_integration"
    | "auth_security"
    | "concurrency_algorithms"
    | "tests_docs";
  complexity: "trivial" | "low" | "medium" | "high";
  tierSlot: "fast" | "balanced" | "frontier";
  altSlot: "fast" | "balanced" | "frontier";
  acceptance: string[];
  checks: string[];
  whyTemplate: string;
  altTradeoffTemplate: string;
  inputTokens: number;
  outputTokens: number;
  estimateBasis: string;
}

export interface GoldPlanExemplarTemplate {
  id: string;
  scale: ProjectScale;
  tags: readonly string[];
  plan: {
    title: string;
    goal: string;
    users: string;
    projectScale: ProjectScale;
    scope: string[];
    nonGoals: string[];
    assumptions: string[];
    questions: string[];
    architecture: Array<{
      title: string;
      decision: string;
      why: string;
      alternative: string;
      tradeoff: string;
    }>;
    flows: Array<{
      from: string;
      to: string;
      data: string;
      boundary: string;
    }>;
    tasks: ExemplarSlotTask[];
    security: Array<{
      risk: string;
      control: string;
      verification: string;
    }>;
  };
}

export const GOLD_TRIAGE_EXEMPLARS: readonly GoldTriageExemplar[] = [
  {
    id: "triage-clarify-consumer-app",
    tags: ["todo", "task", "notes", "habit", "app", "tracker", "personal", "ui"],
    userPrompt: "Build a todo app for my daily work",
    output: {
      mode: "clarify",
      reply:
        "Happy to design a clean daily todo app—locking down storage sync and task workflow depth first will keep the architecture right-sized without over-engineering.",
      questions: [
        {
          id: "storage-sync",
          question: "Where should your tasks live and sync in v1?",
          why: "Decides between zero-auth local SQLite/IndexedDB storage vs. authenticated cloud sync.",
          options: [
            "Local-first on one device (SQLite / IndexedDB)",
            "Cloud database with single-user login",
            "Shared team lists with workspace invites",
          ],
          allowMultiple: false,
        },
        {
          id: "workflow-depth",
          question: "Which task workflows matter beyond basic check-off?",
          why: "Determines schema fields, background reminder timers, and filter views.",
          options: [
            "Clean today/upcoming views, tags & due dates",
            "Recurring schedules & subtasks",
            "Keyboard command palette & markdown notes",
          ],
          allowMultiple: true,
        },
      ],
      elevatedBrief: "",
    },
  },
  {
    id: "triage-clarify-backend-data",
    tags: ["webhook", "import", "csv", "api", "sync", "queue", "billing", "stripe", "job"],
    userPrompt: "Add webhook ingestion from Stripe into our billing service",
    output: {
      mode: "clarify",
      reply:
        "Before locking the webhook pipeline, let's pin down delivery ordering and failure recovery so retries never double-apply billing state changes.",
      questions: [
        {
          id: "processing-mode",
          question: "Should webhooks mutate billing tables inline or enqueue background work?",
          why: "Shapes signature-gate latency, retry durability, and queue infrastructure.",
          options: [
            "Transactional DB ledger write inline (<200ms)",
            "Persist raw event first, process via worker queue",
            "Match existing repo job runner",
          ],
          allowMultiple: false,
        },
        {
          id: "out-of-order-policy",
          question: "How should out-of-order or duplicate Stripe events be handled?",
          why: "Determines idempotency keys and subscription timestamp watermarking.",
          options: [
            "Deduplicate by event.id + monotonic created timestamp check",
            "Fetch canonical Stripe subscription state on every event",
            "Dead-letter unexpected state transitions for operator review",
          ],
          allowMultiple: false,
        },
      ],
      elevatedBrief: "",
    },
  },
  {
    id: "triage-plan-proportional-multi",
    tags: ["dashboard", "nextjs", "postgres", "auth", "saas", "workflow", "team", "monorepo"],
    userPrompt:
      "Build an internal incident status portal in Next.js + Postgres where on-call engineers post incident updates, components show degraded/outage badges, and subscribers get webhook notifications with retry.",
    output: {
      mode: "plan",
      reply:
        "I structured this as a multi-feature system separating public read-only status rendering from authenticated on-call mutations and an idempotent outbound webhook dispatcher.",
      questions: [],
      elevatedBrief:
        "Project scale: multi_feature. Target users: on-call engineers publishing incident timelines and customers/internal teams viewing live component health or receiving webhook alerts. Core workflows: (1) Postgres schema for components, incidents, timeline updates, and webhook subscriptions; (2) authenticated operator console to open/resolve incidents and update component states atomically; (3) public read-optimized status page with component health rollups; (4) HMAC-signed outbound webhook delivery worker with per-delivery idempotency keys and exponential backoff; (5) negative auth & replay tests. Explicit non-goals: SMS/PagerDuty paging integration, multi-region active-active replication.",
    },
  },
];

export const GOLD_PLAN_EXEMPLARS: readonly GoldPlanExemplarTemplate[] = [
  {
    id: "plan-micro-2-slices",
    scale: "micro",
    tags: ["fix", "endpoint", "cli", "flag", "bug", "validation", "health"],
    plan: {
      title: "Idempotent CLI Config Flag & Exit-Code Guard",
      goal: "Add --strict-config validation to the CLI command with deterministic non-zero exit codes on malformed keys.",
      users: "Developers running CI checks",
      projectScale: "micro",
      scope: [
        "Strict config schema validation flag",
        "Exit-code regression unit tests",
      ],
      nonGoals: ["Interactive TUI editor", "Remote config fetching"],
      assumptions: ["CLI uses Node parseArgs and Vitest"],
      questions: [],
      architecture: [
        {
          title: "Fail-closed Zod config parser",
          decision: "Validate config with z.strictObject when --strict-config is set and return exit code 2 on unknown keys.",
          why: "Catches typoed CI flags deterministically before any side effects run.",
          alternative: "Warn on stderr and continue execution.",
          tradeoff: "Strict mode rejects legacy unknown keys until cleaned up.",
        },
      ],
      flows: [
        {
          from: "CLI argv & config JSON",
          to: "Strict Zod validator",
          data: "Raw user configuration",
          boundary: "Untrusted local file & CLI input boundary",
        },
      ],
      tasks: [
        {
          id: "strict-config-flag",
          title: "Wire --strict-config parser and exit-code handling",
          outcome: "CLI rejects unknown config keys cleanly with exit code 2.",
          dependsOn: [],
          kind: "feature_integration",
          complexity: "low",
          tierSlot: "balanced",
          altSlot: "fast",
          acceptance: [
            "Unknown key exits 2 with field path in stderr",
            "Default run without flag remains backward-compatible",
          ],
          checks: ["pnpm typecheck", "pnpm test"],
          whyTemplate: "{MODEL} keeps CLI parser and error-exit changes accurate in a single pass.",
          altTradeoffTemplate: "Leaner fast option if parser changes stay confined to one file.",
          inputTokens: 9000,
          outputTokens: 1800,
          estimateBasis: "CLI command parser and config schema module.",
        },
        {
          id: "strict-config-tests",
          title: "Add negative exit-code and malformed-JSON unit tests",
          outcome: "Regression suite covers valid, unknown-key, and corrupt config files.",
          dependsOn: ["strict-config-flag"],
          kind: "tests_docs",
          complexity: "low",
          tierSlot: "fast",
          altSlot: "balanced",
          acceptance: ["All 3 exit-code scenarios asserted in Vitest"],
          checks: ["pnpm test"],
          whyTemplate: "{MODEL} handles bounded unit test cases fast at minimal cost.",
          altTradeoffTemplate: "Step up to balanced tier if test harness mocking becomes intricate.",
          inputTokens: 7000,
          outputTokens: 1400,
          estimateBasis: "CLI unit test file.",
        },
      ],
      security: [],
    },
  },
  {
    id: "plan-small-app-3-slices",
    scale: "small_app",
    tags: ["todo", "notes", "sqlite", "local", "crud", "filter", "personal"],
    plan: {
      title: "Local-First Daily Todo App",
      goal: "Let an individual user create, tag, filter, and complete daily tasks stored locally in SQLite without unnecessary cloud complexity.",
      users: "Individual developers managing daily tasks",
      projectScale: "small_app",
      scope: [
        "SQLite tasks schema & typed CRUD queries",
        "Interactive Today / Upcoming / Tag filter UI",
        "Keyboard quick-add & persistence tests",
      ],
      nonGoals: ["Multi-tenant OAuth", "Distributed queue workers"],
      assumptions: ["Next.js App Router with local SQLite"],
      questions: [],
      architecture: [
        {
          title: "Embedded SQLite repository",
          decision: "Persist tasks in a single local SQLite table with indexed (completed, due_date) columns.",
          why: "Delivers sub-millisecond local reads/writes with zero external server dependencies.",
          alternative: "Browser localStorage JSON blob",
          tradeoff: "Requires Node server runtime rather than static hosting.",
        },
      ],
      flows: [
        {
          from: "Task Form UI",
          to: "Route Handler",
          data: "Task title, dueDate, and tags",
          boundary: "Zod input validation boundary",
        },
      ],
      tasks: [
        {
          id: "sqlite-task-schema",
          title: "Create SQLite tasks table and Zod validation types",
          outcome: "Typed create/list/toggle/delete repository queries pass unit checks.",
          dependsOn: [],
          kind: "schema_types",
          complexity: "low",
          tierSlot: "fast",
          altSlot: "balanced",
          acceptance: ["Empty titles and invalid ISO dates are rejected cleanly"],
          checks: ["pnpm typecheck", "pnpm test"],
          whyTemplate: "{MODEL} executes a bounded single-table schema and Zod contract cleanly at low cost.",
          altTradeoffTemplate: "Step up to balanced workhorse if adding full-text search indexes.",
          inputTokens: 8000,
          outputTokens: 1600,
          estimateBasis: "Schema module and repository helper.",
        },
        {
          id: "task-list-filter-ui",
          title: "Build interactive task list, quick-add bar, and Today/Tag filters",
          outcome: "Users add, check off, filter, and delete tasks with instant UI feedback.",
          dependsOn: ["sqlite-task-schema"],
          kind: "crud_ui",
          complexity: "low",
          tierSlot: "balanced",
          altSlot: "fast",
          acceptance: ["Filtering by Today, Completed, and Tag updates list state accurately"],
          checks: ["pnpm typecheck", "pnpm test"],
          whyTemplate: "{MODEL} keeps React state, accessible keyboard controls, and route wiring polished.",
          altTradeoffTemplate: "Faster budget option if keeping UI styling minimal.",
          inputTokens: 13000,
          outputTokens: 2800,
          estimateBasis: "Page view, filter bar, and API routes.",
        },
        {
          id: "todo-workflow-tests",
          title: "Add end-to-end CRUD and filter persistence tests",
          outcome: "Automated tests verify task creation, toggle persistence, and validation errors.",
          dependsOn: ["task-list-filter-ui"],
          kind: "tests_docs",
          complexity: "low",
          tierSlot: "fast",
          altSlot: "balanced",
          acceptance: ["CRUD lifecycle and malformed payload tests pass"],
          checks: ["pnpm test"],
          whyTemplate: "{MODEL} generates straightforward CRUD assertions quickly at minimal burn.",
          altTradeoffTemplate: "Balanced option if adding complex browser DOM interactions.",
          inputTokens: 8500,
          outputTokens: 1700,
          estimateBasis: "Integration test suite.",
        },
      ],
      security: [],
    },
  },
  {
    id: "plan-multi-feature-6-slices-dag",
    scale: "multi_feature",
    tags: ["nextjs", "postgres", "auth", "webhook", "import", "dashboard", "saas", "team"],
    plan: {
      title: "Incident Status Portal & Signed Webhook Dispatcher",
      goal: "Enable on-call engineers to publish component status updates and incident timelines while dispatching HMAC-signed webhook alerts safely.",
      users: "On-call engineering teams and status subscribers",
      projectScale: "multi_feature",
      scope: [
        "Postgres incident, component, and webhook subscription schema",
        "Session-authenticated on-call incident management API & UI",
        "Public read-only component health & timeline status page",
        "HMAC-SHA256 webhook delivery worker with idempotent retries",
        "Subscriber management & secret rotation flow",
        "Auth isolation & webhook replay verification suite",
      ],
      nonGoals: ["SMS carrier gateway", "Multi-region database sharding"],
      assumptions: ["Next.js + Postgres + Drizzle + Vitest"],
      questions: [],
      architecture: [
        {
          title: "Transactional outbox for incident webhooks",
          decision: "Insert incident update and outbound webhook_deliveries rows inside one Postgres transaction.",
          why: "Guarantees no incident update silently drops subscriber notifications on process crash.",
          alternative: "Fire-and-forget fetch inside the HTTP POST handler.",
          tradeoff: "Requires a lightweight polling/cron drain loop over webhook_deliveries.",
        },
        {
          title: "HMAC-SHA256 timestamped delivery signatures",
          decision: "Sign `${unixTimestamp}.${rawJsonBody}` per subscriber secret with a unique delivery UUID header.",
          why: "Allows receivers to verify authenticity and reject replayed payloads outside a 5-minute window.",
          alternative: "Static bearer token header.",
          tradeoff: "Subscribers must verify HMAC over raw bytes.",
        },
      ],
      flows: [
        {
          from: "On-Call Operator UI",
          to: "Incident Mutation API",
          data: "Incident transition & component status patch",
          boundary: "Authenticated operator RBAC session",
        },
        {
          from: "Outbox Delivery Worker",
          to: "Subscriber Webhook URL",
          data: "HMAC-signed incident JSON event",
          boundary: "SSRF-guarded external HTTPS egress boundary",
        },
      ],
      tasks: [
        {
          id: "status-outbox-schema",
          title: "Define Postgres schema for components, incidents, and webhook outbox",
          outcome: "Migrations create indexed tables and transactional outbox types.",
          dependsOn: [],
          kind: "schema_types",
          complexity: "low",
          tierSlot: "fast",
          altSlot: "balanced",
          acceptance: ["Unique (incident_update_id, subscription_id) constraint prevents duplicate deliveries"],
          checks: ["pnpm typecheck", "pnpm test"],
          whyTemplate: "{MODEL} handles well-scoped Drizzle table definitions and constraints efficiently.",
          altTradeoffTemplate: "Step up to balanced tier if adding custom SQL trigger rollups.",
          inputTokens: 11000,
          outputTokens: 2200,
          estimateBasis: "Drizzle schema and migration files.",
        },
        {
          id: "operator-auth-mutations",
          title: "Implement RBAC-guarded incident & component status mutation API",
          outcome: "Only authenticated on-call operators can open/resolve incidents and enqueue outbox rows atomically.",
          dependsOn: ["status-outbox-schema"],
          kind: "auth_security",
          complexity: "high",
          tierSlot: "frontier",
          altSlot: "balanced",
          acceptance: [
            "Unauthenticated or viewer-role requests return 401/403",
            "Incident state and outbox rows commit atomically",
          ],
          checks: ["pnpm typecheck", "pnpm test"],
          whyTemplate: "{MODEL} safeguards RBAC authorization boundaries and transactional outbox invariants.",
          altTradeoffTemplate: "Strong balanced option once RBAC middleware contract is locked.",
          inputTokens: 18000,
          outputTokens: 3600,
          estimateBasis: "Auth guard, transactional service, and route handlers.",
        },
        {
          id: "public-status-view",
          title: "Build public status page with component health rollup & incident timeline",
          outcome: "Visitors view live system status, degraded badges, and chronological incident history.",
          dependsOn: ["status-outbox-schema"],
          kind: "crud_ui",
          complexity: "medium",
          tierSlot: "balanced",
          altSlot: "fast",
          acceptance: ["Renders operational/degraded/outage states accurately with empty-state fallback"],
          checks: ["pnpm typecheck", "pnpm test"],
          whyTemplate: "{MODEL} delivers clean multi-component UI composition and server-query wiring.",
          altTradeoffTemplate: "Leaner fast option if layout stays minimal.",
          inputTokens: 15000,
          outputTokens: 3200,
          estimateBasis: "Status page components and read queries (runs in parallel with operator API).",
        },
        {
          id: "operator-console-ui",
          title: "Build on-call incident composer & component status toggle UI",
          outcome: "Operators post timeline updates and flip affected component states in one workflow.",
          dependsOn: ["operator-auth-mutations"],
          kind: "feature_integration",
          complexity: "medium",
          tierSlot: "balanced",
          altSlot: "frontier",
          acceptance: ["Optimistic status form handles validation and conflict errors cleanly"],
          checks: ["pnpm typecheck", "pnpm test"],
          whyTemplate: "{MODEL} handles stateful multi-file form and API error states reliably.",
          altTradeoffTemplate: "Frontier step-up if adding concurrent multi-operator conflict resolution.",
          inputTokens: 16000,
          outputTokens: 3400,
          estimateBasis: "Operator dashboard views and client state.",
        },
        {
          id: "hmac-webhook-worker",
          title: "Implement SSRF-safe HMAC-SHA256 outbox dispatcher with exponential backoff",
          outcome: "Worker signs deliveries, blocks private/loopback callback IPs, and retries 5xx/timeouts safely.",
          dependsOn: ["operator-auth-mutations"],
          kind: "concurrency_algorithms",
          complexity: "high",
          tierSlot: "frontier",
          altSlot: "balanced",
          acceptance: [
            "FOR UPDATE SKIP LOCKED prevents double-pick across concurrent workers",
            "Loopback/RFC1918 webhook targets are rejected before connect",
          ],
          checks: ["pnpm typecheck", "pnpm test"],
          whyTemplate: "{MODEL} handles concurrent SKIP LOCKED claiming, SSRF egress guards, and HMAC signing accurately.",
          altTradeoffTemplate: "Balanced option once worker locking query is specified.",
          inputTokens: 20000,
          outputTokens: 4200,
          estimateBasis: "Outbox worker, HMAC signer, and SSRF URL validator.",
        },
        {
          id: "security-and-replay-suite",
          title: "Add negative RBAC, SSRF, and concurrent worker integration tests",
          outcome: "Automated suite proves unauthorized denial, SSRF blocking, and zero duplicate webhook sends.",
          dependsOn: ["public-status-view", "operator-console-ui", "hmac-webhook-worker"],
          kind: "tests_docs",
          complexity: "medium",
          tierSlot: "balanced",
          altSlot: "fast",
          acceptance: ["Parallel worker dispatch test emits each delivery ID exactly once"],
          checks: ["pnpm typecheck", "pnpm test"],
          whyTemplate: "{MODEL} writes thorough multi-boundary integration and concurrency assertions.",
          altTradeoffTemplate: "Fast option for isolated unit assertions.",
          inputTokens: 14000,
          outputTokens: 3000,
          estimateBasis: "End-to-end security and worker test suite.",
        },
      ],
      security: [
        {
          risk: "Webhook SSRF targeting internal metadata or loopback services",
          control: "Validate HTTPS scheme and reject private/loopback/link-local resolved IP ranges before egress.",
          verification: "Negative unit test asserting 127.0.0.1 and 169.254.169.254 targets are refused.",
        },
      ],
    },
  },
];

function tokenizeKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3),
  );
}

export function retrieveBestTriageExemplar(
  conversationText: string,
  hasPriorClarification: boolean,
): GoldTriageExemplar {
  if (hasPriorClarification) {
    return GOLD_TRIAGE_EXEMPLARS[2]!;
  }
  const tokens = tokenizeKeywords(conversationText);
  let best = GOLD_TRIAGE_EXEMPLARS[0]!;
  let bestScore = -1;
  for (const ex of GOLD_TRIAGE_EXEMPLARS) {
    const overlap = ex.tags.reduce(
      (sum, tag) => sum + (tokens.has(tag) ? 2 : 0),
      0,
    );
    const modeBonus = ex.output.mode === "clarify" ? 1 : 0;
    const score = overlap + modeBonus;
    if (score > bestScore) {
      bestScore = score;
      best = ex;
    }
  }
  return best;
}

function resolveTierSlotModel(
  slot: "fast" | "balanced" | "frontier",
  candidates: readonly RoutableModelLike[],
): RoutableModelLike {
  const exact = candidates.find(
    (c) =>
      c.tier === slot &&
      !(slot === "frontier" && /astra/i.test(c.model) && candidates.some((o) => o.tier === "frontier" && !/astra/i.test(o.model))),
  );
  if (exact) return exact;
  if (slot === "frontier") {
    return (
      candidates.find((c) => c.tier === "frontier") ??
      candidates.find((c) => c.tier === "balanced") ??
      candidates[0]!
    );
  }
  if (slot === "fast") {
    return (
      candidates.find((c) => c.billing === "local") ??
      candidates.find((c) => c.tier === "balanced") ??
      candidates[0]!
    );
  }
  return (
    candidates.find((c) => c.tier === "fast") ??
    candidates.find((c) => c.tier === "frontier") ??
    candidates[0]!
  );
}

/**
 * Retrieves the single best scale- & domain-matched gold plan exemplar and binds its
 * model slots strictly to the caller's active `candidates` pool so open-source models
 * see an exact, valid 1-shot structural reference.
 */
export function buildMatchedPlanExemplarPrompt(params: {
  idea: string;
  effort: "low" | "medium" | "max";
  candidates: readonly RoutableModelLike[];
}): string {
  const { idea, effort, candidates } = params;
  if (candidates.length === 0) return "";

  const detectedScale = resolveProjectScale({ idea });
  const targetScale: ProjectScale =
    effort === "max" && detectedScale === "multi_feature"
      ? "multi_feature"
      : detectedScale === "complex_system"
        ? "multi_feature"
        : detectedScale;

  const tokens = tokenizeKeywords(idea);
  let best = GOLD_PLAN_EXEMPLARS[1]!;
  let bestScore = -1;
  for (const ex of GOLD_PLAN_EXEMPLARS) {
    let score = ex.scale === targetScale ? 10 : 0;
    for (const tag of ex.tags) {
      if (tokens.has(tag)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = ex;
    }
  }

  const materializedTasks = best.plan.tasks.map((t) => {
    const primary = resolveTierSlotModel(t.tierSlot, candidates);
    const preferredAlt = resolveTierSlotModel(t.altSlot, candidates);
    const secondary =
      preferredAlt.model !== primary.model
        ? preferredAlt
        : candidates.find((c) => c.model !== primary.model) ?? null;

    return {
      id: t.id,
      title: t.title,
      outcome: t.outcome,
      dependsOn: t.dependsOn,
      kind: t.kind,
      complexity: t.complexity,
      acceptance: t.acceptance,
      checks: t.checks,
      model: primary.model,
      why: t.whyTemplate.replace("{MODEL}", primary.label ?? primary.model),
      alternatives: secondary
        ? [
            {
              model: secondary.model,
              tradeoff: t.altTradeoffTemplate,
            },
          ]
        : [],
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      estimateBasis: t.estimateBasis,
    };
  });

  const materialized = {
    ...best.plan,
    tasks: materializedTasks,
  };

  return `Reference structural pattern (adapt slice count & DAG waves proportionally to the user's actual brief—do NOT copy unrelated domain details):\n${JSON.stringify(materialized)}`;
}

export function buildMatchedTriageExemplarPrompt(
  conversationText: string,
  hasPriorClarification: boolean,
): string {
  const ex = retrieveBestTriageExemplar(
    conversationText,
    hasPriorClarification,
  );
  return `Reference triage example (match this sharpness and proportionality for the user's actual domain):\nUser: ${JSON.stringify(ex.userPrompt)}\nAssistant JSON: ${JSON.stringify(ex.output)}`;
}
