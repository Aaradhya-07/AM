"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { buildAgentBrief } from "@anvilmark/conformance/review";
import type {
  ReviewEvidenceGap,
  ReviewResult,
} from "@anvilmark/conformance/review";

type ModelChoice = "different" | "selected" | "dynamic";
type DataChoice = "raw" | "redacted";
type TabId = "review" | "decision" | "checks" | "changes" | "handoff";

interface CheckApiResponse {
  report: {
    contract: {
      project_id: string;
      contract_revision: number;
      contract_hash: string;
    };
    results: ReviewResult[];
  };
  modelVerdict: "pass" | "fail" | "unknown" | "not_applicable";
  privacyVerdict: "pass" | "fail" | "unknown" | "not_applicable";
  modelPassed: boolean;
  privacyPassed: boolean;
  source: string;
  traces: string[];
  evidenceGaps: ReviewEvidenceGap[];
  evidenceGap: {
    requiredF1: number;
    measuredF1: number | null;
    status: string;
    budget: number;
    explanation: string;
  };
}

interface CheckErrorResponse {
  error?: string;
  analysisErrors?: string[];
}

export function PlaygroundClient() {
  const [model, setModel] = useState<ModelChoice>("different");
  const [dataHandling, setDataHandling] = useState<DataChoice>("raw");
  const [activeTab, setActiveTab] = useState<TabId>("review");

  // The checked state corresponds to what was last evaluated
  const [checkedModel, setCheckedModel] = useState<ModelChoice>("different");
  const [checkedDataHandling, setCheckedDataHandling] =
    useState<DataChoice>("raw");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Verdicts only ever come from the engine. Until a check succeeds there is
  // no result, and a failed check shows its error instead of a guess.
  const [result, setResult] = useState<CheckApiResponse | null>(null);
  const [checkErrors, setCheckErrors] = useState<string[] | null>(null);

  const isStale =
    model !== checkedModel || dataHandling !== checkedDataHandling;

  const runCheck = useCallback(async (m: ModelChoice, d: DataChoice) => {
    setLoading(true);
    try {
      const response = await fetch("/api/playground/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: m, dataHandling: d }),
      });
      if (response.ok) {
        const data: CheckApiResponse = await response.json();
        setResult(data);
        setCheckedModel(m);
        setCheckedDataHandling(d);
        setCheckErrors(null);
      } else {
        const body = (await response
          .json()
          .catch(() => ({}))) as CheckErrorResponse;
        setCheckErrors(
          body.analysisErrors && body.analysisErrors.length > 0
            ? body.analysisErrors
            : [body.error ?? `The check service returned ${response.status}.`],
        );
      }
    } catch {
      setCheckErrors(["Could not reach the check service."]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial evaluation
    runCheck("different", "raw");
  }, [runCheck]);

  const mp = result?.modelVerdict === "pass";
  const rp = result?.privacyVerdict === "pass";
  // Code checks only. Measured quality is a separate status and stays a gap.
  const codeStatus = !result
    ? null
    : [result.modelVerdict, result.privacyVerdict].includes("fail")
      ? "fail"
      : [result.modelVerdict, result.privacyVerdict].includes("unknown")
        ? "unknown"
        : "pass";

  // The same brief Studio builds for a real bundle, from this check's results.
  const handoffText = result
    ? buildAgentBrief({
        project: {
          id: result.report.contract.project_id,
          name: "Atlas Support Desk (synthetic example)",
          contract_revision: result.report.contract.contract_revision,
          contract_hash: result.report.contract.contract_hash,
        },
        results: result.report.results,
        evidenceGaps: result.evidenceGaps,
      })
    : "";

  const copyBrief = () => {
    navigator.clipboard.writeText(handoffText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-[108rem] px-5 py-8 sm:px-8">
      {/* 1. Context & Baseline Banner */}
      <div className="mb-6 rounded border border-line-muted bg-surface/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
              Recorded Architectural Baseline
            </span>
            <h2 className="mt-1 text-lg font-medium text-canvas">
              Atlas Support Desk · Workload: Ticket Classification
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-sand/80">
              Classify 40,000 tickets/mo. The recorded contract selects{" "}
              <strong className="font-mono text-gold">GPT-4o mini</strong>{" "}
              (2024-07-18) and requires ticket data to pass through the declared
              local redactor before remote transmission.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/studio?example=atlas"
              className="rounded border border-line-muted bg-surface px-3 py-1.5 text-xs text-sand transition-colors hover:border-gold hover:text-gold"
            >
              Open an exported Atlas bundle in Studio →
            </Link>
          </div>
        </div>
      </div>

      {/* 2. Interactive Control Strip */}
      <div className="mb-6 rounded border border-line-muted bg-surface p-4">
        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-between gap-4">
          <div className="flex w-full flex-wrap items-center gap-4 sm:w-auto sm:gap-6">
            <label className="flex w-full min-w-0 items-center gap-2 text-sm text-sand/90 sm:w-auto">
              <span className="shrink-0 font-medium text-canvas">Model:</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as ModelChoice)}
                className="min-w-0 flex-1 rounded border border-line-muted bg-[#121415] px-3 py-1.5 text-sm text-canvas outline-none focus:border-gold sm:flex-initial"
              >
                <option value="different">Different model (gpt-4o)</option>
                <option value="selected">
                  Selected model (gpt-4o-mini-2024-07-18)
                </option>
                <option value="dynamic">
                  Dynamic runtime (process.env.MODEL)
                </option>
              </select>
            </label>

            <label className="flex w-full min-w-0 items-center gap-2 text-sm text-sand/90 sm:w-auto">
              <span className="shrink-0 font-medium text-canvas">
                Data Handling:
              </span>
              <select
                value={dataHandling}
                onChange={(e) => setDataHandling(e.target.value as DataChoice)}
                className="min-w-0 flex-1 rounded border border-line-muted bg-[#121415] px-3 py-1.5 text-sm text-canvas outline-none focus:border-gold sm:flex-initial"
              >
                <option value="raw">Raw ticket text</option>
                <option value="redacted">Declared local redactor output</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {isStale && (
              <span className="text-xs text-[#fbbf24]">
                Selections changed · Re-check to update
              </span>
            )}
            <button
              type="button"
              disabled={loading}
              onClick={() => runCheck(model, dataHandling)}
              className="inline-flex items-center gap-2 rounded bg-gold px-4 py-1.5 text-sm font-semibold text-[#111210] transition-colors hover:bg-gold/90 disabled:opacity-50"
            >
              {loading ? "Checking engine..." : "Check this change"}
            </button>
          </div>
        </div>
      </div>

      {checkErrors && (
        <div
          role="alert"
          className="mb-6 rounded border border-[#592323] bg-[#2e1313] p-4 text-sm text-[#f87171]"
        >
          <h3 className="font-medium">
            The engine did not produce a result for this check
          </h3>
          <p className="mt-1 text-xs text-[#f87171]/80">
            No verdict is shown for it.
            {result
              ? " The results below are from your last successful check."
              : ""}
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 font-mono text-xs">
            {checkErrors.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 3. Main Review Cockpit Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Navigation Sidebar */}
        <nav aria-label="Workspace views" className="space-y-1.5 lg:col-span-3">
          {[
            { id: "review", label: "Review Overview" },
            { id: "decision", label: "Decision & Evidence" },
            { id: "checks", label: "Code Checks & Trace" },
            { id: "changes", label: "Snapshot Changes" },
            { id: "handoff", label: "Agent Action Brief" },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as TabId)}
                className={`flex w-full items-center justify-between rounded border px-3.5 py-2.5 text-left text-sm font-medium transition-colors ${
                  active
                    ? "border-gold bg-[#182026] text-gold shadow-[inset_3px_0_0_0_#D08D2E]"
                    : "border-line-muted bg-surface/80 text-sand hover:border-gold/50"
                }`}
              >
                <span>{tab.label}</span>
                {tab.id === "review" && codeStatus && (
                  <span className="flex flex-wrap justify-end gap-1">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        codeStatus === "pass"
                          ? "bg-[#14532d] text-[#4ade80]"
                          : codeStatus === "unknown"
                            ? "bg-[#3e2c0e] text-[#fbbf24]"
                            : "bg-[#451a1a] text-[#f87171]"
                      }`}
                    >
                      {codeStatus === "pass"
                        ? "Code checks pass"
                        : codeStatus === "unknown"
                          ? "Unresolved"
                          : "Violations"}
                    </span>
                    <span className="rounded bg-[#3e2c0e] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#fbbf24]">
                      Evidence gap
                    </span>
                  </span>
                )}
              </button>
            );
          })}

          <div className="mt-6 rounded border border-line-muted bg-surface/40 p-3.5 text-xs text-sand/70">
            <p className="font-semibold uppercase tracking-wider text-steel">
              Analysis Boundaries
            </p>
            <p className="mt-1.5 leading-relaxed">
              Real engine worker execution. Evaluated via @anvilmark/scanner and
              @anvilmark/conformance without arbitrary execution or live model
              calls.
            </p>
          </div>
        </nav>

        {/* View Details Area */}
        <div className="rounded border border-line-muted bg-surface p-6 lg:col-span-9">
          {result === null ? (
            <p className="text-sm text-sand/70">
              {loading
                ? "Running the scanner and conformance engine on the Atlas example…"
                : "No engine result yet. Choose a variant and run the check."}
            </p>
          ) : (
            <>
              {/* TAB 1: REVIEW OVERVIEW */}
              {activeTab === "review" && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-medium text-canvas">
                      What needs your attention?
                    </h3>
                    <p className="mt-1 text-sm text-sand/70">
                      Current evaluation against the recorded Atlas contract.
                    </p>
                  </div>

                  {isStale && (
                    <div className="rounded border border-[#78350f] bg-[#291e0a] p-3 text-xs text-[#fbbf24]">
                      <strong>Pending changes:</strong> You modified the model
                      or data handling. Click &ldquo;Check this change&rdquo;
                      above to re-run the real engine.
                    </div>
                  )}

                  <div className="divide-y divide-line-muted rounded border border-line-muted bg-ink/40">
                    {/* Item 1: Model check */}
                    <div className="flex flex-wrap items-center justify-between gap-4 p-4">
                      <div>
                        <h4 className="font-medium text-canvas">
                          {result.modelVerdict === "pass"
                            ? "The code uses the selected model"
                            : result.modelVerdict === "unknown"
                              ? "Model selection is dynamic / unresolved"
                              : "The code uses an unselected model"}
                        </h4>
                        <p className="mt-0.5 text-xs text-sand/60">
                          Workload: Classification · Rule: Model candidate
                          binding · Target: gpt-4o-mini-2024-07-18
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded px-2.5 py-1 text-xs font-semibold uppercase ${
                            result.modelVerdict === "pass"
                              ? "bg-[#14532d] text-[#4ade80]"
                              : result.modelVerdict === "unknown"
                                ? "bg-[#3e2c0e] text-[#fbbf24]"
                                : "bg-[#451a1a] text-[#f87171]"
                          }`}
                        >
                          {result.modelVerdict}
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveTab("checks")}
                          className="text-xs text-gold hover:underline"
                        >
                          Inspect code →
                        </button>
                      </div>
                    </div>

                    {/* Item 2: Data redaction check */}
                    <div className="flex flex-wrap items-center justify-between gap-4 p-4">
                      <div>
                        <h4 className="font-medium text-canvas">
                          {result.privacyVerdict === "pass"
                            ? "Customer ticket text is routed through declared redactor"
                            : result.privacyVerdict === "fail"
                              ? "Raw customer ticket text reaches remote model call"
                              : "Whether raw ticket text reaches the model call is unresolved"}
                        </h4>
                        <p className="mt-0.5 text-xs text-sand/60">
                          Constraint: Raw ticket confidentiality · Rule:
                          forbid_dataflow
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded px-2.5 py-1 text-xs font-semibold uppercase ${
                            result.privacyVerdict === "pass"
                              ? "bg-[#14532d] text-[#4ade80]"
                              : result.privacyVerdict === "fail"
                                ? "bg-[#451a1a] text-[#f87171]"
                                : "bg-[#3e2c0e] text-[#fbbf24]"
                          }`}
                        >
                          {result.privacyVerdict}
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveTab("checks")}
                          className="text-xs text-gold hover:underline"
                        >
                          Inspect trace →
                        </button>
                      </div>
                    </div>

                    {/* Item 3: Quality Evidence Status */}
                    <div className="flex flex-wrap items-center justify-between gap-4 p-4">
                      <div>
                        <h4 className="font-medium text-[#fbbf24]">
                          Classification quality has not been measured
                        </h4>
                        <p className="mt-0.5 text-xs text-sand/60">
                          Requirement: F1 ≥ 0.90 (mandatory) · No empirical
                          benchmark attached to contract
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="rounded bg-[#3e2c0e] px-2.5 py-1 text-xs font-semibold uppercase text-[#fbbf24]">
                          Evidence Gap
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveTab("decision")}
                          className="text-xs text-gold hover:underline"
                        >
                          View evidence →
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab("handoff")}
                      className="rounded bg-gold px-4 py-2 text-sm font-semibold text-[#111210] transition-colors hover:bg-gold/90"
                    >
                      View agent prompt brief
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("decision")}
                      className="rounded border border-line-muted bg-surface px-4 py-2 text-sm text-sand transition-colors hover:border-gold"
                    >
                      Inspect decision requirements
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 2: DECISION & EVIDENCE */}
              {activeTab === "decision" && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-medium text-canvas">
                      Why this choice, and what supports it?
                    </h3>
                    <p className="mt-1 text-sm text-sand/70">
                      Recorded architectural choices, constraint domains, and
                      unmeasured gaps.
                    </p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-line-muted text-xs uppercase tracking-wider text-steel">
                          <th className="pb-3 font-medium">Requirement</th>
                          <th className="pb-3 font-medium">Recorded Target</th>
                          <th className="pb-3 font-medium">Severity</th>
                          <th className="pb-3 font-medium">
                            Evidence Standing
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line-muted">
                        <tr>
                          <td className="py-3 font-medium text-canvas">
                            Classification Quality
                          </td>
                          <td className="py-3 text-sand/80">F1 ≥ 0.90</td>
                          <td className="py-3 text-xs text-red-400">
                            Hard (Mandatory)
                          </td>
                          <td className="py-3 text-xs font-medium text-[#fbbf24]">
                            Unmeasured · Missing
                          </td>
                        </tr>
                        <tr>
                          <td className="py-3 font-medium text-canvas">
                            Monthly AI Cost
                          </td>
                          <td className="py-3 text-sand/80">≤ $750 / mo</td>
                          <td className="py-3 text-xs text-steel">
                            Soft (Preference)
                          </td>
                          <td className="py-3 text-xs text-[#fbbf24]">
                            No projection recorded
                          </td>
                        </tr>
                        <tr>
                          <td className="py-3 font-medium text-canvas">
                            Raw Ticket Confidentiality
                          </td>
                          <td className="py-3 text-sand/80">
                            Local redactor before remote call
                          </td>
                          <td className="py-3 text-xs text-red-400">
                            Hard (Mandatory)
                          </td>
                          <td
                            className={`py-3 text-xs ${
                              result.privacyVerdict === "pass"
                                ? "text-[#4ade80]"
                                : result.privacyVerdict === "fail"
                                  ? "text-[#f87171]"
                                  : "text-[#fbbf24]"
                            }`}
                          >
                            {result.privacyVerdict === "pass"
                              ? "Passes the static data-flow check"
                              : result.privacyVerdict === "fail"
                                ? "Fails the static data-flow check"
                                : "Static data-flow check is inconclusive"}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-3 font-medium text-canvas">
                            Redactor Effectiveness
                          </td>
                          <td className="py-3 text-sand/80">
                            PII Recall ≥ 0.98
                          </td>
                          <td className="py-3 text-xs text-red-400">
                            Hard (Mandatory)
                          </td>
                          <td className="py-3 text-xs text-[#fbbf24]">
                            Not established by code checks
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold uppercase tracking-wider text-steel">
                      Declared Architecture Path
                    </h4>
                    <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-xs">
                      <span className="rounded border border-line-muted bg-ink/60 px-3 py-1.5 text-sand">
                        ticket-intake
                      </span>
                      <span className="text-steel">→</span>
                      <span className="rounded border border-line-muted bg-ink/60 px-3 py-1.5 text-sand">
                        pii-redactor (local)
                      </span>
                      <span className="text-steel">→</span>
                      <span className="rounded border border-line-muted bg-ink/60 px-3 py-1.5 text-sand">
                        ticket-classifier
                      </span>
                      <span className="text-steel">→</span>
                      <span className="rounded border border-line-muted bg-ink/60 px-3 py-1.5 text-sand">
                        remote-model-provider
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-sand/60">
                      This flow represents design intent declared in the
                      contract. The observed trace in Code Checks describes what
                      the scanner detected in source.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 3: CODE CHECKS & TRACE */}
              {activeTab === "checks" && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-medium text-canvas">
                      Does this code follow the decision?
                    </h3>
                    <p className="mt-1 text-sm text-sand/70">
                      Inspect generated source code, observed call sites, and
                      AST trace.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {/* Source Code */}
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-xs text-sand/60">
                          src/classify.ts
                        </span>
                        <span className="text-xs text-steel">
                          TypeScript AST
                        </span>
                      </div>
                      <pre className="overflow-x-auto rounded border border-line-muted bg-[#0a0c0e] p-4 font-mono text-xs leading-relaxed text-sand/90">
                        {result.source}
                      </pre>
                    </div>

                    {/* Analysis Trace & Results */}
                    <div className="space-y-4">
                      <div className="rounded border border-line-muted bg-ink/40 p-4">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-steel">
                          Ordered Data-Flow Trace
                        </h4>
                        <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-xs">
                          {result.traces.map((step, idx) => (
                            <span
                              key={`${step}-${idx}`}
                              className="flex items-center gap-2"
                            >
                              <span
                                className={`rounded px-2.5 py-1 ${
                                  step === "sanitizer"
                                    ? "bg-[#14532d] text-[#4ade80]"
                                    : "border border-line-muted bg-surface text-sand"
                                }`}
                              >
                                {step}
                              </span>
                              {idx < result.traces.length - 1 && (
                                <span className="text-steel">→</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="rounded border border-line-muted bg-ink/40 p-4">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-steel">
                          Findings Summary
                        </h4>
                        <ul className="mt-2 space-y-2 text-xs">
                          <li className="flex items-center justify-between">
                            <span className="text-sand/80">
                              Model candidate check:
                            </span>
                            <span
                              className={`font-semibold uppercase ${
                                result.modelVerdict === "pass"
                                  ? "text-[#4ade80]"
                                  : result.modelVerdict === "unknown"
                                    ? "text-[#fbbf24]"
                                    : "text-[#f87171]"
                              }`}
                            >
                              {result.modelVerdict}
                            </span>
                          </li>
                          <li className="flex items-center justify-between">
                            <span className="text-sand/80">
                              Confidentiality dataflow:
                            </span>
                            <span
                              className={`font-semibold uppercase ${
                                result.privacyVerdict === "pass"
                                  ? "text-[#4ade80]"
                                  : "text-[#f87171]"
                              }`}
                            >
                              {result.privacyVerdict}
                            </span>
                          </li>
                        </ul>
                      </div>

                      <div className="rounded border border-line-muted bg-surface/40 p-3 text-xs leading-relaxed text-sand/70">
                        <strong>Coverage limitation:</strong> The data-flow
                        check proves that the declared sanitizer function sits
                        on the data path before the remote call. It does not
                        certify model quality or benchmark PII recall.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: SNAPSHOT CHANGES */}
              {activeTab === "changes" && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-medium text-canvas">
                      What changed between snapshots?
                    </h3>
                    <p className="mt-1 text-sm text-sand/70">
                      Compare initial non-conforming baseline against your
                      current preview.
                    </p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-line-muted text-xs uppercase tracking-wider text-steel">
                          <th className="pb-3 font-medium">Review Item</th>
                          <th className="pb-3 font-medium">
                            Before (Baseline)
                          </th>
                          <th className="pb-3 font-medium">Current Preview</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line-muted">
                        <tr>
                          <td className="py-3 font-medium text-canvas">
                            Model Candidate Check
                          </td>
                          <td className="py-3 text-xs font-semibold uppercase text-[#f87171]">
                            Fail
                          </td>
                          <td className="py-3">
                            <span
                              className={`text-xs font-semibold uppercase ${
                                mp
                                  ? "text-[#4ade80]"
                                  : result.modelVerdict === "unknown"
                                    ? "text-[#fbbf24]"
                                    : "text-[#f87171]"
                              }`}
                            >
                              {result.modelVerdict}
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td className="py-3 font-medium text-canvas">
                            Data-Flow Redaction Check
                          </td>
                          <td className="py-3 text-xs font-semibold uppercase text-[#f87171]">
                            Fail
                          </td>
                          <td className="py-3">
                            <span
                              className={`text-xs font-semibold uppercase ${
                                rp ? "text-[#4ade80]" : "text-[#f87171]"
                              }`}
                            >
                              {result.privacyVerdict}
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td className="py-3 font-medium text-canvas">
                            Quality Evidence (F1 ≥ 0.90)
                          </td>
                          <td className="py-3 text-xs font-semibold uppercase text-[#fbbf24]">
                            Missing
                          </td>
                          <td className="py-3 text-xs font-semibold uppercase text-[#fbbf24]">
                            Still missing
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <p className="text-xs text-sand/60">
                    In real projects, changes in policy or rule scope are
                    tracked separately. Removing a rule or shrinking scan
                    boundaries is never counted as a resolved violation.
                  </p>
                </div>
              )}

              {/* TAB 5: AGENT ACTION BRIEF */}
              {activeTab === "handoff" && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-medium text-canvas">
                      Take a precise next step with your coding agent
                    </h3>
                    <p className="mt-1 text-sm text-sand/70">
                      Copy this exact, bounded prompt into Claude Code or Codex.
                    </p>
                  </div>

                  <div className="relative">
                    <pre className="overflow-x-auto rounded border border-line-muted bg-[#080a08] p-5 font-mono text-xs leading-relaxed text-sand">
                      {handoffText}
                    </pre>
                    <button
                      type="button"
                      onClick={copyBrief}
                      className="absolute right-3 top-3 rounded bg-gold px-3 py-1.5 text-xs font-semibold text-[#111210] transition-colors hover:bg-gold/90"
                    >
                      {copied ? "Copied to clipboard!" : "Copy Prompt"}
                    </button>
                  </div>

                  <p className="text-xs text-sand/60">
                    ANVILMARK does not execute agent calls on the server or send
                    autonomous instructions. You preview and copy the brief to
                    run in your local terminal.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
