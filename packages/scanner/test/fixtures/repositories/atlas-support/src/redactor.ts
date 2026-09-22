/** PII Redactor: replaces e-mail addresses and digits. */
export function redactTicket(text: string): string {
  return text.replace(/\S+@\S+/g, "[email]").replace(/\d/g, "#");
}
