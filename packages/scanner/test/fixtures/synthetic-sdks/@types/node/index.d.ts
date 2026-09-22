// SYNTHETIC TEST DECLARATIONS for the ANVILMARK scanner test suite.
// This is NOT the @types/node npm package. It mirrors only the declaration shape the
// scanner's recognizer relies on, contains no implementation, and is copied
// into a temporary node_modules/ by the tests.
export {};

declare global {
  function fetch(
    input: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<{ json(): Promise<unknown> }>;
  interface Console {
    log(...data: unknown[]): void;
  }
  var console: Console;
  var process: { env: Record<string, string | undefined> };
}
