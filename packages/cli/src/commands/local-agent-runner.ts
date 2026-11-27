import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";
import { z } from "zod";

import type { PlanHandoffBundle, SliceContractSpec } from "./apply-plan.js";
import { isSensitivePath } from "./export-context.js";
import { repoPath } from "./slice-storage.js";
import {
  runSliceGit,
  verifySlice,
  type SliceVerificationReport,
} from "./verify-slice.js";

const MAX_CONTEXT_FILES = 10;
const MAX_SINGLE_FILE_BYTES = 16_000;
const MAX_TOTAL_CONTEXT_BYTES = 48_000;

export const ProposedSlicePatchSchema = z.strictObject({
  summary: z.string().trim().min(1).max(2000),
  edits: z
    .array(
      z.strictObject({
        path: z.string().trim().min(1).max(240),
        content: z.string().max(120_000),
      }),
    )
    .max(12),
});

export type ProposedSlicePatch = z.infer<typeof ProposedSlicePatchSchema>;

export interface AmServerSliceRunResult {
  passed: boolean;
  attempts: number;
  summary: string;
  writtenFiles: string[];
  rejectedPaths: string[];
  inputTokens: number;
  outputTokens: number;
  verification: SliceVerificationReport;
}

function matchesGlob(filePath: string, pattern: string): boolean {
  return posix.matchesGlob(filePath, pattern);
}

