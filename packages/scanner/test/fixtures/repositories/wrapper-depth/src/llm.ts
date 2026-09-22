import OpenAI from "openai";

const client = new OpenAI();

export async function complete(prompt: string) {
  return client.responses.create({ model: "gpt-4o-mini", input: prompt });
}

export function frame(text: string) {
  return `Classify this ticket: ${text}`;
}

export async function deepest(prompt: string) {
  return client.embeddings.create({ model: "text-embedding-3-small", input: prompt });
}

export async function middle(prompt: string) {
  return deepest(prompt);
}

export async function level4(prompt: string) {
  return client.responses.create({ model: "gpt-4o-mini", input: prompt });
}

export async function level3(prompt: string) {
  return level4(prompt);
}

export async function level2(prompt: string) {
  return level3(prompt);
}

export async function level1(prompt: string) {
  return level2(prompt);
}
