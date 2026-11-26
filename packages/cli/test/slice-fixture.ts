import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  PLAN_HANDOFF_VERSION,
  type PlanHandoffBundle,
} from "../src/commands/apply-plan.js";
import { ACTIVE_PLAN } from "../src/commands/slice-storage.js";
import { tempDir } from "./helpers.js";

export const now = "2026-11-27T12:00:00.000Z";

export const contract = {
  allowedGlobs: ["src/**", "package.json"],
  forbiddenGlobs: ["**/.env*"],
  verificationCommands: [],
  allowDependencyChanges: false,
  expectedBoundaries: [],
} satisfies NonNullable<PlanHandoffBundle["plan"]["tasks"][number]["contract"]>;

export function fixture(): PlanHandoffBundle {
  return {
    version: PLAN_HANDOFF_VERSION,
    createdAt: now,
    strict: true,
    quotaMode: "conserve",
    masterPrompt: "Implement the planned work.",
    candidates: [
      {
        model: "gpt",
        label: "GPT",
        provider: "OpenAI",
        tier: "fast",
        billing: "api",
      },
      {
        model: "claude",
        label: "Claude",
        provider: "Anthropic",
        tier: "fast",
        billing: "api",
      },
    ],
    plan: {
      title: "Label API",
      goal: "Label orders",
      users: "Staff",
      scope: ["Labels"],
      assumptions: [],
      questions: [],
      nonGoals: [],
      security: [],
      flows: [],
      architecture: [
        {
          title: "API",
          why: "Existing service",
          decision: "Local code",
          alternative: "Service",
          tradeoff: "Maintenance",
        },
      ],
      tasks: [
        {
          id: "labels",
          title: "Labels",
          outcome: "Label API",
          acceptance: ["Returns label"],
          dependsOn: [],
          checks: ["Confirm a label is generated."],
          model: "gpt",
          why: "Fit",
          alternatives: [],
          inputTokens: 100,
          outputTokens: 20,
          estimateBasis: "Pilot",
          contract,
        },
      ],
    },
  };
}

export function git(root: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function put(root: string, path: string, contents: unknown) {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    typeof contents === "string" ? contents : JSON.stringify(contents),
  );
}

export async function repo(plan: PlanHandoffBundle | null = fixture()) {
  const root = await tempDir();
  git(root, "init", "-q");
  await put(root, ".gitignore", ".anvilmark/\nnode_modules/\n");
  await put(root, "package.json", {
    name: "label-service",
    dependencies: { zod: "^4" },
  });
  await put(root, "src/index.ts", "export const hello = 'world';\n");
  git(root, "add", ".gitignore", "package.json", "src/index.ts");
  git(
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "Initial",
  );
  if (plan) await put(root, ACTIVE_PLAN, plan);
  return root;
}
