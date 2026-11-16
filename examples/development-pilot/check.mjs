import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLabel } from "./label.mjs";

test("normalizes a plain label", () => {
  assert.equal(normalizeLabel("Hello World"), "hello-world");
});

test("collapses repeated punctuation", () => {
  assert.equal(normalizeLabel("Hello... World"), "hello-world");
});

test("trims surrounding separators and collapses spaces", () => {
  assert.equal(normalizeLabel("  Hello  World  "), "hello-world");
});
