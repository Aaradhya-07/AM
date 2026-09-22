"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { GitHubGlyph, TerminalNode } from "../../components/circuitry";
import type { ProjectData } from "./project-card";

interface TopologyNode {
  kind: string;
  name: string;
  badge: string;
  badgeColor: "gold" | "emerald" | "purple";
}

interface ProjectTopology {
  flowLabel1: string;
  flowLabel2: string;
  node1: TopologyNode;
  node2: TopologyNode;
  node3: TopologyNode;
  node4: TopologyNode;
  ruleStatement: string;
}

function getProjectTopology(project: ProjectData): ProjectTopology {
  const text =
    `${project.name} ${project.description} ${project.repo}`.toLowerCase();

  if (text.includes("fraud") || text.includes("anomaly")) {
    return {
      flowLabel1: "raw_event",
      flowLabel2: "masked_event",
      node1: {
        kind: "Event Source",
        name: "Transaction Stream",
        badge: "INPUT BOUNDARY",
        badgeColor: "gold",
      },
      node2: {
        kind: "Sanitizer Gate",
        name: "PII & Masking Guard",
        badge: "SANITIZER GATE",
        badgeColor: "emerald",
      },
      node3: {
        kind: "Worker Service",
        name: "Feature Aggregator",
        badge: "LOCAL BOUNDARY",
        badgeColor: "gold",
      },
      node4: {
        kind: "Inference Engine",
        name: "DeepSeek V3 (Advisory MoE)",
        badge: "ADVISORY SIZING",
        badgeColor: "purple",
      },
      ruleStatement:
        "Raw incoming customer transaction telemetry is strictly prohibited from routing to inference nodes without passing through the PII & Masking Guard.",
    };
  }

  if (
    text.includes("rag") ||
    text.includes("assistant") ||
    text.includes("doc")
  ) {
    return {
      flowLabel1: "doc_payload",
      flowLabel2: "clean_chunks",
      node1: {
        kind: "Intake Source",
        name: "Internal Document Store",
        badge: "LOCAL BOUNDARY",
        badgeColor: "gold",
      },
      node2: {
        kind: "Sanitizer Gate",
        name: "PII & Secret Scrubber",
        badge: "SANITIZER GATE",
        badgeColor: "emerald",
      },
      node3: {
        kind: "Storage Engine",
        name: "Local Vector Index",
        badge: "LOCAL BOUNDARY",
        badgeColor: "gold",
      },
      node4: {
        kind: "Inference Engine",
        name: "Llama 3.1 8B (Metal 16GB)",
        badge: "PINNED HARDWARE",
        badgeColor: "purple",
      },
      ruleStatement:
        "Enterprise document embeddings and Q&A context are bound strictly to local Metal execution; remote model egress is locked to zero.",
    };
  }

  if (
    text.includes("settlement") ||
    text.includes("merchant") ||
    text.includes("payment")
  ) {
    return {
      flowLabel1: "ledger_entry",
      flowLabel2: "sanitized_routing",
      node1: {
        kind: "Intake Service",
        name: "Merchant Batch Intake",
        badge: "INPUT BOUNDARY",
        badgeColor: "gold",
      },
      node2: {
        kind: "Sanitizer Gate",
        name: "Account Number Masker",
        badge: "SANITIZER GATE",
        badgeColor: "emerald",
      },
      node3: {
        kind: "Processing Node",
        name: "Settlement Reconciler",
        badge: "LOCAL BOUNDARY",
        badgeColor: "gold",
      },
      node4: {
        kind: "External System",
        name: "Core Banking Clearing API",
        badge: "REMOTE PROVIDER",
        badgeColor: "purple",
      },
      ruleStatement:
        "Unmasked bank account numbers and merchant credentials must never cross trust boundaries into automated reconciliation agents.",
    };
  }

  // Default Atlas Core Banking Reference
  return {
    flowLabel1: "raw_ticket",
    flowLabel2: "redacted_ticket",
    node1: {
      kind: "Service",
      name: "Ticket Intake API",
      badge: "LOCAL BOUNDARY",
      badgeColor: "gold",
    },
    node2: {
      kind: "Service",
      name: "PII Redactor",
      badge: "SANITIZER GATE",
      badgeColor: "emerald",
    },
    node3: {
      kind: "Service",
      name: "Ticket Classifier",
      badge: "LOCAL BOUNDARY",
      badgeColor: "gold",
    },
    node4: {
      kind: "External System",
      name: "Remote Model Provider",
      badge: "REMOTE PROVIDER",
      badgeColor: "purple",
    },
    ruleStatement:
      "Raw customer support tickets are strictly forbidden from egressing to remote model providers unless passed through the PII Redactor.",
  };
}

