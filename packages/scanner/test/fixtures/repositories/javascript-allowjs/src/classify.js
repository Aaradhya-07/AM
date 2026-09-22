const { OpenAI } = require("openai");
const { readTicket } = require("./tickets");

const client = new OpenAI();

async function classify(id) {
  const ticket = readTicket(id);
  return client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: ticket }],
  });
}

module.exports = { classify };
