// openai: client.chat.completions.create({ messages }) is only mentioned here.
/* const client = new OpenAI(); await client.responses.create({ input }); */
export const documentation = "client.chat.completions.create(...) calls openai";
export const template = `new OpenAI().responses.create(${JSON.stringify({ input: "x" })})`;

export function describe() {
  return "ollama.chat, ollama.generate and OpenAI are provider names";
}
