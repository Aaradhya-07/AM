import OpenAI from "openai";
import { Ollama } from "ollama";
import { readTicket } from "./tickets";

export async function runtimeImport(id: string) {
  const ticket = readTicket(id);
  const moduleName = process.env.CLASSIFIER_MODULE ?? "./providers/local";
  const provider = await import(moduleName);
  return provider.classify(ticket);
}

export async function runtimeProvider(id: string, useLocal: boolean) {
  const ticket = readTicket(id);
  const client = useLocal ? new Ollama() : new OpenAI();
  return client.chat({ model: "llama3.2", messages: [{ role: "user", content: ticket }] });
}

export async function runtimeEndpoint(id: string) {
  const client = new OpenAI({ baseURL: process.env.LLM_BASE_URL });
  return client.responses.create({ model: "gpt-4o-mini", input: readTicket(id) });
}
