import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

import {
  addConstraint,
  addIntentEntry,
  addWorkload,
  commitRevision,
  loadProject,
  newProjectContract,
  pathsFor,
  slugId,
} from "@anvilmark/cli";
import { decisionStanding, sourceMarker } from "@anvilmark/context";
import type { ProjectionName } from "@anvilmark/context";
import {
  ConstraintSchema,
  findSecrets,
  validateProjectContract,
  WorkloadSchema,
} from "@anvilmark/project-contract";
import type { Constraint, ProjectContract } from "@anvilmark/project-contract";
import { z } from "zod/v4";

const citation = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("prompt"),
    quote: z.string().min(1).max(2000),
  }),
  z.strictObject({
    kind: z.literal("file"),
    path: z.string().min(1).max(500),
    quote: z.string().min(1).max(2000),
  }),
]);

const proposedClaim = z.strictObject({
  id: z.string().min(1).max(200),
  domain: z.string().min(1),
  severity: z.enum(["hard", "soft", "informational"]),
  direction: z.enum(["minimize", "maximize", "target"]).optional(),
  subject: z.string().min(1),
  operator: z.string().min(1),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number()])),
  ]),
  rationale: z.string().max(1000).optional(),
  citation,
});

export const DecisionBriefInputSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(10000),
  project_name: z.string().trim().min(1).max(200).optional(),
  workload: z.strictObject({
    id: z.string().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    input_classification: z.string().min(1).max(100),
  }),
  claims: z.array(proposedClaim).max(30),
  questions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
});

export type DecisionBriefInput = z.input<typeof DecisionBriefInputSchema>;
type ParsedInput = z.output<typeof DecisionBriefInputSchema>;

interface VerifiedSource {
  readonly id: string;
  readonly kind: "prompt" | "file";
  readonly path: string | null;
  readonly content_hash: string;
  readonly quote_hash: string;
}

