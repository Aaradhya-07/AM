import { posix } from "node:path";

import type { ProjectContract } from "@anvilmark/project-contract";
import { compareCodeUnits, prettyStringify } from "@anvilmark/project-contract";

import { renderAgentContext } from "./agent-context.js";
import { renderCalm } from "./calm.js";
import type { ProjectFacts } from "./facts.js";
import { timeSensitiveDifferences } from "./freshness.js";
import { stateRevisionText } from "./header.js";
import { buildProjectFacts } from "./facts.js";
import { renderMermaid } from "./mermaid.js";
import type { ProjectionName } from "./source.js";
import { GENERATOR_ID, GENERATOR_VERSION, digestText } from "./source.js";

export const MANIFEST_FORMAT = "anvilmark-generated-manifest/0.1" as const;

export type ArtifactKind = "agent_context" | "calm_1_2" | "mermaid";

export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "agent_context",
  "calm_1_2",
  "mermaid",
];

/**
 * Where artifacts are written, relative to the project root and in POSIX form.
 *
 * `architecture.generated` paths in the contract are relative to `.anvilmark/`
 * (the Atlas fixture declares `./architecture/calm.json`). A null path uses the
 * default. Agent context and the manifest have fixed locations.
 */
export interface ArtifactPaths {
  readonly agent_context: string;
  readonly calm_1_2: string;
  readonly mermaid: string;
  readonly manifest: string;
}

export const DEFAULT_ARTIFACT_PATHS: ArtifactPaths = {
  agent_context: ".anvilmark/generated/agent-context.md",
  calm_1_2: ".anvilmark/architecture/calm.json",
  mermaid: ".anvilmark/architecture/view.mmd",
  manifest: ".anvilmark/generated/manifest.json",
};

/** Paths a generated view may never replace. */
function reserved(path: string): string | null {
  if (path === ".anvilmark/project.yaml") return "the project contract";
  if (path === ".anvilmark/.lock") return "the write lock";
  for (const prefix of [
    ".anvilmark/history/",
    ".anvilmark/intelligence/",
    ".anvilmark/evaluations/",
  ]) {
    if (path.startsWith(prefix)) return `the ${prefix} directory`;
  }
  return null;
}

export class ArtifactPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactPathError";
  }
}

function resolveGeneratedPath(
  declared: string | null,
  fallback: string,
  field: string,
): string {
  if (declared === null) return fallback;
  if (declared.includes("\\") || declared.includes("\0")) {
    throw new ArtifactPathError(
      `architecture.generated.${field} ${JSON.stringify(declared)} must be a POSIX path relative to .anvilmark/`,
    );
  }
  const joined = posix.normalize(posix.join(".anvilmark", declared));
  if (!joined.startsWith(".anvilmark/") || joined.endsWith("/")) {
    throw new ArtifactPathError(
      `architecture.generated.${field} ${JSON.stringify(declared)} resolves outside .anvilmark/ or to a directory; generated views are written only inside .anvilmark/`,
    );
  }
  const clash = reserved(joined);
  if (clash !== null) {
    throw new ArtifactPathError(
      `architecture.generated.${field} ${JSON.stringify(declared)} would overwrite ${clash}`,
    );
  }
  return joined;
}

export function artifactPaths(contract: ProjectContract): ArtifactPaths {
  const generated = contract.architecture.generated;
  const paths: ArtifactPaths = {
    agent_context: DEFAULT_ARTIFACT_PATHS.agent_context,
    calm_1_2: resolveGeneratedPath(
      generated.calm_1_2,
      DEFAULT_ARTIFACT_PATHS.calm_1_2,
      "calm_1_2",
    ),
    mermaid: resolveGeneratedPath(
      generated.mermaid,
      DEFAULT_ARTIFACT_PATHS.mermaid,
      "mermaid",
    ),
    manifest: DEFAULT_ARTIFACT_PATHS.manifest,
  };
  const all = Object.values(paths);
  if (new Set(all).size !== all.length) {
    throw new ArtifactPathError(
      `generated views must have distinct paths; got ${all.join(", ")}`,
    );
  }
  return paths;
}