export function validatePathAgainstContract(
  rawPath: string,
  contract?: SliceContractSpec,
): { ok: true; normalizedPath: string } | { ok: false; reason: string } {
  let clean: string;
  try {
    clean = repoPath(rawPath.trim().replace(/^\.\//, "")).join("/");
  } catch {
    return {
      ok: false,
      reason: `Unsafe repository path "${rawPath}"`,
    };
  }

  if (
    clean.startsWith(".git/") ||
    clean.startsWith(".anvilmark/") ||
    isSensitivePath(clean)
  ) {
    return {
      ok: false,
      reason: `Protected or sensitive path "${clean}" cannot be modified`,
    };
  }

  if (contract) {
    if (contract.forbiddenGlobs.some((glob) => matchesGlob(clean, glob))) {
      return {
        ok: false,
        reason: `Path "${clean}" matches forbiddenGlobs`,
      };
    }
    if (
      contract.allowedGlobs.length > 0 &&
      !contract.allowedGlobs.some((glob) => matchesGlob(clean, glob))
    ) {
      return {
        ok: false,
        reason: `Path "${clean}" is outside allowedGlobs (${contract.allowedGlobs.join(", ")})`,
      };
    }
    if (
      !contract.allowDependencyChanges &&
      basename(clean) === "package.json"
    ) {
      return {
        ok: false,
        reason: `Modifying "${clean}" is blocked when allowDependencyChanges=false`,
      };
    }
  }

  return { ok: true, normalizedPath: clean };
}

async function assertNoSymlinkOnWrite(root: string, relPath: string) {
  let cursor = root;
  for (const segment of relPath.split("/").filter(Boolean)) {
    cursor = join(cursor, segment);
    const st = await lstat(cursor).catch(() => null);
    if (st?.isSymbolicLink()) {
      throw new Error(`Refusing to write through symbolic link: ${relPath}`);
    }
  }
}

async function atomicWriteRepoText(
  root: string,
  relPath: string,
  content: string,
) {
  await assertNoSymlinkOnWrite(root, relPath);
  const fullPath = join(root, relPath);
  await mkdir(dirname(fullPath), { recursive: true });
  const tmp = `${fullPath}.anvilmark-${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, fullPath);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function collectScopedContextFiles(
  root: string,
  contract: SliceContractSpec | undefined,
  sliceBrief: string,
): Promise<Array<{ path: string; content: string }>> {
  const rawTracked = await runSliceGit(root, ["ls-files", "-z"]).catch(
    () => "",
  );
  const tracked = rawTracked.split("\0").filter(Boolean);

  const briefLower = sliceBrief.toLowerCase();
  const candidates = tracked.filter((p) => {
    if (isSensitivePath(p) || p.startsWith(".anvilmark/")) return false;
    if (contract?.forbiddenGlobs.some((g) => matchesGlob(p, g))) return false;
    if (contract && contract.allowedGlobs.length > 0) {
      return contract.allowedGlobs.some((g) => matchesGlob(p, g));
    }
    const base = basename(p).toLowerCase();
    return briefLower.includes(p.toLowerCase()) || briefLower.includes(base);
  });

  // Prioritize files explicitly mentioned in the slice brief
  candidates.sort((a, b) => {
    const aExplicit = briefLower.includes(a.toLowerCase()) ? 0 : 1;
    const bExplicit = briefLower.includes(b.toLowerCase()) ? 0 : 1;
    return aExplicit - bExplicit || a.localeCompare(b);
  });

  const collected: Array<{ path: string; content: string }> = [];
  let totalBytes = 0;

  for (const relPath of candidates) {
    if (collected.length >= MAX_CONTEXT_FILES) break;
    const full = join(root, relPath);
    const st = await lstat(full).catch(() => null);
    if (
      !st ||
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.size > MAX_SINGLE_FILE_BYTES
    ) {
      continue;
    }
    if (totalBytes + st.size > MAX_TOTAL_CONTEXT_BYTES) continue;
    const text = await readFile(full, "utf8").catch(() => null);
    if (text === null || text.includes("\0")) continue;
    totalBytes += Buffer.byteLength(text, "utf8");
    collected.push({ path: relPath, content: text });
  }

  return collected;
}

function extractJsonObject(raw: string): string {
  const stripped = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .replace(/^`{3}(?:json)?\s*|\s*`{3}$/gi, "")
    .trim();
  if (stripped.startsWith("{")) return stripped;
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first >= 0 && last > first) return stripped.slice(first, last + 1);
  return stripped;
}

async function requestAmServerPatch(params: {
  endpoint: string;
  model: string;
  userPrompt: string;
}): Promise<
  | {
      ok: true;
      patch: ProposedSlicePatch;
      inputTokens: number;
      outputTokens: number;
    }
  | { ok: false; error: string }
> {
  const jsonSchema = z.toJSONSchema(ProposedSlicePatchSchema) as Record<
    string,
    unknown
  >;
  const systemPrompt = `You are AnvilMark's contract-jailed autonomous coding runner. Return ONE JSON object matching the JSON Schema with "summary" and "edits" (full file contents for each modified or created repo-relative POSIX file path).
Rules:
1. Modify ONLY files required by this slice and strictly inside the slice's allowedGlobs.
2. Never modify .env*, credentials, keys, or package.json dependencies when disallowed.
3. Preserve existing imports, types, and formatting conventions in each file.`;

  const makeBody = (useStrictSchema: boolean) => ({
    model: params.model,
    messages: [
      {
        role: "system",
        content: `${systemPrompt}\nJSON Schema: ${JSON.stringify(jsonSchema)}`,
      },
      { role: "user", content: params.userPrompt },
    ],
    max_tokens: 4096,
    ...(useStrictSchema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "anvilmark_slice_edits",
              strict: true,
              schema: jsonSchema,
            },
          },
          chat_template_kwargs: { enable_thinking: false },
        }
      : {}),
  });

  try {
    let resp = await fetch(params.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBody(true)),
      signal: AbortSignal.timeout(180_000),
    });

    if (resp.status === 400 || resp.status === 422) {
      resp = await fetch(params.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeBody(false)),
        signal: AbortSignal.timeout(180_000),
      });
    }

    if (!resp.ok) {
      return {
        ok: false,
        error: `am-server returned HTTP ${resp.status} at ${params.endpoint}`,
      };
    }

    const payload = (await resp.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const rawContent = payload.choices?.[0]?.message?.content;
    if (typeof rawContent !== "string" || !rawContent.trim()) {
      return {
        ok: false,
        error: "am-server returned an empty completion.",
      };
    }

    const parsed = ProposedSlicePatchSchema.safeParse(
      JSON.parse(extractJsonObject(rawContent)),
    );
    if (!parsed.success) {
      return {
        ok: false,
        error: "am-server response did not match ProposedSlicePatchSchema.",
      };
    }

    const inputTokens =
      typeof payload.usage?.prompt_tokens === "number"
        ? payload.usage.prompt_tokens
        : 0;
    const outputTokens =
      typeof payload.usage?.completion_tokens === "number"
        ? payload.usage.completion_tokens
        : 0;

    return {
      ok: true,
      patch: parsed.data,
      inputTokens,
      outputTokens,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Could not complete am-server coding request: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function runAmServerSliceAgent(options: {
  root: string;
  bundle: PlanHandoffBundle;
  sliceId: string;
  sliceBrief: string;
  endpoint: string;
  model: string;
  runChecks?: boolean;
  approvedCommands?: ReadonlySet<string>;
  maxAttempts?: number;
  clock?: () => string;
}): Promise<AmServerSliceRunResult> {
  const {
    root,
    bundle,
    sliceId,
    sliceBrief,
    endpoint,
    model,
    runChecks = false,
    approvedCommands,
    maxAttempts = 2,
    clock = () => new Date().toISOString(),
  } = options;

  const task = bundle.plan.tasks.find((t) => t.id === sliceId);
  if (!task) throw new Error(`Slice "${sliceId}" not found in active plan`);

  const maxTries = Math.max(1, Math.min(4, maxAttempts));
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastSummary = "";
  const writtenSet = new Set<string>();
  const rejectedSet = new Set<string>();
  let failureFeedback = "";

  let latestVerification = await verifySlice({
    root,
    bundle,
    sliceId,
    runChecks: false,
    clock,
  });

  for (let attempt = 1; attempt <= maxTries; attempt += 1) {
    const contextFiles = await collectScopedContextFiles(
      root,
      task.contract,
      sliceBrief,
    );

    const promptSections = [
      sliceBrief,
      contextFiles.length > 0
        ? `## Scoped Repository Files (${contextFiles.length})\n${contextFiles
            .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
            .join("\n\n")}`
        : "## Scoped Repository Files\n(No matching pre-existing files in scope; create only the files required within allowedGlobs.)",
      failureFeedback
        ? `## Previous Attempt Failure — Fix These Violations\n${failureFeedback}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await requestAmServerPatch({
      endpoint,
      model,
      userPrompt: promptSections,
    });

    if (!response.ok) {
      lastSummary = response.error;
      latestVerification = await verifySlice({
        root,
        bundle,
        sliceId,
        runChecks: false,
        clock,
      });
      return {
        passed: false,
        attempts: attempt,
        summary: lastSummary,
        writtenFiles: [...writtenSet],
        rejectedPaths: [...rejectedSet],
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        verification: latestVerification,
      };
    }

    totalInputTokens += response.inputTokens;
    totalOutputTokens += response.outputTokens;
    lastSummary = response.patch.summary;

    const preWriteErrors: string[] = [];
    for (const edit of response.patch.edits) {
      const check = validatePathAgainstContract(edit.path, task.contract);
      if (!check.ok) {
        rejectedSet.add(edit.path);
        preWriteErrors.push(check.reason);
        continue;
      }
      await atomicWriteRepoText(root, check.normalizedPath, edit.content);
      writtenSet.add(check.normalizedPath);
    }

    latestVerification = await verifySlice({
      root,
      bundle,
      sliceId,
      runChecks,
      ...(approvedCommands ? { approvedCommands } : {}),
      clock,
    });

    if (preWriteErrors.length === 0 && latestVerification.passed) {
      return {
        passed: true,
        attempts: attempt,
        summary: lastSummary,
        writtenFiles: [...writtenSet],
        rejectedPaths: [...rejectedSet],
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        verification: latestVerification,
      };
    }

    const violationLines = [
      ...preWriteErrors.map((e) => `- [contract_jail_blocked] ${e}`),
      ...latestVerification.violations.map(
        (v) =>
          `- [${v.kind}] ${v.path ? `${v.path}: ` : ""}${v.command ? `(${v.command}) ` : ""}${v.detail}`,
      ),
    ];
    failureFeedback = violationLines.join("\n");
  }

  return {
    passed: false,
    attempts: maxTries,
    summary: lastSummary,
    writtenFiles: [...writtenSet],
    rejectedPaths: [...rejectedSet],
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    verification: latestVerification,
  };
}
