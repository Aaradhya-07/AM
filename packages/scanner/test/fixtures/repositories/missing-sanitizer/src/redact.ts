export function redactTicket(text: string): string {
  return text.replace(/\S+@\S+/g, "[email]");
}

export function redactWith(options: { mask: string }, text: string): string {
  return text.replace(/\d/g, options.mask);
}
