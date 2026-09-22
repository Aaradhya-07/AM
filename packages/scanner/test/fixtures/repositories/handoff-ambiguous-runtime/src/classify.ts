import { readTicket } from "./tickets";

export async function classifyTicket(id: string) {
  const ticket = readTicket(id);
  const providerModule = process.env.CLASSIFIER_PROVIDER_MODULE ?? "./providers/local";
  const provider = await import(providerModule);
  return provider.classify(ticket);
}
