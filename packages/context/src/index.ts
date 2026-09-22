/**
 * @anvilmark/context
 *
 * One provider-neutral fact layer over an ANVILMARK project contract, and the
 * generated views built from it: Mermaid, a CALM 1.2 export, and agent context.
 * The same facts back the read-only MCP tools. Everything here reads the
 * contract; nothing writes it, and no generated output is ever read back.
 */
export * from "./source.js";
export * from "./facts.js";
export * from "./escape.js";
export * from "./header.js";
export * from "./mermaid.js";
export * from "./calm.js";
export * from "./agent-context.js";
export * from "./artifacts.js";
export * from "./queries.js";
export * from "./freshness.js";
