import OpenAI from "openai";
import { readTicket } from "./tickets";

const client = new OpenAI();

export async function classifyTicket(id: string) {
  const ticket = readTicket(id);
  return client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: ticket }],
  });
}
