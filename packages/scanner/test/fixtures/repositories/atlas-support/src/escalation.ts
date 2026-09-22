import OpenAI from "openai";
import { readTicket, type IncomingTicket } from "./intake";

const client = new OpenAI();

/** Deliberate benchmark violation: the raw ticket goes to a remote provider. */
export async function escalateTicket(ticket: IncomingTicket) {
  return client.responses.create({ model: "gpt-4o-mini", input: readTicket(ticket) });
}
