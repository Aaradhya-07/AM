import OpenAI from "openai";
import { readTicket } from "./tickets";

const client = new OpenAI();

export async function stillScanned(id: string) {
  return client.responses.create({ model: "gpt-4o-mini", input: readTicket(id) });
}
