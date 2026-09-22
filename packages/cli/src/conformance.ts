import { randomBytes } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { ConformanceReport } from "@anvilmark/conformance";
import {
  ConformanceReportSchema,
  evaluateConformance,
  readReport,
  reportConformanceHash,
  serializeReport,
} from "@anvilmark/conformance";
import { assertTimestamp } from "@anvilmark/context";
import { finalizeArtifact } from "@anvilmark/scanner";

import type { GenerateFs } from "./generate.js";
import { nodeGenerateFs } from "./generate.js";
import {
  CONFORMANCE_DIRECTORY,
  CONFORMANCE_REPORT_FILE,
  SCAN_CONFIG_FILE,
  resolveOutputBoundary,
} from "./output-boundary.js";
import {
  SCAN_CONFIG_PATH,
  readStoredScan,
  prepareScan,
  recheckScanInputs,
} from "./scan.js";
import { STATE_DIRECTORY, StoreError, acquireLock, pathsFor } from "./store.js";

export const CONFORMANCE_OUTPUT_PATH = `${STATE_DIRECTORY}/${CONFORMANCE_DIRECTORY}/${CONFORMANCE_REPORT_FILE}`;

export interface ConformanceOptions {
  readonly root: string;
  readonly repository?: string;
  readonly config?: string;
  readonly evaluatedAt?: string;
  readonly clock: () => string;
  readonly fs?: GenerateFs;
  readonly hooks?: { readonly afterEvaluation?: () => Promise<void> };
}

export type StoredConformance =
  | { readonly status: "missing" }
  | { readonly status: "invalid"; readonly problem: string }
  | { readonly status: "tampered"; readonly report: ConformanceReport }
  | { readonly status: "valid"; readonly report: ConformanceReport };

export async function readStoredConformance(
  root: string,
  fs: GenerateFs = nodeGenerateFs,
): Promise<StoredConformance> {
  await realpath(join(root, STATE_DIRECTORY)).catch(() => {
    throw new StoreError(
      `no ANVILMARK project at ${root}; run "anvilmark init" first`,
    );
  });
  const [output] = await resolveOutputBoundary(
    root,
    [CONFORMANCE_OUTPUT_PATH],
    {
      create: false,
      protect: { files: [SCAN_CONFIG_FILE] },
    },
  );
  if (output === undefined || !output.parentExists)
    return { status: "missing" };
  const text = await fs.read(output.physical);
  if (text === null) return { status: "missing" };

  try {
    const report = readReport(text);
    return { status: "valid", report };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("hash mismatch")) {
      try {
        const json = JSON.parse(text);
        const parsed = ConformanceReportSchema.safeParse(json);
        if (parsed.success) {
          return { status: "tampered", report: parsed.data };
        }
      } catch {
        // Fall through to invalid
      }
    }
    return { status: "invalid", problem: message };
  }
}

export interface ConformanceRunOutcome {
  readonly report: ConformanceReport;
  readonly path: string;
  readonly unchanged: boolean;
}

