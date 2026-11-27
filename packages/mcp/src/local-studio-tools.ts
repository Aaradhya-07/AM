import { lstat, realpath } from "node:fs/promises";
import {
  HandoffPlan,
  PLAN_HANDOFF_VERSION,
  aggregateOutcomes,
  applyPlan,
  exportRepoContext,
  loadSlicePlan,
  measureDrift,
  parseBundle,
  readSliceOutcomes,
  renderCursorRule,
  renderInstructionSection,
  sliceDigest,
  sliceWaves,
  verifySlice,
  type PlanHandoffBundle,
  type PlanTarget,
  type RepoOutcomesSummary,
  type SliceContractSpec,
} from "@anvilmark/cli";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  COCKPIT_APP_HTML,
  COCKPIT_APP_MIME,
  COCKPIT_APP_URI,
} from "./cockpit-app-html.js";

export interface LocalStudioToolOptions {
  readonly root: string;
  readonly clock: () => string;
  readonly diagnostics?: (message: string) => void;
  readonly getActiveRoot?: () => string;
  readonly setActiveRoot?: (nextDir: string) => void;
}

const SubscriptionEnum = z.enum([
  "claude",
  "chatgpt",
  "gemini",
  "cursor",
  "local_oss",
]);
const QuotaModeEnum = z.enum(["plenty", "conserve", "exhausted"]);
const TargetEnum = z.enum(["claude", "cursor", "codex"]);

interface CatalogCandidate {
  model: string;
  label: string;
  provider: string;
  tier: "frontier" | "balanced" | "fast";
  billing: "api" | "subscription" | "local";
  groups: Array<z.infer<typeof SubscriptionEnum>>;
  strengths: string;
  priorMean: number;
}

const DEFAULT_CANDIDATES: readonly CatalogCandidate[] = [
  {
    model: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "Anthropic",
    tier: "frontier",
    billing: "subscription",
    groups: ["claude", "cursor"],
    strengths:
      "#1 Agent Arena for ambiguous architecture, security boundaries, and tricky concurrency.",
    priorMean: 0.87,
  },
  {
    model: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    provider: "Anthropic",
    tier: "balanced",
    billing: "subscription",
    groups: ["claude", "cursor"],
    strengths:
      "#2 Agent Arena daily workhorse for multi-file feature slices and stateful UI.",
    priorMean: 0.78,
  },
  {
    model: "gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    provider: "OpenAI",
    tier: "balanced",
    billing: "subscription",
    groups: ["chatgpt", "cursor"],
    strengths:
      "#5 Agent Arena & #2 Praise/Complaint at 5x lower burn than Astra; primary OpenAI workhorse for feature slices.",
    priorMean: 0.77,
  },
  {
    model: "gemini-4-argon",
    label: "Gemini 4 Argon",
    provider: "Google",
    tier: "frontier",
    billing: "subscription",
    groups: ["gemini", "cursor"],
    strengths:
      "#2 Coding Arena & large-context synthesis across multi-package monorepos.",
    priorMean: 0.84,
  },
  {
    model: "gpt-6-astra",
    label: "GPT-6 Astra",
    provider: "OpenAI",
    tier: "frontier",
    billing: "subscription",
    groups: ["chatgpt"],
    strengths:
      "Heavy reasoning specialist ($10/$50 eq.) reserved strictly for tricky concurrency, cryptography, and hard algorithmic invariants—never routine CRUD or UI.",
    priorMean: 0.85,
  },
  {
    model: "qwen3-coder-30b-a3b",
    label: "Qwen 3 Coder 30B (Local OSS)",
    provider: "am-server",
    tier: "balanced",
    billing: "local",
    groups: ["local_oss"],
    strengths:
      "Zero-marginal-cost 30B MoE coding model on local/LAN GPU server for CRUD, backend routes, and refactors.",
    priorMean: 0.72,
  },
  {
    model: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    provider: "Anthropic",
    tier: "fast",
    billing: "subscription",
    groups: ["claude", "cursor"],
    strengths:
      "Fast, low-burn execution for bounded schemas, types, fixtures, and unit tests.",
    priorMean: 0.65,
  },
  {
    model: "gpt-6-luna",
    label: "GPT-6 Luna",
    provider: "OpenAI",
    tier: "fast",
    billing: "subscription",
    groups: ["chatgpt"],
    strengths:
      "Fast budget model for narrow CRUD endpoints, wiring, and unit tests.",
    priorMean: 0.64,
  },
  {
    model: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    provider: "Google",
    tier: "fast",
    billing: "subscription",
    groups: ["gemini"],
    strengths: "Rapid UI components, glue code, and iterative test passes.",
    priorMean: 0.66,
  },
  {
    model: "qwen3.5-9b",
    label: "Qwen 3.5 9B (Local OSS)",
    provider: "am-server",
    tier: "fast",
    billing: "local",
    groups: ["local_oss"],
    strengths:
      "Warm zero-cost local model for fast triage, fixtures, and boilerplate.",
    priorMean: 0.62,
  },
];

