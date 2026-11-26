import { execFileSync } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PLAN_BLOCK_END,
  PLAN_BLOCK_START,
  upsertPlanBlock,
} from "../src/commands/apply-plan.js";
import { cleanup, cli, exists, scriptedIo, tempDir } from "./helpers.js";

afterEach(cleanup);

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    version: "anvilmark.plan-handoff.v1",
    createdAt: "2026-11-26T09:00:00.000Z",
    plan: {
      title: "Label service",
      goal: "Let staff print shipping labels from the order page.",
      users: "Warehouse staff",
      scope: ["Generate labels for paid orders"],
      nonGoals: ["International customs forms"],
      assumptions: ["Orders already store addresses"],
      questions: ["Which printer models are in use?"],
      architecture: [
        {
          title: "Rendering",
          decision: "Render labels server-side as PDF.",
          why: "Printers accept PDF directly.",
          alternative: "Client-side canvas rendering",
          tradeoff: "More server CPU.",
        },
      ],
      flows: [
        {
          from: "Order page",
          to: "Label API",
          data: "Order id",
          boundary: "Authenticated session",
        },
      ],
      tasks: [
        {
          id: "label-api",
          title: "Label API",
          outcome: "POST /labels returns a PDF.",
          dependsOn: [],
          acceptance: ["Returns 200 with application/pdf"],
          checks: ["pnpm test"],
          model: "claude-sonnet-4-6",
          why: "Moderate complexity.",
          alternatives: [{ model: "gpt-5-mini", tradeoff: "Cheaper, weaker." }],
          inputTokens: 20000,
          outputTokens: 4000,
          estimateBasis: "Similar endpoints.",
        },
        {
          id: "label-ui",
          title: "Print button",
          outcome: "Order page has a print button.",
          dependsOn: ["label-api"],
          acceptance: ["Button downloads the PDF"],
          checks: ["pnpm test"],
          model: "gpt-5-mini",
          why: "Simple UI work.",
          alternatives: [],
          inputTokens: 8000,
          outputTokens: 2000,
          estimateBasis: "Small component.",
        },
      ],
      security: [
        {
          risk: "Label for another tenant's order",
          control: "Check order ownership",
          verification: "Negative test for cross-tenant access",
        },
      ],
    },
    candidates: [
      {
        model: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        provider: "Anthropic",
        tier: "balanced",
        billing: "api",
        inputUsdPerMillion: 3,
      },
      {
        model: "gpt-5-mini",
        label: "GPT-5 mini",
        provider: "OpenAI",
        tier: "fast",
        billing: "api",
      },
    ],
    strict: true,
    masterPrompt:
      "Continue this AnvilMark draft in the repository I have opened.",
    ...overrides,
  };
}

async function repo(): Promise<{ root: string; file: string }> {
  const parent = await tempDir();
  const root = join(parent, "repo");
  await mkdir(root);
  const file = join(parent, "bundle.json");
  await writeFile(file, JSON.stringify(bundle()));
  return { root, file };
}

async function apply(root: string, args: readonly string[]) {
  const io = scriptedIo({ cwd: root });
  const code = await cli(["apply-plan", ...args], io);
  return { code, out: io.out(), err: io.err() };
}

