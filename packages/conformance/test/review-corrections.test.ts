import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectContract } from "@anvilmark/project-contract";
import { appendApproval, unwrap } from "@anvilmark/project-contract";
import { contractHash } from "@anvilmark/context";
import { finalizeArtifact } from "@anvilmark/scanner";
import type { ScanArtifact } from "@anvilmark/scanner";
import {
  evaluateConformance,
  readReport,
  reportConformanceHash,
  resultRecordContentHash,
  runConformanceQuery,
  serializeReport,
} from "../src/index.js";
import {
  ATLAS_COMPONENTS,
  approvedLocal,
  approvedRemote,
  cleanup,
  declarations,
  materialize,
  scan,
} from "./helpers.js";

afterEach(cleanup);
const stamp = "2026-09-15T12:00:00Z";
const evaluate = (contract: ProjectContract, artifact: ScanArtifact) =>
  evaluateConformance({ contract, scan: artifact, evaluatedAt: stamp });
const flow = (report: ReturnType<typeof evaluate>) =>
  report.results.find((r) => r.rule_kind === "forbid_dataflow")!;
const provider = (report: ReturnType<typeof evaluate>) =>
  report.results.find((r) => r.rule_kind === "approved_candidate_only")!;
const renew = (contract: ProjectContract) =>
  unwrap(
    appendApproval(contract, {
      decisionId: "decision.classification",
      actorRef: "synthetic-regression",
      approvedAt: stamp,
    }),
  );
function rehash(artifact: ScanArtifact) {
  const { content_hash, observation, ...content } = artifact;
  void content_hash;
  return finalizeArtifact(content, observation);
}

async function subject(source?: string) {
  const contract = await approvedRemote();
  const root = await materialize("handoff-approved-sanitized");
  if (source) await writeFile(join(root, "src/classify.ts"), source);
  return { contract, root, artifact: scan(root, contract) };
}
const prelude =
  'import OpenAI from "openai";\nimport {readTicket} from "./tickets";\nimport {redactTicket} from "./redact";\nconst client = new OpenAI();\n';
const send = (data: string, model = '"gpt-4o-mini-2024-07-18"') =>
  `client.chat.completions.create({model:${model},messages:[{role:"user",content:${data}}]})`;

