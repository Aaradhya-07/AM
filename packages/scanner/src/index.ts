/**
 * @anvilmark/scanner
 *
 * A local, deterministic TypeScript/JavaScript repository scanner. It produces
 * source-linked observations, bounded data-flow evidence, explicit unknowns
 * and proposed bindings in a versioned local artifact. It does not evaluate
 * conformance rules, write the project contract, run anything from the
 * scanned repository, or send anything anywhere.
 */
export * from "./version.js";
export * from "./model.js";
export * from "./config.js";
export * from "./boundary.js";
export * from "./inventory.js";
export * from "./program.js";
export * from "./resolution.js";
export * from "./semantics.js";
export * from "./declarations.js";
export * from "./flow.js";
export * from "./evidence.js";
export * from "./binding.js";
export * from "./artifact.js";
export * from "./scan.js";
export * from "./handoff.js";
export * from "./draft.js";
export * from "./ai-inventory.js";
export * from "./recognizers/index.js";
export type { FunctionNode } from "./symbols.js";
