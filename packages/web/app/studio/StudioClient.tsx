"use client";

import { HardwareSizingCockpit } from "../components/HardwareSizingCockpit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  buildAgentBrief,
  collectEvidenceGaps,
} from "@anvilmark/conformance/review";
import {
  verifyBundleInBrowser,
  type WebReviewEnvelope,
} from "../../lib/review-bundle";
import {
  CodeAndEvidence,
  EvidenceGapTable,
  ResultDetails,
  StatusDimensions,
} from "./review-panels";
import { SnapshotComparison } from "./snapshot-diff";

export type StudioTab =
  "review" | "decision" | "checks" | "changes" | "handoff";

/** A shareable bundle exported from the synthetic Atlas fixtures. */
export const ATLAS_EXAMPLE_PATH = "/examples/atlas-review-bundle.json";

function formatConstraintValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export interface StudioClientProps {
  /** A bundle that has already been verified, such as a bundled example. */
  readonly initialBundle?: WebReviewEnvelope | null;
  readonly initialTab?: StudioTab;
  readonly autoLoadExample?: boolean;
}

export function StudioClient({
  initialBundle = null,
  initialTab = "review",
  autoLoadExample = false,
}: StudioClientProps) {
  const [bundle, setBundle] = useState<WebReviewEnvelope | null>(initialBundle);
  const [bundleWarnings, setBundleWarnings] = useState<readonly string[]>([]);
  const [hashesVerified, setHashesVerified] = useState(false);
  const [comparisonBundle, setComparisonBundle] =
    useState<WebReviewEnvelope | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [activeTab, setActiveTab] = useState<StudioTab>(initialTab);
  const [copied, setCopied] = useState(false);
  const [selectedResultIndex, setSelectedResultIndex] = useState<number>(0);
  const bundleRef = useRef(bundle);
  bundleRef.current = bundle;

  const openBundle = useCallback(
    async (load: () => Promise<unknown>, isComparison = false) => {
      setErrors(null);
      try {
        const result = await verifyBundleInBrowser(await load());
        if (result.status === "invalid") {
          setErrors([...result.errors]);
        } else if (isComparison) {
          const current = bundleRef.current;
          if (current && result.bundle.project.id !== current.project.id) {
            setErrors([
              `The comparison bundle is for project ${result.bundle.project.id}, not ${current.project.id}.`,
            ]);
          } else {
            setComparisonBundle(result.bundle);
            setActiveTab("changes");
          }
        } else {
          setBundle(result.bundle);
          setBundleWarnings(result.warnings);
          setHashesVerified(true);
          setComparisonBundle(null);
          setSelectedResultIndex(0);
        }
      } catch (err) {
        setErrors([
          err instanceof Error ? err.message : "Failed to read the bundle file",
        ]);
      }
    },
    [],
  );

  const handleFileUpload = (file: File, isComparison = false) =>
    openBundle(async () => JSON.parse(await file.text()), isComparison);

  const loadExample = useCallback(
    () =>
      openBundle(async () => {
        const response = await fetch(ATLAS_EXAMPLE_PATH);
        if (!response.ok) {
          throw new Error(`Could not load the example (${response.status})`);
        }
        return response.json();
      }),
    [openBundle],
  );

  useEffect(() => {
    if (initialBundle) return;
    if (autoLoadExample) {
      void loadExample();
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("example") === "atlas" || params.get("load") === "atlas") {
      void loadExample();
    }
  }, [autoLoadExample, initialBundle, loadExample]);

  const evidenceGaps = useMemo(
    () => (bundle ? collectEvidenceGaps(bundle.facts) : []),
    [bundle],
  );

  // Which bundle is the base is decided by export time, not load order.
  const olderFirst = useMemo(
    () =>
      bundle && comparisonBundle
        ? ([bundle, comparisonBundle].sort((a, b) =>
            a.exported_at < b.exported_at ? -1 : 1,
          ) as [WebReviewEnvelope, WebReviewEnvelope])
        : null,
    [bundle, comparisonBundle],
  );

  const handleDrop = (
    e: React.DragEvent<HTMLDivElement>,
    isComparison = false,
  ) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0], isComparison);
    }
  };

  const handoffText = bundle
    ? buildAgentBrief({
        project: bundle.project,
        results: bundle.report.artifact?.results ?? [],
        evidenceGaps,
        reportFreshness: bundle.report.freshness,
      })
    : "";

  const copyBrief = () => {
    navigator.clipboard.writeText(handoffText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-[108rem] px-5 py-8 sm:px-8">
      {/* 1. Header & Local Verification Status */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line-muted pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-sand/60">
            <Link
              href="/"
              className="inline-flex items-center gap-1 transition-colors hover:text-gold"
            >
              <span aria-hidden="true">←</span> Back to Home
            </Link>
            <span className="text-line-muted">/</span>
            <span className="text-sand/90">Studio</span>
          </div>
          <h1 className="mt-2 text-2xl font-light text-canvas sm:text-3xl">
            {bundle ? bundle.project.name : "Review Workspace"}
          </h1>
          <p className="mt-1 text-sm text-sand/70">
            {bundle
              ? `Project ID: ${bundle.project.id} · Snapshot exported: ${bundle.exported_at}`
              : "Review your locally exported project bundle in browser memory."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded border border-[#14532d] bg-[#0c2415] px-3 py-1.5 text-xs text-[#4ade80]">
            <span className="inline-block h-2 w-2 rounded-full bg-[#4ade80]" />
            <span>100% Browser-Local · Zero Server Uploads</span>
          </div>

          {bundle && (
            <label className="cursor-pointer rounded border border-line-muted bg-surface px-3 py-1.5 text-xs text-sand transition-colors hover:border-gold hover:text-gold">
              <span>Open different bundle</span>
              <input
                type="file"
                accept=".json"
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
                }}
              />
            </label>
          )}
        </div>
      </div>

      {/* 2. Error Display */}
      {errors && errors.length > 0 && (
        <div className="mb-6 rounded border border-[#592323] bg-[#2e1313] p-4 text-sm text-[#f87171]">
          <h3 className="font-medium">Invalid Review Bundle</h3>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
            {errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {bundle && bundleWarnings.length > 0 && (
        <div className="mb-6 rounded border border-[#78350f] bg-[#291e0a] p-4 text-sm text-[#fbbf24]">
          <h3 className="font-medium">
            Check these limits before relying on this bundle
          </h3>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
            {bundleWarnings.map((warning, idx) => (
              <li key={idx}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 3. Empty State / Dropzone */}
      {!bundle && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e)}
          className="my-12 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-line-muted bg-surface/40 p-12 text-center transition-colors hover:border-gold/50"
        >
          <div className="rounded-full border border-line-muted bg-ink p-4 text-gold">
            <svg
              className="h-8 w-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>

          <h2 className="mt-4 text-lg font-medium text-canvas">
            Open your project review bundle
          </h2>
          <p className="mt-2 max-w-md text-sm text-sand/70">
            Drag and drop your{" "}
            <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-gold">
              .anvilmark/review-bundle.json
            </code>{" "}
            file here, or browse from your disk.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded bg-gold px-4 py-2 text-sm font-semibold text-[#111210] transition-colors hover:bg-gold/90">
              <span>Select Bundle File</span>
              <input
                type="file"
                accept=".json"
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => void loadExample()}
              className="rounded border border-line-muted bg-surface px-4 py-2 text-sm text-sand transition-colors hover:border-gold"
            >
              Load the Atlas example
            </button>
            <Link
              href="/playground"
              className="text-sm text-sand/70 transition-colors hover:text-gold"
            >
              Try the Playground →
            </Link>
          </div>

          <div className="mt-8 max-w-lg border-t border-line-muted pt-6 text-left text-xs text-sand/60">
            <p className="font-semibold uppercase tracking-wider text-steel">
              How to export a bundle locally:
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-1 font-mono text-sand/80">
              <li>anvilmark check</li>
              <li>anvilmark export --include-source</li>
              <li>Drop .anvilmark/review-bundle.json into this window</li>
            </ol>
            <p className="mt-3">
              The CLI is not published to npm yet; run it from a local checkout.{" "}
              <Link href="/start" className="text-gold hover:underline">
                Set it up →
              </Link>
            </p>
          </div>
        </div>
      )}

      {/* 4. Loaded Workspace Review Cockpit */}
      {bundle && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Navigation Sidebar */}
          <nav aria-label="Studio views" className="space-y-1.5 lg:col-span-3">
            {[
              { id: "review", label: "Review & Findings" },
              { id: "decision", label: "Decision & Evidence" },
              { id: "checks", label: "Code Checks & Traces" },
              { id: "changes", label: "Snapshot Comparison" },
              { id: "handoff", label: "Agent Action Prompt" },
            ].map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as StudioTab)}
                  className={`flex w-full items-center justify-between rounded border px-3.5 py-2.5 text-left text-sm font-medium transition-colors ${
                    active
                      ? "border-gold bg-[#182026] text-gold shadow-[inset_3px_0_0_0_#D08D2E]"
                      : "border-line-muted bg-surface/80 text-sand hover:border-gold/50"
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.id === "changes" && comparisonBundle && (
                    <span className="rounded bg-[#14532d] px-1.5 py-0.5 text-[10px] font-semibold text-[#4ade80]">
                      Active
                    </span>
                  )}
                </button>
              );
            })}

            {/* Bundle Metadata Card */}
            <div className="mt-6 space-y-3 rounded border border-line-muted bg-surface/40 p-4 text-xs">
              <span className="font-semibold uppercase tracking-wider text-steel">
                Bundle Envelope
              </span>
              <div className="space-y-1.5 text-sand/80">
                <p>
                  <strong className="text-sand/60">Generator:</strong>{" "}
                  {bundle.generator}
                </p>
                <p>
                  <strong className="text-sand/60">Contract Hash:</strong>{" "}
                  <code className="font-mono text-gold">
                    {bundle.contract.content_hash.slice(0, 16)}...
                  </code>
                </p>
                {hashesVerified && (
                  <p title="All hashes were recomputed in this browser and match. This shows the bundle is unchanged since export, not who exported it.">
                    <strong className="text-sand/60">Hashes:</strong> recomputed
                    and consistent
                  </p>
                )}
                <p>
                  <strong className="text-sand/60">Projection:</strong>{" "}
                  {bundle.projection === "shareable"
                    ? `shareable (${bundle.contract.redactions.length} fields removed)`
                    : "local"}
                </p>
                <p>
                  <strong className="text-sand/60">Scan Status:</strong>{" "}
                  {bundle.scan.status}
                  {bundle.scan.freshness ? ` · ${bundle.scan.freshness}` : ""}
                </p>
                <p>
                  <strong className="text-sand/60">Report Status:</strong>{" "}
                  {bundle.report.status}
                  {bundle.report.freshness
                    ? ` · ${bundle.report.freshness}`
                    : ""}
                </p>
                <p>
                  <strong className="text-sand/60">Source Included:</strong>{" "}
                  {bundle.manifest.has_source
                    ? `${Object.keys(bundle.sources ?? {}).length} file(s)`
                    : "none"}
                  {bundle.manifest.sources_omitted.length > 0
                    ? ` · ${bundle.manifest.sources_omitted.length} left out`
                    : ""}
                </p>
                {bundle.source_control?.head_sha && (
                  <p>
                    <strong className="text-sand/60">Commit:</strong>{" "}
                    <code className="font-mono">
                      {bundle.source_control.head_sha.slice(0, 12)}
                    </code>
                    {bundle.source_control.dirty
                      ? " · uncommitted changes"
                      : ""}
                  </p>
                )}
              </div>
            </div>
          </nav>

          {/* View Details Area */}
          <div className="rounded border border-line-muted bg-surface p-6 lg:col-span-9">
            {/* TAB 1: REVIEW & FINDINGS */}
            {activeTab === "review" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-medium text-canvas">
                    What this bundle establishes
                  </h3>
                  <p className="mt-1 text-sm text-sand/70">
                    Four separate statuses. None of them implies another.
                  </p>
                </div>

                <StatusDimensions
                  bundle={bundle}
                  gaps={evidenceGaps}
                  hashesVerified={hashesVerified}
                />

                <CodeAndEvidence
                  results={bundle.report.artifact?.results ?? null}
                  gaps={evidenceGaps}
                  onInspect={(index) => {
                    setSelectedResultIndex(index);
                    setActiveTab("checks");
                  }}
                />
              </div>
            )}

            {/* TAB 2: DECISION & EVIDENCE */}
            {activeTab === "decision" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-medium text-canvas">
                    Recorded Decisions &amp; Constraints
                  </h3>
                  <p className="mt-1 text-sm text-sand/70">
                    Architectural choices and constraints as recorded in this
                    project&apos;s contract, with each decision&apos;s status.
                  </p>
                </div>

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-steel">
                    Decisions
                  </h4>
                  <div className="mt-3 space-y-3">
                    {bundle.contract.canonical.decisions.map((d) => (
                      <div
                        key={d.id}
                        className="rounded border border-line-muted bg-ink/40 p-4"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-canvas">
                            {d.id}
                          </span>
                          <span className="flex items-center gap-2 text-xs">
                            <span className="rounded border border-line-muted px-2 py-0.5 uppercase text-sand">
                              {d.status}
                            </span>
                            <span className="rounded bg-surface px-2 py-0.5 text-sand">
                              Rev {d.revision}
                            </span>
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-sand/80">
                          <strong>Selected:</strong>{" "}
                          <code className="font-mono text-gold">
                            {d.selected_candidate_ref || "None selected"}
                          </code>
                        </p>
                        <p className="mt-1 text-xs text-sand/60">
                          Rationale: {d.rationale.summary}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-steel">
                    Constraints ({bundle.contract.canonical.constraints.length})
                  </h4>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-line-muted text-xs uppercase tracking-wider text-steel">
                          <th className="pb-2 font-medium">ID</th>
                          <th className="pb-2 font-medium">Domain</th>
                          <th className="pb-2 font-medium">Severity</th>
                          <th className="pb-2 font-medium">Target Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line-muted">
                        {bundle.contract.canonical.constraints.map((c) => (
                          <tr key={c.id}>
                            <td className="py-2.5 font-mono text-xs text-canvas">
                              {c.id}
                            </td>
                            <td className="py-2.5 text-sand/80">{c.domain}</td>
                            <td className="py-2.5 text-xs">
                              <span
                                className={`rounded px-1.5 py-0.5 uppercase ${
                                  c.severity === "hard"
                                    ? "bg-red-950 text-red-400"
                                    : "bg-yellow-950 text-yellow-400"
                                }`}
                              >
                                {c.severity}
                              </span>
                            </td>
                            <td className="py-2.5 font-mono text-xs text-sand/80">
                              {formatConstraintValue(c.value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-steel">
                    Open evidence gaps ({evidenceGaps.length})
                  </h4>
                  <p className="mt-1 text-xs text-sand/60">
                    Recorded in the project facts for the project, each workload
                    and each workload&apos;s selected candidate. Code checks do
                    not close these.
                  </p>
                  <div className="mt-3">
                    <EvidenceGapTable gaps={evidenceGaps} />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: CODE CHECKS & TRACES */}
            {activeTab === "checks" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-medium text-canvas">
                    Does the code follow the rules?
                  </h3>
                  <p className="mt-1 text-sm text-sand/70">
                    Each check with its trace, the source it points at and the
                    limits of what it covers.
                  </p>
                </div>

                {bundle.report.artifact &&
                bundle.report.artifact.results.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {bundle.report.artifact.results.map((r, idx) => (
                        <button
                          key={r.id || idx}
                          type="button"
                          onClick={() => setSelectedResultIndex(idx)}
                          className={`rounded border px-3 py-1 text-xs font-mono transition-colors ${
                            selectedResultIndex === idx
                              ? "border-gold bg-gold/10 text-gold"
                              : "border-line-muted bg-surface text-sand hover:border-gold/50"
                          }`}
                        >
                          {r.rule_ref} ({r.verdict})
                        </button>
                      ))}
                    </div>

                    {bundle.report.artifact.results[selectedResultIndex] && (
                      <ResultDetails
                        result={
                          bundle.report.artifact.results[selectedResultIndex]
                        }
                        sources={bundle.sources}
                      />
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-sand/60">
                    No results available in this report.
                  </p>
                )}
              </div>
            )}

            {/* TAB 4: SNAPSHOT COMPARISON */}
            {activeTab === "changes" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-medium text-canvas">
                    Two-Snapshot Comparison
                  </h3>
                  <p className="mt-1 text-sm text-sand/70">
                    Compare this review bundle against another snapshot to
                    verify fixes without policy erosion.
                  </p>
                </div>

                {!olderFirst ? (
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDrop(e, true)}
                    className="flex flex-col items-center justify-center rounded border-2 border-dashed border-line-muted bg-surface/30 p-8 text-center"
                  >
                    <p className="text-sm text-sand">
                      Drop a second bundle here to compare changes between
                      snapshots.
                    </p>
                    <label className="mt-4 cursor-pointer rounded bg-gold px-3.5 py-1.5 text-xs font-semibold text-[#111210] transition-colors hover:bg-gold/90">
                      <span>Select Comparison Bundle</span>
                      <input
                        type="file"
                        accept=".json"
                        className="sr-only"
                        onChange={(e) => {
                          if (e.target.files?.[0]) {
                            handleFileUpload(e.target.files[0], true);
                          }
                        }}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-line-muted bg-ink/40 p-4">
                      <div className="text-xs text-sand/70">
                        <p>
                          <strong className="text-sand/60">Base:</strong>{" "}
                          exported {olderFirst[0].exported_at}
                        </p>
                        <p>
                          <strong className="text-sand/60">Head:</strong>{" "}
                          exported {olderFirst[1].exported_at}
                        </p>
                        <p className="mt-1 text-sand/50">
                          Ordered by export time; the older snapshot is the
                          base.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setComparisonBundle(null)}
                        className="text-xs text-red-400 hover:underline"
                      >
                        Remove comparison
                      </button>
                    </div>

                    <SnapshotComparison
                      base={olderFirst[0]}
                      head={olderFirst[1]}
                    />
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: AGENT ACTION PROMPT */}
            {activeTab === "handoff" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-medium text-canvas">
                    Agent Action Prompt
                  </h3>
                  <p className="mt-1 text-sm text-sand/70">
                    Pre-formatted precision instructions for Claude Code or
                    Codex tailored to this bundle&apos;s findings.
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
              </div>
            )}
          </div>
        </div>
      )}
      <HardwareSizingCockpit />
    </div>
  );
}
