import { estimateModelFit } from "./estimate.js";
import type { SizingArtifact, SizingInput, SizingResult } from "./schema.js";
import {
  DigestSchema,
  SIZING_FORMAT,
  SizingArtifactSchema,
  SizingInputSchema,
} from "./schema.js";

/** Inject Node crypto or Web Crypto at the boundary; the package imports neither. */
export type TextHasher = (text: string) => string | Promise<string>;

/** Canonical JSON over already validated JSON values. No locale-dependent ordering. */
export function canonicalSizingJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON requires finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map(canonicalSizingJson).join(",")}]`;
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalSizingJson(record[key])}`,
      )
      .join(",")}}`;
  }
  throw new TypeError("Canonical JSON requires plain JSON values");
}

async function digest(value: unknown, hashText: TextHasher): Promise<string> {
  return DigestSchema.parse(await hashText(canonicalSizingJson(value)));
}

function dependencies(input: SizingInput, result: SizingResult): unknown {
  return {
    input,
    model_profile: result.model_profile,
    estimator_version: result.estimator_version,
    catalog_version: result.catalog_version,
  };
}

export async function createSizingArtifact(
  value: unknown,
  options: { readonly evaluatedAt: string; readonly hashText: TextHasher },
): Promise<SizingArtifact> {
  const input = SizingInputSchema.parse(value);
  if (input.extensions?.calibration)
    input.extensions.calibration_as_of = options.evaluatedAt;
  const result = estimateModelFit(input);
  const content = {
    format: SIZING_FORMAT,
    evaluated_at: options.evaluatedAt,
    input,
    input_digest: await digest(input, options.hashText),
    dependency_digest: await digest(
      dependencies(input, result),
      options.hashText,
    ),
    result,
  };
  return SizingArtifactSchema.parse({
    ...content,
    integrity_hash: await digest(content, options.hashText),
  });
}

/** Content integrity and reproducibility only; never authenticates hardware or evidence. */
export async function verifySizingArtifact(
  value: unknown,
  hashText: TextHasher,
): Promise<
  | { readonly ok: true; readonly artifact: SizingArtifact }
  | { readonly ok: false; readonly issues: readonly string[] }
> {
  const parsed = SizingArtifactSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    };
  const artifact = parsed.data;
  const expected = await createSizingArtifact(artifact.input, {
    evaluatedAt: artifact.evaluated_at,
    hashText,
  });
  const issues: string[] = [];
  if (artifact.input_digest !== expected.input_digest)
    issues.push("Input digest does not match the normalized scenario.");
  if (artifact.dependency_digest !== expected.dependency_digest)
    issues.push(
      "Dependency digest does not match the pinned model and estimator.",
    );
  if (
    canonicalSizingJson(artifact.result) !==
    canonicalSizingJson(expected.result)
  )
    issues.push("Stored result differs from local recomputation.");
  if (artifact.integrity_hash !== expected.integrity_hash)
    issues.push(
      "Artifact integrity hash does not match its reproducible content.",
    );
  return issues.length === 0 ? { ok: true, artifact } : { ok: false, issues };
}