/** Current in-memory analysis shared by CLI and MCP. Never writes scan artifacts. */
export async function prepareCurrentConformance(options: ConformanceOptions) {
  const storedReport = await readStoredConformance(options.root, options.fs);
  const storedScan = await readStoredScan(options.root, options.fs);
  const selectionsDisagree =
    storedReport.status === "valid" &&
    storedScan.status === "valid" &&
    (storedReport.report.scan.repository_root !==
      storedScan.artifact.repository.root ||
      storedReport.report.scan.configuration_source !==
        storedScan.artifact.configuration.source ||
      storedReport.report.scan.configuration_path !==
        storedScan.artifact.configuration.path);
  const configurationsDisagree =
    storedReport.status === "valid" &&
    storedScan.status === "valid" &&
    (storedReport.report.scan.configuration_source !==
      storedScan.artifact.configuration.source ||
      storedReport.report.scan.configuration_path !==
        storedScan.artifact.configuration.path);
  const repositoriesDisagree =
    storedReport.status === "valid" &&
    storedScan.status === "valid" &&
    storedReport.report.scan.repository_root !==
      storedScan.artifact.repository.root;
  // When the repositories agree and one stored run used the declarations that
  // are the default now, that default is the unambiguous choice.
  const defaultDeclarations = (await stat(
    join(options.root, SCAN_CONFIG_PATH),
  ).then(
    (entry) => entry.isFile(),
    () => false,
  ))
    ? { source: "file", path: SCAN_CONFIG_PATH }
    : { source: "default", path: null };
  const isCurrentDefault = (source: string, path: string | null) =>
    source === defaultDeclarations.source && path === defaultDeclarations.path;
  const useCurrentDefault =
    configurationsDisagree &&
    !repositoriesDisagree &&
    options.config === undefined &&
    storedReport.status === "valid" &&
    storedScan.status === "valid" &&
    (isCurrentDefault(
      storedReport.report.scan.configuration_source,
      storedReport.report.scan.configuration_path,
    ) ||
      isCurrentDefault(
        storedScan.artifact.configuration.source,
        storedScan.artifact.configuration.path,
      ));
  if (
    selectionsDisagree &&
    !useCurrentDefault &&
    ((options.repository === undefined && options.config === undefined) ||
      (configurationsDisagree && options.config === undefined))
  )
    throw new StoreError(
      repositoriesDisagree
        ? "The stored scan and conformance report describe different repositories; pass --repository PATH to choose one (and --config FILE if their declarations differ)."
        : "The stored scan and conformance report used different declaration files, and neither is the current default; pass --config FILE to choose one.",
    );
  const previous =
    storedReport.status === "valid"
      ? {
          repository: storedReport.report.scan.repository_root,
          source: storedReport.report.scan.configuration_source,
          config: storedReport.report.scan.configuration_path,
        }
      : storedScan.status === "valid"
        ? {
            repository: storedScan.artifact.repository.root,
            source: storedScan.artifact.configuration.source,
            config: storedScan.artifact.configuration.path,
          }
        : null;
  if (
    options.config === undefined &&
    previous?.source === "file" &&
    previous.config === null
  )
    throw new StoreError(
      "The previous scan used an external configuration; supply --config explicitly to reproduce its input selection.",
    );
  const { hooks, ...scanOptions } = options;
  void hooks;
  const prepared = await prepareScan({
    ...scanOptions,
    ...(previous === null ||
    (selectionsDisagree && options.repository === undefined)
      ? {}
      : { fallbackRepository: resolve(options.root, previous.repository) }),
    ...(options.config !== undefined ||
    useCurrentDefault ||
    previous?.source !== "file" ||
    previous.config === null
      ? {}
      : { config: resolve(options.root, previous.config) }),
  });
  const stamp = options.evaluatedAt ?? options.clock();
  assertTimestamp(stamp);
  const artifact = finalizeArtifact(prepared.outcome.content, {
    observed_at: stamp,
    basis: "clock",
  });
  const report = evaluateConformance({
    contract: prepared.contract,
    scan: artifact,
    stateRevision: prepared.stateRevision,
    evaluatedAt: stamp,
  });
  const recheck = () =>
    recheckScanInputs(prepared, options.fs ?? nodeGenerateFs);
  await recheck();
  return { prepared, artifact, report, recheck };
}

