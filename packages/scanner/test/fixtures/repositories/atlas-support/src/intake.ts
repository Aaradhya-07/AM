export interface IncomingTicket {
  id: string;
  body: string;
}

/** Ticket Intake: returns the raw customer ticket text. */
export function readTicket(ticket: IncomingTicket): string {
  return ticket.body;
}
