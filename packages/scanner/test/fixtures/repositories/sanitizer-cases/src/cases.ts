import OpenAI from "openai";
import { readTicket } from "./tickets";
import { redactTicket, redactWith } from "./redact";

const client = new OpenAI();

export async function sanitizedDirect(id: string) {
  const redacted = redactTicket(readTicket(id));
  return client.responses.create({ model: "gpt-4o-mini", input: redacted });
}

export async function resultIgnored(id: string) {
  const ticket = readTicket(id);
  redactTicket(ticket);
  return client.responses.create({ model: "gpt-4o-mini", input: ticket });
}

export async function reassigned(id: string) {
  let text = readTicket(id);
  text = redactTicket(text);
  return client.responses.create({ model: "gpt-4o-mini", input: text });
}

export async function mixedBranch(id: string, strict: boolean) {
  let text = readTicket(id);
  if (strict) {
    text = redactTicket(text);
  }
  return client.responses.create({ model: "gpt-4o-mini", input: text });
}

export async function propertySelected(id: string) {
  const ticket = readTicket(id);
  const parts = { safe: redactTicket(ticket), unsafe: ticket };
  return client.responses.create({ model: "gpt-4o-mini", input: parts.safe });
}

export async function propertyLeaks(id: string) {
  const ticket = readTicket(id);
  const parts = { safe: redactTicket(ticket), unsafe: ticket };
  return client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: parts.safe }],
    user: parts.unsafe,
  });
}

export async function declaredArgumentPosition(id: string) {
  const ticket = readTicket(id);
  const masked = redactWith({ mask: "*" }, ticket);
  return client.responses.create({ model: "gpt-4o-mini", input: masked });
}

export async function undeclaredArgumentPosition(id: string) {
  const ticket = readTicket(id);
  const masked = redactWith({ mask: ticket }, "static text");
  return client.responses.create({ model: "gpt-4o-mini", input: masked });
}
