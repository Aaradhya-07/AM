/**
 * Deterministic synthetic dataset generator for the Braintrust validation experiment.
 *
 * OFFLINE ONLY. Makes no network calls and requires no credentials.
 * Fixed seed, so every run produces byte-identical output.
 *
 * Not ANVILMARK product code. Contains no customer data.
 *
 * Usage: node experiments/braintrust-validation/generate-datasets.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "data");

const SEED = 20260813;
const S1_ROWS = 200;
const S2_DOC_COUNT = 100;

/** Mulberry32: small, fast, deterministic PRNG. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, xs) => xs[Math.floor(rng() * xs.length)];

// --- Scenario 1: ticket classification -------------------------------------

const CATEGORIES = [
  "billing",
  "shipping",
  "returns",
  "account_access",
  "product_defect",
  "order_status",
  "cancellation",
  "other",
];

/**
 * Deliberately skewed frequency weights. "order_status" dominates, mirroring
 * real support traffic. This skew is the point: it tests whether Braintrust can
 * weight an evaluation dataset by production frequency (test T4).
 */
const CATEGORY_WEIGHTS = {
  order_status: 0.6,
  shipping: 0.12,
  billing: 0.09,
  returns: 0.07,
  account_access: 0.05,
  product_defect: 0.04,
  cancellation: 0.02,
  other: 0.01,
};

const TICKET_TEMPLATES = {
  order_status: [
    "Where is my order {id}? It was due {day}.",
    "Order {id} still shows processing after {n} days.",
    "Can you tell me when {id} will arrive?",
  ],
  shipping: [
    "The tracking for {id} has not updated in {n} days.",
    "My package for order {id} went to the wrong address.",
    "Can I change the delivery address on {id}?",
  ],
  billing: [
    "I was charged twice for order {id}.",
    "Invoice for {id} shows an amount I did not expect.",
    "Please explain the {n} dollar fee on order {id}.",
  ],
  returns: [
    "I want to return the item from order {id}.",
    "How long do I have to return {id}?",
    "Return label for {id} never arrived.",
  ],
  account_access: [
    "I cannot log in to my account.",
    "Password reset email never arrived.",
    "My account is locked after {n} attempts.",
  ],
  product_defect: [
    "The item in order {id} arrived damaged.",
    "Product from {id} stopped working after {n} days.",
    "Item {id} is missing parts.",
  ],
  cancellation: [
    "Please cancel order {id}.",
    "I want to cancel {id} before it ships.",
    "Cancel my subscription, reference {id}.",
  ],
  other: [
    "Do you ship to other countries?",
    "Is there a loyalty programme?",
    "What are your opening hours?",
  ],
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

// Guard: the weight table and the label set must stay in sync, or the
// classifier prompt and the ground-truth labels silently diverge.
{
  const weighted = Object.keys(CATEGORY_WEIGHTS).sort().join(",");
  const declared = [...CATEGORIES].sort().join(",");
  if (weighted !== declared) {
    throw new Error(
      `CATEGORY_WEIGHTS does not match CATEGORIES.\n  weights:  ${weighted}\n  declared: ${declared}`,
    );
  }
  const total = Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error(`CATEGORY_WEIGHTS must sum to 1, got ${total}`);
  }
}

