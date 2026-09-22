import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConformanceReportSchema, readReport } from "@anvilmark/conformance";
import { CONFORMANCE_OUTPUT_PATH } from "../src/index.js";
import { cleanup, cli, scriptedIo } from "./helpers.js";
import {
  approvedRemoteContract,
  approvedLocalContract,
  setupWorkspace,
} from "./conformance-helpers.js";
afterEach(cleanup);

describe("CLI Conformance Command", () => {
  it("prints help on --help or check --help", async () => {
    const io1 = scriptedIo({ cwd: process.cwd() });
    const code1 = await cli(["conformance", "--help"], io1);
    expect(code1).toBe(0);
    expect(io1.out()).toContain("Usage:\n  anvilmark conformance");

    const io2 = scriptedIo({ cwd: process.cwd() });
    const code2 = await cli(["check", "--help"], io2);
    expect(code2).toBe(0);
    expect(io2.out()).toContain("Usage:\n  anvilmark conformance");
  });

  it("evaluates compliant repository to pass with exit code 0", async () => {
    const contract = await approvedRemoteContract();
    const { projectDir, appDir } = await setupWorkspace(
      "handoff-approved-sanitized",
      contract,
    );

    const io = scriptedIo({ cwd: projectDir });
    const code = await cli(
      [
        "conformance",
        "--repository",
        appDir,
        "--evaluated-at",
        "2026-09-15T12:00:00Z",
      ],
      io,
    );

    expect(code, io.out() + io.err()).toBe(0);
    expect(io.out()).toContain("Overall Status: COMPLIANT");
    expect(io.out()).toContain("[PASS] rule.classification_approved_candidate");
    expect(io.out()).toContain("[PASS] rule.raw_ticket_never_remote");

    const reportFile = await readFile(
      join(projectDir, CONFORMANCE_OUTPUT_PATH),
      "utf8",
    );
    const report = readReport(reportFile);
    expect(report.summary.compliant).toBe(true);
    expect(report.summary.pass).toBe(2);

    // Conformance check passes
    const checkIo = scriptedIo({ cwd: projectDir });
    const checkCode = await cli(["conformance", "--check"], checkIo);
    expect(checkCode).toBe(0);
    expect(checkIo.out()).toContain("CURRENT");
  });

  it("evaluates direct violation repository to fail with exit code 1", async () => {
    const contract = await approvedLocalContract();
    const { projectDir, appDir } = await setupWorkspace(
      "handoff-disallowed-raw",
      contract,
    );

    const io = scriptedIo({ cwd: projectDir });
    const code = await cli(
      [
        "conformance",
        "--repository",
        appDir,
        "--evaluated-at",
        "2026-09-15T12:00:00Z",
      ],
      io,
    );

    expect(code, io.out() + io.err()).toBe(1);
    expect(io.out()).toContain(
      "Overall Status: CONFORMANCE VIOLATIONS DETECTED",
    );
    expect(io.out()).toContain("[FAIL] rule.classification_approved_candidate");
    expect(io.out()).toContain("[FAIL] rule.raw_ticket_never_remote");
    expect(io.out()).toContain("suggested remediation:");
    expect(io.out()).toContain("candidate.classification.local_unselected");
    expect(io.out()).toContain("pii-redactor");
  });

  it("evaluates ambiguous runtime path to unknown with exit code 2", async () => {
    const contract = await approvedRemoteContract();
    const { projectDir, appDir } = await setupWorkspace(
      "handoff-ambiguous-runtime",
      contract,
    );

    const io = scriptedIo({ cwd: projectDir });
    const code = await cli(
      [
        "conformance",
        "--repository",
        appDir,
        "--evaluated-at",
        "2026-09-15T12:00:00Z",
      ],
      io,
    );

    expect(code, io.out() + io.err()).toBe(2);
    expect(io.out()).toContain("Overall Status: UNKNOWN / INCONCLUSIVE");
    expect(io.out()).toContain(
      "[UNKNOWN] rule.classification_approved_candidate",
    );
    expect(io.out()).toContain("[UNKNOWN] rule.raw_ticket_never_remote");
    expect(io.out()).toContain("runtime_selected_import");
    expect(io.out()).toContain("unresolved_any");
  });

  it("emits valid JSON report when --json flag is passed", async () => {
    const contract = await approvedRemoteContract();
    const { projectDir, appDir } = await setupWorkspace(
      "handoff-approved-sanitized",
      contract,
    );

    const io = scriptedIo({ cwd: projectDir });
    const code = await cli(
      [
        "conformance",
        "--repository",
        appDir,
        "--evaluated-at",
        "2026-09-15T12:00:00Z",
        "--json",
      ],
      io,
    );

    expect(code, io.out() + io.err()).toBe(0);
    const json = JSON.parse(io.out());
    const parsed = ConformanceReportSchema.safeParse(json);
    expect(parsed.success).toBe(true);
    expect(json.summary.compliant).toBe(true);
  });

  it("lists offending paths and suggests scanner.yaml exclude entry when verdict is unknown due to unresolved imports", async () => {
    const contract = await approvedRemoteContract();
    const { projectDir, appDir } = await setupWorkspace(
      "handoff-approved-sanitized",
      contract,
    );

    // Introduce an unresolved import in a non-test file outside the workload
    await writeFile(
      join(appDir, "src", "unresolved.ts"),
      `// @ts-nocheck\nimport { missing } from "non-existent-package";\nexport const value = missing;\n`,
      "utf8",
    );

    const io = scriptedIo({ cwd: projectDir });
    const code = await cli(
      [
        "conformance",
        "--repository",
        appDir,
        "--evaluated-at",
        "2026-09-15T12:00:00Z",
      ],
      io,
    );

    expect(code, io.out() + io.err()).toBe(2);
    expect(io.out()).toContain("Overall Status: UNKNOWN / INCONCLUSIVE");
    expect(io.out()).toContain("unresolved_import");
    expect(io.out()).toContain("offending paths:");
    expect(io.out()).toContain("src/unresolved.ts");
    expect(io.out()).toContain("suggested remediation:");
    expect(io.out()).toContain("Scope them out in scanner.yaml:");
    expect(io.out()).toContain("exclude:");
    expect(io.out()).toContain("- src/unresolved.ts");
  });

  it("caps offending paths at 5 when more than 5 files have unresolved imports", async () => {
    const contract = await approvedRemoteContract();
    const { projectDir, appDir } = await setupWorkspace(
      "handoff-approved-sanitized",
      contract,
    );

    // Create 7 files with unresolved imports
    for (let i = 1; i <= 7; i++) {
      await writeFile(
        join(appDir, "src", `extra${i}.ts`),
        `// @ts-nocheck\nimport { missing } from "non-existent-pkg-${i}";\nexport const v${i} = missing;\n`,
        "utf8",
      );
    }

    const io = scriptedIo({ cwd: projectDir });
    const code = await cli(
      [
        "conformance",
        "--repository",
        appDir,
        "--evaluated-at",
        "2026-09-15T12:00:00Z",
      ],
      io,
    );

    expect(code, io.out() + io.err()).toBe(2);
    expect(io.out()).toContain("offending paths:");
    const offendingSection =
      io.out().split("offending paths:")[1]?.split("caveats:")[0] ?? "";
    const offendingEntries = offendingSection
      .split("\n")
      .filter((line) => line.trim().startsWith("- src/extra"));
    expect(offendingEntries.length).toBe(5);
    expect(offendingSection).toContain("- src/extra1.ts");
    expect(offendingSection).toContain("- src/extra5.ts");
    expect(offendingSection).not.toContain("extra6.ts");
    expect(offendingSection).not.toContain("extra7.ts");
  });
});
