// SYNTHETIC TEST DECLARATIONS for the ANVILMARK scanner test suite.
// This is NOT the ollama npm package. It mirrors only the declaration shape the
// scanner's recognizer relies on, contains no implementation, and is copied
// into a temporary node_modules/ by the tests.
export interface Config {
  host: string;
}

export interface Message {
  role: string;
  content: string;
}

export declare class Ollama {
  constructor(config?: Partial<Config>);
  chat(request: { model: string; messages: Message[] }): Promise<{ message: Message }>;
  generate(request: { model: string; prompt: string }): Promise<{ response: string }>;
  embed(request: { model: string; input: string }): Promise<{ embeddings: number[][] }>;
}

declare const ollama: Ollama;
export default ollama;
