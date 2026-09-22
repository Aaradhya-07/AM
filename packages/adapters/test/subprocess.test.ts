import { dirname } from "node:path";
import { describe, expect, it } from "vitest";

import { fixedClock, isAvailable, runSubprocess } from "../src/index.js";
import { FIXED_TIMES, NODE, identity, nodeScript } from "./helpers.js";

const clock = () => fixedClock(...FIXED_TIMES);

const BASE = {
  timeoutMs: 5000,
  maxOutputBytes: 64 * 1024,
} as const;

describe("the subprocess runner", () => {
  it("returns a usable result for a tool that succeeds", async () => {
    const outcome = await runSubprocess(
      {
        ...BASE,
        executable: NODE,
        args: nodeScript("process.stdout.write(JSON.stringify({ok:true}))"),
      },
      { identity: identity(), clock: clock() },
    );

    expect(outcome.standing).toBe("available");
    if (!isAvailable(outcome)) return;
    expect(outcome.value.stdout).toBe('{"ok":true}');
    expect(outcome.value.exit_code).toBe(0);
    expect(outcome.value.raw_result_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.started_at).toBe(FIXED_TIMES[0]);
  });

  it("reports a missing tool as unavailable, not as a failure", async () => {
    const outcome = await runSubprocess(
      {
        ...BASE,
        executable: "anvilmark-tool-that-does-not-exist",
        args: [],
      },
      { identity: identity(), clock: clock() },
    );

    // Absence is an evidence gap. It must never be a crash and never a pass.
    expect(outcome.standing).toBe("unavailable");
    expect(outcome.errors[0]?.code).toBe("executable_not_found");
  });

  it("reports a non-zero exit as failed and keeps the sanitized output", async () => {
    const outcome = await runSubprocess(
      {
        ...BASE,
        executable: NODE,
        args: nodeScript('process.stderr.write("boom"); process.exit(3)'),
      },
      { identity: identity(), clock: clock() },
    );

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("non_zero_exit");
    expect(outcome.errors[0]?.detail).toMatchObject({
      exit_code: 3,
      stderr: "boom",
    });
  });

  it("terminates a tool that exceeds its deadline", async () => {
    const outcome = await runSubprocess(
      {
        ...BASE,
        timeoutMs: 150,
        executable: NODE,
        args: nodeScript("setInterval(() => {}, 1000)"),
      },
      { identity: identity(), clock: clock() },
    );

    expect(outcome.standing).toBe("timed_out");
    expect(outcome.errors[0]?.code).toBe("timed_out");
  });

  it("terminates and reports a tool that floods its output", async () => {
    const outcome = await runSubprocess(
      {
        ...BASE,
        maxOutputBytes: 1024,
        executable: NODE,
        args: nodeScript(
          'for (let i = 0; i < 5000; i += 1) process.stdout.write("x".repeat(100))',
        ),
      },
      { identity: identity(), clock: clock() },
    );

    // Truncated output is indistinguishable from malformed output, so the
    // runner refuses to hand back a partial result.
    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("output_too_large");
  });

  it("honours cancellation", async () => {
    const controller = new AbortController();
    const pending = runSubprocess(
      {
        ...BASE,
        executable: NODE,
        args: nodeScript("setInterval(() => {}, 1000)"),
        signal: controller.signal,
      },
      { identity: identity(), clock: clock() },
    );
    controller.abort();

    const outcome = await pending;
    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("cancelled");
  });

  it("refuses to start when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    const outcome = await runSubprocess(
      {
        ...BASE,
        executable: NODE,
        args: nodeScript("1"),
        signal: controller.signal,
      },
      { identity: identity(), clock: clock() },
    );

    expect(outcome.errors[0]?.code).toBe("cancelled");
  });

  it("redacts credential-shaped values from stdout and stderr", async () => {
    const outcome = await runSubprocess(
      {
        ...BASE,
        executable: NODE,
        args: nodeScript(
          'process.stdout.write("using sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD\\n");' +
            'process.stderr.write("AKIAIOSFODNN7EXAMPLE failed\\n")',
        ),
      },
      { identity: identity(), clock: clock() },
    );

    expect(outcome.standing).toBe("available");
    if (!isAvailable(outcome)) return;
    expect(outcome.value.stdout).not.toContain("sk-abcdefghij");
    expect(outcome.value.stdout).toContain("[redacted:");
    expect(outcome.value.stderr).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(outcome.diagnostics[0]).toContain("redacted");
  });

  it("never records a credential passed on the command line", async () => {
    const outcome = await runSubprocess(
      {
        ...BASE,
        executable: NODE,
        args: [
          ...nodeScript('process.stdout.write("ok")'),
          // `--` stops node parsing the rest as its own options.
          "--",
          "--api-key",
          "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD",
          "--token=ghp_a1B2c3D4e5a1B2c3D4e5a1B2c3D4e5a1B2c3",
        ],
        env: { EXAMPLE_API_KEY: "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD" },
      },
      { identity: identity(), clock: clock() },
    );

    if (!isAvailable(outcome)) throw new Error("expected the tool to run");
    const manifest = JSON.stringify(outcome.value.manifest);
    expect(manifest).not.toContain("sk-abcdefghij");
    expect(manifest).not.toContain("ghp_");
    expect(outcome.value.manifest.arguments).toContain("[redacted:argument]");
    // Environment NAMES are useful provenance; values never are.
    expect(outcome.value.manifest.environment_names).toEqual([
      "EXAMPLE_API_KEY",
    ]);
  });

  it("does not leak the parent environment to the child by default", async () => {
    const outcome = await runSubprocess(
      {
        ...BASE,
        executable: NODE,
        args: nodeScript(
          'process.stdout.write(String(process.env.ANVILMARK_TEST_SECRET ?? "absent"))',
        ),
      },
      { identity: identity(), clock: clock() },
    );

    if (!isAvailable(outcome)) throw new Error("expected the tool to run");
    expect(outcome.value.stdout).toBe("absent");
  });
});

