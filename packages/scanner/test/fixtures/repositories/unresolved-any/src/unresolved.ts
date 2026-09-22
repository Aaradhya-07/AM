import { readTicket } from "./tickets";
// @ts-ignore the package is deliberately not installed
import { createClient } from "missing-llm-sdk";

export async function viaAny(id: string) {
  const client: any = createClient();
  return client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: readTicket(id) }],
  });
}

export async function viaParsedAny(id: string, config: string) {
  const handler = JSON.parse(config);
  return handler.send(readTicket(id));
}