const BASE_FORBIDDEN_GLOBS = [
  ".env",
  ".env.*",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa*",
  "**/id_ed25519*",
];

const SAFE_COMMAND_RE =
  /^(pnpm|npm|yarn|bun|npx|node|vitest|jest|playwright|pytest|python3?|uv|cargo|go|make|tsc|eslint|prettier|ruff|mypy|anvilmark)\b/;

function inferFamily(
  model: string,
  provider?: string,
  billing?: string,
): "anthropic" | "openai" | "google" | "local_oss" | null {
  if (billing === "local") return "local_oss";
  const text = `${model} ${provider ?? ""}`.toLowerCase();
  if (/am-server|ollama|vllm|local/.test(text)) return "local_oss";
  if (/claude|anthropic|opus|sonnet|haiku/.test(text)) return "anthropic";
  if (/gpt-|openai|codex|astra|\bsol\b|luna/.test(text)) return "openai";
  if (/gemini|google|argon/.test(text)) return "google";
  if (/qwen|gemma|llama|mistral|deepseek/.test(text)) return "local_oss";
  return null;
}

function selectRankedCandidates(
  subscriptions: readonly z.infer<typeof SubscriptionEnum>[],
  quotaMode: z.infer<typeof QuotaModeEnum>,
  outcomes: RepoOutcomesSummary,
) {
  const subSet = new Set(subscriptions);
  let pool =
    subSet.size === 0
      ? [...DEFAULT_CANDIDATES]
      : DEFAULT_CANDIDATES.filter((c) => c.groups.some((g) => subSet.has(g)));

  if (pool.length === 0) pool = [...DEFAULT_CANDIDATES];

  if (quotaMode === "exhausted") {
    const filtered = pool.filter(
      (c) => c.billing === "local" || c.tier !== "frontier",
    );
    const localOnes = DEFAULT_CANDIDATES.filter((c) => c.billing === "local");
    const seen = new Set<string>();
    const combined: CatalogCandidate[] = [];
    for (const item of [...localOnes, ...filtered]) {
      if (!seen.has(item.model)) {
        seen.add(item.model);
        combined.push(item);
      }
    }
    pool = combined;
  } else if (quotaMode === "conserve") {
    let keptFrontier = false;
    const conserved: CatalogCandidate[] = [];
    for (const item of pool) {
      if (item.tier === "frontier" && item.billing !== "local") {
        if (keptFrontier) continue;
        keptFrontier = true;
      }
      conserved.push(item);
    }
    for (const loc of DEFAULT_CANDIDATES.filter((c) => c.billing === "local")) {
      if (!conserved.some((c) => c.model === loc.model)) {
        conserved.push(loc);
      }
    }
    pool = conserved;
  }

  const outcomeMap = new Map(
    outcomes.models.map((m) => [m.model.toLowerCase(), m]),
  );

  return pool
    .map((c) => {
      const obs = outcomeMap.get(c.model.toLowerCase());
      const priorTrials = 6;
      const alpha0 = c.priorMean * priorTrials;
      if (!obs || obs.attempts <= 0) {
        return {
          model: c.model,
          label: c.label,
          provider: c.provider,
          tier: c.tier,
          billing: c.billing,
          empiricalScore: Number(c.priorMean.toFixed(4)),
          observedRuns: 0,
          observedFirstPassRate: null as number | null,
          strengths: c.strengths,
        };
      }
      const adjustedWins = Math.min(
        obs.attempts,
        (obs.acceptedFirstPass + 0.55 * obs.acceptedAfterRetry) *
          (1 - 0.5 * obs.meanReworkRatio),
      );
      const posterior = (alpha0 + adjustedWins) / (priorTrials + obs.attempts);
      const firstRate = Number(
        (obs.acceptedFirstPass / obs.attempts).toFixed(4),
      );
      return {
        model: c.model,
        label: c.label,
        provider: c.provider,
        tier: c.tier,
        billing: c.billing,
        empiricalScore: Number(posterior.toFixed(4)),
        observedRuns: obs.attempts,
        observedFirstPassRate: firstRate,
        strengths: `Proven ${obs.acceptedFirstPass}/${obs.attempts} first-pass on this repo. ${c.strengths}`,
      };
    })
    .sort((a, b) => b.empiricalScore - a.empiricalScore)
    .slice(0, 8);
}

