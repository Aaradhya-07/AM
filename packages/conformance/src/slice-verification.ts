import { z } from "zod";

export const SliceVerificationReportSchema = z.strictObject({
  schemaVersion: z.literal("anvilmark.slice-verification.v1"),
  verifiedAt: z.iso.datetime(),
  sliceId: z.string(),
  passed: z.boolean(),
  changedFiles: z.array(z.string()),
  violations: z.array(
    z.strictObject({
      kind: z.enum([
        "out_of_scope_file",
        "forbidden_file",
        "unapproved_dependency_change",
        "boundary_violation",
        "check_command_failed",
      ]),
      path: z.string().optional(),
      command: z.string().optional(),
      detail: z.string(),
    }),
  ),
  checkResults: z.array(
    z.strictObject({
      command: z.string(),
      exitCode: z.int(),
      durationMs: z.int().nonnegative(),
      outputExcerpt: z.string(),
    }),
  ),
});

export type SliceVerificationReport = z.infer<
  typeof SliceVerificationReportSchema
>;
