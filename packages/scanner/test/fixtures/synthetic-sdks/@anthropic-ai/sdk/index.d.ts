// SYNTHETIC TEST DECLARATIONS for the ANVILMARK scanner test suite.
// This is NOT the @anthropic-ai/sdk npm package. It mirrors only the declaration shape the
// scanner's recognizer relies on, contains no implementation, and is copied
// into a temporary node_modules/ by the tests.
import { Messages } from "./resources/messages";

export declare class Anthropic {
  constructor(options?: { apiKey?: string; baseURL?: string });
  messages: Messages;
}

export default Anthropic;
