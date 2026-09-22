import { Queue } from "bullmq";
import { readTicket } from "./tickets";

const queue = new Queue("tickets");

export async function enqueue(id: string) {
  const ticket = readTicket(id);
  await queue.add("classify", { ticket });
}
