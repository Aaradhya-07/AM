import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ConformanceReport,
  ConformanceResultRecord,
} from "@anvilmark/conformance";
import { evaluateConformance } from "@anvilmark/conformance";
import { collectEvidenceGaps } from "@anvilmark/conformance/review";
import type { ReviewEvidenceGap } from "@anvilmark/conformance/review";
import { buildProjectFacts } from "@anvilmark/context";
import type { ProjectContract } from "@anvilmark/project-contract";
import { parseProjectContract, unwrap } from "@anvilmark/project-contract";
import type { ScanArtifact, ScanConfig } from "@anvilmark/scanner";
import {
  ScanConfigSchema,
  SCAN_CONFIG_FORMAT,
  finalizeArtifact,
  scanRepository,
} from "@anvilmark/scanner";
import { ATLAS_CONTRACT_YAML, ATLAS_REPO_FILES } from "./atlas-fixtures";

export type AtlasModelChoice = "selected" | "different" | "dynamic";
export type AtlasDataChoice = "redacted" | "raw";

export interface AtlasCheckRequest {
  readonly model: AtlasModelChoice;
  readonly dataHandling: AtlasDataChoice;
}

export interface AtlasCheckResult {
  readonly report: ConformanceReport;
  readonly modelPassed: boolean;
  readonly privacyPassed: boolean;
  readonly modelVerdict: "pass" | "fail" | "unknown" | "not_applicable";
  readonly privacyVerdict: "pass" | "fail" | "unknown" | "not_applicable";
  readonly source: string;
  readonly traces: readonly string[];
  /** Recorded evidence gaps of the Atlas contract; code checks do not close them. */
  readonly evidenceGaps: readonly ReviewEvidenceGap[];
  readonly evidenceGap: {
    readonly requiredF1: number;
    readonly measuredF1: number | null;
    readonly status: "missing";
    readonly budget: number;
    readonly explanation: string;
  };
}

/** The engine ran but could not analyze the Atlas fixture. */
export class AtlasAnalysisError extends Error {
  readonly analysisErrors: readonly string[];

  constructor(analysisErrors: readonly string[]) {
    super(`Atlas analysis failed: ${analysisErrors.join("; ")}`);
    this.name = "AtlasAnalysisError";
    this.analysisErrors = analysisErrors;
  }
}

const ATLAS_AS_OF = "2026-09-16T12:00:00Z";

let cachedContract: ProjectContract | null = null;

export async function getAtlasContract(): Promise<ProjectContract> {
  if (cachedContract) return cachedContract;
  cachedContract = unwrap(parseProjectContract(ATLAS_CONTRACT_YAML, "yaml"));
  return cachedContract;
}

export function getAtlasScanConfig(): ScanConfig {
  return ScanConfigSchema.parse({
    format: SCAN_CONFIG_FORMAT,
    sources: [
      {
        id: "source.raw_ticket",
        data_classification: "raw_customer_ticket",
        function: { path: "src/tickets.ts", export: "readTicket" },
        architecture_node_ref: "ticket-intake",
      },
    ],
    sanitizers: [
      {
        id: "sanitizer.pii",
        function: { path: "src/redact.ts", export: "redactTicket" },
        clears: ["raw_customer_ticket"],
        produces: "redacted_customer_ticket",
        architecture_node_ref: "pii-redactor",
      },
    ],
    sinks: [
      {
        id: "sink.openai",
        recognizer: "openai",
        architecture_node_ref: "remote-model-provider",
        candidate_ref: "candidate.classification.remote_unselected",
      },
    ],
    components: [
      {
        id: "component.classifier",
        path: "src/classify.ts",
        export: "classifyTicket",
        architecture_node_ref: "ticket-classifier",
        workload_ref: "classification",
      },
    ],
  });
}

export function buildSyntheticClassifySource(
  model: AtlasModelChoice,
  dataHandling: AtlasDataChoice,
): string {
  const modelExpression =
    model === "selected"
      ? '"gpt-4o-mini-2024-07-18"'
      : model === "different"
        ? '"gpt-4o"'
        : 'process.env.MODEL ?? "gpt-4o"';

  const textExpression =
    dataHandling === "redacted"
      ? "const text = redactTicket(ticket);"
      : "const text = ticket;";

  return `import OpenAI from "openai";
import { readTicket } from "./tickets";
import { redactTicket } from "./redact";

const client = new OpenAI();

export async function classifyTicket(id: string) {
  const ticket = readTicket(id);
  ${textExpression}

  return client.chat.completions.create({
    model: ${modelExpression},
    messages: [{ role: "user", content: text }],
  });
}
`;
}

export async function checkAtlasPermutation(
  request: AtlasCheckRequest,
): Promise<AtlasCheckResult> {
  const contract = await getAtlasContract();
  const config = getAtlasScanConfig();

  const tempDir = await mkdtemp(join(tmpdir(), "anvilmark-playground-"));

  try {
    // 1. Write base repository & synthetic SDK files
    for (const [relPath, fileContent] of Object.entries(ATLAS_REPO_FILES)) {
      const fullPath = join(tempDir, relPath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, fileContent, "utf8");
    }

    // 2. Write customized classify.ts
    const source = buildSyntheticClassifySource(
      request.model,
      request.dataHandling,
    );
    await writeFile(join(tempDir, "src/classify.ts"), source, "utf8");

    // 4. Scan repository
    const outcome = scanRepository({
      repositoryPath: tempDir,
      repositoryRoot: ".",
      repositoryDeclaredInContract: true,
      deniedDirectories: [join(tempDir, ".anvilmark")],
      contract,
      stateRevision: null,
      config,
      configSource: { source: "default" },
    });

    const scanArtifact: ScanArtifact = finalizeArtifact(outcome.content, {
      observed_at: ATLAS_AS_OF,
      basis: "explicit",
    });

    // 5. Evaluate conformance
    const report = evaluateConformance({
      contract,
      scan: scanArtifact,
      evaluatedAt: ATLAS_AS_OF,
    });

    const modelResult = report.results.find(
      (r: ConformanceResultRecord) => r.rule_kind === "approved_candidate_only",
    );
    const flowResult = report.results.find(
      (r: ConformanceResultRecord) => r.rule_kind === "forbid_dataflow",
    );

    // Never substitute verdicts: if the engine could not analyze the fixture,
    // the caller must show that, not a result the engine did not produce.
    if (report.analysis_errors.length > 0 || !modelResult || !flowResult) {
      throw new AtlasAnalysisError(
        report.analysis_errors.length > 0
          ? report.analysis_errors
          : ["the engine produced no result for one or both Atlas rules"],
      );
    }

    return {
      report,
      modelPassed: modelResult.verdict === "pass",
      privacyPassed: flowResult.verdict === "pass",
      modelVerdict: modelResult.verdict,
      privacyVerdict: flowResult.verdict,
      source,
      traces: flowResult.trace.map((step) => step.kind),
      evidenceGaps: collectEvidenceGaps(
        buildProjectFacts(contract, {
          asOf: ATLAS_AS_OF,
          projection: "remote-default",
          stateRevision: null,
        }),
      ),
      evidenceGap: {
        requiredF1: 0.9,
        measuredF1: null,
        status: "missing",
        budget: 750,
        explanation:
          "Required classification quality is F1 ≥ 0.90 (mandatory). No empirical evaluation result has been recorded. Passing code checks does not establish model accuracy or privacy efficacy.",
      },
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
