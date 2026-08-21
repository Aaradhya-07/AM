import { z } from "zod/v4";
import { NonEmptyStringSchema, RefSchema, TimestampSchema, } from "./primitives.js";
/**
 * Approval is an interactive, local, human action. The actor kind is fixed to
 * `local_user` so that no adapter, agent, or automation can record itself as
 * the approver.
 *
 * Doc 06 section 5 is explicit that removing approval from MCP and requiring
 * an interactive terminal REDUCES accidental approval but is not a
 * cryptographic human-presence guarantee: an agent with unrestricted shell
 * access can invoke local programs.
 */
export const ApprovalActorSchema = z.strictObject({
    kind: z.literal("local_user"),
    ref: NonEmptyStringSchema,
});
export const SHA256_HEX = /^[0-9a-f]{64}$/;
/**
 * One entry in an append-only approval history. The hash covers the resolved
 * content that was approved: the decision revision, the full selected
 * candidate, every cited evidence record, and the constraint results.
 */
export const ApprovalSchema = z.strictObject({
    decision_ref: RefSchema,
    decision_revision: z.int().min(1),
    actor: ApprovalActorSchema,
    approved_at: TimestampSchema,
    note: NonEmptyStringSchema.nullable().default(null),
    hash_algorithm: z.literal("sha-256").default("sha-256"),
    content_hash: z
        .string()
        .regex(SHA256_HEX, "content_hash must be lower-case hex SHA-256"),
});