export interface RenderedArtifact {
  readonly kind: ArtifactKind;
  readonly path: string;
  readonly content: string;
  readonly digest: string;
}

export interface GenerationManifest {
  readonly format: typeof MANIFEST_FORMAT;
  readonly authority: "generated-output";
  readonly source: {
    readonly project_id: string;
    readonly contract_revision: number;
    readonly state_revision: number | null;
    readonly contract_hash: string;
    readonly schema_version: string;
  };
  readonly generator: string;
  readonly projection: ProjectionName;
  readonly as_of: string;
  readonly artifacts: readonly {
    readonly kind: ArtifactKind;
    readonly path: string;
    readonly digest: string;
  }[];
}

export interface RenderedSet {
  readonly facts: ProjectFacts;
  readonly artifacts: readonly RenderedArtifact[];
  readonly manifest: GenerationManifest;
  readonly manifestPath: string;
  readonly manifestText: string;
}

/**
 * Render every artifact and the manifest that describes them.
 *
 * Pure: the same contract, projection and `as_of` always produce the same
 * bytes. The manifest records no generation clock -- only the `as_of` the
 * caller chose -- so regenerating an unchanged source is byte-stable.
 */
export function renderArtifactSet(
  contract: ProjectContract,
  options: {
    readonly asOf: string;
    readonly projection?: ProjectionName;
    readonly stateRevision?: number | null;
  },
): RenderedSet {
  const projection = options.projection ?? "remote-default";
  const paths = artifactPaths(contract);
  const facts = buildProjectFacts(contract, {
    asOf: options.asOf,
    projection,
    stateRevision: options.stateRevision ?? null,
  });
  const contents: Record<ArtifactKind, string> = {
    agent_context: renderAgentContext(facts),
    calm_1_2: renderCalm(facts),
    mermaid: renderMermaid(facts),
  };
  const artifacts = ARTIFACT_KINDS.map((kind) => ({
    kind,
    path: paths[kind],
    content: contents[kind],
    digest: digestText(contents[kind]),
  }));
  const manifest: GenerationManifest = {
    format: MANIFEST_FORMAT,
    authority: "generated-output",
    source: {
      project_id: facts.source.project_id,
      contract_revision: facts.source.contract_revision,
      state_revision: facts.source.state_revision,
      contract_hash: facts.source.contract_hash,
      schema_version: facts.source.schema_version,
    },
    generator: facts.source.generator,
    projection,
    as_of: options.asOf,
    artifacts: artifacts.map(({ kind, path, digest }) => ({
      kind,
      path,
      digest,
    })),
  };
  return {
    facts,
    artifacts,
    manifest,
    manifestPath: paths.manifest,
    manifestText: prettyStringify(manifest),
  };
}

export type ArtifactStatus =
  | "current"
  | "missing"
  | "tampered"
  | "stale_source"
  | "stale_generator"
  | "unexpected_path";

export type GenerationStatus =
  | "current"
  | "missing"
  | "incomplete"
  | "tampered"
  | "stale_source"
  | "stale_generator"
  | "stale_time";

export interface GenerationCheck {
  readonly status: GenerationStatus;
  /** True only for `current`. */
  readonly ok: boolean;
  readonly current_source: {
    readonly contract_revision: number;
    readonly state_revision: number | null;
    readonly contract_hash: string;
  };
  readonly manifest: GenerationManifest | null;
  readonly artifacts: readonly {
    readonly kind: ArtifactKind;
    readonly path: string;
    readonly status: ArtifactStatus;
  }[];
  readonly problems: readonly string[];
  readonly notices: readonly string[];
}

function stripAsOf(facts: ProjectFacts): string {
  return prettyStringify({
    ...facts,
    source: { ...facts.source, as_of: null },
  });
}

