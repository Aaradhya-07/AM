import { z } from "zod";

const Finding = z
  .strictObject({
    severity: z.enum(["blocking", "advisory"]),
    message: z.string().trim().min(1),
    path: z.string().trim().min(1).optional(),
    line: z.number().int().positive().optional(),
  })
  .refine(
    (finding) => finding.line === undefined || finding.path !== undefined,
    {
      message: "a finding with a line number also needs a path",
    },
  );

const ReviewPass = z
  .strictObject({
    verdict: z.enum(["pass", "changes_requested"]),
    findings: z.array(Finding),
  })
  .refine(
    ({ verdict, findings }) =>
      (verdict === "changes_requested") ===
      findings.some((finding) => finding.severity === "blocking"),
    {
      message:
        "changes_requested requires a blocking finding, and pass allows only advisory findings",
    },
  );

export const ReviewFindings = z.strictObject({
  spec_compliance: ReviewPass,
  code_quality: ReviewPass,
});

export type ReviewFindings = z.infer<typeof ReviewFindings>;

export function reviewPasses(findings: ReviewFindings | undefined): boolean {
  const parsed = ReviewFindings.safeParse(findings);
  return (
    parsed.success &&
    parsed.data.spec_compliance.verdict === "pass" &&
    parsed.data.code_quality.verdict === "pass"
  );
}
