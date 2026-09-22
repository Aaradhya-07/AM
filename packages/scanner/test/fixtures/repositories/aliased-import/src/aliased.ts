import { Provider } from "./providers";
import * as sdk from "openai";
import { readTicket } from "./tickets";

const primary = new Provider();
const secondary = new sdk.OpenAI();

export async function viaReExport(id: string) {
  const completions = primary.chat.completions;
  return completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: readTicket(id) }],
  });
}

export async function viaNamespace(id: string) {
  const text = readTicket(id);
  const alias = text;
  return secondary.responses.create({ model: "gpt-4o-mini", input: alias });
}