function hash(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function contained(root: string, target: string): boolean {
  const path = relative(root, target);
  return (
    path !== "" &&
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
}

async function verifySource(
  root: string,
  prompt: string,
  item: z.output<typeof citation>,
): Promise<VerifiedSource> {
  if (item.kind === "prompt") {
    if (!prompt.includes(item.quote))
      throw new Error(
        "A prompt citation is not an exact excerpt of the prompt.",
      );
    return {
      id: "prompt",
      kind: "prompt",
      path: null,
      content_hash: hash(prompt),
      quote_hash: hash(item.quote),
    };
  }
  if (isAbsolute(item.path) || item.path.split(/[\\/]/).includes(".."))
    throw new Error("A document citation must use a path inside the project.");
  if (!/\.(md|mdx|txt)$/i.test(item.path))
    throw new Error("Decision sources must be Markdown or text documents.");
  const selected = resolve(root, item.path);
  const actual = await realpath(selected);
  if (!contained(root, actual))
    throw new Error("A document citation resolves outside the project.");
  const rel = relative(root, actual).split(sep).join("/");
  if (
    rel
      .split("/")
      .some((part) => [".git", ".anvilmark", "node_modules"].includes(part))
  )
    throw new Error("A document citation names a protected project directory.");
  const info = await stat(actual);
  if (!info.isFile() || info.size > 128 * 1024)
    throw new Error(
      "A decision source must be a text file no larger than 128 KiB.",
    );
  const text = await readFile(actual, "utf8");
  if (!text.includes(item.quote))
    throw new Error("A document citation is not an exact excerpt of its file.");
  return {
    id: `doc-${hash(rel).slice(7, 19)}`,
    kind: "file",
    path: rel,
    content_hash: hash(text),
    quote_hash: hash(item.quote),
  };
}

function sameRule(left: Constraint, right: Constraint): boolean {
  return (
    left.subject === right.subject &&
    left.severity === right.severity &&
    left.operator === right.operator &&
    JSON.stringify(left.value) === JSON.stringify(right.value) &&
    (left.severity === "soft" ? left.direction : null) ===
      (right.severity === "soft" ? right.direction : null)
  );
}

export async function draftDecisionBrief(
  rootPath: string,
  raw: unknown,
  options: { clock: () => string; projection: ProjectionName },
) {
  const input: ParsedInput = DecisionBriefInputSchema.parse(raw);
  if (findSecrets(input).length > 0)
    throw new Error(
      "The submitted brief contains a secret-shaped value; nothing was saved.",
    );
  const root = await realpath(rootPath);
  if (!(await stat(root)).isDirectory())
    throw new Error("The selected project root is not a directory.");
  const now = options.clock();
  const paths = pathsFor(root);
  const existing = await stat(paths.projectFile).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  const loaded = existing ? await loadProject(root) : null;
  const name = input.project_name ?? basename(root);
  const id = slugId(name);
  if (id === null) throw new Error("A valid project name is required.");
  let contract: ProjectContract =
    loaded?.contract ??
    newProjectContract({
      id,
      name,
      idea: input.prompt,
      repositoryRoots: ["."],
      intelligence: "handoff",
      remoteIntelligence: "nothing",
      now,
    });

  const sourceByClaim = await Promise.all(
    input.claims.map((claim) =>
      verifySource(root, input.prompt, claim.citation),
    ),
  );
  const proposals = input.claims.map((claim, index) => {
    const source = sourceByClaim[index]!;
    const parsed = ConstraintSchema.safeParse({
      id: claim.id,
      domain: claim.domain,
      severity: claim.severity,
      ...(claim.severity === "soft" ? { direction: claim.direction } : {}),
      subject: claim.subject,
      operator: claim.operator,
      value: claim.value,
      source: "agent_proposed",
      rationale: `${claim.rationale ? `${claim.rationale} ` : ""}Proposed from ${source.id}; verify before using as a rule.`,
      condition: null,
      exceptions: [],
    });
    if (!parsed.success)
      throw new Error(
        `Claim ${index + 1} is not a valid constraint: ${parsed.error.issues[0]?.message ?? "invalid"}`,
      );
    return parsed.data;
  });

  const workload = WorkloadSchema.parse({
    id: input.workload.id,
    name: input.workload.name,
    input_classification: input.workload.input_classification,
    output_classification: null,
    output_contract: { kind: "plain_text" },
    expected_usage: { basis: "unknown", calls_per_month: null },
    latency: null,
    quality_gates: [],
    fallback: null,
    current_decision_ref: null,
  });
  const previousWorkload = contract.workloads.find(
    (entry) => entry.id === workload.id,
  );
  if (previousWorkload === undefined)
    contract = addWorkload(contract, workload, now);
  else if (
    previousWorkload.name !== workload.name ||
    previousWorkload.input_classification !== workload.input_classification
  )
    throw new Error(
      "The workload id already exists with different details; nothing was saved.",
    );

  const conflicts: string[] = [];
  const added: string[] = [];
  const groups = new Map<string, Constraint[]>();
  for (const proposal of proposals) {
    const list = groups.get(proposal.subject) ?? [];
    list.push(proposal);
    groups.set(proposal.subject, list);
  }
  for (const [subject, proposed] of groups) {
    const recorded = contract.constraints.filter(
      (entry) => entry.subject === subject,
    );
    const all = [...recorded, ...proposed];
    if (all.some((entry) => !sameRule(entry, all[0]!))) {
      conflicts.push(
        `Resolve conflicting claims about ${subject} before recording a rule.`,
      );
      continue;
    }
    if (recorded.length > 0) continue;
    const first = proposed[0]!;
    contract = addConstraint(contract, first, now);
    added.push(first.id);
  }

  const questions = [
    ...input.questions,
    ...conflicts,
    ...(contract.workloads.find((entry) => entry.id === workload.id)
      ?.quality_gates.length
      ? []
      : [
          `What measured quality metric and minimum does ${workload.name} need?`,
        ]),
    ...(contract.workloads.find((entry) => entry.id === workload.id)
      ?.expected_usage.calls_per_month === null
      ? [`What monthly volume should ${workload.name} be planned for?`]
      : []),
  ];
  for (const question of new Set(questions)) {
    if (!contract.intent.unresolved_questions.includes(question))
      contract = addIntentEntry(
        contract,
        "unresolved_questions",
        question,
        now,
      );
  }
  const valid = validateProjectContract(contract);
  if (!valid.ok)
    throw new Error(
      `The draft does not validate: ${valid.issues[0]?.message ?? "invalid contract"}`,
    );
  if (
    loaded?.contract.decisions.some(
      (decision) =>
        decisionStanding(loaded.contract, decision) !==
        decisionStanding(valid.value, decision),
    )
  )
    throw new Error(
      "The draft would make a signed decision noncurrent; nothing was saved.",
    );
  const sources = [
    ...new Map(
      sourceByClaim.map((source) => [
        `${source.id}:${source.quote_hash}`,
        source,
      ]),
    ).values(),
  ];
  for (const source of sources) {
    if (source.path === null) continue;
    const current = await verifySource(root, input.prompt, {
      kind: "file",
      path: source.path,
      quote: input.claims.find(
        (_claim, index) => sourceByClaim[index] === source,
      )!.citation.quote,
    });
    if (current.content_hash !== source.content_hash)
      throw new Error(
        "A cited document changed during the assessment; nothing was saved.",
      );
  }
  const committed = await commitRevision({
    paths,
    expectedDigest: loaded?.digest ?? null,
    contract: valid.value,
    command: "mcp draft decision brief",
    summary: `drafted workload ${workload.id} from an agent assessment`,
    provenance: {
      kind: "agent_decision_brief",
      prompt_hash: hash(input.prompt),
      sources,
      claims: proposals.map((entry, index) => ({
        constraint_ref: entry.id,
        source_id: sourceByClaim[index]!.id,
        quote_hash: sourceByClaim[index]!.quote_hash,
        recorded: added.includes(entry.id),
      })),
      conflicts,
    },
    clock: options.clock,
  });
  return {
    ok: true as const,
    tool: "draft_decision_brief" as const,
    source: sourceMarker(committed.contract, {
      asOf: now,
      projection: options.projection,
      stateRevision: committed.entry.revision,
    }),
    data: {
      workload: workload.id,
      proposed_constraints_recorded: added,
      claim_citations: proposals.map((entry, index) => ({
        constraint_ref: entry.id,
        source_id: sourceByClaim[index]!.id,
        recorded: added.includes(entry.id),
      })),
      conflicts,
      questions: [...new Set(questions)],
      citations: sources.map((source) => ({
        id: source.id,
        kind: source.kind,
        content_hash: source.content_hash,
        quote_hash: source.quote_hash,
        ...(options.projection === "local-disclosed"
          ? { path: source.path }
          : {}),
      })),
      note: "This is a draft. File quotes were matched to local bytes; their meaning, currency, and authority have not been established. Proposed constraints are not a decision.",
    },
  };
}
