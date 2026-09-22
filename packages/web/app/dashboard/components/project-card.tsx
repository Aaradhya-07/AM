"use client";

import Link from "next/link";
import { GitHubGlyph, TerminalNode } from "../../components/circuitry";

export interface ProjectData {
  id: string;
  name: string;
  repo: string;
  branch: string;
  contractVersion: string;
  targetHardware: string;
  conformanceStatus: "verified" | "drift_detected" | "pending_ratification";
  boundariesCount: number;
  lastUpdated: string;
  lastCommit: string;
  description: string;
}

export function ProjectCard({
  project,
  onInspect,
}: {
  project: ProjectData;
  onInspect?: (project: ProjectData) => void;
}) {
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

  return (
    <div className="group relative rounded-module border border-line-muted bg-surface/90 p-5 transition-all duration-200 hover:border-gold/60 hover:bg-surface hover:shadow-xl">
      {/* Top row: Name, Repo & Status */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-brand text-lg font-bold tracking-tight text-canvas group-hover:text-gold transition-colors">
              {project.name}
            </h3>
            {getStatusBadge()}
          </div>
          <div className="mt-1 flex items-center gap-2 font-mono text-xs text-sand/60">
            <GitHubGlyph />
            <span>{project.repo}</span>
            <span>·</span>
            <span className="text-sand/40">branch: {project.branch}</span>
          </div>
        </div>

        <div className="text-right font-mono text-[11px] text-sand/50">
          <span>{project.lastUpdated}</span>
        </div>
      </div>

      <p className="mt-3 text-xs text-sand/80 line-clamp-2 leading-relaxed">
        {project.description}
      </p>

      {/* Contract & Architecture Specs */}
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-b border-line-muted/40 py-3 font-mono text-xs">
        <div>
          <span className="block text-[10px] uppercase text-sand/40">
            Contract Schema
          </span>
          <span className="font-semibold text-sand/90">
            {project.contractVersion}
          </span>
        </div>
        <div>
          <span className="block text-[10px] uppercase text-sand/40">
            Monitored Boundaries
          </span>
          <span className="font-semibold text-sand/90">
            {project.boundariesCount} data flows
          </span>
        </div>
        <div className="col-span-2">
          <span className="block text-[10px] uppercase text-sand/40">
            Target Execution Profile
          </span>
          <span className="text-gold font-medium truncate block">
            {project.targetHardware}
          </span>
        </div>
      </div>

      {/* Card Actions */}
      <div className="mt-4 flex items-center justify-between pt-1">
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-sand/50">
          <TerminalNode active />
          <span>commit: {project.lastCommit.slice(0, 7)}</span>
        </div>

        <div className="flex items-center gap-2">
          {onInspect && (
            <button
              type="button"
              onClick={() => onInspect(project)}
              className="rounded-edge border border-line-muted bg-graphite/40 px-3 py-1.5 font-mono text-xs text-sand hover:border-gold hover:text-gold transition-colors"
            >
              Inspect
            </button>
          )}

          <Link
            href="/studio?load=atlas"
            className="inline-flex items-center gap-1 rounded-edge border border-gold/50 bg-gold/10 px-3 py-1.5 font-mono text-xs font-medium text-gold hover:border-gold hover:bg-gold/20 transition-colors"
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
      </div>
    </div>
  );
}
