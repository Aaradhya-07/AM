// SYNTHETIC TEST DECLARATIONS for the ANVILMARK scanner test suite.
// This is NOT the openai npm package. It mirrors only the declaration shape the
// scanner's recognizer relies on, contains no implementation, and is copied
// into a temporary node_modules/ by the tests.
export interface RequestOptions {
  timeout?: number;
  headers?: Record<string, string>;
}

export declare class Files {
  create(body: { file: unknown; purpose: string }, options?: RequestOptions): Promise<{ id: string }>;
  retrieve(fileId: string, options?: RequestOptions): Promise<{ id: string }>;
}
