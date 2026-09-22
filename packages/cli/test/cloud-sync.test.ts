import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as conformance from "../src/conformance.js";
import { validateTelemetryDetails } from "../src/commands/push.js";
import { ATLAS, cleanup, cli, scriptedIo, tempDir } from "./helpers.js";

afterEach(cleanup);

describe("cloud sync commands (login, whoami, logout, push)", () => {
  it("authenticates, sets 0o600 mode, and saves credentials outside the repository", async () => {
    const root = await tempDir("anvilmark-repo-");
    const configHome = await tempDir("anvilmark-config-");

    const io = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CONFIG_HOME: configHome },
    });

    const code = await cli(
      ["login", "--token", "am_live_test_session_token_1234"],
      io,
    );
    expect(code).toBe(0);
    expect(io.out()).toContain("Logged in to ANVILMARK console");
    expect(io.out()).toContain("am_liv...1234");
    expect(io.err()).toBe("");

    // Assert credentials file mode is 0o600 (owner read/write only)
    const credPath = join(configHome, "credentials.json");
    const info = await stat(credPath);
    // On POSIX, lower 9 bits represent file permissions
    expect(info.mode & 0o777).toBe(0o600);

    // Whoami check
    const whoamiIo = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CONFIG_HOME: configHome },
    });
    const whoamiCode = await cli(["login", "--whoami"], whoamiIo);
    expect(whoamiCode).toBe(0);
    expect(whoamiIo.out()).toContain("ANVILMARK Authentication Status:");
    expect(whoamiIo.out()).toContain("am_liv...1234");

    // Logout check
    const logoutIo = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CONFIG_HOME: configHome },
    });
    const logoutCode = await cli(["login", "--logout"], logoutIo);
    expect(logoutCode).toBe(0);
    expect(logoutIo.out()).toContain("Logged out from ANVILMARK console");

    // Whoami after logout
    const postLogoutIo = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CONFIG_HOME: configHome },
    });
    await cli(["login", "--whoami"], postLogoutIo);
    expect(postLogoutIo.out()).toContain("Not logged in");
  });

  it("refuses login without a token", async () => {
    const root = await tempDir();
    const io = scriptedIo({ cwd: root });
    const code = await cli(["login"], io);
    expect(code).toBe(2);
    expect(io.err()).toContain("missing --token argument");
  });

  it("refuses credentials path that is inside a project directory", async () => {
    const root = await tempDir();
    // Initialize a project
    await cli(["init", "--from-contract", ATLAS], scriptedIo({ cwd: root }));

    // Try setting config home inside the project
    const insideProject = join(root, "config");
    const io = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CONFIG_HOME: insideProject },
    });

    const code = await cli(["login", "--token", "am_live_123"], io);
    expect(code).toBe(1);
    expect(io.err()).toContain("credentials must live outside repositories");
  });

  it("refuses push when not logged in and no token provided", async () => {
    const root = await tempDir();
    const emptyConfig = await tempDir();
    await cli(["init", "--from-contract", ATLAS], scriptedIo({ cwd: root }));

    const io = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CONFIG_HOME: emptyConfig },
    });

    const code = await cli(["push"], io);
    expect(code).toBe(1);
    expect(io.err()).toContain("Not logged in to ANVILMARK console");
  });

  it("refuses push in non-interactive environment without --yes (enforcing outbound consent)", async () => {
    const root = await tempDir();
    await cli(["init", "--from-contract", ATLAS], scriptedIo({ cwd: root }));

    const io = scriptedIo({
      cwd: root,
      interactive: false,
    });

    const code = await cli(["push", "--token", "am_live_token"], io);
    expect(code).toBe(1);
    expect(io.err()).toContain(
      "requires interactive confirmation or the --yes flag",
    );
  });

  it("strictly pins outbound payload shape: only project, commit, status, counts - no source or file contents", async () => {
    const root = await tempDir();
    await cli(["init", "--from-contract", ATLAS], scriptedIo({ cwd: root }));

    let capturedHeaders: Record<string, string | string[] | undefined> = {};
    let capturedBody: Record<string, unknown> = {};

    const server = createServer(async (req, res) => {
      capturedHeaders = req.headers;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      capturedBody = JSON.parse(raw);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, runId: "test_run_123" }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const endpoint = `http://127.0.0.1:${port}`;

    try {
      const io = scriptedIo({
        cwd: root,
        interactive: false,
      });

      const code = await cli(
        [
          "push",
          "--endpoint",
          endpoint,
          "--token",
          "am_live_test_pinned_token_456",
          "--yes",
        ],
        io,
      );

      expect(code).toBe(0);
      expect(io.out()).toContain(
        "Conformance telemetry transmitted to ANVILMARK console",
      );
      expect(io.err()).toBe("");

      // 1. Assert Authentication Header is passed
      expect(capturedHeaders["authorization"]).toBe(
        "Bearer am_live_test_pinned_token_456",
      );

      // 2. PIN THE EXACT PAYLOAD KEYS: strictly 5 fields, no more, no less
      const keys = Object.keys(capturedBody).sort();
      expect(keys).toEqual([
        "agentTrigger",
        "commitSha",
        "details",
        "projectId",
        "status",
      ]);

      // 3. Assert values
      expect(capturedBody.projectId).toBe("atlas-support-desk");
      expect(typeof capturedBody.commitSha).toBe("string");
      expect(capturedBody.commitSha).toMatch(/^[0-9a-fA-F]{7,40}$/);
      expect(["pass", "fail", "warn"]).toContain(capturedBody.status);
      expect(capturedBody.agentTrigger).toBe("Local CLI (anvilmark push)");

      // 4. Assert ZERO source code egress
      expect(capturedBody).not.toHaveProperty("source");
      expect(capturedBody).not.toHaveProperty("code");
      expect(capturedBody).not.toHaveProperty("files");
      expect(capturedBody).not.toHaveProperty("file_contents");
      expect(capturedBody).not.toHaveProperty("ast");

      // 5. Assert details contains only counts / summaries, not raw source paths
      const details = String(capturedBody.details);
      expect(details).not.toContain("/Users/");
      expect(details).not.toContain(".ts");
      expect(details).not.toContain(".py");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("handles push gracefully with connection failure without crashing", async () => {
    const root = await tempDir();
    await cli(["init", "--from-contract", ATLAS], scriptedIo({ cwd: root }));

    const io = scriptedIo({
      cwd: root,
      interactive: false,
      env: { ANVILMARK_API_URL: "http://127.0.0.1:59999" },
    });

    const code = await cli(["push", "--token", "am_live_test", "--yes"], io);
    expect(code).toBe(1);
    expect(io.err()).toContain("Connection failed to http://127.0.0.1:59999");
  });

  it("stands up a mock HTTP server, runs push with --dry-run, and asserts zero requests received while stdout contains payload keys", async () => {
    const root = await tempDir();
    await cli(["init", "--from-contract", ATLAS], scriptedIo({ cwd: root }));

    let requestCount = 0;
    let socketCount = 0;

    const server = createServer(async (_req, res) => {
      requestCount++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    server.on("connection", () => {
      socketCount++;
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const endpoint = `http://127.0.0.1:${port}`;

    try {
      const io = scriptedIo({
        cwd: root,
        interactive: false,
      });

      const code = await cli(
        [
          "push",
          "--endpoint",
          endpoint,
          "--token",
          "am_live_test_pinned_token_456",
          "--dry-run",
        ],
        io,
      );

      expect(code).toBe(0);
      expect(io.err()).toBe("");

      // 1. Assert the server received ZERO requests and ZERO sockets were opened
      expect(requestCount).toBe(0);
      expect(socketCount).toBe(0);

      // 2. Assert destination URL is printed
      const out = io.out();
      expect(out).toContain(`${endpoint}/api/runs`);

      // 3. Assert stdout contains the exact payload keys
      const keys = [
        "agentTrigger",
        "commitSha",
        "details",
        "projectId",
        "status",
      ];
      for (const key of keys) {
        expect(out).toContain(key);
      }

      // 4. Assert values are present in payload
      expect(out).toContain("atlas-support-desk");
      expect(out).toContain("Local CLI (anvilmark push)");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("requires credentials for push even with --dry-run", async () => {
    const root = await tempDir();
    const emptyConfig = await tempDir();
    await cli(["init", "--from-contract", ATLAS], scriptedIo({ cwd: root }));

    const io = scriptedIo({
      cwd: root,
      interactive: false,
      env: { ANVILMARK_CONFIG_HOME: emptyConfig },
    });

    const code = await cli(["push", "--dry-run"], io);
    expect(code).toBe(1);
    expect(io.err()).toContain("Not logged in to ANVILMARK console");
  });

  it("client refuses a details string containing 'src/app.ts'", async () => {
    const root = await tempDir();
    await cli(["init", "--from-contract", ATLAS], scriptedIo({ cwd: root }));

    let requestReceived = false;
    const server = createServer((_req, res) => {
      requestReceived = true;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, runId: "test_run_123" }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const endpoint = `http://127.0.0.1:${port}`;

    const spy = vi
      .spyOn(conformance, "readStoredConformance")
      .mockResolvedValue({
        status: "valid",
        report: {
          summary: {
            total: 1,
            pass: 1,
            fail: 0,
            unknown: 0,
            not_applicable: 0,
            compliant: true,
          },
          conformance_hash: "src/app.ts_dummy_hash",
        },
      } as unknown as conformance.StoredConformance);

    try {
      const io = scriptedIo({
        cwd: root,
        interactive: false,
      });

      const code = await cli(
        [
          "push",
          "--endpoint",
          endpoint,
          "--token",
          "am_live_test_pinned_token_456",
          "--yes",
        ],
        io,
      );

      expect(code).toBe(1);
      expect(io.err()).toContain("telemetry details violates policy");
      expect(io.err()).toContain("src/app.ts");
      expect(requestReceived).toBe(false);

      // Direct validation function checks
      expect(validateTelemetryDetails("src/app.ts")).toBe(false);
      expect(validateTelemetryDetails("Violations found in src/app.ts")).toBe(
        false,
      );
      expect(validateTelemetryDetails("foo/bar.py")).toBe(false);
      expect(validateTelemetryDetails("foo\\bar")).toBe(false);
      expect(validateTelemetryDetails("line1\nline2")).toBe(false);
      expect(validateTelemetryDetails("a".repeat(501))).toBe(false);
      expect(validateTelemetryDetails("3/3 rules verified compliant.")).toBe(
        true,
      );
    } finally {
      spy.mockRestore();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
