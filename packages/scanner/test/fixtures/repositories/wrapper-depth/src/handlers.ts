import { complete, frame, level1, middle } from "./llm";
import { readTicket } from "./tickets";

export async function oneLevel(id: string) {
  const ticket = readTicket(id);
  return complete(ticket);
}

export async function returnPropagation(id: string) {
  const framed = frame(readTicket(id));
  return complete(framed);
}

export async function twoLevels(id: string) {
  const ticket = readTicket(id);
  return middle(ticket);
}

export async function fourLevels(id: string) {
  const ticket = readTicket(id);
  return level1(ticket);
}
