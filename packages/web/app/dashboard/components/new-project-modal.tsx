"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "../../../lib/supabase/client";
import { useAuth } from "../../components/auth-provider";
import { TerminalNode } from "../../components/circuitry";
import type { ProjectData } from "./project-card";

export function NewProjectModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (project: ProjectData) => void;
}) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [targetHardware, setTargetHardware] = useState(
    "Llama 3.1 8B · Metal 16GB",
  );
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !repo) return;

    setSubmitting(true);
    try {
      const supabase = createClient();
      if (supabase && user) {
        const { data, error } = await supabase
          .from("projects")
          .insert({
            user_id: user.id,
            name,
            repo_url: repo,
            branch: branch || "main",
            contract_version: "0.1.0-draft.5",
            target_hardware: targetHardware,
            conformance_status: "verified",
            boundaries_count: 6,
            description:
              description ||
              "Connected repository decision contract and bounded conformance monitor.",
          })
          .select()
          .single();

        if (!error && data) {
          onCreate({
            id: data.id,
            name: data.name,
            repo: data.repo_url,
            branch: data.branch,
            contractVersion: data.contract_version,
            targetHardware: data.target_hardware,
            conformanceStatus:
              data.conformance_status === "drift_detected" ||
              data.conformance_status === "pending_ratification"
                ? data.conformance_status
                : "verified",
            boundariesCount: data.boundaries_count ?? 6,
            lastUpdated: "Just now",
            lastCommit: "origin/HEAD",
            description: data.description,
          });
          setName("");
          setRepo("");
          setDescription("");
          onClose();
          return;
        } else if (error) {
          console.warn(
            "Supabase project insert failed, fallback to local state:",
            error,
          );
        }
      }

      // Local / preview fallback
      const newProject: ProjectData = {
        id: `prj_${Date.now()}`,
        name,
        repo,
        branch: branch || "main",
        contractVersion: "0.1.0-draft.5",
        targetHardware,
        conformanceStatus: "verified",
        boundariesCount: 6,
        lastUpdated: "Just now",
        lastCommit: "origin/HEAD",
        description:
          description ||
          "Connected repository decision contract and bounded conformance monitor.",
      };
      onCreate(newProject);
      setName("");
      setRepo("");
      setDescription("");
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-title"
    >
      <div
        className="fixed inset-0 bg-ink/85 backdrop-blur-md transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative my-auto w-full max-w-lg rounded-module border border-line/40 bg-surface p-6 shadow-2xl sm:p-8 z-10">
        <div className="flex items-center justify-between border-b border-line-muted pb-4">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-gold">
            <TerminalNode active />
            <span>PLATFORM // CONNECT REPOSITORY</span>
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

        <div className="mt-5">
          <h2
            id="new-project-title"
            className="font-brand text-xl font-bold tracking-tight text-canvas"
          >
            Connect Repository / Register Contract
          </h2>
          <p className="mt-1.5 text-xs text-sand/70">
            Establish a decision contract and conformance boundary tracking for
            your codebase.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
          <span className="text-sand/50">Templates:</span>
          <button
            type="button"
            onClick={() => {
              setName("Atlas Payment Gateway");
              setRepo("company/atlas-payments");
              setBranch("main");
              setTargetHardware("Llama 3.1 70B · 8xH100 SXM5");
              setDescription(
                "Core transactional engine with strict PII boundary isolation.",
              );
            }}
            className="rounded border border-line-muted bg-graphite/40 px-2 py-0.5 text-sand/80 hover:border-gold hover:text-gold transition-colors"
          >
            Payment Engine
          </button>
          <button
            type="button"
            onClick={() => {
              setName("Fraud Detection Service");
              setRepo("company/fraud-detector");
              setBranch("main");
              setTargetHardware("DeepSeek V3 · 8xH100");
              setDescription(
                "Real-time anomaly scoring worker with bounded model memory.",
              );
            }}
            className="rounded border border-line-muted bg-graphite/40 px-2 py-0.5 text-sand/80 hover:border-gold hover:text-gold transition-colors"
          >
            Fraud Worker
          </button>
          <button
            type="button"
            onClick={() => {
              setName("Local RAG Assistant");
              setRepo("company/rag-assistant");
              setBranch("main");
              setTargetHardware("Llama 3.1 8B · Metal 16GB");
              setDescription(
                "On-premise document Q&A assistant pinned to local inference hardware.",
              );
            }}
            className="rounded border border-line-muted bg-graphite/40 px-2 py-0.5 text-sand/80 hover:border-gold hover:text-gold transition-colors"
          >
            Local RAG
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block font-mono text-xs text-sand/80">
              Project / Service Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Atlas Payment Gateway"
              className="mt-1.5 w-full rounded-edge border border-line-muted bg-graphite/40 px-3.5 py-2 font-sans text-sm text-canvas placeholder-sand/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block font-mono text-xs text-sand/80">
                GitHub Repository
              </label>
              <input
                type="text"
                required
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="organization/repository"
                className="mt-1.5 w-full rounded-edge border border-line-muted bg-graphite/40 px-3.5 py-2 font-mono text-xs text-canvas placeholder-sand/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
              />
            </div>
            <div>
              <label className="block font-mono text-xs text-sand/80">
                Branch
              </label>
              <input
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                className="mt-1.5 w-full rounded-edge border border-line-muted bg-graphite/40 px-3.5 py-2 font-mono text-xs text-canvas placeholder-sand/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
              />
            </div>
          </div>

          <div>
            <label className="block font-mono text-xs text-sand/80">
              Target Hardware / Inference Profile
            </label>
            <select
              value={targetHardware}
              onChange={(e) => setTargetHardware(e.target.value)}
              className="mt-1.5 w-full rounded-edge border border-line-muted bg-graphite/40 px-3.5 py-2 font-mono text-xs text-canvas focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            >
              <option value="Llama 3.1 8B · Metal 16GB">
                Llama 3.1 8B · Apple Silicon Metal (16GB)
              </option>
              <option value="Llama 3.1 70B · 8xH100 SXM5">
                Llama 3.1 70B · 8xH100 SXM5 (Pinned MoE)
              </option>
              <option value="DeepSeek V3 · 8xH100">
                DeepSeek V3 · 8xH100 (Pinned MoE Profile)
              </option>
              <option value="Claude 3.7 Sonnet (Hybrid Cloud)">
                Claude 3.7 Sonnet (Hybrid Cloud Contract)
              </option>
              <option value="Custom Hardware Target">
                Custom Dedicated Server
              </option>
            </select>
          </div>

          <div>
            <label className="block font-mono text-xs text-sand/80">
              Description / Architecture Scope
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="High-throughput transaction ingestion engine with bounded PII handling."
              className="mt-1.5 w-full rounded-edge border border-line-muted bg-graphite/40 px-3.5 py-2 font-sans text-xs text-canvas placeholder-sand/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            />
          </div>

          <div className="mt-6 flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-edge border border-line-muted bg-transparent px-4 py-2 font-mono text-xs text-sand hover:border-gold hover:text-gold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-edge border border-gold/70 bg-gold px-5 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-ink transition-all hover:bg-goldsoft focus:outline-none focus:ring-2 focus:ring-gold"
            >
              {submitting ? "Connecting..." : "Establish Contract"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
