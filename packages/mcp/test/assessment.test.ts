import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadProject } from "@anvilmark/cli";
import { afterEach, describe, expect, it } from "vitest";

import { draftDecisionBrief } from "../src/assessment.js";
import {
  compareDecisionOptions,
  proposeDecisionOptions,
} from "../src/decision-options.js";
import { researchCandidateModel } from "../src/model-research.js";
// @ts-expect-error -- plain ESM protocol harness shared with package verification.
import { startStdioServer } from "../scripts/stdio-client.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "anvilmark-assessment-"));
  roots.push(root);
  await writeFile(
    join(root, "decision.md"),
    "Raw tickets must stay local.\n",
    "utf8",
  );
  return root;
}

const workload = {
  id: "classification",
  name: "Ticket classification",
  input_classification: "raw_ticket",
};
const localClaim = {
  id: "privacy.raw_ticket",
  domain: "privacy",
  severity: "hard" as const,
  subject: "data.raw_ticket",
  operator: "must_not_leave",
  value: "local_trust_boundary",
  citation: {
    kind: "file" as const,
    path: "decision.md",
    quote: "Raw tickets must stay local.",
  },
};
const options = {
  clock: () => "2026-10-14T12:00:00Z",
  projection: "remote-default" as const,
};

describe("agent decision brief", () => {
  it("advertises the write capability only when requested and commits through stdio", async () => {
    const root = await workspace();
    const server = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "bin",
      "anvilmark-project-mcp.mjs",
    );
    const client = startStdioServer(process.execPath, [
      server,
      "--project-dir",
      root,
      "--agent-assessment",
    ]);
    try {
      await client.initialize({ name: "agent-test", version: "1" });
      const list = await client.request("tools/list", {});
      const tool = list.result.tools.find(
        (entry: { name: string }) => entry.name === "draft_decision_brief",
      );
      expect(tool?.annotations?.readOnlyHint).toBe(false);
      expect(
        list.result.tools.find(
          (entry: { name: string }) =>
            entry.name === "compare_decision_options",
        )?.annotations?.readOnlyHint,
      ).toBe(true);
      expect(
        list.result.tools.find(
          (entry: { name: string }) =>
            entry.name === "research_candidate_model",
        )?.annotations?.openWorldHint,
      ).toBe(true);
      const response = await client.request("tools/call", {
        name: "draft_decision_brief",
        arguments: {
          prompt: "Classify support tickets while keeping customer data local.",
          workload,
          claims: [localClaim],
        },
      });
      expect(response.result?.structuredContent?.ok).toBe(true);
      expect((await loadProject(root)).contract.constraints).toHaveLength(1);
      const proposed = await client.request("tools/call", {
        name: "propose_decision_options",
        arguments: {
          candidates: [
            {
              id: "local-model-a",
              workload_ref: "classification",
              component_kind: "model_runtime",
              model_family: "Model A",
              model_version: null,
              deployment_mode: "local",
              provider: null,
              rationale: "Explore a local model",
            },
          ],
        },
      });
      expect(proposed.result?.structuredContent?.ok).toBe(true);
      const comparison = await client.request("tools/call", {
        name: "compare_decision_options",
        arguments: { workload: "classification" },
      });
      expect(
        comparison.result?.structuredContent?.data?.workloads?.[0]
          ?.candidates?.[0]?.unknown,
      ).toEqual(["privacy.raw_ticket"]);
    } finally {
      await client.close();
    }
  });

  it("commits a cited restriction as an unconfirmed draft and keeps the citation in local history", async () => {
    const root = await workspace();
    const result = await draftDecisionBrief(
      root,
      {
        prompt: "Classify support tickets while keeping customer data local.",
        workload,
        claims: [localClaim],
      },
      options,
    );
    const loaded = await loadProject(root);
    expect(result.source.state_revision).toBe(1);
    expect(result.data.proposed_constraints_recorded).toEqual([
      "privacy.raw_ticket",
    ]);
    expect(result.data.citations[0]).not.toHaveProperty("path");
    expect(loaded.contract.workloads.map((entry) => entry.id)).toEqual([
      "classification",
    ]);
    expect(loaded.contract.constraints[0]).toMatchObject({
      id: "privacy.raw_ticket",
      source: "agent_proposed",
      severity: "hard",
    });
    expect(loaded.contract.decisions).toEqual([]);
    expect(loaded.contract.approvals).toEqual([]);
    const history = JSON.parse(
      await readFile(
        join(root, ".anvilmark", "history", "r000001.json"),
        "utf8",
      ),
    );
    expect(history.provenance.sources[0]).toMatchObject({
      path: "decision.md",
    });
    expect(history.provenance.claims[0]).toMatchObject({
      constraint_ref: "privacy.raw_ticket",
      source_id: result.data.citations[0]?.id,
      recorded: true,
    });
  });

  it("turns a prompt and ADR disagreement into an open question without recording either rule", async () => {
    const root = await workspace();
    const result = await draftDecisionBrief(
      root,
      {
        prompt: "Send raw tickets to a remote API for classification.",
        workload,
        claims: [
          localClaim,
          {
            ...localClaim,
            id: "deployment.remote_tickets",
            operator: "eq",
            value: "remote_provider",
            citation: {
              kind: "prompt",
              quote: "Send raw tickets to a remote API",
            },
          },
        ],
      },
      options,
    );
    const loaded = await loadProject(root);
    expect(result.data.conflicts).toHaveLength(1);
    expect(result.data.proposed_constraints_recorded).toEqual([]);
    expect(loaded.contract.constraints).toEqual([]);
    expect(loaded.contract.intent.unresolved_questions).toContain(
      result.data.conflicts[0],
    );
  });

  it("refuses a document symlink that leaves the selected project before writing state", async () => {
    const root = await workspace();
    const outside = await mkdtemp(join(tmpdir(), "anvilmark-outside-"));
    roots.push(outside);
    await writeFile(
      join(outside, "private.md"),
      "Raw tickets must stay local.\n",
    );
    await symlink(join(outside, "private.md"), join(root, "escape.md"));
    await expect(
      draftDecisionBrief(
        root,
        {
          prompt: "Classify support tickets.",
          workload,
          claims: [
            {
              ...localClaim,
              citation: { ...localClaim.citation, path: "escape.md" },
            },
          ],
        },
        options,
      ),
    ).rejects.toThrow("outside the project");
    await expect(
      readFile(join(root, ".anvilmark", "project.yaml")),
    ).rejects.toThrow();
  });

  it("records agent options as discovered and reports unknown constraints until evidence exists", async () => {
    const root = await workspace();
    await draftDecisionBrief(
      root,
      {
        prompt: "Classify support tickets while keeping customer data local.",
        workload,
        claims: [localClaim],
      },
      options,
    );
    const proposed = await proposeDecisionOptions(
      root,
      {
        candidates: [
          {
            id: "local-model-a",
            workload_ref: "classification",
            component_kind: "model_runtime",
            model_family: "publisher/model-a",
            model_version: null,
            deployment_mode: "local",
            provider: null,
            rationale: "A possible local option",
          },
          {
            id: "managed-model-b",
            workload_ref: "classification",
            component_kind: "model_runtime",
            model_family: "Model B",
            model_version: null,
            deployment_mode: "managed_api",
            provider: "Example",
            rationale:
              "A possible managed option, conditional on data handling",
          },
        ],
      },
      options,
    );
    expect(proposed.source.state_revision).toBe(2);
    const loaded = await loadProject(root);
    expect(loaded.contract.candidates[0]).toMatchObject({
      id: "local-model-a",
      status: "discovered",
      measurements: {},
      constraint_results: [],
    });
    expect(loaded.contract.decisions).toEqual([]);
    const compared = await compareDecisionOptions(
      root,
      { workload: "classification" },
      options,
    );
    expect(compared.data.workloads[0]?.candidates[0]).toMatchObject({
      candidate_ref: "local-model-a",
      satisfied: [],
      failed: [],
      unknown: ["privacy.raw_ticket"],
    });
    expect(compared.data.workloads[0]?.candidates[1]).toMatchObject({
      candidate_ref: "managed-model-b",
      satisfied: [],
      failed: [],
      unknown: ["privacy.raw_ticket"],
    });
    expect(compared.source.state_revision).toBe(2);
    expect(compared.data.project_candidates).toEqual([]);

    const researched = await researchCandidateModel(
      root,
      { candidate_ref: "local-model-a" },
      {
        ...options,
        fetcher: (async () =>
          new Response(
            JSON.stringify({
              id: "publisher/model-a",
              evalResults: [
                {
                  verified: true,
                  data: { dataset: { id: "example/benchmark" }, value: 0.8 },
                },
              ],
            }),
            { status: 200 },
          )) as typeof fetch,
      },
    );
    expect(researched.source.state_revision).toBe(2);
    expect(researched.data).toMatchObject({
      status: "fresh",
      model_id: "publisher/model-a",
      result_count: 1,
      workload_quality: "unknown",
    });
    const withResearch = await compareDecisionOptions(
      root,
      { workload: "classification" },
      options,
    );
    expect(withResearch.data.catalog_research[0]).toMatchObject({
      candidate_ref: "local-model-a",
      status: "fresh",
      model_id: "publisher/model-a",
      result_count: 1,
      workload_quality: "unknown",
    });
    expect(withResearch.data.workloads[0]?.candidates[0]?.unknown).toEqual([
      "privacy.raw_ticket",
    ]);
    expect((await loadProject(root)).contract.evidence_refs).toEqual([]);
  });

  it("refuses an option that names an unknown workload without changing state", async () => {
    const root = await workspace();
    await draftDecisionBrief(
      root,
      { prompt: "Classify tickets.", workload, claims: [] },
      options,
    );
    await expect(
      proposeDecisionOptions(
        root,
        {
          candidates: [
            {
              id: "unmapped",
              workload_ref: "missing",
              component_kind: "model_runtime",
              model_family: "Model A",
              model_version: null,
              deployment_mode: "managed_api",
              provider: "Example",
              rationale: "Explore this option",
            },
          ],
        },
        options,
      ),
    ).rejects.toThrow();
    expect((await loadProject(root)).contract.candidates).toEqual([]);
  });

  it("refuses a catalog symlink outside the project before storing research", async () => {
    const root = await workspace();
    await draftDecisionBrief(
      root,
      { prompt: "Classify tickets.", workload, claims: [] },
      options,
    );
    await proposeDecisionOptions(
      root,
      {
        candidates: [
          {
            id: "model-a",
            workload_ref: "classification",
            component_kind: "model_runtime",
            model_family: "publisher/model-a",
            model_version: null,
            deployment_mode: "local",
            provider: null,
            rationale: "Explore exact Hub model",
          },
        ],
      },
      options,
    );
    const outside = await mkdtemp(join(tmpdir(), "anvilmark-catalog-outside-"));
    roots.push(outside);
    const external = join(outside, "catalog.sqlite");
    await writeFile(external, "untouched", "utf8");
    await symlink(external, join(root, ".anvilmark", "model-catalog.sqlite"));
    await expect(
      researchCandidateModel(
        root,
        { candidate_ref: "model-a" },
        {
          ...options,
          fetcher: (async () =>
            new Response(JSON.stringify({ id: "publisher/model-a" }), {
              status: 200,
            })) as typeof fetch,
        },
      ),
    ).rejects.toThrow("symbolic link");
    expect(await readFile(external, "utf8")).toBe("untouched");
  });
});