describe("anvilmark apply-plan", () => {
  it("writes the plan, CLAUDE.md, AGENTS.md and the Cursor rule in a fresh repo", async () => {
    const { root, file } = await repo();
    const result = await apply(root, ["--file", file]);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("created   CLAUDE.md");
    expect(result.out).toContain("created   AGENTS.md");
    expect(result.out).toContain("created   .cursor/rules/anvilmark-plan.mdc");

    const active = JSON.parse(
      await readFile(
        join(root, ".anvilmark", "development", "active-plan.json"),
        "utf8",
      ),
    ) as { version: string; candidates: Record<string, unknown>[] };
    expect(active.version).toBe("anvilmark.plan-handoff.v1");
    // Unknown candidate fields are not carried into the repository.
    expect(active.candidates[0]).not.toHaveProperty("inputUsdPerMillion");

    const plan = await readFile(join(root, "PLAN.md"), "utf8");
    expect(plan).toContain(PLAN_BLOCK_START);
    expect(plan).toContain("Continue this AnvilMark draft");

    const claude = await readFile(join(root, "CLAUDE.md"), "utf8");
    expect(claude.startsWith(PLAN_BLOCK_START)).toBe(true);
    expect(claude).toContain("## AnvilMark plan: Label service");
    expect(claude).toContain("International customs forms");
    expect(claude).toContain(
      "1. **label-api — Label API** (recommended model: Claude Sonnet 4.6 (`claude-sonnet-4-6`))",
    );
    expect(claude).toContain("after: label-api");
    expect(claude).toContain("Strict mode");
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(claude);

    const mdc = await readFile(
      join(root, ".cursor", "rules", "anvilmark-plan.mdc"),
      "utf8",
    );
    expect(mdc).toMatch(
      /^---\ndescription: "AnvilMark plan: Label service"\nglobs:\nalwaysApply: true\n---\n/,
    );
    expect(mdc).toContain("## Architecture decisions");
    expect(mdc).toContain("Render labels server-side as PDF.");
    expect(mdc).toContain("## Non-goals");
    expect(mdc).toContain("recommended model: GPT-5 mini (`gpt-5-mini`)");
  });

  it("updates only the marked block of existing CLAUDE.md and AGENTS.md, idempotently", async () => {
    const { root, file } = await repo();
    const userClaude = "# Team rules\n\nAlways run pnpm lint.\n";
    const userAgents = `# Agents\n\nBefore\n\n${PLAN_BLOCK_START}\nold plan text\n${PLAN_BLOCK_END}\n\nAfter: keep me.\n`;
    await writeFile(join(root, "CLAUDE.md"), userClaude);
    await writeFile(join(root, "AGENTS.md"), userAgents);

    const first = await apply(root, [
      "--file",
      file,
      "--target",
      "claude,codex",
    ]);
    expect(first.code).toBe(0);
    expect(first.out).toContain("updated   CLAUDE.md");
    expect(first.out).not.toContain(".cursor");
    expect(await exists(join(root, ".cursor"))).toBe(false);

    const claude = await readFile(join(root, "CLAUDE.md"), "utf8");
    expect(
      claude.startsWith(`${userClaude.trimEnd()}\n\n${PLAN_BLOCK_START}\n`),
    ).toBe(true);
    expect(claude.trimEnd().endsWith(PLAN_BLOCK_END)).toBe(true);

    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(agents.startsWith("# Agents\n\nBefore\n\n")).toBe(true);
    expect(agents.endsWith(`${PLAN_BLOCK_END}\n\nAfter: keep me.\n`)).toBe(
      true,
    );
    expect(agents).not.toContain("old plan text");
    expect(agents.split(PLAN_BLOCK_START)).toHaveLength(2);

    const second = await apply(root, [
      "--file",
      file,
      "--target",
      "claude,codex",
    ]);
    expect(second.code).toBe(0);
    expect(second.out).toContain("unchanged CLAUDE.md");
    expect(second.out).toContain("unchanged AGENTS.md");
    expect(second.out).toContain("Nothing changed");
    expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toBe(claude);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(agents);
  });

  it("uses supplied formatted sections and keeps markers from nesting", async () => {
    const { root } = await repo();
    const file = join(root, "..", "custom.json");
    await writeFile(
      file,
      JSON.stringify(
        bundle({
          claudeMdSection: `${PLAN_BLOCK_START}\n## Custom Claude\n${PLAN_BLOCK_END}`,
          codexAgentsSection: "## Custom Codex",
          cursorRuleMdc: "# Custom cursor body",
        }),
      ),
    );
    expect((await apply(root, ["--file", file])).code).toBe(0);
    const claude = await readFile(join(root, "CLAUDE.md"), "utf8");
    expect(claude).toBe(
      `${PLAN_BLOCK_START}\n## Custom Claude\n${PLAN_BLOCK_END}\n`,
    );
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain(
      "## Custom Codex",
    );
    const mdc = await readFile(
      join(root, ".cursor", "rules", "anvilmark-plan.mdc"),
      "utf8",
    );
    expect(mdc).toMatch(
      /^---\n[\s\S]*alwaysApply: true\n---\n\n# Custom cursor body\n$/,
    );
  });

  it("refuses to write through a symbolic link that leaves the project", async () => {
    const { root, file } = await repo();
    const outside = await tempDir();
    await symlink(outside, join(root, ".cursor"));
    const result = await apply(root, ["--file", file, "--target", "cursor"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("symbolic link");
    expect(await exists(join(outside, "rules"))).toBe(false);

    const second = await repo();
    await writeFile(join(outside, "CLAUDE.md"), "outside\n");
    await symlink(join(outside, "CLAUDE.md"), join(second.root, "CLAUDE.md"));
    const linked = await apply(second.root, [
      "--file",
      second.file,
      "--target",
      "claude",
    ]);
    expect(linked.code).toBe(1);
    expect(linked.err).toContain("symbolic link");
    expect(await readFile(join(outside, "CLAUDE.md"), "utf8")).toBe(
      "outside\n",
    );
  });

  it("rejects invalid bundles without writing anything", async () => {
    const { root } = await repo();
    const cases: Array<[string, unknown]> = [
      ["wrong-version", bundle({ version: "anvilmark.plan-handoff.v0" })],
      ["extra-field", bundle({ surprise: true })],
      ["no-prompt", bundle({ masterPrompt: "" })],
      [
        "bad-deps",
        bundle({
          plan: {
            ...bundle().plan,
            tasks: [{ ...bundle().plan.tasks[1], dependsOn: ["missing"] }],
          },
        }),
      ],
    ];
    for (const [name, value] of cases) {
      const file = join(root, "..", `${name}.json`);
      await writeFile(file, JSON.stringify(value));
      const result = await apply(root, ["--file", file]);
      expect({ name, code: result.code }).toEqual({ name, code: 1 });
      expect(result.err).toContain("invalid plan handoff bundle");
    }
    const notJson = join(root, "..", "broken.json");
    await writeFile(notJson, "{");
    const broken = await apply(root, ["--file", notJson]);
    expect(broken.code).toBe(1);
    expect(broken.err).toContain("not valid JSON");
    expect(await exists(join(root, ".anvilmark"))).toBe(false);
    expect(await exists(join(root, "CLAUDE.md"))).toBe(false);
  });

  it("reports usage errors", async () => {
    const { root, file } = await repo();
    expect((await apply(root, [])).code).toBe(2);
    expect((await apply(root, ["--file", file, "--target", "vim"])).code).toBe(
      2,
    );
    const help = await apply(root, ["--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("anvilmark apply-plan --file");
  });

  it("applies to a -C project directory and prints JSON", async () => {
    const { root, file } = await repo();
    execFileSync("git", ["init", "-q", root]);
    const io = scriptedIo({ cwd: join(root, "..") });
    const code = await cli(
      [
        "apply-plan",
        "--file",
        file,
        "-C",
        "repo",
        "--target",
        "codex",
        "--json",
      ],
      io,
    );
    expect(code).toBe(0);
    const report = JSON.parse(io.out()) as {
      files: { path: string; action: string }[];
    };
    expect(report.files.map((item) => item.path)).toEqual([
      ".anvilmark/development/active-plan.json",
      "PLAN.md",
      "AGENTS.md",
    ]);
  });
});

describe("upsertPlanBlock", () => {
  it("refuses unbalanced markers instead of guessing", () => {
    expect(() =>
      upsertPlanBlock(`${PLAN_BLOCK_START}\nunterminated`, "x"),
    ).toThrow(/without/);
    expect(() => upsertPlanBlock(`stray ${PLAN_BLOCK_END}`, "x")).toThrow(
      /without/,
    );
  });
});

it("keeps v1 quota and strict slice contracts in the active plan", async () => {
  const root = await tempDir();
  const input = bundle();
  Object.assign(input, { quotaMode: "conserve" });
  const contract = {
    allowedGlobs: ["src/**"],
    forbiddenGlobs: [".env*"],
    verificationCommands: ["pnpm test"],
    allowDependencyChanges: false,
    expectedBoundaries: ["Auth"],
    reviewerFamily: "anthropic",
  };
  Object.assign(input.plan.tasks[0]!, { contract });
  const file = join(root, "bundle.json");
  await writeFile(file, JSON.stringify(input));
  const result = await cli(
    ["apply-plan", "--file", file, "-C", root],
    scriptedIo({ cwd: root }),
  );
  expect(result).toBe(0);
  const active = JSON.parse(
    await readFile(
      join(root, ".anvilmark/development/active-plan.json"),
      "utf8",
    ),
  );
  expect(active.quotaMode).toBe("conserve");
  expect(active.plan.tasks[0].contract).toEqual(contract);
  Object.assign(input.plan.tasks[0]!, {
    contract: { ...contract, extra: true },
  });
  await writeFile(file, JSON.stringify(input));
  expect(
    await cli(
      ["apply-plan", "--file", file, "-C", root],
      scriptedIo({ cwd: root }),
    ),
  ).toBe(1);
});