describe("M6 review corrections: rule semantics and failure boundaries", () => {
  it("rejects a different literal model despite the approved sink candidate label", async () => {
    const { contract, artifact } = await subject(
      prelude +
        `export function classifyTicket(id:string){return ${send("redactTicket(readTicket(id))", '"gpt-4o"')}}`,
    );
    expect(provider(evaluate(contract, artifact))).toMatchObject({
      verdict: "fail",
    });
    expect(provider(evaluate(contract, artifact)).explanation).toContain(
      "candidate_model_mismatch",
    );
  });
  it("requires a concrete approved model identity and current approval", async () => {
    const { contract, root } = await subject();
    contract.candidates.find((c) => c.id.endsWith("remote_unselected"))!.model =
      null;
    const renewed = renew(contract);
    expect(
      provider(evaluate(renewed, scan(root, renewed))).unknown_reasons,
    ).toContain("candidate_model_unspecified");
    renewed.approvals = [];
    expect(provider(evaluate(renewed, scan(root, renewed))).verdict).toBe(
      "unknown",
    );
  });
  it("does not verify an overridden SDK endpoint", async () => {
    const { contract, artifact } = await subject(
      prelude.replace(
        "new OpenAI()",
        'new OpenAI({baseURL:"https://example.invalid"})',
      ) +
        `export function classifyTicket(id:string){return ${send("readTicket(id)")}}`,
    );
    expect(provider(evaluate(contract, artifact)).verdict).toBe("unknown");
    expect(flow(evaluate(contract, artifact)).verdict).toBe("unknown");
  });
  it("does not resurrect an approved historical decision when the workload has no current decision", async () => {
    const { contract, root } = await subject();
    contract.workloads.find(
      (w) => w.id === "classification",
    )!.current_decision_ref = null;
    expect(provider(evaluate(contract, scan(root, contract))).verdict).toBe(
      "unknown",
    );
  });
  it("does not silently exclude unbound dynamic provider operations in another source file", async () => {
    const { contract, root } = await subject();
    await writeFile(
      join(root, "src/unbound.ts"),
      "export async function dispatch(path:string){const provider=await import(path);return provider.run();}",
    );
    expect(provider(evaluate(contract, scan(root, contract))).verdict).toBe(
      "unknown",
    );
  });
  it("evaluates provider allowlists against the observed identity", async () => {
    const { contract, root } = await subject();
    contract.conformance_rules = contract.conformance_rules.filter(
      (r) => r.kind === "forbid_dataflow",
    );
    contract.conformance_rules.push({
      id: "rule.allowlist",
      kind: "provider_allowlist",
      workload_ref: "classification",
      severity: "error",
      allowed_candidate_refs: ["candidate.classification.local_unselected"],
    });
    expect(
      evaluate(contract, scan(root, contract)).results.find(
        (r) => r.rule_kind === "provider_allowlist",
      )?.verdict,
    ).toBe("fail");
  });
  it("does not accept a different sanitizer architecture node", async () => {
    const { contract, root } = await subject();
    const config = declarations(ATLAS_COMPONENTS);
    config.sanitizers[0]!.architecture_node_ref = "ticket-classifier";
    const result = flow(evaluate(contract, scan(root, contract, config)));
    expect(result.verdict).toBe("fail");
    expect(result.trace.some((s) => s.kind === "sanitizer")).toBe(true);
  });
  it("forbids an explicitly banned output classification even when tagged sanitized", async () => {
    const { contract, root } = await subject();
    const rule = contract.conformance_rules.find(
      (r) => r.kind === "forbid_dataflow",
    )!;
    rule.from.data_classification = "redacted_customer_ticket";
    rule.unless = null;
    expect(flow(evaluate(contract, scan(root, contract))).verdict).toBe("fail");
  });
  it("does not allow generic sanitization when the rule has no exception", async () => {
    const { contract, root } = await subject();
    contract.conformance_rules.find(
      (r) => r.kind === "forbid_dataflow",
    )!.unless = null;
    expect(flow(evaluate(contract, scan(root, contract))).verdict).toBe("fail");
  });
  it("checks every required sanitizer rather than accepting one member of the list", async () => {
    const { contract, root } = await subject();
    contract.conformance_rules
      .find((r) => r.kind === "forbid_dataflow")!
      .unless!.passes_through.push({ component_ref: "ticket-classifier" });
    expect(flow(evaluate(contract, scan(root, contract))).verdict).toBe("fail");
  });
  it("preserves a proven violation beside runtime dispatch and a compliant path", async () => {
    const { contract, artifact } = await subject(
      prelude +
        `export async function classifyTicket(id:string,path:string){const ticket=readTicket(id);await ${send("ticket")};await ${send("redactTicket(ticket)")};const other=await import(path);return other.classify(ticket);}`,
    );
    const result = flow(evaluate(contract, artifact));
    expect(result.verdict).toBe("fail");
    expect(result.trace.map((s) => s.kind)).not.toContain("sanitizer");
    expect(result.unknown_reasons.length).toBeGreaterThan(0);
  });
  it("preserves a known provider violation beside an unknown call", async () => {
    const { root } = await subject(
      prelude +
        `export async function classifyTicket(id:string,path:string){await ${send("readTicket(id)")};const other=await import(path);return other.classify(id);}`,
    );
    const contract = await approvedLocal();
    expect(provider(evaluate(contract, scan(root, contract))).verdict).toBe(
      "fail",
    );
  });
  it("treats unclassified unknown target inputs as unknown", async () => {
    const { contract, artifact } = await subject(
      prelude +
        `export function classifyTicket(payload:any){return ${send("payload")}}`,
    );
    expect(artifact.data_flows[0]?.status).toBe("unresolved");
    expect(flow(evaluate(contract, artifact)).verdict).toBe("unknown");
  });
  it("never calls an unresolved declared source compliant", async () => {
    const { contract, root } = await subject();
    const cfg = declarations(ATLAS_COMPONENTS);
    cfg.sources[0]!.function!.export = "missingExport";
    expect(
      evaluate(contract, scan(root, contract, cfg)).summary.compliant,
    ).toBe(false);
  });
  it("separates parser errors from rule verdicts", async () => {
    const { contract, root } = await subject();
    await writeFile(join(root, "src/broken.ts"), "export const x = ;");
    const report = evaluate(contract, scan(root, contract));
    expect(report.analysis_errors.length).toBeGreaterThan(0);
    expect(report.results).toEqual([]);
    expect(report.summary.compliant).toBe(false);
    expect(readReport(serializeReport(report))).toEqual(report);
  });
  it("does not infer non-applicability from inventory limits", async () => {
    const { contract, root } = await subject();
    const artifact = scan(root, contract, declarations(ATLAS_COMPONENTS), {
      maxFileBytes: 1,
    });
    expect(artifact.limits.length).toBeGreaterThan(0);
    expect(evaluate(contract, artifact).summary.compliant).toBe(false);
  });
  it("does not use superseded raw contexts as violations or as the chosen trace", async () => {
    const { contract, artifact } = await subject();
    const raw = structuredClone(artifact.data_flows[0]!.contexts[0]!);
    raw.id += ".superseded";
    raw.superseded = true;
    raw.facts[0]!.state = "raw";
    raw.facts[0]!.classification = "raw_customer_ticket";
    artifact.data_flows[0]!.contexts.unshift(raw);
    const result = flow(evaluate(contract, rehash(artifact)));
    expect(result.verdict).toBe("pass");
    expect(result.trace.map((t) => t.kind)).toContain("sanitizer");
  });
});

