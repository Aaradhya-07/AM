// SYNTHETIC TEST DECLARATIONS for the ANVILMARK scanner test suite.
// This is NOT the @anthropic-ai/sdk npm package. It mirrors only the declaration shape the
// scanner's recognizer relies on, contains no implementation, and is copied
// into a temporary node_modules/ by the tests.
export interface MessageCreateParams {
  model: string;
  max_tokens: number;
  messages: { role: string; content: string }[];
}

export declare class Messages {
  create(body: MessageCreateParams, options?: { timeout?: number }): Promise<{ id: string }>;
}
