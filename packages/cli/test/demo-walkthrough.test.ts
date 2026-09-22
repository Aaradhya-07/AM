import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const DEMO_SCRIPT = join(REPO_ROOT, "scripts/demo-atlas.mjs");

describe("Atlas offline fixture replay integration", () => {
  it("replays the same-contract fail, pass and unknown cases through built binaries", () => {
    const result = spawnSync(process.execPath, [DEMO_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        FORCE_COLOR: "0",
      },
      timeout: 60000,
    });

    if (result.status !== 0) {
      console.error("STDOUT:", result.stdout);
      console.error("STDERR:", result.stderr);
    }

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "[Step 1/8] Preflight & Packaging Verification",
    );
    expect(result.stdout).toContain(
      "[Step 2/8] Initialize Atlas Project from Contract Specification",
    );
    expect(result.stdout).toContain(
      "[Step 3/8] Compare Workload Candidates & Identify Evidence Gaps",
    );
    expect(result.stdout).toContain(
      "[Step 4/8] Synthetic Approval Fixture & Context Generation",
    );
    expect(result.stdout).toContain("[Step 5/8] MCP Stdio Harness Consistency");
    expect(result.stdout).toContain(
      "[Step 6/8] Deliberate Violation — Wrong Model & Raw Customer Data",
    );
    expect(result.stdout).toContain(
      "[Step 7/8] Correct Source & Recheck the Same Contract",
    );
    expect(result.stdout).toContain(
      "[Step 8/8] Ambiguous Runtime Dispatch Remains Unknown",
    );
    expect(result.stdout).toContain("OFFLINE ATLAS FIXTURE REPLAY COMPLETE");
  });
});