function calibrateMcpPlanTasks(
  plan: z.infer<typeof HandoffPlan>,
  ranked: ReturnType<typeof selectRankedCandidates>,
): z.infer<typeof HandoffPlan>["tasks"] {
  const planText = `${plan.title} ${plan.goal} ${plan.scope.join(" ")}`;
  const isSimpleApp =
    plan.projectScale === "micro" ||
    plan.projectScale === "small_app" ||
    (/\b(todo|to-do|task\s*list|checklist|notes?\s+app|habit\s+tracker|calculator|counter\s+app)\b/i.test(
      planText,
    ) &&
      !/\b(crdt|distributed|multi-tenant\s+rbac|consensus|kafka)\b/i.test(
        planText,
      ));

  return plan.tasks.map((task) => {
    const sliceText = `${task.title} ${task.outcome} ${task.acceptance.join(" ")}`;
    const hasHighRisk =
      task.complexity === "high" ||
      /\b(auth|rbac|jwt|oauth|hmac|signature|encrypt|concurren|race\s+condition|deadlock|idempoten|crdt|tenant\s+isolation)\b/i.test(
        sliceText,
      );
    const isHeavySpecialist = /astra|\bo1\b|\bo3-pro\b/i.test(task.model);

    let nextModel = task.model;
    let nextWhy = task.why;

    // Demote heavy reasoning specialists (e.g. gpt-6-astra) on simple apps or routine slices
    if (isHeavySpecialist && (isSimpleApp || !hasHighRisk)) {
      const replacement =
        ranked.find(
          (c) =>
            c.tier === "balanced" &&
            inferFamily(c.model, c.provider, c.billing) ===
              inferFamily(task.model),
        ) ??
        ranked.find((c) => c.tier === "balanced") ??
        ranked.find((c) => !/astra|\bo1\b|\bo3-pro\b/i.test(c.model));
      if (replacement) {
        nextModel = replacement.model;
        nextWhy = `${replacement.label} (${replacement.tier} tier) delivers reliable coding quality for this slice at a fraction of specialist frontier burn.`;
      }
    }

    // Ensure every slice exposes a meaningful second model option (`alternatives[0]`)
    const filteredAlts = task.alternatives.filter(
      (alt) =>
        alt.model !== nextModel &&
        !(
          /astra|\bo1\b|\bo3-pro\b/i.test(alt.model) &&
          (isSimpleApp || !hasHighRisk)
        ),
    );

    if (filteredAlts.length === 0 && ranked.length >= 2) {
      const primaryCand = ranked.find((c) => c.model === nextModel);
      const preferredTier =
        primaryCand?.tier === "fast"
          ? "balanced"
          : isSimpleApp
            ? "fast"
            : hasHighRisk && primaryCand?.tier !== "frontier"
              ? "frontier"
              : "balanced";
      const second =
        ranked.find(
          (c) =>
            c.model !== nextModel &&
            c.tier === preferredTier &&
            !(
              /astra|\bo1\b|\bo3-pro\b/i.test(c.model) &&
              (isSimpleApp || !hasHighRisk)
            ),
        ) ??
        ranked.find(
          (c) =>
            c.model !== nextModel &&
            !(
              /astra|\bo1\b|\bo3-pro\b/i.test(c.model) &&
              (isSimpleApp || !hasHighRisk)
            ),
        );
      if (second) {
        filteredAlts.push({
          model: second.model,
          tradeoff:
            second.billing === "local"
              ? "Zero-API-cost local OSS alternative on am-server."
              : second.tier === "frontier"
                ? "Frontier step-up option if subtle cross-cutting invariants arise."
                : second.tier === "fast"
                  ? "Leaner fast-tier option if slice implementation stays compact."
                  : "Strong balanced workhorse option with dependable multi-file accuracy.",
        });
      }
    }

    return {
      ...task,
      model: nextModel,
      why: nextWhy,
      alternatives: filteredAlts,
    };
  });
}