function weightedCategory(rng) {
  const r = rng();
  let cumulative = 0;
  for (const [category, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    cumulative += weight;
    if (r <= cumulative) return category;
  }
  return "other";
}

function buildTickets(rng) {
  const rows = [];
  for (let i = 0; i < S1_ROWS; i += 1) {
    const category = weightedCategory(rng);
    const text = pick(rng, TICKET_TEMPLATES[category])
      .replace("{id}", `A-${10000 + Math.floor(rng() * 89999)}`)
      .replace("{n}", String(2 + Math.floor(rng() * 12)))
      .replace("{day}", pick(rng, DAYS));

    rows.push({
      id: `ticket-${String(i + 1).padStart(4, "0")}`,
      input: text,
      expected: category,
      metadata: {
        category,
        // Frequency weight for this row's class. Braintrust may or may not be
        // able to use this — that is exactly what test T4 checks.
        frequency_weight: CATEGORY_WEIGHTS[category],
        synthetic: true,
      },
    });
  }
  return rows;
}

// --- Scenario 2: document summarization ------------------------------------

/**
 * A long, stable prefix shared by every document. This is what makes prompt
 * caching economically decisive, and what a naive token count gets wrong.
 */
const SHARED_PREFIX = [
  "INTERNAL OPERATIONS HANDBOOK — SECTION 4: INCIDENT REPORTING",
  "All incidents must be recorded within one business day of detection.",
  "Severity is assigned by the on-call engineer and reviewed at the weekly meeting.",
  "Reports must state impact, duration, affected systems, and remediation.",
  "Customer-facing impact requires an additional communications review.",
].join("\n");

const TOPICS = [
  "a database failover that degraded read latency",
  "an expired certificate blocking a partner integration",
  "a queue backlog causing delayed notifications",
  "a misconfigured feature flag exposing a beta surface",
  "a third-party outage affecting payment confirmation",
];

const SENTENCES = [
  "The on-call engineer acknowledged the alert and began triage.",
  "Initial investigation pointed to a change deployed earlier that day.",
  "Traffic was shifted away from the affected region as a mitigation.",
  "Customer impact was limited to a subset of requests in one locale.",
  "A rollback was completed and metrics returned to baseline shortly after.",
  "Follow-up actions were assigned to the owning team with due dates.",
  "Monitoring gaps were identified during the review and logged separately.",
  "No data loss occurred, and no customer records were affected.",
];

function buildDocuments(rng) {
  const rows = [];
  for (let i = 0; i < S2_DOC_COUNT; i += 1) {
    // Length varies widely so the output-token distribution is right-skewed,
    // which is what stresses the sampling and interval methodology.
    const sentenceCount = 12 + Math.floor(rng() * rng() * 160);
    const body = [];
    body.push(`Incident report ${i + 1}: ${pick(rng, TOPICS)}.`);
    for (let s = 0; s < sentenceCount; s += 1) body.push(pick(rng, SENTENCES));

    rows.push({
      id: `doc-${String(i + 1).padStart(4, "0")}`,
      input: `${SHARED_PREFIX}\n\n---\n\n${body.join(" ")}`,
      // No ground-truth summary. Deliberate: Scenario 2 forces the evaluation
      // hierarchy down to judges and human review.
      expected: null,
      metadata: {
        sentence_count: sentenceCount,
        approx_chars: body.join(" ").length,
        shared_prefix_chars: SHARED_PREFIX.length,
        synthetic: true,
      },
    });
  }
  return rows;
}

// --- Write ------------------------------------------------------------------

function writeJsonl(name, rows) {
  const path = join(OUT, name);
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return path;
}

function main() {
  mkdirSync(OUT, { recursive: true });

  const tickets = buildTickets(makeRng(SEED));
  const documents = buildDocuments(makeRng(SEED + 1));

  const written = [
    writeJsonl("s1-tickets.jsonl", tickets),
    // Byte-identical duplicate. Used as the noise-floor control arm (test T7):
    // the same configuration is run over both, and any difference between the
    // two runs is stochastic variation rather than a real effect.
    writeJsonl("s1-repeat.jsonl", tickets),
    writeJsonl("s2-docs.jsonl", documents),
  ];

  const distribution = {};
  for (const row of tickets) {
    distribution[row.expected] = (distribution[row.expected] ?? 0) + 1;
  }

  console.log("Wrote:");
  for (const path of written) console.log(`  ${path}`);
  console.log(`\nScenario 1: ${tickets.length} rows`);
  console.log("Class distribution (deliberately skewed):");
  for (const [category, count] of Object.entries(distribution).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(
      `  ${category.padEnd(16)} ${String(count).padStart(4)}  ${((count / tickets.length) * 100).toFixed(1)}%`,
    );
  }
  console.log(`\nScenario 2: ${documents.length} rows`);
  const chars = documents
    .map((d) => d.metadata.approx_chars)
    .sort((a, b) => a - b);
  const at = (q) => chars[Math.floor(chars.length * q)];
  console.log(
    `Body length chars — p50 ${at(0.5)}  p95 ${at(0.95)}  max ${chars[chars.length - 1]}`,
  );
  console.log(`Shared prefix: ${SHARED_PREFIX.length} chars on every row`);
  console.log("\nNo network calls were made. No credentials were used.");
}

main();
