// Browser-safe review helpers: no Node built-ins and no runtime imports from
// the rest of this package, so web clients can import this entry directly.
export * from "./types.js";
export * from "./canonical.js";
export * from "./evidence.js";
export * from "./brief.js";
export * from "./diff.js";
export * from "./markdown.js";
export * from "./line-diff.js";
