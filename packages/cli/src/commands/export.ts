import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

import { assembleWebReviewBundle } from "@anvilmark/conformance";
import type {
  BundlePartInput,
  ConformanceReport,
  OmittedSource,
} from "@anvilmark/conformance";
import type { ScanArtifact } from "@anvilmark/scanner";

import type { CliIo, ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import { CLI_VERSION } from "../version.js";
import { checkConformance, readStoredConformance } from "../conformance.js";
import { lines } from "../render.js";
import { collectReviewSources } from "../review-sources.js";
import { checkScan, readStoredScan } from "../scan.js";
import {
  StoreError,
  findProjectRoot,
  loadProject,
  pathsFor,
} from "../store.js";
import type { CommandContext, OptionSpec, Parsed } from "./common.js";
import { UsageError, flag, parse, stringOption, writeJson } from "./common.js";

export const EXPORT_USAGE = `Usage:
  anvilmark export [--out FILE | --json] [--include-source] [--shareable]
                   [--allow-stale] [--require-report]
                   [--repository PATH] [--config FILE] [--project-dir DIR]

Assembles a Web Review Bundle for ANVILMARK Studio containing:
  - the project contract (redacted with --shareable)
  - derived decision-layer facts, including evidence gaps
  - the latest scan and conformance report, each checked for freshness
  - optionally, the source files the findings point at
  - hashes that let Studio detect edits made after export

Outputs:
  .anvilmark/review-bundle.json (default, or --out FILE)

Options:
  --out FILE          output bundle destination (default: .anvilmark/review-bundle.json)
  --json              write the bundle JSON to stdout instead of a file
  --include-source    include the source files named by findings and traces.
                      Files outside the repository, changed since the scan, over
                      256 KiB (4 MiB in total) or containing a recognisable
                      credential are left out and listed in the manifest
  --shareable         remove identities, local directories and credential
                      references from the contract so the bundle can be shared
  --allow-stale       export a report or scan that no longer matches the project,
                      marked stale, instead of refusing
  --require-report    fail unless a current conformance report is included
  --repository PATH   repository to check freshness against (as for "check")
  --config FILE       scan declarations to check freshness against (as for "check")
  --project-dir DIR   project directory (default: current directory or nearest ancestor)

Exit codes: 0 exported, 1 refused (stale, tampered or missing required report), 2 usage error
`;

const SPECS: OptionSpec = {
  out: { type: "string" },
  "include-source": { type: "boolean" },
  shareable: { type: "boolean" },
  "allow-stale": { type: "boolean" },
  "require-report": { type: "boolean" },
  repository: { type: "string" },
  config: { type: "string" },
};

async function projectRoot(io: CliIo, parsed: Parsed): Promise<string> {
  const explicit = stringOption(parsed, "project-dir");
  const root =
    explicit === undefined
      ? await findProjectRoot(io.cwd)
      : resolve(io.cwd, explicit);
  if (root === null) {
    throw new StoreError(
      `no ANVILMARK project found in ${io.cwd} or any parent directory; run "anvilmark init" first`,
    );
  }
  return root;
}

function git(repository: string, args: readonly string[]): string | null {
  const result = spawnSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function sourceControl(repository: string) {
  const head = git(repository, ["rev-parse", "HEAD"]);
  if (head === null) return null;
  const status = git(repository, ["status", "--porcelain"]);
  return { head_sha: head, dirty: status === null ? null : status !== "" };
}

export async function exportCommand(
  context: CommandContext,
  argv: readonly string[] = context.args,
): Promise<ExitCode> {
  const parsed = parse(argv, SPECS, EXPORT_USAGE);
  if (flag(parsed, "help")) {
    context.io.stdout(EXPORT_USAGE);
    return EXIT.ok;
  }
  if (parsed.positionals.length > 0) {
    throw new UsageError(
      `unexpected arguments: ${parsed.positionals.join(" ")}`,
      EXPORT_USAGE,
    );
  }
  const asJson = flag(parsed, "json");
  const explicitOut = stringOption(parsed, "out");
  if (asJson && explicitOut !== undefined) {
    throw new UsageError(
      "--json writes to stdout; do not combine it with --out",
      EXPORT_USAGE,
    );
  }
  const allowStale = flag(parsed, "allow-stale");
  const requireReport = flag(parsed, "require-report");

  const root = await projectRoot(context.io, parsed);
  const loaded = await loadProject(root);
  const contract = loaded.contract;
  const stateRevision = loaded.head?.revision ?? null;

  const repositoryOption = stringOption(parsed, "repository");
  const configOption = stringOption(parsed, "config");
  const inputs = {
    root,
    clock: context.io.clock,
    ...(repositoryOption === undefined
      ? {}
      : { repository: resolve(context.io.cwd, repositoryOption) }),
    ...(configOption === undefined
      ? {}
      : { config: resolve(context.io.cwd, configOption) }),
  };

  // The report is the substance of the bundle: never export one silently
  // out of date or altered.
  const reportCheck = await checkConformance(inputs);
  let report: BundlePartInput<ConformanceReport> = { artifact: null };
  if (reportCheck.status === "invalid" || reportCheck.status === "tampered") {
    throw new StoreError(
      `the stored conformance report is ${reportCheck.status} (${reportCheck.reasons.join("; ")}); run "anvilmark check" to regenerate it`,
    );
  }
  if (reportCheck.status === "stale" && !allowStale) {
    throw new StoreError(
      `the stored conformance report is stale (${reportCheck.reasons.join("; ")}); run "anvilmark check" first, or pass --allow-stale to export it marked as stale`,
    );
  }
  if (requireReport && reportCheck.status !== "current") {
    throw new StoreError(
      reportCheck.status === "missing"
        ? 'no conformance report; run "anvilmark check" before exporting with --require-report'
        : `--require-report needs a current conformance report, but it is ${reportCheck.status} (${reportCheck.reasons.join("; ")})`,
    );
  }
  if (reportCheck.status === "current" || reportCheck.status === "stale") {
    const stored = await readStoredConformance(root);
    if (stored.status !== "valid") {
      throw new StoreError(
        'the stored conformance report changed during export; run "anvilmark export" again',
      );
    }
    report = {
      artifact: stored.report,
      freshness: reportCheck.status,
      problems: reportCheck.reasons,
    };
  }

  // The scan only supplies observations, so a stale or unreadable one is
  // left out with the reason rather than refusing the export.
  const storedScan = await readStoredScan(root);
  let scan: BundlePartInput<ScanArtifact> = { artifact: null };
  if (storedScan.status !== "missing") {
    const scanCheck = await checkScan(inputs).catch(
      (error: unknown) =>
        ({
          status: "invalid",
          reasons: [error instanceof Error ? error.message : String(error)],
        }) as const,
    );
    if (scanCheck.status === "current" && storedScan.status === "valid") {
      scan = { artifact: storedScan.artifact, freshness: "current" };
    } else if (
      scanCheck.status === "stale" &&
      storedScan.status === "valid" &&
      allowStale
    ) {
      scan = {
        artifact: storedScan.artifact,
        freshness: "stale",
        problems: scanCheck.reasons,
      };
    } else if (scanCheck.status === "stale") {
      scan = {
        artifact: null,
        problems: [
          `the stored scan is stale (${scanCheck.reasons.join("; ")}); run "anvilmark scan" to include it`,
        ],
      };
    } else {
      scan = {
        artifact: null,
        status: "error",
        problems: [
          `the stored scan is ${scanCheck.status}: ${scanCheck.reasons.join("; ")}`,
        ],
      };
    }
  }

  const repositoryRoot =
    report.artifact !== null
      ? resolve(root, report.artifact.scan.repository_root)
      : storedScan.status === "valid"
        ? resolve(root, storedScan.artifact.repository.root)
        : null;

  let sources: Record<string, string> | undefined;
  let sourcesOmitted: readonly OmittedSource[] = [];
  if (flag(parsed, "include-source") && repositoryRoot !== null) {
    const paths = new Set<string>();
    const expectedHashes = new Map<string, string>();
    if (storedScan.status === "valid") {
      for (const input of storedScan.artifact.repository.inputs) {
        expectedHashes.set(input.path, input.sha256);
      }
      if (scan.artifact) {
        for (const observation of scan.artifact.observations) {
          if (observation.location?.path) {
            paths.add(observation.location.path);
          }
        }
      }
    }
    for (const result of report.artifact?.results ?? []) {
      for (const location of result.locations) {
        paths.add(location.path);
        if (location.source_sha256) {
          expectedHashes.set(location.path, location.source_sha256);
        }
      }
      for (const step of result.trace) {
        if (step.path) paths.add(step.path);
      }
    }
    const collected = await collectReviewSources({
      repositoryRoot,
      paths,
      expectedHashes,
    });
    sources =
      Object.keys(collected.sources).length > 0 ? collected.sources : undefined;
    sourcesOmitted = collected.omitted;
  }

  const bundle = assembleWebReviewBundle({
    contract,
    stateRevision,
    scan,
    report,
    sources,
    sourcesOmitted,
    projection: flag(parsed, "shareable") ? "shareable" : "local",
    sourceControl:
      repositoryRoot === null ? null : sourceControl(repositoryRoot),
    generator: `anvilmark-cli/${CLI_VERSION}`,
  });

  if (asJson) {
    writeJson(context.io, bundle);
    return EXIT.ok;
  }

  const outPath =
    explicitOut !== undefined
      ? resolve(context.io.cwd, explicitOut)
      : join(pathsFor(root).directory, "review-bundle.json");

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(bundle, null, 2) + "\n", "utf8");

  const describe = (part: typeof bundle.scan | typeof bundle.report) =>
    part.freshness === null
      ? part.status
      : `${part.status} (${part.freshness})`;
  const omittedByReason = new Map<string, number>();
  for (const entry of bundle.manifest.sources_omitted) {
    omittedByReason.set(
      entry.reason,
      (omittedByReason.get(entry.reason) ?? 0) + 1,
    );
  }

  context.io.stdout(
    lines(
      "Exported Web Review Bundle:",
      `  File:        ${outPath}`,
      `  Projection:  ${bundle.projection}`,
      `  Project:     ${contract.project.id} (${contract.project.name})`,
      `  Contract:    ${bundle.contract.content_hash.slice(0, 19)}...`,
      `  Scan:        ${describe(bundle.scan)}`,
      `  Report:      ${describe(bundle.report)}`,
      flag(parsed, "include-source")
        ? `  Sources:     ${Object.keys(bundle.sources ?? {}).length} included, ${bundle.manifest.sources_omitted.length} omitted${
            omittedByReason.size === 0
              ? ""
              : ` (${[...omittedByReason].map(([reason, count]) => `${reason}: ${count}`).join(", ")})`
          }`
        : [],
      `  Integrity:   ${bundle.integrity_hash.slice(0, 19)}...`,
      [...bundle.report.problems, ...bundle.scan.problems].map(
        (problem) => `  warning: ${problem}`,
      ),
      "",
      "Review browser-locally in ANVILMARK Studio:",
      "  https://anvilmark.vercel.app/studio",
      "",
    ),
  );

  return EXIT.ok;
}
