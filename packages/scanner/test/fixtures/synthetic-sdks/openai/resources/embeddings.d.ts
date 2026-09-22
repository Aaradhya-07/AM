// SYNTHETIC TEST DECLARATIONS for the ANVILMARK scanner test suite.
// This is NOT the openai npm package. It mirrors only the declaration shape the
// scanner's recognizer relies on, contains no implementation, and is copied
// into a temporary node_modules/ by the tests.
export declare class Embeddings {
  create(body: { model: string; input: string }): Promise<{ data: number[][] }>;
}
