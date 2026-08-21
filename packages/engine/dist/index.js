import { loadFixture } from "@anvilmark/contract";
export * from "./pricing/litellm.js";
export * from "./rules/index.js";
export async function runAudit(_input) {
    // TODO(engine): replace this fixture with rule execution and real aggregation.
    return loadFixture("saas-support");
}
