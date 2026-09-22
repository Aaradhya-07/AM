// SYNTHETIC TEST DECLARATIONS for the ANVILMARK scanner test suite.
// This is NOT the together-ai npm package. It mirrors only the declaration shape
// the scanner's recognizer relies on, contains no implementation, and is copied
// into a temporary node_modules/ by the tests.
export interface RequestOptions {
  timeout?: number;
  headers?: Record<string, string>;
}

export interface CompletionCreateParams {
  model: string;
  messages: { role: string; content: string }[];
  stream?: boolean;
}

export declare class Completions {
  create(body: CompletionCreateParams, options?: RequestOptions): Promise<{ id: string }>;
  stream(body: CompletionCreateParams, options?: RequestOptions): AsyncIterable<unknown>;
}
