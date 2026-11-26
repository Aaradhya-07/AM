import { join } from "node:path";

import { inventoryRepository } from "@anvilmark/scanner";

import type { HandoffPlan } from "./apply-plan.js";
import { isSensitivePath } from "./export-context.js";
import type { z } from "zod";

type Flow = z.infer<typeof HandoffPlan>["flows"][number];

export interface ObservedEdge {
  from: string;
  to: string;
  kind: "import" | "boundary" | "provider" | "sdk";
  boundary?: string;
}

export function observeArchitecture(root: string): ObservedEdge[] {
  const edges = new Map<string, ObservedEdge>();
  const add = (edge: ObservedEdge) => {
    if (isSensitivePath(edge.from) || isSensitivePath(edge.to)) return;
    edges.set(JSON.stringify(edge), edge);
  };
  const { content } = inventoryRepository({
    repositoryPath: root,
    deniedDirectories: [join(root, ".anvilmark")],
    onLocalImport: (from, to) => add({ from, to, kind: "import" }),
  });
  for (const observation of content.observations) {
    const from = observation.location.path;
    if (observation.kind === "provider_call") {
      const { provider, endpoint } = observation;
      const to =
        endpoint.provider ??
        endpoint.host ??
        (endpoint.selection === "default" ? provider : "unresolved provider");
      add({ from, to, kind: "provider" });
    }
    if (observation.kind === "sdk_import") {
      const { package: to, category, recognizer } = observation;
      if (category === "boundary") {
        add({ from, to, kind: "boundary", boundary: recognizer ?? to });
      } else {
        add({ from, to, kind: "sdk" });
      }
    }
  }
  for (const dependency of content.inventory.ai_dependencies) {
    if (dependency.category === "other") continue;
    add({ from: dependency.manifest, to: dependency.name, kind: "sdk" });
  }
  return [...edges.keys()].sort().map((key) => edges.get(key)!);
}

export function matchesEndpoint(label: string, actual: string): boolean {
  const expected = label.trim().replace(/^\.\//, "").replace(/\/$/, "");
  return expected === actual || actual.startsWith(expected + "/");
}

export function matchesFlow(flow: Flow, edge: ObservedEdge): boolean {
  return (
    matchesEndpoint(flow.from, edge.from) && matchesEndpoint(flow.to, edge.to)
  );
}