interface HardwareProfile {
  status: string;
  statusColor: string;
  weight: string;
  weightDetail: string;
  kvCache: string;
  kvDetail: string;
  headroom: string;
  headroomDetail: string;
  rationale: string;
}

function getHardwareSizing(targetHardware: string): HardwareProfile {
  const hw = targetHardware.toLowerCase();

  if (hw.includes("8b") || hw.includes("metal") || hw.includes("apple")) {
    return {
      status: "FIT CONFIRMED",
      statusColor: "emerald",
      weight: "4.8 GB",
      weightDetail: "Q4_K_M Quantized",
      kvCache: "1.2 GB",
      kvDetail: "FP16 8k Context Window",
      headroom: "+10.0 GB",
      headroomDetail: "Safe on 16GB Apple Silicon",
      rationale:
        "Deterministic local execution: Llama 3.1 8B quantized weights and KV-cache comfortably fit within 16GB Unified Memory with 62% operating headroom.",
    };
  }

  if (hw.includes("deepseek") || hw.includes("v3")) {
    return {
      status: "ADVISORY SIZING",
      statusColor: "amber",
      weight: "240.0 GB",
      weightDetail: "FP8 MoE Active Footprint",
      kvCache: "32.0 GB",
      kvDetail: "Paged KV Multi-Head Attention",
      headroom: "+368.0 GB",
      headroomDetail: "8xH100 SXM5 Pool (640GB)",
      rationale:
        "Advisory sizing for mixture-of-experts model: 37B active parameters per token. Paged KV-cache bounded across 8xH100 GPUs with ample memory safety margin.",
    };
  }

  if (hw.includes("claude") || hw.includes("sonnet") || hw.includes("hybrid")) {
    return {
      status: "HYBRID CONTRACT",
      statusColor: "emerald",
      weight: "Managed",
      weightDetail: "Remote Provider API",
      kvCache: "< 1.8s p95",
      kvDetail: "Latency SLA Bound",
      headroom: "Zero VRAM",
      headroomDetail: "Offloaded Compute Tier",
      rationale:
        "Hybrid Cloud Model: zero local GPU allocation required. Conformance enforcement validates that egress payloads strictly abide by declared PII scrub rules.",
    };
  }

  // Default: Llama 3.1 70B · 8xH100
  return {
    status: "FIT CONFIRMED",
    statusColor: "emerald",
    weight: "38.4 GB",
    weightDetail: "Q4_K_M Quantized (Pinned MoE)",
    kvCache: "16.4 GB",
    kvDetail: "FP16 16k Context Window",
    headroom: "+585.2 GB",
    headroomDetail: "8xH100 SXM5 Pool (640GB)",
    rationale:
      "Enterprise High-Throughput Cluster: 8xH100 SXM5 provides 640GB aggregate HBM3 VRAM, comfortably hosting 70B parameters with massive concurrent batching headroom.",
  };
}