function compileDefaultContract(
  task: z.infer<typeof HandoffPlan>["tasks"][number],
  flows: z.infer<typeof HandoffPlan>["flows"],
  candidates: PlanHandoffBundle["candidates"],
  repoCheckCommands: readonly string[],
  sampleFiles: readonly string[],
  strict: boolean,
): SliceContractSpec {
  const authorCand = candidates.find((c) => c.model === task.model);
  const authorFamily = inferFamily(
    task.model,
    authorCand?.provider,
    authorCand?.billing,
  );
  let reviewerFamily: "anthropic" | "openai" | "google" | "local_oss" =
    authorFamily === "anthropic" ? "openai" : "anthropic";
  for (const cand of candidates) {
    const f = inferFamily(cand.model, cand.provider, cand.billing);
    if (f && f !== authorFamily) {
      reviewerFamily = f;
      break;
    }
  }

  if (task.contract) {
    return {
      ...task.contract,
      reviewerFamily: task.contract.reviewerFamily ?? reviewerFamily,
    };
  }

  const textBlob = `${task.title}\n${task.outcome}\n${task.acceptance.join("\n")}`;
  const globs = new Set<string>();
  const pkgMatches = textBlob.match(
    /\b(?:packages|apps|services|libs)\/[a-z0-9._-]+/gi,
  );
  if (pkgMatches) {
    for (const m of pkgMatches) {
      const clean = m.replace(/\\/g, "/").replace(/^\/+/, "");
      if (!clean.includes("..")) globs.add(`${clean}/**`);
    }
  } else if (sampleFiles.length > 0) {
    const roots = new Set<string>();
    for (const f of sampleFiles) {
      const parts = f.split("/");
      if (
        parts.length >= 2 &&
        (parts[0] === "packages" || parts[0] === "apps")
      ) {
        roots.add(`${parts[0]}/${parts[1]}`);
      }
    }
    for (const r of roots) {
      const name = r.split("/")[1];
      if (name && name.length >= 3 && textBlob.toLowerCase().includes(name)) {
        globs.add(`${r}/**`);
      }
    }
  }

  const forbidden = [...BASE_FORBIDDEN_GLOBS];
  if (strict && !/\b(ci|workflow|github\s+action)\b/i.test(textBlob)) {
    forbidden.push(".github/workflows/**");
  }

  const cmds: string[] = [];
  const seenCmds = new Set<string>();
  for (const raw of [...task.checks, ...repoCheckCommands]) {
    const trimmed = raw
      .trim()
      .replace(/^`+|`+$/g, "")
      .trim();
    if (
      trimmed &&
      trimmed.length <= 260 &&
      !/[;\n\r`]|\$\(|\brm\s+-rf\b/.test(trimmed) &&
      SAFE_COMMAND_RE.test(trimmed) &&
      !seenCmds.has(trimmed)
    ) {
      seenCmds.add(trimmed);
      cmds.push(trimmed);
    }
  }

  const allowDeps =
    !/no\s+new\s+dependenc|without\s+adding\s+dependenc/i.test(textBlob) &&
    /\b(install|add\s+package|dependenc|package\.json|scaffold)\b/i.test(
      textBlob,
    );

  const expectedBoundaries = flows
    .filter((fl) => {
      const tokens = `${fl.from} ${fl.to} ${fl.data}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4);
      return tokens.some((t) => textBlob.toLowerCase().includes(t));
    })
    .map((fl) => fl.boundary)
    .slice(0, 12);

  return {
    allowedGlobs: [...globs].slice(0, 24),
    forbiddenGlobs: forbidden,
    verificationCommands: cmds.slice(0, 12),
    allowDependencyChanges: allowDeps,
    expectedBoundaries,
    reviewerFamily,
  };
}

