import OpenAI from "openai";
import { readTicket } from "./tickets";
import { redactTicket } from "./redact";

const client = new OpenAI();

export async function classifyTicket(id: string) {
  const ticket = readTicket(id);
  const redacted = redactTicket(ticket);
  return client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: redacted }],
  });
}
