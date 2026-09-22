import {
  parseJsonDocument,
  prettyStringify,
  unwrap,
} from "@anvilmark/project-contract";

import type { ConformanceReport } from "./schemas.js";
import {
  ConformanceReportSchema,
  reportConformanceHash,
  resultRecordContentHash,
  summarizeResults,
} from "./schemas.js";

export function serializeReport(report: ConformanceReport): string {
  return prettyStringify(report);
}

export function readReport(text: string): ConformanceReport {
  const parsed = unwrap(parseJsonDocument(text));
  const validated = ConformanceReportSchema.parse(parsed);

  const expectedHash = reportConformanceHash(validated);
  if (validated.conformance_hash !== expectedHash) {
    throw new Error(
      `Conformance report content hash mismatch: expected ${expectedHash}, got ${validated.conformance_hash}`,
    );
  }

  for (const result of validated.results) {
    if (result.content_hash !== resultRecordContentHash(result))
      throw new Error("Conformance result content hash mismatch");
  }
  const summary = summarizeResults(
    validated.results,
    validated.analysis_errors,
  );
  if (JSON.stringify(summary) !== JSON.stringify(validated.summary))
    throw new Error("Conformance summary does not match results");
  return validated;
}