/**
 * Denying the whole ambient environment is right, but denying PATH with it
 * would make every ordinarily-installed tool permanently "unavailable".
 */
describe("executable discovery", () => {
  it("finds a tool that is only reachable through PATH", async () => {
    const outcome = await runSubprocess(
      {
        ...BASE,
        // A bare name, not an absolute path: resolution has to work.
        executable: "node",
        args: nodeScript('process.stdout.write("resolved")'),
      },
      { identity: identity(), clock: clock() },
    );

    expect(outcome.standing).toBe("available");
    if (!isAvailable(outcome)) return;
    expect(outcome.value.stdout).toBe("resolved");
  });

  it("finds a tool through an injected PATH", async () => {
    const outcome = await runSubprocess(
      {
        ...BASE,
        executable: "node",
        args: nodeScript('process.stdout.write("injected")'),
        baseEnv: { PATH: dirname(NODE) },
      },
      { identity: identity(), clock: clock() },
    );

    expect(outcome.standing).toBe("available");
  });

  it("cannot find a tool when the injected PATH excludes it", async () => {
    const outcome = await runSubprocess(
      {
        ...BASE,
        executable: "node",
        args: [],
        baseEnv: { PATH: "/nonexistent-anvilmark-path" },
      },
      { identity: identity(), clock: clock() },
    );

    expect(outcome.standing).toBe("unavailable");
    expect(outcome.errors[0]?.code).toBe("executable_not_found");
  });

  it("still refuses to inherit an unrelated ambient secret", async () => {
    const outcome = await runSubprocess(
      {
        ...BASE,
        executable: NODE,
        args: nodeScript(
          'process.stdout.write(String(process.env.ANVILMARK_TEST_SECRET ?? "absent") + "|" + (process.env.PATH ? "path" : "no-path"))',
        ),
      },
      { identity: identity(), clock: clock() },
    );

    if (!isAvailable(outcome)) throw new Error("expected the tool to run");
    // PATH is forwarded so tools can be found; nothing else is.
    expect(outcome.value.stdout).toBe("absent|path");
  });

  it("never records the value of a forwarded resolution variable", async () => {
    const outcome = await runSubprocess(
      {
        ...BASE,
        executable: NODE,
        args: nodeScript('process.stdout.write("ok")'),
        baseEnv: { PATH: "/a/very/distinctive/path/segment" },
      },
      { identity: identity(), clock: clock() },
    );

    if (!isAvailable(outcome)) throw new Error("expected the tool to run");
    expect(JSON.stringify(outcome.value.manifest)).not.toContain(
      "very/distinctive",
    );
  });
});

describe("the raw-result hash covers the complete result", () => {
  const run = (source: string, extra: Record<string, unknown> = {}) =>
    runSubprocess(
      { ...BASE, executable: NODE, args: nodeScript(source), ...extra },
      { identity: identity(), clock: clock() },
    );

  it("differs when stderr differs even though stdout is identical", async () => {
    const first = await run('process.stdout.write("same")');
    const second = await run(
      'process.stdout.write("same"); process.stderr.write("noise")',
    );

    if (!isAvailable(first) || !isAvailable(second)) {
      throw new Error("expected both runs to succeed");
    }
    expect(first.value.stdout).toBe(second.value.stdout);
    expect(second.value.raw_result_hash).not.toBe(first.value.raw_result_hash);
  });

  it("is stable for an identical complete result", async () => {
    const first = await run('process.stdout.write("same")');
    const second = await run('process.stdout.write("same")');

    if (!isAvailable(first) || !isAvailable(second)) {
      throw new Error("expected both runs to succeed");
    }
    expect(second.value.raw_result_hash).toBe(first.value.raw_result_hash);
  });
});
