import { normalizeLabel } from "./label.mjs";

const cases = [
  ["Hello World", "hello-world"],
  ["Hello... World", "hello-world"],
  ["  Hello  World  ", "hello-world"],
];

for (const [input, expected] of cases) {
  const actual = normalizeLabel(input);
  if (actual !== expected) {
    console.error(
      `${JSON.stringify(input)}: expected ${expected}, got ${actual}`,
    );
    process.exitCode = 1;
  }
}
