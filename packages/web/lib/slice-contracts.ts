import { z } from "zod";

import type { RoutableCandidate } from "./routing-types";

export const reviewerFamilies = [
  "anthropic",
  "openai",
  "google",
  "local_oss",
] as const;

export type ReviewerFamily = (typeof reviewerFamilies)[number];

const safeGlob = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine(
    (glob) =>
      !glob.startsWith("/") &&
      !glob.includes("\\") &&
      !glob.split("/").includes(".."),
    "Globs must be normalized repo-relative POSIX patterns without '..'.",
  );

export const SliceContractSchema = z.strictObject({
  allowedGlobs: z.array(safeGlob).max(40),
  forbiddenGlobs: z.array(safeGlob).max(40),
  verificationCommands: z.array(z.string().trim().min(1).max(300)).max(20),
  allowDependencyChanges: z.boolean(),
  expectedBoundaries: z.array(z.string().trim().min(1).max(240)).max(20),
  reviewerFamily: z.enum(reviewerFamilies).optional(),
});

export type SliceContractSpec = z.infer<typeof SliceContractSchema>;

export const SliceVerificationReportSchema = z.strictObject({
  schemaVersion: z.literal("anvilmark.slice-verification.v1"),
  verifiedAt: z.string().trim().min(1).max(64),
  sliceId: z.string().trim().min(1).max(80),
  passed: z.boolean(),
  changedFiles: z.array(z.string().trim().max(400)).max(2000),
  violations: z
    .array(
      z.strictObject({
        kind: z.enum([
          "out_of_scope_file",
          "forbidden_file",
          "unapproved_dependency_change",
          "boundary_violation",
          "check_command_failed",
        ]),
        path: z.string().trim().max(400).optional(),
        command: z.string().trim().max(400).optional(),
        detail: z.string().max(4000),
      }),
    )
    .max(200),
  checkResults: z
    .array(
      z.strictObject({
        command: z.string().trim().min(1).max(400),
        exitCode: z.number().int(),
        durationMs: z.number().nonnegative(),
        outputExcerpt: z.string().max(8000),
      }),
    )
    .max(50),
});

export type SliceVerificationReport = z.infer<
  typeof SliceVerificationReportSchema
>;

const BASE_FORBIDDEN_GLOBS = [
  ".env",
  ".env.*",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa*",
  "**/id_ed25519*",
] as const;

const EXECUTABLE_COMMAND_PREFIX =
  /^(pnpm|npm|yarn|bun|npx|node|vitest|jest|playwright|pytest|python3?|uv|cargo|go|make|tsc|eslint|prettier|ruff|mypy|anvilmark|deno|gradle|mvn|dotnet)\b/;

export function inferModelFamily(
  modelId: string,
  provider?: string,
  billing?: RoutableCandidate["billing"],
): ReviewerFamily | null {
  if (billing === "local") return "local_oss";
  const combined = `${modelId} ${provider ?? ""}`.toLowerCase();
  if (/am-server|ollama|vllm|llama\.cpp|local/.test(combined)) {
    return "local_oss";
  }
  if (/claude|anthropic|opus|sonnet|haiku/.test(combined)) {
    return "anthropic";
  }
  if (/gpt-|openai|codex|astra|\bsol\b|luna|\bo[134]\b/.test(combined)) {
    return "openai";
  }
  if (/gemini|google|argon/.test(combined)) {
    return "google";
  }
  if (/qwen|gemma|llama|mistral|deepseek/.test(combined)) {
    return "local_oss";
  }
  return null;
}

export function formatReviewerFamilyLabel(family: ReviewerFamily): string {
  switch (family) {
    case "anthropic":
      return "Anthropic (Claude)";
    case "openai":
      return "OpenAI (Codex / GPT)";
    case "google":
      return "Google (Gemini)";
    case "local_oss":
      return "Local OSS (am-server)";
  }
}

