import { loadFixture } from "@anvilmark/contract";
import { runAudit } from "@anvilmark/engine";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

export const TOOL_NAMES = [
  "audit_system",
  "explain_finding",
  "estimate_cost",
] as const;

const auditSystemInputSchema = z.object({
  repoPath: z.string().describe("Absolute path to the codebase to audit"),
});

const explainFindingInputSchema = z.object({
  findingId: z.string().describe("Finding identifier returned by audit_system"),
});

const estimateCostInputSchema = z.object({
  purpose: z.string().describe("What the AI component does"),
  model: z.string().nullable().optional(),
  monthlyInputTokens: z.number().nonnegative().nullable().optional(),
  monthlyOutputTokens: z.number().nonnegative().nullable().optional(),
  monthlyCalls: z.number().nonnegative().nullable().optional(),
});

export function createServer(): McpServer {
  const server = new McpServer({ name: "anvilmark", version: "0.1.0" });

  server.registerTool(
    "audit_system",
    {
      description: "Run an Anvilmark cost audit on a codebase.",
      inputSchema: auditSystemInputSchema,
    },
    async ({ repoPath }) => {
      // TODO(mcp): discover components and constraints from the requested repo.
      const result = await runAudit({
        components: [],
        constraints: {
          budgetMonthlyUsd: null,
          deployment: "cloud",
          privacyRequirements: [],
          latencyRequirementMs: null,
        },
        repoPath,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    "explain_finding",
    {
      description: "Expand on one audit finding.",
      inputSchema: explainFindingInputSchema,
    },
    async ({ findingId }) => {
      // TODO(mcp): generate a source-aware explanation from the engine.
      const fixture = await loadFixture("saas-support");
      const finding =
        fixture.findings.find((candidate) => candidate.id === findingId) ??
        fixture.findings[0];
      const payload = {
        finding,
        explanation:
          "Fixture explanation only. Production reasoning is intentionally not implemented.",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.registerTool(
    "estimate_cost",
    {
      description: "Estimate monthly cost for a described AI component.",
      inputSchema: estimateCostInputSchema,
    },
    async ({ purpose }) => {
      // TODO(mcp): calculate an estimate using validated live pricing.
      const fixture = await loadFixture("document-review");
      const payload = {
        purpose,
        estimate: {
          currentMonthlyUsd: fixture.totalCurrentMonthlyUsd,
          projectedMonthlyUsd: fixture.totalProjectedMonthlyUsd,
          tokenizerType: "approximate",
        },
        note: "Fixture estimate only; no cost calculation has been implemented.",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  return server;
}
