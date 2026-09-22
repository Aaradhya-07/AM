// SYNTHETIC TEST DECLARATIONS for the ANVILMARK scanner test suite.
// This is NOT the openai npm package. It mirrors only the declaration shape the
// scanner's recognizer relies on, contains no implementation, and is copied
// into a temporary node_modules/ by the tests.
export interface ResponseCreateParams {
  model: string;
  input: string;
}

// Synthetic subset of OpenAI v4.104.0 core.RequestOptions. No implementation.
export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  query?: unknown;
  timeout?: number;
  maxRetries?: number;
  signal?: AbortSignal | null;
  httpAgent?: unknown;
  idempotencyKey?: string;
}

export declare class Responses {
  create(body: ResponseCreateParams, options?: RequestOptions): Promise<{ output_text: string }>;
}