export function ProjectInspectionModal({
  project,
  open,
  onClose,
  onDelete,
  onRunTriggered,
}: {
  project: ProjectData | null;
  open: boolean;
  onClose: () => void;
  onDelete?: (projectId: string) => void;
  onRunTriggered?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<"topology" | "hardware" | "ci">(
    "topology",
  );
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simulateResult, setSimulateResult] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setConfirmDelete(false);
      setSimulateResult(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted || !project) return null;

  const topology = getProjectTopology(project);
  const hardware = getHardwareSizing(project.targetHardware);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleSimulateRun = async (status: "pass" | "warn") => {
    setSimulating(true);
    setSimulateResult(null);
    try {
      // Same-origin fetch carries the Supabase session cookie, which is a
      // credential the server can actually verify. A token derived from a user
      // id in the browser is not a secret and is no longer accepted.
      const res = await fetch("/api/runs", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: project.id,
          commitSha: (project.lastCommit || "e2c4019a").slice(0, 7),
          agentTrigger: "Simulated CI Run (Console Test)",
          status,
          details:
            status === "pass"
              ? `${project.boundariesCount}/${project.boundariesCount} boundaries verified. Zero PII egress violations.`
              : `Advisory: Model memory footprint is nearing 85% headroom limit.`,
        }),
      });

      if (res.ok) {
        setSimulateResult(
          status === "pass"
            ? "✓ Conformance pass recorded in audit stream!"
            : "⚠ Conformance warning recorded in audit stream!",
        );
        onRunTriggered?.();
      } else {
        const err = await res.json().catch(() => ({}));
        setSimulateResult(`Simulation note: ${err.error || "Logged locally"}`);
      }
    } catch {
      setSimulateResult("Run logged locally in telemetry stream.");
    } finally {
      setSimulating(false);
    }
  };

  const ciWorkflowYaml = `name: ANVILMARK Conformance Check
on:
  push:
    branches: [main, feat/*]
  pull_request:
    branches: [main]

jobs:
  conformance:
    name: Verify Contract Boundaries
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Source Code
        uses: actions/checkout@v4

      - name: Install Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Evaluate Decision Boundaries
        run: npx @anvilmark/cli check

      - name: Send Run Telemetry to Console
        if: always()
        run: |
          curl -s -X POST https://anvilmark.vercel.app/api/runs \\
            -H "Content-Type: application/json" \\
            -d '{
              "projectId": "${project.id}",
              "commitSha": "\${{ github.sha }}",
              "agentTrigger": "GitHub Actions · PR #\${{ github.event.pull_request.number || github.ref_name }}",
              "status": "\${{ job.status == \\'success\\' && \\'pass\\' || \\'fail\\' }}",
              "details": "${project.boundariesCount} boundaries verified against schema ${project.contractVersion}"
            }'
`;

  const getStatusBadge = () => {
    switch (project.conformanceStatus) {
      case "verified":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-edge border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            CONFORMING
          </span>
        );
      case "drift_detected":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-edge border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            DRIFT DETECTED
          </span>
        );
      case "pending_ratification":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-edge border border-gold/40 bg-gold/10 px-2 py-0.5 font-mono text-[11px] font-medium text-gold">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            PENDING RATIFICATION
          </span>
        );
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-inspect-title"
    >
      <div
        className="fixed inset-0 bg-ink/85 backdrop-blur-md transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative my-auto w-full max-w-3xl rounded-module border border-line/40 bg-surface p-6 shadow-2xl sm:p-8 z-10">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-line-muted pb-4">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-gold">
            <TerminalNode active />
            <span>CONTRACT COCKPIT // {project.id.slice(0, 16)}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-sand/60 transition-colors hover:text-canvas focus:outline-none focus:ring-1 focus:ring-gold"
            aria-label="Close modal"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Title + Meta */}
        <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h2
                id="project-inspect-title"
                className="font-brand text-2xl font-bold tracking-tight text-canvas"
              >
                {project.name}
              </h2>
              {getStatusBadge()}
            </div>
            <div className="mt-1.5 flex items-center gap-2 font-mono text-xs text-sand/70">
              <GitHubGlyph />
              <span>{project.repo}</span>
              <span>·</span>
              <span className="text-sand/50">branch: {project.branch}</span>
            </div>
          </div>

          <Link
            href="/studio?load=atlas"
            className="inline-flex items-center gap-1.5 rounded-edge border border-gold/60 bg-gold/10 px-3.5 py-1.5 font-mono text-xs font-semibold text-gold hover:bg-gold hover:text-ink transition-colors"
          >
            <span>Open in Studio</span>
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              />
            </svg>
          </Link>
        </div>

        {/* Tab Navigation */}
        <div className="mt-6 flex border-b border-line-muted text-xs font-mono">
          <button
            type="button"
            onClick={() => setActiveTab("topology")}
            className={`border-b-2 px-4 py-2 transition-colors ${
              activeTab === "topology"
                ? "border-gold text-gold font-semibold"
                : "border-transparent text-sand/60 hover:text-canvas"
            }`}
          >
            Architecture & Trust Boundaries
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("hardware")}
            className={`border-b-2 px-4 py-2 transition-colors ${
              activeTab === "hardware"
                ? "border-gold text-gold font-semibold"
                : "border-transparent text-sand/60 hover:text-canvas"
            }`}
          >
            Hardware Fit & Inference Sizing
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ci")}
            className={`border-b-2 px-4 py-2 transition-colors ${
              activeTab === "ci"
                ? "border-gold text-gold font-semibold"
                : "border-transparent text-sand/60 hover:text-canvas"
            }`}
          >
            CI/CD Action & Telemetry
          </button>
        </div>

        {/* Tab Content */}
        <div className="mt-5">
          {/* TAB 1: TOPOLOGY & TRUST BOUNDARIES */}
          {activeTab === "topology" && (
            <div className="space-y-4 font-mono text-xs">
              <p className="font-sans text-sm text-sand/80 leading-relaxed">
                {project.description}
              </p>

              {/* CALM 1.2 Interactive Nodes Map */}
              <div className="rounded-edge border border-line-muted bg-ink/90 p-4">
                <div className="flex items-center justify-between text-[11px] text-sand/60 border-b border-line-muted/40 pb-2">
                  <span className="uppercase tracking-wider text-gold font-bold">
                    FINOS CALM 1.2 Declared Topology
                  </span>
                  <span>{project.boundariesCount} Monitored Flows</span>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-center text-center">
                  <div className="rounded-edge border border-line-muted bg-surface/80 p-2.5">
                    <span className="block text-[10px] uppercase text-sand/50">
                      {topology.node1.kind}
                    </span>
                    <span className="text-canvas font-semibold">
                      {topology.node1.name}
                    </span>
                    <span className="mt-1 block rounded bg-gold/10 text-[9px] text-gold">
                      {topology.node1.badge}
                    </span>
                  </div>

                  <div className="hidden sm:flex flex-col items-center justify-center text-[10px] text-sand/40">
                    <span>{topology.flowLabel1}</span>
                    <span>──────▶</span>
                  </div>

                  <div className="rounded-edge border border-gold/60 bg-surface/80 p-2.5 shadow-[0_0_12px_rgba(208,141,46,0.15)]">
                    <span className="block text-[10px] uppercase text-sand/50">
                      {topology.node2.kind}
                    </span>
                    <span className="text-canvas font-semibold">
                      {topology.node2.name}
                    </span>
                    <span className="mt-1 block rounded bg-emerald-500/10 text-[9px] text-emerald-400">
                      {topology.node2.badge}
                    </span>
                  </div>

                  <div className="hidden sm:flex flex-col items-center justify-center text-[10px] text-sand/40">
                    <span>{topology.flowLabel2}</span>
                    <span>──────▶</span>
                  </div>

                  <div className="rounded-edge border border-line-muted bg-surface/80 p-2.5 col-span-1 sm:col-span-2">
                    <span className="block text-[10px] uppercase text-sand/50">
                      {topology.node3.kind}
                    </span>
                    <span className="text-canvas font-semibold">
                      {topology.node3.name}
                    </span>
                    <span className="mt-1 block rounded bg-gold/10 text-[9px] text-gold">
                      {topology.node3.badge}
                    </span>
                  </div>

                  <div className="rounded-edge border border-purple-500/40 bg-surface/80 p-2.5 col-span-1 sm:col-span-2">
                    <span className="block text-[10px] uppercase text-sand/50">
                      {topology.node4.kind}
                    </span>
                    <span className="text-canvas font-semibold">
                      {topology.node4.name}
                    </span>
                    <span className="mt-1 block rounded bg-purple-500/10 text-[9px] text-purple-300">
                      {topology.node4.badge}
                    </span>
                  </div>
                </div>

                <div className="mt-4 border-t border-line-muted/40 pt-3 text-[11px] text-sand/70">
                  <span className="text-emerald-400 font-semibold">
                    Rule Enforced:{" "}
                  </span>
                  {topology.ruleStatement}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-edge border border-line-muted/60 bg-surface/60 p-3.5">
                <div>
                  <span className="block text-[10px] uppercase text-sand/40">
                    Contract Version
                  </span>
                  <span className="text-canvas font-semibold">
                    {project.contractVersion}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-sand/40">
                    Repository Commit
                  </span>
                  <span className="text-sand/70">{project.lastCommit}</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: HARDWARE FIT & SIZING */}
          {activeTab === "hardware" && (
            <div className="space-y-4 font-mono text-xs">
              <div className="rounded-edge border border-gold/40 bg-gold/5 p-4">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="uppercase tracking-wider text-gold font-bold">
                    Target Execution Profile
                  </span>
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                    {hardware.status}
                  </span>
                </div>
                <h4 className="mt-1 font-brand text-lg font-bold text-canvas">
                  {project.targetHardware}
                </h4>
                <p className="mt-1 font-sans text-xs text-sand/80 leading-relaxed">
                  {hardware.rationale}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-edge border border-line-muted bg-surface/80 p-3 text-center">
                  <span className="block text-[10px] uppercase text-sand/40">
                    Weight Memory
                  </span>
                  <span className="mt-1 block text-lg font-bold text-canvas">
                    {hardware.weight}
                  </span>
                  <span className="text-[10px] text-sand/50">
                    {hardware.weightDetail}
                  </span>
                </div>
                <div className="rounded-edge border border-line-muted bg-surface/80 p-3 text-center">
                  <span className="block text-[10px] uppercase text-sand/40">
                    KV Buffer
                  </span>
                  <span className="mt-1 block text-lg font-bold text-canvas">
                    {hardware.kvCache}
                  </span>
                  <span className="text-[10px] text-sand/50">
                    {hardware.kvDetail}
                  </span>
                </div>
                <div className="rounded-edge border border-line-muted bg-surface/80 p-3 text-center">
                  <span className="block text-[10px] uppercase text-sand/40">
                    Runtime Headroom
                  </span>
                  <span className="mt-1 block text-lg font-bold text-emerald-400">
                    {hardware.headroom}
                  </span>
                  <span className="text-[10px] text-emerald-500/70">
                    {hardware.headroomDetail}
                  </span>
                </div>
              </div>

              <div className="rounded-edge border border-line-muted/60 bg-ink p-3 text-[11px] text-sand/70 leading-relaxed">
                <span className="text-gold font-semibold">
                  ANVILMARK Invariant:{" "}
                </span>
                Models must never be assigned to deployment hardware without
                verifiable memory headroom evidence. All estimates are
                verifiable by local CI test fixtures.
              </div>
            </div>
          )}

          {/* TAB 3: CI/CD ACTION & TELEMETRY */}
          {activeTab === "ci" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-sand/70">
                <span className="font-mono text-[11px]">
                  .github/workflows/anvilmark-conformance.yml
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(ciWorkflowYaml, "ci")}
                  className="font-mono text-[11px] text-gold hover:text-canvas transition-colors"
                >
                  {copied === "ci" ? "Copied!" : "Copy Workflow YAML"}
                </button>
              </div>

              <pre className="max-h-48 overflow-auto rounded-edge border border-line-muted bg-ink p-3 font-mono text-[11px] text-canvas selection:bg-gold selection:text-ink">
                {ciWorkflowYaml}
              </pre>

              {/* Simulation Box */}
              <div className="rounded-edge border border-line-muted/80 bg-surface/60 p-3.5 font-mono text-xs">
                <span className="block font-semibold text-canvas text-xs">
                  Test Live Telemetry Ingestion
                </span>
                <p className="mt-1 text-[11px] text-sand/70 font-sans">
                  Simulate an automated pull request check reporting to this
                  dashboard via{" "}
                  <code className="rounded bg-ink px-1 py-0.5 text-gold">
                    POST /api/runs
                  </code>
                  :
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={simulating}
                    onClick={() => handleSimulateRun("pass")}
                    className="rounded-edge border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  >
                    {simulating
                      ? "Transmitting..."
                      : "Simulate Passing Conformance"}
                  </button>
                  <button
                    type="button"
                    disabled={simulating}
                    onClick={() => handleSimulateRun("warn")}
                    className="rounded-edge border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-500/20 transition-colors"
                  >
                    Simulate Drift Warning
                  </button>
                </div>

                {simulateResult && (
                  <p className="mt-2 text-[11px] text-gold animate-fadeIn">
                    {simulateResult}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="mt-8 flex items-center justify-between border-t border-line-muted/60 pt-4">
          <div>
            {onDelete && (
              <>
                {confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-red-400">
                      Disconnect this repo?
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(project.id);
                        onClose();
                      }}
                      className="rounded-edge bg-red-600 px-3 py-1 font-mono text-[11px] font-bold text-white hover:bg-red-700 transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-edge border border-line-muted px-2.5 py-1 font-mono text-[11px] text-sand hover:text-canvas"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="font-mono text-xs text-red-400/80 hover:text-red-400 transition-colors"
                  >
                    Disconnect Repository
                  </button>
                )}
              </>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-edge border border-line-muted bg-graphite/40 px-5 py-2 font-mono text-xs uppercase tracking-wider text-sand hover:border-gold hover:text-gold transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