function parseManifest(text: string): GenerationManifest | null {
  try {
    const value = JSON.parse(text) as Partial<GenerationManifest>;
    if (
      value === null ||
      typeof value !== "object" ||
      typeof value.format !== "string" ||
      typeof value.generator !== "string" ||
      typeof value.as_of !== "string" ||
      typeof value.projection !== "string" ||
      typeof value.source?.contract_hash !== "string" ||
      !Array.isArray(value.artifacts)
    ) {
      return null;
    }
    return value as GenerationManifest;
  } catch {
    return null;
  }
}

/**
 * Check generated output against the contract, without trusting either the
 * manifest or the files.
 *
 * Every artifact is compared byte for byte with what this generator renders
 * from the current contract at the manifest's `as_of`, so a hand-edited file is
 * reported as tampered even if its manifest digest was edited to match. A
 * contract change reports `stale_source`; a different generator, format or
 * projection reports `stale_generator`; a partial or mismatched set reports
 * `incomplete`. When `now` is given and time-dependent standings (evidence
 * freshness, exception expiry) differ between `as_of` and `now`, an otherwise
 * current set reports `stale_time`.
 */
export function checkArtifactSet(input: {
  readonly contract: ProjectContract;
  readonly manifestText: string | null;
  readonly read: (path: string) => string | null;
  readonly now?: string;
  readonly projection?: ProjectionName;
  readonly stateRevision?: number | null;
}): GenerationCheck {
  const contract = input.contract;
  const paths = artifactPaths(contract);
  const notices: string[] = [];
  const problems: string[] = [];
  const probe = buildProjectFacts(contract, {
    asOf: input.now ?? "1970-01-01T00:00:00Z",
    projection: input.projection ?? "remote-default",
  });
  const stateRevision = input.stateRevision ?? null;
  const currentSource = {
    contract_revision: probe.source.contract_revision,
    state_revision: stateRevision,
    contract_hash: probe.source.contract_hash,
  };

  const base = {
    current_source: currentSource,
  };

  if (input.manifestText === null) {
    const present = ARTIFACT_KINDS.filter(
      (kind) => input.read(paths[kind]) !== null,
    );
    return {
      ...base,
      status: present.length === 0 ? "missing" : "incomplete",
      ok: false,
      manifest: null,
      artifacts: ARTIFACT_KINDS.map((kind) => ({
        kind,
        path: paths[kind],
        status: "missing" as const,
      })),
      problems: [
        present.length === 0
          ? `no generated output: ${paths.manifest} does not exist`
          : `${paths.manifest} does not exist, so ${present.map((kind) => paths[kind]).join(", ")} cannot be attributed to any source`,
      ],
      notices,
    };
  }

  const manifest = parseManifest(input.manifestText);
  if (manifest === null) {
    return {
      ...base,
      status: "tampered",
      ok: false,
      manifest: null,
      artifacts: ARTIFACT_KINDS.map((kind) => ({
        kind,
        path: paths[kind],
        status: "missing" as const,
      })),
      problems: [`${paths.manifest} is not a readable generation manifest`],
      notices,
    };
  }

  const generatorMatches =
    manifest.format === MANIFEST_FORMAT &&
    manifest.generator === `${GENERATOR_ID}/${GENERATOR_VERSION}` &&
    manifest.projection === (input.projection ?? manifest.projection) &&
    (manifest.projection === "remote-default" ||
      manifest.projection === "local-disclosed");
  const sourceMatches =
    manifest.source.contract_hash === currentSource.contract_hash &&
    (manifest.source.state_revision ?? null) === stateRevision;

  let expected: RenderedSet | null = null;
  try {
    expected = renderArtifactSet(contract, {
      asOf: manifest.as_of,
      projection: manifest.projection,
      stateRevision,
    });
  } catch (error) {
    problems.push(
      `the manifest cannot be reproduced: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const listed = new Map(
    manifest.artifacts.map((entry) => [entry.kind, entry] as const),
  );
  const artifacts = ARTIFACT_KINDS.map((kind) => {
    const path = paths[kind];
    const entry = listed.get(kind);
    const actual = input.read(path);
    let status: ArtifactStatus;
    if (entry === undefined || actual === null) {
      status = "missing";
    } else if (entry.path !== path) {
      status = "unexpected_path";
    } else if (entry.digest !== digestText(actual)) {
      status = "tampered";
    } else if (!generatorMatches) {
      status = "stale_generator";
    } else if (!sourceMatches) {
      status = "stale_source";
    } else if (
      expected === null ||
      expected.artifacts.find((item) => item.kind === kind)?.content !== actual
    ) {
      status = "tampered";
    } else {
      status = "current";
    }
    return { kind, path, status };
  });

  const extra = manifest.artifacts.filter(
    (entry) => !ARTIFACT_KINDS.includes(entry.kind),
  );
  if (extra.length > 0) {
    problems.push(
      `the manifest lists unknown artifacts: ${extra.map((entry) => String(entry.kind)).join(", ")}`,
    );
  }

  for (const artifact of artifacts) {
    switch (artifact.status) {
      case "missing":
        problems.push(
          `${artifact.path} is missing or not listed in the manifest`,
        );
        break;
      case "unexpected_path":
        problems.push(
          `${artifact.path} is not where the manifest recorded this view; the contract's generated paths changed`,
        );
        break;
      case "tampered":
        problems.push(
          `${artifact.path} does not match what the recorded source renders; it was edited or replaced after generation and is not authoritative`,
        );
        break;
      default:
        break;
    }
  }
  if (!generatorMatches) {
    problems.push(
      `generated by ${manifest.generator} (${manifest.format}, ${manifest.projection}); this is ${GENERATOR_ID}/${GENERATOR_VERSION} (${MANIFEST_FORMAT}, ${input.projection ?? manifest.projection})`,
    );
  }
  if (!sourceMatches) {
    problems.push(
      `generated from state revision ${stateRevisionText(manifest.source.state_revision ?? null)}, contract revision ${manifest.source.contract_revision} (${manifest.source.contract_hash}); project.yaml is now state revision ${stateRevisionText(stateRevision)}, contract revision ${currentSource.contract_revision} (${currentSource.contract_hash})`,
    );
  }

  const statuses = new Set(artifacts.map((entry) => entry.status));
  let status: GenerationStatus;
  if (statuses.has("tampered") || extra.length > 0) {
    status = "tampered";
  } else if (statuses.has("missing") || statuses.has("unexpected_path")) {
    status = "incomplete";
  } else if (!generatorMatches) {
    status = "stale_generator";
  } else if (!sourceMatches) {
    status = "stale_source";
  } else {
    status = "current";
  }

  if (status === "current" && input.now !== undefined && expected !== null) {
    const later = buildProjectFacts(contract, {
      asOf: input.now,
      projection: manifest.projection,
      stateRevision,
    });
    const differences =
      stripAsOf(later) === stripAsOf(expected.facts)
        ? []
        : timeSensitiveDifferences(expected.facts, later);
    if (differences.length > 0) {
      status = "stale_time";
      problems.push(
        `the snapshot's bytes match its source, but it is not current: time-dependent standings changed since as_of ${manifest.as_of} (${differences.join("; ")}); run "anvilmark generate --refresh"`,
      );
    }
  }

  if (status === "current") {
    notices.push(
      `generated output matches state revision ${stateRevisionText(stateRevision)}, contract revision ${currentSource.contract_revision} (${currentSource.contract_hash}) as of ${manifest.as_of}`,
    );
  }

  return {
    ...base,
    status,
    ok: status === "current",
    manifest,
    artifacts,
    problems: [...new Set(problems)].sort(compareCodeUnits),
    notices,
  };
}