async function buildCockpitState(rootDir: string, now: string) {
  const directory = await realpath(rootDir);
  const [repo, outcomes, drift, bundle, rawOutcomesList] = await Promise.all([
    exportRepoContext(directory, { now }),
    aggregateOutcomes(directory, now),
    measureDrift(directory, now),
    loadSlicePlan(directory),
    readSliceOutcomes(directory),
  ]);

  if (!bundle) {
    return {
      asOf: now,
      projectDir: directory,
      repo,
      activePlan: null,
      slices: [],
      candidates: [],
      drift,
      outcomes,
    };
  }

  const planSha256 = sliceDigest(JSON.stringify(bundle));
  const outcomeBySlice = new Map(
    rawOutcomesList
      .filter(
        (r) => r.plan_sha256 === undefined || r.plan_sha256 === planSha256,
      )
      .map((r) => [r.slice_id, r]),
  );

  const acceptedSet = new Set(
    [...outcomeBySlice.values()]
      .filter((r) => r.status === "accepted")
      .map((r) => r.slice_id),
  );

  const slices = await Promise.all(
    bundle.plan.tasks.map(async (task) => {
      const latestVerification = await verifySlice({
        root: directory,
        bundle,
        sliceId: task.id,
        runChecks: false,
        clock: () => now,
      }).catch(() => null);
      const outcome = outcomeBySlice.get(task.id);
      const ready =
        !acceptedSet.has(task.id) &&
        task.dependsOn.every((dep) => acceptedSet.has(dep));
      return {
        id: task.id,
        title: task.title,
        outcome: task.outcome,
        model: task.model,
        why: task.why,
        alternatives: task.alternatives,
        dependsOn: task.dependsOn,
        contract: task.contract ?? null,
        ready,
        outcomeStatus: outcome?.status ?? "pending",
        latestVerification,
      };
    }),
  );

  return {
    asOf: now,
    projectDir: directory,
    repo,
    activePlan: bundle.plan,
    slices,
    candidates: bundle.candidates,
    drift,
    outcomes,
  };
}

