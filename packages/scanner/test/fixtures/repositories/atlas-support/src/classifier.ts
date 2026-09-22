import OpenAI from "openai";
import ollama from "ollama";
import { readTicket, type IncomingTicket } from "./intake";
import { redactTicket } from "./redactor";

const remote = new OpenAI();

async function classifyRemotely(text: string) {
  return remote.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: `Classify: ${text}` }],
  });
}

export async function classifyTicket(ticket: IncomingTicket) {
  const redacted = redactTicket(readTicket(ticket));
  const local = await ollama.chat({
    model: "llama3.2",
    messages: [{ role: "user", content: redacted }],
  });
  if (local.message.content === "") {
    return classifyRemotely(redacted);
  }
  return local;
}
