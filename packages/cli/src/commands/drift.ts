import { lstat, realpath } from "node:fs/promises";
import { z } from "zod";

import { EXIT } from "../io.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  flag,
  parse,
  projectDirectory,
  writeJson,
} from "./common.js";
import {
  matchesEndpoint,
  matchesFlow,
  observeArchitecture,
} from "./architecture-observations.js";
import { loadSlicePlan } from "./slice-storage.js";

const DRIFT_USAGE = "Usage: anvilmark drift [-C DIR] [--json]";
const DriftItem = z.strictObject({
  severity: z.enum(["error", "warning", "info"]),
  kind: z.enum([
    "undeclared_flow",
    "missing_planned_flow",
    "boundary_bypass",
    "unapproved_ai_sdk",
  ]),
  from: z.string(),
  to: z.string(),
  boundary: z.string().optional(),
  evidencePaths: z.array(z.string()),
  detail: z.string(),
});
export const ArchitectureDriftReportSchema = z.strictObject({
  schemaVersion: z.literal("anvilmark.drift-report.v1"),
  scannedAt: z.iso.datetime(),
  planTitle: z.string(),
  status: z.enum(["aligned", "drifted", "no_active_plan"]),
  plannedFlowsCount: z.int().nonnegative(),
  observedEdgesCount: z.int().nonnegative(),
  items: z.array(DriftItem),
});
export type ArchitectureDriftReport = z.infer<
  typeof ArchitectureDriftReportSchema
>;

export async function measureDrift(
  directory: string,
  now = new Date().toISOString(),
): Promise<ArchitectureDriftReport> {
  if (!(await lstat(directory)).isDirectory())
    throw new Error("Expected a real repository directory");
  const root = await realpath(directory);
  const bundle = await loadSlicePlan(root);
  const items: ArchitectureDriftReport["items"] = [];
  const header = {
    schemaVersion: "anvilmark.drift-report.v1" as const,
    scannedAt: now,
  };
  if (!bundle)
    return {
      ...header,
      planTitle: "",
      status: "no_active_plan",
      plannedFlowsCount: 0,
      observedEdgesCount: 0,
      items,
    };
  const { flows, title } = bundle.plan;
  const edges = observeArchitecture(root);
  const matched = new Set<number>();

  for (const edge of edges) {
    const endpoints = flows.flatMap((flow, index) =>
      matchesFlow(flow, edge) ? [index] : [],
    );
    if (edge.kind !== "sdk") for (const index of endpoints) matched.add(index);
    if (
      endpoints.length ||
      (edge.kind === "import" &&
        !flows.some(
          (flow) =>
            matchesEndpoint(flow.from, edge.from) ||
            matchesEndpoint(flow.to, edge.to),
        ))
    )
      continue;
    const evidence = {
      from: edge.from,
      to: edge.to,
      evidencePaths: [edge.from],
    };
    if (edge.kind === "sdk") {
      // Manifests can declare an SDK for an approved call elsewhere.
      if (
        edge.from.endsWith("package.json") &&
        flows.some((flow) => matchesEndpoint(flow.to, edge.to))
      )
        continue;
      items.push({
        ...evidence,
        severity: "warning",
        kind: "unapproved_ai_sdk",
        detail:
          "Observed an AI SDK without a matching planned destination for this source.",
      });
    } else if (
      edge.kind === "boundary" ||
      (edge.kind === "import" &&
        flows.some((flow) => matchesEndpoint(flow.to, edge.to)))
    ) {
      const boundary =
        edge.boundary ??
        flows.find((flow) => matchesEndpoint(flow.to, edge.to))?.boundary;
      items.push({
        ...evidence,
        severity: "error",
        kind: "boundary_bypass",
        ...(boundary === undefined ? {} : { boundary }),
        detail:
          "Observed an edge across a trust boundary without a matching planned flow.",
      });
    } else {
      items.push({
        ...evidence,
        severity: "warning",
        kind: "undeclared_flow",
        detail: "Observed a static edge without a matching planned flow.",
      });
    }
  }
  flows.forEach(({ from, to, boundary }, index) => {
    if (!matched.has(index))
      items.push({
        severity: "info",
        kind: "missing_planned_flow",
        from,
        to,
        boundary,
        evidencePaths: [],
        detail: "No static observation matched this planned flow.",
      });
  });
  return {
    ...header,
    planTitle: title,
    status: items.length ? "drifted" : "aligned",
    plannedFlowsCount: flows.length,
    observedEdgesCount: edges.length,
    items,
  };
}

export async function driftCommand({ args, io }: CommandContext) {
  const parsed = parse(args, {}, DRIFT_USAGE);
  if (flag(parsed, "help")) {
    io.stdout(DRIFT_USAGE + "\n");
    return EXIT.ok;
  }
  if (parsed.positionals.length)
    throw new UsageError("Unexpected positional argument", DRIFT_USAGE);
  const report = await measureDrift(projectDirectory(io, parsed), io.clock());
  if (flag(parsed, "json")) writeJson(io, report);
  else {
    io.stdout(
      (report.planTitle ? report.planTitle + " · " : "") + report.status + "\n",
    );
    for (const item of report.items)
      io.stdout(
        "  " +
          item.severity +
          " " +
          item.from +
          " → " +
          item.to +
          ": " +
          item.detail +
          "\n",
      );
  }
  return EXIT.ok;
}
