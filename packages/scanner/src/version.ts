import ts from "typescript";

/** The scanner as a whole. Changing analysis behaviour changes this version. */
export const SCANNER_ID = "anvilmark-scanner" as const;
export const SCANNER_VERSION = "0.1.0-draft.3" as const;

/** The local repository-scan artifact (not a project-contract schema). */
export const SCAN_ARTIFACT_FORMAT =
  "anvilmark-repository-scan/0.1.0-draft.3" as const;

/** The local scan declaration file. */
export const SCAN_CONFIG_FORMAT =
  "anvilmark-scan-config/0.1.0-draft.2" as const;

/** Earlier declaration formats still accepted (their fields are a subset). */
export const ACCEPTED_SCAN_CONFIG_FORMATS = [
  "anvilmark-scan-config/0.1.0-draft.1",
  SCAN_CONFIG_FORMAT,
] as const;

/**
 * The bounded flow model. `call_depth` is the number of nested repository
 * calls followed from each analysis root, as defined in the package README.
 */
export const FLOW_MODEL = {
  id: "bounded-direct-call",
  version: "3",
  call_depth: 3,
} as const;

/** The TypeScript compiler actually loaded, recorded in every artifact. */
export const TYPESCRIPT_VERSION: string = ts.version;
