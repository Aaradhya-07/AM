// SYNTHETIC TEST DECLARATIONS for the ANVILMARK scanner test suite.
// This is NOT the ai npm package. It mirrors only the declaration shape the
// scanner's recognizer relies on, contains no implementation, and is copied
// into a temporary node_modules/ by the tests.
export interface LanguageModel {
  readonly modelId: string;
}

export declare function generateText(options: {
  model: LanguageModel;
  prompt?: string;
  system?: string;
}): Promise<{ text: string }>;

export declare function streamText(options: {
  model: LanguageModel;
  messages?: { role: string; content: string }[];
}): { toTextStreamResponse(): unknown };

export declare function convertToCoreMessages(messages: unknown[]): unknown[];
