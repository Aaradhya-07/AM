import { Ollama } from "ollama";

const local = new Ollama({ host: "http://127.0.0.1:11434" });

export async function summarize(text) {
  return local.generate({ model: "llama3.2", prompt: text });
}
