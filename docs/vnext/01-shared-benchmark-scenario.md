# ANVILMARK Shared Benchmark Scenario

Date: **August 17, 2026**  
Status: **Active benchmark fixture**

## Purpose

Every close competitor and the first ANVILMARK vertical slice must receive the same scenario. This prevents the team from changing the problem to make a product look stronger or weaker.

The benchmark tests the entire intended loop:

```text
idea → constraints → architecture/model/deployment decision
     → coding-agent contract → repository implementation → conformance
```

## Scenario: Atlas Support Desk

Build a web application for a mid-sized SaaS company that helps human support agents process multilingual customer tickets.

The application must:

1. accept support tickets from email and a web form;
2. detect and redact personal data before any remote AI call;
3. classify category, urgency, language, and routing team;
4. extract structured product, account, and incident information;
5. retrieve relevant internal documentation;
6. draft a response with citations to the retrieved documentation;
7. require human approval before sending;
8. record feedback for later quality evaluation;
9. provide an operational dashboard for volume, latency, failures, and AI cost.

The benchmark user has an idea and the constraints below but has not selected a stack, cloud, provider, model, database, vector store, queue, or deployment architecture.

## Workloads and evaluation process

The system must treat the five application workloads as separate decision units because they may need different models or deployments. Quality evaluation is an evidence-producing process applied to those workloads, not a sixth deployable workload.

| Workload                              | Input                                        | Output                                        | Decision concern                                |
| ------------------------------------- | -------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| Personal-data detection and redaction | Raw ticket                                   | Redacted ticket plus detected spans           | Privacy, deterministic fallback, recall         |
| Classification and routing            | Redacted ticket                              | Strict JSON category, urgency, language, team | Latency, schema validity, local feasibility     |
| Structured extraction                 | Redacted ticket                              | Strict JSON product/account/incident fields   | Field accuracy, schema validity                 |
| Retrieval                             | Redacted ticket and metadata                 | Ranked internal documents                     | Data locality, recall, index operations         |
| Response drafting                     | Ticket, extracted facts, retrieved documents | Cited draft response                          | Factuality, multilingual quality, latency, cost |

Quality evaluation receives the input, output, and human feedback for a workload and produces a workload-specific result with reproducibility, provenance, and drift metadata.

## Declared constraints

### Usage and performance

- **40,000 tickets per month** initially;
- average raw ticket size: **900 input tokens**;
- average retrieved context for drafting: **3,500 input tokens**;
- average response: **450 output tokens**;
- classification and extraction should complete within **1 second p95** where feasible;
- full draft should complete within **5 seconds p95**;
- expected burst: **20 newly received tickets per second**;
- asynchronous processing is acceptable after ticket receipt, but the support interface must show progress and failures.

These are assumptions, not measured production facts. A product should preserve them as such.

### Budget

- AI inference and supporting AI-specific infrastructure target: **no more than USD 750 per month** at the stated volume;
- the comparison must show uncertainty and excluded costs;
- a lower-cost option cannot be accepted if it fails the quality thresholds.

### Privacy and jurisdiction

- raw tickets can contain personal and contractual data;
- raw text must not be sent to a remote model before redaction;
- redacted text may be sent to a remote provider only if the deployment satisfies the user's selected data-location policy;
- repository source remains local by default;
- every remote transmission must be disclosed;
- the design must offer a path that remains usable if one external model provider becomes unavailable.

This is a user policy constraint. The benchmark does not ask the product to make geopolitical judgments.

### Available compute

The user owns one workstation/server with:

- NVIDIA RTX 4090 with **24 GB VRAM**;
- **64 GB system RAM**;
- modern 16-core CPU;
- Linux;
- approximately 500 GB free SSD storage.

The system must decide which workloads, if any, can reasonably run on this machine and what quantization, throughput, concurrency, and operational assumptions affect the answer.

### Quality gates

The user can provide the following evaluation set:

- 500 historically resolved and manually labelled tickets;
- 200 classification/routing labels held out for final testing;
- 100 tickets with verified structured fields;
- 100 drafting examples with accepted final responses and cited documents;
- multilingual representation in English, Hindi, Spanish, and German.

Minimum acceptance thresholds:

- personal-data detection recall: **at least 0.98** on the test set;
- classification macro-F1: **at least 0.90**;
- classification/extraction schema validity: **at least 0.99**;
- structured-field macro-F1: **at least 0.92**;
- citation validity: **at least 0.95**;
- no drafting candidate may be recommended without deterministic checks plus blinded human review;
- quality results must be associated with the exact model, provider, parameters, prompt/configuration, and evaluation-set version.

## Required competitor exercise

For each product, attempt to answer or perform the following without adding capabilities the product does not supply:

1. enter the scenario from the idea alone;
2. capture the constraints as structured, revisable values;
3. separate the five application workloads and preserve quality evaluation as an evidence-producing process;
4. propose at least two viable architectures;
5. compare managed, open-weight, and local execution;
6. assess the RTX 4090 option;
7. use or request workload-specific quality evidence;
8. estimate tokens, effective cost, and latency with stated assumptions;
9. show sources and freshness for factual claims;
10. produce an editable architecture backed by machine-readable data;
11. export approved decisions for Claude Code and Codex;
12. import or inspect the resulting repository;
13. detect a deliberate conformance violation.

## Deliberate conformance violation

After the coding agent implements the approved design, change the classification workload to call a disallowed remote provider with raw ticket text.

ANVILMARK should identify:

- the exact file and call site;
- the violated privacy/provider decision;
- the evidence linking the call to unredacted input;
- the approved alternative;
- whether the conclusion is deterministic, inferred, or requires runtime confirmation.

## Scoring rubric

Each capability receives one score and an evidence status.

### Capability score

| Score | Meaning                                                                            |
| ----: | ---------------------------------------------------------------------------------- |
| **0** | Absent or contradicted by observed behavior                                        |
| **1** | Generic claim, static advice, or output with no usable project state               |
| **2** | Partial capability, substantial manual transfer, or restricted to one vendor/scope |
| **3** | Completes the benchmark capability and produces a reusable output                  |

### Evidence status

| Status | Meaning                                                                                |
| ------ | -------------------------------------------------------------------------------------- |
| **D**  | Official documentation or source code only                                             |
| **O**  | Directly observed on a publicly accessible product surface without an account          |
| **H**  | Hands-on authenticated trial performed                                                 |
| **G**  | Gated; authentication, payment, demo approval, or unavailable launch prevented testing |
| **U**  | Unknown; available evidence is insufficient                                            |

Scores based only on **D** or **O** are provisional. A public differentiation claim requires **H** for the closest relevant competitor, unless the capability is conclusively established through source code.

## Evaluation principles

- Do not award a capability merely because an LLM could theoretically produce it.
- Do not award machine-readable state for a diagram image or prose report.
- Do not treat a price calculator as workload-specific quality proof.
- Do not treat model fit in VRAM as proof of useful throughput or quality.
- Do not infer absence from missing marketing copy; record it as unknown.
- Record every manual copy/paste step between tools.
- Record account, payment, cloud, provider, and telemetry requirements.
- Preserve screenshots or exact output excerpts where permitted.
- Keep facts, vendor claims, observations, and inferences distinct.
