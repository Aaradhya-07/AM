import OpenAI from "openai";

const client = new OpenAI();

export async function classify(text: string) {
  return client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: text }],
  });
}
