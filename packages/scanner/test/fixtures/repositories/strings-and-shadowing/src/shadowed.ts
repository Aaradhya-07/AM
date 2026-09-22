import OpenAIClient from "openai";
import { readTicket } from "./tickets";

class OpenAI {
  chat = { completions: { create: (request: { input: string }) => request.input.length } };
}

function create(request: { input: string }) {
  return request;
}

export function localClass(id: string) {
  const client = new OpenAI();
  return client.chat.completions.create({ input: readTicket(id) });
}

export function localFunction(id: string) {
  return create({ input: readTicket(id) });
}

export function shadowedParameter(
  OpenAIClient: { responses: { create(request: { input: string }): string } },
  id: string,
) {
  return OpenAIClient.responses.create({ input: readTicket(id) });
}
