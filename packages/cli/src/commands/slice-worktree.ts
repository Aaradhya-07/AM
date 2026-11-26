import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import { z } from "zod";
import { ReviewerFamilySchema, SliceContractSchema } from "./apply-plan.js";
import { readRepoFile } from "./slice-storage.js";

export const WORKTREE_META = ".anvilmark/development/slice-worktree.json";
export const SLICE_PROMPT = "SLICE_PROMPT.md";
export const WORKTREE_PARENT = ".anvilmark/worktrees";

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const WorktreeMetadata = z.strictObject({
  schemaVersion: z.literal("anvilmark.slice-worktree.v1"),
  sliceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  branch: z.string().regex(/^anvilmark\/slice\/[a-z0-9][a-z0-9-]{0,39}$/),
  baseCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  planSha256: Sha256,
  promptSha256: Sha256,
  contract: SliceContractSchema.nullable(),
  reviewerFamily: ReviewerFamilySchema.nullable(),
});
export type WorktreeMetadata = z.infer<typeof WorktreeMetadata>;

export function sliceDigest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function readWorktreeMetadata(root: string) {
  const raw = await readRepoFile(root, WORKTREE_META);
  return raw === null ? null : WorktreeMetadata.parse(JSON.parse(raw));
}

export function worktreeRegistration(sliceId: string): string {
  return WORKTREE_PARENT + "/" + sliceId + ".json";
}

export async function readRegisteredWorktree(root: string) {
  const worktrees = dirname(root);
  const anvilmark = dirname(worktrees);
  const local = await readWorktreeMetadata(root);
  if (
    basename(worktrees) !== "worktrees" ||
    basename(anvilmark) !== ".anvilmark"
  ) {
    if (local)
      throw new Error("Slice worktree is outside its prepared location");
    return null;
  }
  const raw = await readRepoFile(
    dirname(anvilmark),
    worktreeRegistration(basename(root)),
  );
  const registered =
    raw === null ? null : WorktreeMetadata.parse(JSON.parse(raw));
  if (JSON.stringify(registered) !== JSON.stringify(local))
    throw new Error("Slice worktree metadata differs from its creation record");
  return registered;
}
