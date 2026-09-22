"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase/client";
import { useAuth } from "../components/auth-provider";
import { TerminalNode } from "../components/circuitry";
import { ProjectCard, type ProjectData } from "./components/project-card";
import { NewProjectModal } from "./components/new-project-modal";
import { CliConnectModal } from "./components/cli-connect-modal";
import { ConformanceFeed } from "./components/conformance-feed";
import { ProjectInspectionModal } from "./components/project-inspection-modal";
import { AuthModal } from "../components/auth-modal";

export default function DashboardPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [filter, setFilter] = useState<
    "all" | "verified" | "drift_detected" | "pending_ratification"
  >("all");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [cliModalOpen, setCliModalOpen] = useState(false);
  const [inspectingProject, setInspectingProject] =
    useState<ProjectData | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  useEffect(() => {
    // 1. Load local custom projects cache
    let currentProjects: ProjectData[] = [];
    try {
      const stored = localStorage.getItem("anvilmark_custom_projects");
      if (stored) {
        const custom: ProjectData[] = JSON.parse(stored);
        if (Array.isArray(custom) && custom.length > 0) {
          currentProjects = custom;
        }
      }
    } catch (err) {
      void err;
    }

    setProjects(currentProjects);

    // 2. Sync from Supabase if authenticated
    if (!user) {
      setLoadingProjects(false);
      return;
    }
    const supabase = createClient();
    if (!supabase) {
      setLoadingProjects(false);
      return;
    }

    let active = true;
    supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        setLoadingProjects(false);
        if (error || !data) return;
        interface SupabaseProjectRow {
          id: string;
          name: string;
          repo_url: string;
          branch: string;
          contract_version: string;
          target_hardware: string;
          conformance_status?: string;
          boundaries_count?: number;
          description?: string;
        }
        const loaded: ProjectData[] = (data as SupabaseProjectRow[]).map(
          (row) => ({
            id: row.id,
            name: row.name,
            repo: row.repo_url,
            branch: row.branch,
            contractVersion: row.contract_version,
            targetHardware: row.target_hardware,
            conformanceStatus:
              row.conformance_status === "drift_detected" ||
              row.conformance_status === "pending_ratification"
                ? row.conformance_status
                : "verified",
            boundariesCount: row.boundaries_count ?? 6,
            lastUpdated: "Synced from Supabase",
            lastCommit: "origin/HEAD",
            description:
              row.description || "Connected repository decision contract.",
          }),
        );

        setProjects((prev) => {
          const loadedIds = new Set(loaded.map((l) => l.id));
          const unshared = prev.filter((p) => !loadedIds.has(p.id));
          return [...loaded, ...unshared];
        });
      });

    return () => {
      active = false;
    };
  }, [user]);

  const handleCreateProject = (newProject: ProjectData) => {
    setProjects((prev) => [newProject, ...prev]);
    try {
      const stored = localStorage.getItem("anvilmark_custom_projects");
      const list = stored ? JSON.parse(stored) : [];
      localStorage.setItem(
        "anvilmark_custom_projects",
        JSON.stringify([newProject, ...list]),
      );
    } catch (err) {
      void err;
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    try {
      const stored = localStorage.getItem("anvilmark_custom_projects");
      if (stored) {
        const list: ProjectData[] = JSON.parse(stored);
        localStorage.setItem(
          "anvilmark_custom_projects",
          JSON.stringify(list.filter((p) => p.id !== projectId)),
        );
      }
    } catch (err) {
      void err;
    }
    const supabase = createClient();
    if (supabase && user) {
      await supabase.from("projects").delete().eq("id", projectId);
    }
  };

  const filteredProjects = projects.filter((p) => {
    if (filter === "all") return true;
    return p.conformanceStatus === filter;
  });

  const conformingCount = projects.filter(
    (p) => p.conformanceStatus === "verified",
  ).length;
  const pendingCount = projects.filter(
    (p) => p.conformanceStatus === "pending_ratification",
  ).length;

  return (
    <div className="am-inset-x mx-auto max-w-shell px-5 py-8 sm:px-8 lg:px-12">
      {/* Guest Mode Banner: Explicit distinction for unauthenticated visitors */}
      {!user && (
        <div className="mb-8 rounded-module border border-amber-500/40 bg-amber-500/10 p-5 shadow-lg">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="flex items-start gap-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 font-mono text-sm font-bold border border-amber-500/40">
                !
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-brand text-base font-bold tracking-tight text-canvas">
                    Guest Sandbox Mode Active
                  </h3>
                  <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] uppercase font-bold text-amber-300">
                    Preloaded Reference Contracts
                  </span>
                </div>
                <p className="mt-1 text-xs text-sand/80 leading-relaxed max-w-2xl">
                  You are exploring sample FINOS CALM 1.2 architectures in guest
                  mode. Sign in with GitHub or Google to connect your private
                  repositories, persist decision contracts, and stream real-time
                  CI telemetry directly into this cockpit.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-edge border border-gold bg-gold px-4 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-goldsoft transition-colors"
              >
                <span>Sign In with GitHub / Google</span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Platform Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-line-muted pb-6">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-gold">
            <TerminalNode active />
            <span>PLATFORM CONSOLE // WORKSPACE</span>
          </div>
          <h1 className="mt-1 font-brand text-3xl font-bold tracking-tight text-canvas sm:text-4xl">
            Decision Contracts & Conformance
          </h1>
          <p className="mt-1 text-sm text-sand/70">
            {user ? (
              <>
                Welcome back,{" "}
                <span className="font-semibold text-canvas">{user.name}</span>.
                All local decision contracts are synchronized with zero source
                code egress.
              </>
            ) : (
              <>
                Viewing in{" "}
                <span className="font-semibold text-amber-400">
                  Guest Sandbox Mode
                </span>
                . Connect your account to persist private contracts and stream
                CI telemetry.
              </>
            )}
          </p>
        </div>

        {/* Global Platform Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setCliModalOpen(true)}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-edge border border-line-muted bg-graphite/40 px-4 font-mono text-xs uppercase tracking-wider text-sand hover:border-gold hover:text-gold transition-colors"
          >
            <svg
              className="h-4 w-4 text-gold"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span>Connect CLI</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!user) {
                setAuthModalOpen(true);
              } else {
                setNewProjectOpen(true);
              }
            }}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-edge border border-gold/80 bg-gold px-4 font-mono text-xs font-semibold uppercase tracking-wider text-ink hover:bg-goldsoft transition-colors"
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
                d="M12 4v16m8-8H4"
              />
            </svg>
            <span>
              {user ? "Connect Repository" : "Sign In to Connect Repo"}
            </span>
          </button>
        </div>
      </div>

      {/* Platform Metric Cockpit */}
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-module border border-line-muted bg-surface/80 p-4">
          <span className="block font-mono text-[11px] uppercase tracking-wider text-sand/60">
            Registered Contracts
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-brand text-3xl font-bold text-canvas">
              {projects.length}
            </span>
            <span className="font-mono text-xs text-sand/50">repositories</span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-sand/60">
            Across all microservices
          </p>
        </div>

        <div className="rounded-module border border-line-muted bg-surface/80 p-4">
          <span className="block font-mono text-[11px] uppercase tracking-wider text-sand/60">
            Conformance Rate
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-brand text-3xl font-bold text-emerald-400">
              {projects.length > 0
                ? `${Math.round((conformingCount / projects.length) * 100)}%`
                : "—"}
            </span>
            <span className="font-mono text-xs text-sand/50">
              {projects.length > 0
                ? `(${conformingCount}/${projects.length} passing)`
                : "(0 registered)"}
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-sand/60">
            Zero unauthorized egress flows
          </p>
        </div>

        <div className="rounded-module border border-line-muted bg-surface/80 p-4">
          <span className="block font-mono text-[11px] uppercase tracking-wider text-sand/60">
            Pending Ratifications
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-brand text-3xl font-bold text-gold">
              {pendingCount}
            </span>
            <span className="font-mono text-xs text-sand/50">
              schema deltas
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-sand/60">
            Requires architect hash sign-off
          </p>
        </div>

        <div className="rounded-module border border-line-muted bg-surface/80 p-4">
          <span className="block font-mono text-[11px] uppercase tracking-wider text-sand/60">
            Connected Agents
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-brand text-3xl font-bold text-canvas">
              Claude / Cursor
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-sand/60">
            Building against frozen contracts
          </p>
        </div>
      </div>

      {/* Main Grid: Projects + Live Audit Feed */}
      <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left 2 Cols: Projects list */}
        <div className="lg:col-span-2 space-y-6">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-muted/60 pb-3">
            <h2 className="font-brand text-xl font-bold text-canvas">
              Monitored Repositories & Services
            </h2>

            <div className="flex items-center gap-1.5 font-mono text-xs">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`rounded-edge px-3 py-1 transition-colors ${
                  filter === "all"
                    ? "bg-gold/20 text-gold border border-gold/40"
                    : "text-sand/60 hover:text-canvas"
                }`}
              >
                All ({projects.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("verified")}
                className={`rounded-edge px-3 py-1 transition-colors ${
                  filter === "verified"
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                    : "text-sand/60 hover:text-canvas"
                }`}
              >
                Conforming ({conformingCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter("pending_ratification")}
                className={`rounded-edge px-3 py-1 transition-colors ${
                  filter === "pending_ratification"
                    ? "bg-gold/20 text-gold border border-gold/40"
                    : "text-sand/60 hover:text-canvas"
                }`}
              >
                Pending ({pendingCount})
              </button>
            </div>
          </div>

          {/* Projects Content: Loading / Empty / List */}
          {loadingProjects ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-36 animate-pulse rounded-module border border-line-muted/40 bg-surface/40"
                />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-module border border-line-muted/60 bg-surface/60 p-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gold/10 text-gold mb-3">
                <TerminalNode active />
              </div>
              <h3 className="font-brand text-lg font-semibold text-canvas">
                No repositories registered yet
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-sand/70">
                Connect your repository to monitor agent conformance, verify
                architectural boundaries, and stream live audits.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setNewProjectOpen(true)}
                  className="inline-flex items-center gap-2 rounded-edge border border-gold bg-gold px-4 py-2 font-mono text-xs font-semibold text-ink transition-all hover:bg-gold-light"
                >
                  <span>+ Register Project</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCliModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-edge border border-line-muted bg-surface px-4 py-2 font-mono text-xs text-sand transition-all hover:border-gold hover:text-gold"
                >
                  <span>CLI Connect Guide</span>
                </button>
                <Link
                  href="/start"
                  className="inline-flex items-center gap-2 rounded-edge border border-line-muted bg-surface px-4 py-2 font-mono text-xs text-sand transition-all hover:border-gold hover:text-gold"
                >
                  <span>Quickstart Docs →</span>
                </Link>
              </div>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="rounded-module border border-line-muted/40 bg-surface/40 p-8 text-center">
              <p className="font-mono text-xs text-sand/70">
                No repositories match filter &ldquo;{filter}&rdquo;.
              </p>
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="mt-2 font-mono text-xs text-gold hover:underline"
              >
                Reset filter
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onInspect={(p) => setInspectingProject(p)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right 1 Col: Live Telemetry & Quicklinks */}
        <div className="space-y-6">
          <ConformanceFeed />

          {/* Quick Studio launcher banner */}
          <div className="rounded-module border border-gold/30 bg-gold/5 p-5">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-gold">
              <TerminalNode active />
              <span>Interactive Architecture Studio</span>
            </div>
            <p className="mt-2 text-xs text-sand/80 leading-relaxed">
              Launch the in-browser cockpit to inspect full FINOS CALM 1.2
              architectures, interactive Mermaid state graphs, and memory sizing
              curves.
            </p>
            <div className="mt-4">
              <Link
                href="/studio?load=atlas"
                className="inline-flex w-full items-center justify-center gap-2 rounded-edge border border-gold/60 bg-gold/10 px-4 py-2 font-mono text-xs font-semibold text-gold hover:bg-gold hover:text-ink transition-colors"
              >
                <span>Launch Studio Viewer</span>
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
          </div>
        </div>
      </div>

      {/* Modals */}
      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreate={handleCreateProject}
      />
      <CliConnectModal
        open={cliModalOpen}
        onClose={() => setCliModalOpen(false)}
      />
      <ProjectInspectionModal
        project={inspectingProject}
        open={Boolean(inspectingProject)}
        onClose={() => setInspectingProject(null)}
        onDelete={handleDeleteProject}
        onRunTriggered={() => {
          if (inspectingProject) {
            setProjects((prev) =>
              prev.map((p) =>
                p.id === inspectingProject.id
                  ? { ...p, lastUpdated: "Just now via Console Simulation" }
                  : p,
              ),
            );
          }
        }}
      />
      <AuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  );
}