export async function runConformance(
  options: ConformanceOptions,
): Promise<ConformanceRunOutcome> {
  const fs = options.fs ?? nodeGenerateFs;
  const release = await acquireLock(pathsFor(options.root), options.clock);
  try {
    const current = await prepareCurrentConformance(options);
    await options.hooks?.afterEvaluation?.();
    await current.recheck();
    const protect = {
      files: [SCAN_CONFIG_FILE],
      paths:
        current.prepared.configFile === null
          ? []
          : [
              {
                path: current.prepared.configFile.absolute,
                label: "the scan declaration file",
              },
            ],
    };
    const [output] = await resolveOutputBoundary(
      options.root,
      [CONFORMANCE_OUTPUT_PATH],
      { create: true, protect },
    );
    if (!output)
      throw new StoreError(
        "The conformance output is inside a protected location.",
      );
    const before = await fs.read(output.physical);
    const stored = await readStoredConformance(options.root, fs);
    if (
      stored.status === "valid" &&
      stored.report.conformance_hash === current.report.conformance_hash
    ) {
      const [checked] = await resolveOutputBoundary(
        options.root,
        [CONFORMANCE_OUTPUT_PATH],
        { create: false, protect },
      );
      await current.recheck();
      if (
        checked?.physical !== output.physical ||
        (await fs.read(output.physical)) !== before
      )
        throw new StoreError(
          "The stored report changed while evaluating; rerun conformance.",
        );
      await current.recheck();
      return {
        report: stored.report,
        path: CONFORMANCE_OUTPUT_PATH,
        unchanged: true,
      };
    }
    const temporary = `${output.physical}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    try {
      await fs.writeTemporary(temporary, serializeReport(current.report));
      const [checked] = await resolveOutputBoundary(
        options.root,
        [CONFORMANCE_OUTPUT_PATH],
        { create: false, protect },
      );
      await current.recheck();
      if (
        checked?.physical !== output.physical ||
        (await fs.read(output.physical)) !== before
      )
        throw new StoreError(
          "The conformance output changed while evaluating; no report was replaced.",
        );
      await current.recheck();
      await fs.rename(temporary, output.physical);
    } catch (error) {
      await fs.remove(temporary).catch(() => undefined);
      throw error;
    }
    return {
      report: current.report,
      path: CONFORMANCE_OUTPUT_PATH,
      unchanged: false,
    };
  } finally {
    await release();
  }
}

export interface ConformanceCheckOutcome {
  readonly status: "current" | "missing" | "invalid" | "tampered" | "stale";
  readonly reasons: readonly string[];
  readonly stored_conformance_hash: string | null;
  readonly current_conformance_hash: string | null;
}

export async function checkConformance(
  options: ConformanceOptions,
): Promise<ConformanceCheckOutcome> {
  const fs = options.fs ?? nodeGenerateFs;
  const stored = await readStoredConformance(options.root, fs);
  if (stored.status === "missing" || stored.status === "invalid") {
    return {
      status: stored.status,
      reasons:
        stored.status === "invalid"
          ? [stored.problem]
          : ['no conformance report; run "anvilmark conformance"'],
      stored_conformance_hash: null,
      current_conformance_hash: null,
    };
  }
  if (stored.status === "tampered") {
    return {
      status: "tampered",
      reasons: [
        "the stored conformance report does not match its own conformance hash",
      ],
      stored_conformance_hash: stored.report.conformance_hash,
      current_conformance_hash: reportConformanceHash(stored.report),
    };
  }

  const current = await prepareCurrentConformance(options);
  await options.hooks?.afterEvaluation?.();
  await current.recheck();
  const reloaded = await readStoredConformance(options.root, fs);
  if (
    reloaded.status !== "valid" ||
    serializeReport(reloaded.report) !== serializeReport(stored.report)
  )
    return {
      status: "stale",
      reasons: ["stored report changed while checking"],
      stored_conformance_hash: stored.report.conformance_hash,
      current_conformance_hash: current.report.conformance_hash,
    };
  await current.recheck();
  const matches =
    current.report.conformance_hash === stored.report.conformance_hash;
  return {
    status: matches ? "current" : "stale",
    reasons: matches
      ? []
      : [
          "current source, contract, configuration or detector differs from the report",
        ],
    stored_conformance_hash: stored.report.conformance_hash,
    current_conformance_hash: current.report.conformance_hash,
  };
}
