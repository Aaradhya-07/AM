// SYNTHETIC TEST DECLARATIONS for the ANVILMARK scanner test suite.
// This is NOT the together-ai npm package. It mirrors only the declaration shape
// the scanner's recognizer relies on, contains no implementation, and is copied
// into a temporary node_modules/ by the tests.
import { Completions } from "./resources/chat/completions";
import { Embeddings } from "./resources/embeddings";
import { Files } from "./resources/files";
import { Images } from "./resources/images";

export interface ClientOptions {
  apiKey?: string;
  baseURL?: string | null;
}

export declare class Together {
  constructor(options?: ClientOptions);
  chat: { completions: Completions };
  embeddings: Embeddings;
  images: Images;
  files: Files;
  models: { list(): Promise<unknown[]> };
}

export default Together;