function respondJson(
  payload: Record<string, unknown>,
  summaryText?: string,
  isError = false,
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: summaryText ?? JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

export function registerLocalStudioTools(
  server: McpServer,
  options: LocalStudioToolOptions,
): void {
  const ensureRoot = async (overrideProjectDir?: string) => {
    const candidate =
      overrideProjectDir?.trim() || options.getActiveRoot?.() || options.root;
    if (!(await lstat(candidate)).isDirectory()) {
      throw new Error("Project directory is unavailable");
    }
    const resolved = await realpath(candidate);
    if (overrideProjectDir?.trim()) {
      options.setActiveRoot?.(resolved);
    }
    return resolved;
  };

  server.registerResource(
    "anvilmark-cockpit",
    COCKPIT_APP_URI,
    {
      title: "AnvilMark Control Cockpit",
      description:
        "Interactive slice contracts, trust-boundary drift radar, and empirical model routing dashboard.",
      mimeType: COCKPIT_APP_MIME,
      _meta: {
        ui: { prefersBorder: false },
      },
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: COCKPIT_APP_MIME,
          text: COCKPIT_APP_HTML,
        },
      ],
    }),
  );

  server.registerTool(
    "prepare_planning_context",
    {
      title: "Prepare AnvilMark planning context",
      description:
        "Read-only. Scans structural repository metadata (languages, frameworks, scripts, check commands, ADRs, tracked file paths—never secrets or file contents), loads empirical model win-rates on this repo, and returns ranked candidate coding models so you can clarify unknowns and propose an AnvilMark execution plan locally without a browser.",
      inputSchema: z.strictObject({
        project_dir: z
          .string()
          .trim()
          .min(1)
          .max(1000)
          .optional()
          .describe("Absolute path to the target Git workspace directory"),
        goal: z.string().trim().max(4000).optional(),
        subscriptions: z.array(SubscriptionEnum).max(5).optional(),
        quota_mode: QuotaModeEnum.optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const directory = await ensureRoot(args.project_dir);
        const now = options.clock();
        const [repoContext, outcomes, existingPlan] = await Promise.all([
          exportRepoContext(directory, {
            ...(args.goal ? { goal: args.goal } : {}),
            now,
          }),
          aggregateOutcomes(directory, now),
          loadSlicePlan(directory),
        ]);
        const quotaMode = args.quota_mode ?? "plenty";
        const rankedCandidates = selectRankedCandidates(
          args.subscriptions ?? [],
          quotaMode,
          outcomes,
        );

        return respondJson({
          ok: true,
          as_of: now,
          repo_context: repoContext,
          observed_outcomes: outcomes,
          ranked_candidates: rankedCandidates,
          has_existing_active_plan: Boolean(existingPlan),
          existing_plan_title: existingPlan?.plan.title ?? null,
          agent_workflow_instructions: [
            "1. Clarify domain forks before guessing: if product workflows, persistence/sync boundaries, auth/tenancy, or failure invariants are underspecified, ask 2–4 domain-specific clarifying questions (putting the recommended v1 default option first) BEFORE calling lock_execution_plan.",
            "2. Right-size vertical slices (never default to a generic 3-slice Backend -> Frontend -> Tests template): set `projectScale` honestly and decompose by shippable vertical capability (1–2 slices for micro changes, 2–4 for small single-entity apps, 5–8 for multi-feature apps, and 7–12 for complex systems) with parallelizable DAG `dependsOn` waves.",
            "3. Provide TWO quality-calibrated model options per slice (`model` as Option 1 + `alternatives[0]` as Option 2 from `ranked_candidates`): tag `kind` and `complexity`, use `frontier` mindfully wherever high complexity/security/concurrency warrants it (no artificial cap across slices, and never waste heavy specialists like `gpt-6-astra` on simple CRUD/todo apps), keep work quality high with `balanced` workhorses (`claude-sonnet-5-5`, `gpt-6.1-sol`, `qwen3-coder-30b-a3b`) on real UI/feature slices, and use `fast` models only on narrow schemas/wiring/unit tests.",
            "4. Call `lock_execution_plan` to validate the DAG, calibrate 2-option model picks, compile deterministic `SliceContractSpec` globs & cross-vendor reviewers, and write `.anvilmark/development/active-plan.json`, `PLAN.md`, `CLAUDE.md`, `AGENTS.md`, and `.cursor/rules/anvilmark-plan.mdc`.",
          ],
        });
      } catch (error) {
        options.diagnostics?.(
          `prepare_planning_context: ${error instanceof Error ? error.message : String(error)}`,
        );
        return respondJson(
          {
            ok: false,
            error: "Could not inspect local repository planning context.",
          },
          undefined,
          true,
        );
      }
    },
  );

  server.registerTool(
    "lock_execution_plan",
    {
      title: "Lock AnvilMark execution plan",
      description:
        "Validates a structured implementation plan, deterministically compiles per-slice scope globs, check commands, and cross-vendor reviewer assignments (`SliceContractSpec`), writes `.anvilmark/development/active-plan.json` plus marked instruction blocks (`PLAN.md`, `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/anvilmark-plan.mdc`), and opens the interactive AnvilMark Cockpit.",
      inputSchema: z.strictObject({
        project_dir: z
          .string()
          .trim()
          .min(1)
          .max(1000)
          .optional()
          .describe("Absolute path to the target Git workspace directory"),
        plan: HandoffPlan,
        strict: z.boolean().optional(),
        quota_mode: QuotaModeEnum.optional(),
        subscriptions: z.array(SubscriptionEnum).max(5).optional(),
        targets: z.array(TargetEnum).max(3).optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: COCKPIT_APP_URI },
      },
    },
    async (args) => {
      try {
        const directory = await ensureRoot(args.project_dir);
        const now = options.clock();
        const strict = args.strict ?? false;
        const quotaMode = args.quota_mode ?? "plenty";

        // Validate topological order & dependencies upfront
        const waves = sliceWaves(args.plan.tasks);

        const [repoContext, outcomes] = await Promise.all([
          exportRepoContext(directory, { goal: args.plan.goal, now }),
          aggregateOutcomes(directory, now),
        ]);

        const ranked = selectRankedCandidates(
          args.subscriptions ?? [],
          quotaMode,
          outcomes,
        );
        const calibratedTasks = calibrateMcpPlanTasks(args.plan, ranked);
        const candidateMap = new Map(ranked.map((c) => [c.model, c]));
        for (const task of calibratedTasks) {
          if (!candidateMap.has(task.model)) {
            candidateMap.set(task.model, {
              model: task.model,
              label: task.model,
              provider: inferFamily(task.model) ?? "custom",
              tier: "balanced",
              billing: "subscription",
              empiricalScore: 0.7,
              observedRuns: 0,
              observedFirstPassRate: null,
              strengths: "Selected by host planning agent.",
            });
          }
          for (const alt of task.alternatives) {
            if (!candidateMap.has(alt.model)) {
              candidateMap.set(alt.model, {
                model: alt.model,
                label: alt.model,
                provider: inferFamily(alt.model) ?? "custom",
                tier: "balanced",
                billing: "subscription",
                empiricalScore: 0.68,
                observedRuns: 0,
                observedFirstPassRate: null,
                strengths: alt.tradeoff,
              });
            }
          }
        }

        const bundleCandidates: PlanHandoffBundle["candidates"] = [
          ...candidateMap.values(),
        ]
          .slice(0, 32)
          .map(({ model, label, provider, tier, billing }) => ({
            model,
            label,
            provider,
            tier,
            billing,
          }));

        const contractedPlan = {
          ...args.plan,
          tasks: calibratedTasks.map((task) => ({
            ...task,
            contract: compileDefaultContract(
              task,
              args.plan.flows,
              bundleCandidates,
              repoContext.checkCommands,
              repoContext.sampleFiles,
              strict,
            ),
          })),
        };

        const baseBundle: PlanHandoffBundle = {
          version: PLAN_HANDOFF_VERSION,
          createdAt: now,
          plan: contractedPlan,
          candidates: bundleCandidates,
          strict,
          quotaMode,
          masterPrompt: `# Implementation Plan: ${contractedPlan.title}\n\nGoal: ${contractedPlan.goal}\nTarget users: ${contractedPlan.users}`,
        };

        const sectionMd = renderInstructionSection(baseBundle);
        const fullBundle = parseBundle({
          ...baseBundle,
          masterPrompt: sectionMd,
          claudeMdSection: sectionMd,
          codexAgentsSection: sectionMd,
          cursorRuleMdc: renderCursorRule(baseBundle),
        });

        const targets: readonly PlanTarget[] | undefined = args.targets;
        const written = await applyPlan(directory, fullBundle, targets);
        const cockpitState = await buildCockpitState(directory, now);

        const summary = `Locked AnvilMark plan "${fullBundle.plan.title}" (${fullBundle.plan.tasks.length} slices across ${waves.length} wave(s)). Updated: ${written.map((w) => `${w.path} (${w.action})`).join(", ")}.`;
        return respondJson(
          {
            ...cockpitState,
            locked: true,
            waveCount: waves.length,
            writtenFiles: written,
          },
          summary,
        );
      } catch (error) {
        options.diagnostics?.(
          `lock_execution_plan: ${error instanceof Error ? error.message : String(error)}`,
        );
        return respondJson(
          {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Could not lock execution plan.",
          },
          undefined,
          true,
        );
      }
    },
  );

  server.registerTool(
    "open_anvilmark_cockpit",
    {
      title: "AnvilMark Cockpit",
      description:
        "Read-only. Opens the interactive AnvilMark Control Cockpit showing active slice contracts, conformance status, trust-boundary drift radar, and repository model win-rates.",
      inputSchema: z.strictObject({
        project_dir: z
          .string()
          .trim()
          .min(1)
          .max(1000)
          .optional()
          .describe("Absolute path to the target Git workspace directory"),
        slice_id: z.string().trim().max(80).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: COCKPIT_APP_URI },
        "com.google.antigravity/ui": {
          entrypoints: [
            { type: "aux_pane", title: "AnvilMark Cockpit" },
            { type: "global", title: "AnvilMark Cockpit" },
          ],
        },
      },
    },
    async (args) => {
      try {
        const directory = await ensureRoot(args.project_dir);
        const now = options.clock();
        const state = await buildCockpitState(directory, now);
        const summary = state.activePlan
          ? `AnvilMark Cockpit: "${state.activePlan.title}" — ${state.slices.length} slices, drift=${state.drift.status}.`
          : `AnvilMark Cockpit: Repository "${state.repo.repoName}" ready (no active plan locked yet).`;
        return respondJson(state, summary);
      } catch (error) {
        options.diagnostics?.(
          `open_anvilmark_cockpit: ${error instanceof Error ? error.message : String(error)}`,
        );
        return respondJson(
          {
            ok: false,
            error: "Could not load AnvilMark Cockpit state.",
          },
          undefined,
          true,
        );
      }
    },
  );
}
