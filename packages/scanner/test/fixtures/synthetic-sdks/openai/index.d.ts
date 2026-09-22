// SYNTHETIC TEST DECLARATIONS for the ANVILMARK scanner test suite.
// This is NOT the openai npm package. It mirrors only the declaration shape the
// scanner's recognizer relies on, contains no implementation, and is copied
// into a temporary node_modules/ by the tests.
import { Completions } from "./resources/chat/completions";
import { Responses } from "./resources/responses";
import { Embeddings } from "./resources/embeddings";
import { Files } from "./resources/files";
import { Messages } from "./resources/beta/threads/messages";

export interface ClientOptions {
  apiKey?: string;
  baseURL?: string;
}

export declare class OpenAI {
  constructor(options?: ClientOptions);
  chat: { completions: Completions };
  responses: Responses;
  embeddings: Embeddings;
  models: { list(): Promise<unknown[]> };
  files: Files;
  beta: { threads: { messages: Messages } };
}

export declare class AzureOpenAI extends OpenAI {
  constructor(options?: ClientOptions & { endpoint?: string; deployment?: string });
}

export default OpenAI;
