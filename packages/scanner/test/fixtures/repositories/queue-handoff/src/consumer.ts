import { Worker } from "bullmq";
import OpenAI from "openai";

const client = new OpenAI();

export const worker = new Worker("tickets", async (job) => {
  return client.responses.create({ model: "gpt-4o-mini", input: job.data.ticket });
});
