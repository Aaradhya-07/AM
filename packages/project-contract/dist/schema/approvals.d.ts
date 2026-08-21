import { z } from "zod/v4";
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
export declare const ApprovalActorSchema: z.ZodObject<{
    kind: z.ZodLiteral<"local_user">;
    ref: z.ZodString;
}, z.core.$strict>;
export type ApprovalActor = z.infer<typeof ApprovalActorSchema>;
export declare const SHA256_HEX: RegExp;
/**
 * One entry in an append-only approval history. The hash covers the resolved
 * content that was approved: the decision revision, the full selected
 * candidate, every cited evidence record, and the constraint results.
 */
export declare const ApprovalSchema: z.ZodObject<{
    decision_ref: z.ZodString;
    decision_revision: z.ZodInt;
    actor: z.ZodObject<{
        kind: z.ZodLiteral<"local_user">;
        ref: z.ZodString;
    }, z.core.$strict>;
    approved_at: z.ZodISODateTime;
    note: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    hash_algorithm: z.ZodDefault<z.ZodLiteral<"sha-256">>;
    content_hash: z.ZodString;
}, z.core.$strict>;
export type Approval = z.infer<typeof ApprovalSchema>;
//# sourceMappingURL=approvals.d.ts.map