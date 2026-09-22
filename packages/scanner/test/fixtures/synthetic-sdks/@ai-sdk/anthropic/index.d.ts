// SYNTHETIC TEST DECLARATIONS for the ANVILMARK scanner test suite.
// This is NOT the @ai-sdk/anthropic npm package. It mirrors only the declaration shape the
// scanner's recognizer relies on, contains no implementation, and is copied
// into a temporary node_modules/ by the tests.
export interface LanguageModel {
  readonly modelId: string;
}

export interface Provider {
  (modelId: string): LanguageModel;
  chat(modelId: string): LanguageModel;
}

export declare const anthropic: Provider;

export declare function createAnthropic(options?: { apiKey?: string; baseURL?: string }): Provider;
