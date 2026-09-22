// SYNTHETIC TEST DECLARATIONS for the ANVILMARK scanner test suite.
// This is NOT the together-ai npm package. It mirrors only the declaration shape
// the scanner's recognizer relies on, contains no implementation, and is copied
// into a temporary node_modules/ by the tests.
import { RequestOptions } from "./chat/completions";

export declare class Images {
  generate(body: { model: string; prompt: string }, options?: RequestOptions): Promise<{ data: unknown[] }>;
}
