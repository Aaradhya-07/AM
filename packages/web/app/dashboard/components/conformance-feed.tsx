"use client";

import { useCallback, useEffect, useState } from "react";
import { TerminalNode } from "../../components/circuitry";

export interface ConformanceEvent {
  id: string;
  projectName: string;
  commit: string;
  trigger: string;
  status: "pass" | "fail" | "warn";
  details: string;
  timestamp: string;
}

function formatTimeAgo(isoString?: string): string {
  if (!isoString) return "just now";
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (isNaN(diffSec) || diffSec < 15) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

interface ApiRunRecord {
  id: string;
  project_id?: string;
  commit_sha?: string;
  agent_trigger?: string;
  status: "pass" | "fail" | "warn";
  details?: string;
  created_at?: string;
  projects?: {
    name?: string;
    repo_url?: string;
  } | null;
}

export function ConformanceFeed({
  events: initialEvents,
}: {
  events?: ConformanceEvent[];
}) {
  const [events, setEvents] = useState<ConformanceEvent[]>(initialEvents ?? []);
  const [loading, setLoading] = useState(false);

  const fetchEvents = useCallback(async (manual = false) => {
    if (manual) setLoading(true);
    try {
      const res = await fetch("/api/runs");
      if (!res.ok) return;
      const data = await res.json();
      if (!data.runs || data.runs.length === 0) {
        setEvents([]);
        return;
      }

      const live: ConformanceEvent[] = (data.runs as ApiRunRecord[]).map(
        (r) => ({
          id: r.id,
          projectName: r.projects?.name || "Connected Repository",
          commit: (r.commit_sha || "HEAD").slice(0, 7),
          trigger: r.agent_trigger || "CI Conformance Check",
          status: r.status,
          details: r.details || "Automated architectural boundary check",
          timestamp: formatTimeAgo(r.created_at),
        }),
      );

      setEvents(live);
    } catch {
      // Offline or network error handled gracefully
    } finally {
      if (manual) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEvents();
    const timer = setInterval(() => void fetchEvents(), 15000);
    return () => clearInterval(timer);
  }, [fetchEvents]);

  return (
    <div className="rounded-module border border-line-muted bg-surface/90 p-5">
      <div className="flex items-center justify-between border-b border-line-muted/60 pb-3">
        <div className="flex items-center gap-2">
          <TerminalNode active />
          <h4 className="font-brand text-sm font-bold tracking-tight text-canvas">
            Agent & CI Conformance Stream
          </h4>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchEvents(true)}
            disabled={loading}
            className="font-mono text-[10px] text-sand/50 hover:text-gold transition-colors"
            title="Refresh stream"
          >
            {loading ? "Syncing..." : "Sync"}
          </button>
          <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-gold">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>LIVE</span>
          </span>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="py-8 text-center">
          <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-sand/10 text-sand/60 mb-2">
            <TerminalNode />
          </div>
          <p className="font-mono text-xs font-medium text-sand/80">
            Awaiting first conformance stream event
          </p>
          <p className="mx-auto mt-1 max-w-xs text-[11px] text-sand/50">
            Run <code className="font-mono text-gold">anvilmark push</code> in
            your repository or configure CI to stream live boundary audits here.
          </p>
        </div>
      ) : (
        <div className="mt-4 divide-y divide-line-muted/30">
          {events.slice(0, 8).map((evt) => (
            <div key={evt.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between font-mono text-xs">
                <div className="flex items-center gap-2">
                  {evt.status === "pass" && (
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                  )}
                  {evt.status === "warn" && (
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                  )}
                  {evt.status === "fail" && (
                    <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
                  )}
                  <span className="font-semibold text-canvas">
                    {evt.projectName}
                  </span>
                  <span className="text-sand/40">·</span>
                  <span className="text-sand/70">{evt.trigger}</span>
                </div>
                <span className="text-sand/40 text-[11px]">
                  {evt.timestamp}
                </span>
              </div>

              <p className="mt-1 font-mono text-[11px] text-sand/80 leading-relaxed pl-4">
                {evt.details}
              </p>

              <div className="mt-1 flex items-center gap-2 pl-4 font-mono text-[10px] text-sand/50">
                <span>commit: {evt.commit}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