describe("M6 review corrections: identity and projections", () => {
  it("refuses stale contracts and keeps every nested hash valid", async () => {
    const { contract, artifact } = await subject();
    contract.project.name += " changed";
    const report = evaluate(contract, artifact);
    expect(report.summary.compliant).toBe(false);
    expect(report.contract.contract_hash).toBe(contractHash(contract));
    for (const result of report.results) {
      expect(result.verdict).toBe("unknown");
      expect(result.content_hash).toBe(resultRecordContentHash(result));
    }
    expect(readReport(serializeReport(report))).toEqual(report);
  });
  it("normalizes observation/evaluation time but preserves actual state revision", async () => {
    const { contract, artifact } = await subject();
    const first = evaluateConformance({
      contract,
      scan: artifact,
      stateRevision: 71,
      evaluatedAt: stamp,
    });
    artifact.observation.observed_at = "2026-09-16T00:00:00Z";
    const later = evaluateConformance({
      contract,
      scan: artifact,
      stateRevision: 71,
      evaluatedAt: "2026-09-17T00:00:00Z",
    });
    expect(first.conformance_hash).toBe(later.conformance_hash);
    expect(later.contract.state_revision).toBe(71);
    expect(first.results.map((r) => r.id)).toEqual(
      later.results.map((r) => r.id),
    );
  });
  it("makes scanner/configuration changes change result IDs and report identity", async () => {
    const { contract, root, artifact } = await subject();
    const first = evaluate(contract, artifact);
    const cfg = declarations(ATLAS_COMPONENTS);
    cfg.exclude.push("**/unused/**");
    const second = evaluate(contract, scan(root, contract, cfg));
    expect(second.conformance_hash).not.toBe(first.conformance_hash);
    expect(second.results[0]!.id).not.toBe(first.results[0]!.id);
  });
  it("detects nested hash and summary tampering even if the outer hash is recomputed", async () => {
    const { contract, artifact } = await subject();
    const report = evaluate(contract, artifact);
    report.results[0]!.explanation = "altered";
    report.conformance_hash = reportConformanceHash(report);
    expect(() => readReport(serializeReport(report))).toThrow(
      /result content hash mismatch/,
    );
    const summary = evaluate(contract, artifact);
    summary.summary.compliant = false;
    summary.conformance_hash = reportConformanceHash(summary);
    expect(() => readReport(serializeReport(summary))).toThrow(/summary/);
  });
  it("refuses obsolete report and scanner versions", async () => {
    const { contract, artifact } = await subject();
    const report = evaluate(contract, artifact);
    expect(() =>
      readReport(
        serializeReport(report).replaceAll(
          "anvilmark-conformance-report/0.1.0-draft.2",
          "anvilmark-conformance-report/0.1.0-draft.1",
        ),
      ),
    ).toThrow();
    artifact.scanner.version = "old";
    expect(evaluate(contract, rehash(artifact)).summary.compliant).toBe(false);
  });
  it("projects all conformance records and detailed lookups without local paths or traces", async () => {
    const { contract, artifact } = await subject();
    const ctx = {
      contract,
      scan: artifact,
      stateRevision: null,
      asOf: stamp,
      projection: "remote-default" as const,
    };
    const remote = runConformanceQuery("run_conformance", {}, ctx);
    expect(JSON.stringify(remote)).not.toContain("src/classify.ts");
    expect(JSON.stringify(remote)).not.toContain('"trace"');
    const id = evaluate(contract, artifact).results[0]!.id;
    expect(
      JSON.stringify(
        runConformanceQuery("get_conformance_result", { result_id: id }, ctx),
      ),
    ).not.toContain("src/classify.ts");
    expect(
      JSON.stringify(
        runConformanceQuery(
          "run_conformance",
          {},
          { ...ctx, projection: "local-disclosed" },
        ),
      ),
    ).toContain("src/classify.ts");
  });
  it("checks existing selected files against actual repository rules and refuses invalid arguments", async () => {
    const { contract, artifact } = await subject(
      prelude +
        `export function classifyTicket(id:string){return ${send("readTicket(id)")}}`,
    );
    const ctx = {
      contract,
      scan: artifact,
      stateRevision: null,
      asOf: stamp,
      projection: "local-disclosed" as const,
    };
    const result = runConformanceQuery(
      "check_proposed_change",
      { files: ["src/classify.ts"] },
      ctx,
    );
    expect(result).toMatchObject({
      ok: true,
      data: { compliant: false, files_checked: ["src/classify.ts"] },
    });
    for (const args of [
      { files: ["missing.ts"] },
      { files: ["../escape.ts"] },
      { files: [12] },
      { files: [] },
      { workload: "missing", candidate_ref: "missing" },
      {},
    ])
      expect(runConformanceQuery("check_proposed_change", args, ctx).ok).toBe(
        false,
      );
    expect(
      runConformanceQuery("run_conformance", { workload: 17 }, ctx).ok,
    ).toBe(false);
    expect(
      runConformanceQuery(
        "check_proposed_change",
        { files: ["src/classify.ts"] },
        { ...ctx, scan: null },
      ),
    ).toMatchObject({ data: { summary: { compliant: false } } });
  });
  it("does not claim file analysis for candidate-only comparisons", async () => {
    const { contract, artifact } = await subject();
    const query = runConformanceQuery(
      "check_proposed_change",
      {
        workload: "classification",
        candidate_ref: "candidate.classification.remote_unselected",
      },
      {
        contract,
        scan: artifact,
        stateRevision: null,
        asOf: stamp,
        projection: "remote-default",
      },
    );
    expect(query).toMatchObject({
      data: { scope: "candidate_policy_only", verdict: "pass" },
    });
    expect(JSON.stringify(query)).not.toContain("files_checked");
  });
});
