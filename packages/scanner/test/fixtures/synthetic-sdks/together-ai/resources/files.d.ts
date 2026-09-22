// SYNTHETIC TEST DECLARATIONS for the ANVILMARK scanner test suite.
// This is NOT the together-ai npm package. It mirrors only the declaration shape
// the scanner's recognizer relies on, contains no implementation, and is copied
// into a temporary node_modules/ by the tests.
import { RequestOptions } from "./chat/completions";

export declare class Files {
  upload(body: { file: unknown; purpose?: string }, options?: RequestOptions): Promise<{ id: string }>;
  list(options?: RequestOptions): Promise<unknown[]>;
}