export function pickCrossVendorReviewer(
  authorModelId: string,
  candidates: readonly RoutableCandidate[],
): ReviewerFamily | undefined {
  const authorCandidate = candidates.find((c) => c.model === authorModelId);
  const authorFamily = inferModelFamily(
    authorModelId,
    authorCandidate?.provider,
    authorCandidate?.billing,
  );

  const tierRank: Record<RoutableCandidate["tier"], number> = {
    frontier: 0,
    balanced: 1,
    fast: 2,
  };

  const orderedCandidates = [...candidates].sort(
    (a, b) => tierRank[a.tier] - tierRank[b.tier],
  );

  for (const candidate of orderedCandidates) {
    const family = inferModelFamily(
      candidate.model,
      candidate.provider,
      candidate.billing,
    );
    if (family && family !== authorFamily) {
      return family;
    }
  }

  if (authorFamily === "anthropic") return "openai";
  if (authorFamily === "openai") return "anthropic";
  if (authorFamily === "google") return "anthropic";
  if (authorFamily === "local_oss") return "anthropic";
  return undefined;
}

function normalizeCandidateGlob(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^['"`]+|['"`.,;:!?)]+$/g, "")
    .replace(/^\.\//, "")
    .replace(/\\/g, "/");
  if (
    !cleaned ||
    cleaned.startsWith("/") ||
    cleaned.includes("..") ||
    cleaned.startsWith("http:") ||
    cleaned.startsWith("https:")
  ) {
    return null;
  }
  return cleaned.slice(0, 240);
}

function inferAllowedGlobs(
  task: {
    title: string;
    outcome: string;
    acceptance: readonly string[];
  },
  sampleFiles: readonly string[],
): string[] {
  const textBlob = `${task.title}\n${task.outcome}\n${task.acceptance.join("\n")}`;
  const lowerBlob = textBlob.toLowerCase();
  const globs = new Set<string>();

  // 1. Explicit workspace package references (e.g. packages/web, apps/api)
  const explicitDirMatches = textBlob.match(
    /\b(?:packages|apps|services|libs)\/[a-z0-9._-]+/gi,
  );
  if (explicitDirMatches) {
    for (const match of explicitDirMatches) {
      const clean = normalizeCandidateGlob(match);
      if (clean) globs.add(`${clean}/**`);
    }
  }

  // 2. Match workspace roots from sampleFiles when package name appears in slice text
  if (sampleFiles.length > 0 && globs.size === 0) {
    const workspaceRoots = new Set<string>();
    for (const path of sampleFiles) {
      const normalized = normalizeCandidateGlob(path);
      if (!normalized) continue;
      const parts = normalized.split("/");
      if (
        parts.length >= 2 &&
        (parts[0] === "packages" ||
          parts[0] === "apps" ||
          parts[0] === "services")
      ) {
        workspaceRoots.add(`${parts[0]}/${parts[1]}`);
      }
    }
    for (const root of workspaceRoots) {
      const pkgName = root.split("/")[1]?.toLowerCase();
      if (
        pkgName &&
        pkgName.length >= 3 &&
        new RegExp(
          `\\b${pkgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "i",
        ).test(lowerBlob)
      ) {
        globs.add(`${root}/**`);
      }
    }
  }

  // 3. Explicit repo-relative file or folder paths mentioned in the slice
  const pathTokens = textBlob.match(
    /\b(?:src|app|lib|db|prisma|drizzle|migrations|components|routes|api|test|tests)\/[A-Za-z0-9._/*-]+/g,
  );
  if (pathTokens && globs.size === 0) {
    for (const rawToken of pathTokens) {
      const clean = normalizeCandidateGlob(rawToken);
      if (!clean) continue;
      const topSegment = clean.split("/")[0];
      if (topSegment) {
        globs.add(`${topSegment}/**`);
      }
    }
    if (globs.size > 0) {
      globs.add("test/**");
      globs.add("tests/**");
      globs.add("**/*.test.*");
      globs.add("**/*.spec.*");
    }
  }

  return [...globs].slice(0, 24);
}

function extractExecutableCheckCommands(
  taskChecks: readonly string[],
  repoCheckCommands: readonly string[],
): string[] {
  const commands: string[] = [];
  const seen = new Set<string>();

  const addIfSafe = (raw: string) => {
    const trimmed = raw
      .trim()
      .replace(/^`+|`+$/g, "")
      .replace(/^Run\s+`?([^`]+)`?\.?$/i, "$1")
      .trim();
    if (!trimmed || trimmed.length > 260) return;
    if (/[;\n\r`]|\$\(|\|\s*sh\b|\brm\s+-rf\b/.test(trimmed)) return;
    if (!EXECUTABLE_COMMAND_PREFIX.test(trimmed)) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    commands.push(trimmed);
  };

  for (const check of taskChecks) {
    addIfSafe(check);
  }
  for (const repoCmd of repoCheckCommands) {
    addIfSafe(repoCmd);
  }

  return commands.slice(0, 12);
}

function inferAllowDependencyChanges(task: {
  title: string;
  outcome: string;
  acceptance: readonly string[];
}): boolean {
  const combined = `${task.title} ${task.outcome} ${task.acceptance.join(" ")}`;
  if (/no\s+new\s+dependenc|without\s+adding\s+dependenc/i.test(combined)) {
    return false;
  }
  return /\b(install|add\s+package|upgrade\s+package|dependenc|package\.json|pyproject\.toml|cargo\.toml|scaffold|bootstrap)\b/i.test(
    combined,
  );
}

function inferExpectedBoundaries(
  task: { title: string; outcome: string; acceptance: readonly string[] },
  flows: readonly {
    from: string;
    to: string;
    data: string;
    boundary: string;
  }[],
): string[] {
  if (flows.length === 0) return [];
  const haystack =
    `${task.title} ${task.outcome} ${task.acceptance.join(" ")}`.toLowerCase();
  const matched = new Set<string>();

  for (const flow of flows) {
    const tokens = `${flow.from} ${flow.to} ${flow.data}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((tok) => tok.length >= 4);
    if (tokens.some((tok) => haystack.includes(tok))) {
      matched.add(flow.boundary);
    }
  }

  if (
    matched.size === 0 &&
    flows.length <= 3 &&
    /\b(auth|api|route|endpoint|database|session|webhook|import|upload)\b/i.test(
      haystack,
    )
  ) {
    for (const flow of flows) {
      matched.add(flow.boundary);
    }
  }

  return [...matched].slice(0, 12);
}

export function compileSliceContractForTask(params: {
  task: {
    id: string;
    title: string;
    outcome: string;
    acceptance: readonly string[];
    checks: readonly string[];
    model: string;
    contract?: SliceContractSpec | undefined;
  };
  flows: readonly {
    from: string;
    to: string;
    data: string;
    boundary: string;
  }[];
  candidates: readonly RoutableCandidate[];
  repoCheckCommands?: readonly string[] | undefined;
  sampleFiles?: readonly string[] | undefined;
  strict: boolean;
}): SliceContractSpec {
  const {
    task,
    flows,
    candidates,
    repoCheckCommands = [],
    sampleFiles = [],
    strict,
  } = params;

  const reviewerFamily = pickCrossVendorReviewer(task.model, candidates);

  if (task.contract) {
    const parsedExisting = SliceContractSchema.safeParse({
      ...task.contract,
      ...(reviewerFamily !== undefined ? { reviewerFamily } : {}),
    });
    if (parsedExisting.success) {
      return parsedExisting.data;
    }
  }

  const forbidden = new Set<string>(BASE_FORBIDDEN_GLOBS);
  const touchesCi = /\b(ci|workflow|github\s+action|pipeline)\b/i.test(
    `${task.title} ${task.outcome}`,
  );
  if (strict && !touchesCi) {
    forbidden.add(".github/workflows/**");
  }

  return {
    allowedGlobs: inferAllowedGlobs(task, sampleFiles),
    forbiddenGlobs: [...forbidden],
    verificationCommands: extractExecutableCheckCommands(
      task.checks,
      repoCheckCommands,
    ),
    allowDependencyChanges: inferAllowDependencyChanges(task),
    expectedBoundaries: inferExpectedBoundaries(task, flows),
    ...(reviewerFamily !== undefined ? { reviewerFamily } : {}),
  };
}
