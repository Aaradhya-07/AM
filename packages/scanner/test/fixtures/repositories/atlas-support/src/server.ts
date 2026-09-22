import { classifyTicket } from "./classifier";
import { escalateTicket } from "./escalation";

export async function handle(ticket: { id: string; body: string }, escalate: boolean) {
  return escalate ? escalateTicket(ticket) : classifyTicket(ticket);
}
