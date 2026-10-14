# Demo plan: contract to model decision

Date: 2026-10-14  
Status: End-to-end demo target; live model evidence source in progress

## Demo promise

Given one concrete AI workload and explicit constraints, Anvilmark produces a reviewable decision contract that shows which model/deployment candidates satisfy the constraints, which fail, which remain unknown, and what evidence supports the choice. A human approves the exact decision revision.

The first workload can be support-ticket classification unless the demo owner supplies another. Use two or three meaningfully different candidates, including a managed API and a local/open-weight option when viable. The demo must not call an unmeasured model “best.”

## What we will build or assemble today

1. **Reproduce the current CLI.** Use supported Node 24, install the frozen workspace dependencies, build the core packages, and run targeted contract/CLI/adapter tests. Record versions and commands.
2. **Create one contract from the idea.** Capture task input/output, monthly usage assumption, a measurable quality gate, privacy/residency constraints, budget, and priority order. Keep unknowns explicit.
3. **Add candidate models and admissible evidence.** Record exact model identities and deployment modes. Use dated official pricing, licence, and provider-capability sources where applicable. Add a small labelled evaluation set for the exact task. Run the same cases against each available candidate through the supported evaluation adapter; preserve raw results and model identity. Evidence that cannot be obtained today remains a gap.
4. **Make comparison presentation demo-ready.** Add a concise, shareable model-decision report built from the existing comparison and review logic. It should show the constraint standing for each candidate, quality result, cost assumptions, source/date, missing evidence, and the proposed/approved choice. It must not invent an overall score or suppress `unknown`.
5. **Draft and approve the decision.** Record the selected candidate, rejected alternatives, rationale, cited evidence, and unresolved gates. Use the existing interactive approval flow. Export the final contract and report for the demo.
6. **Verify the guardrails.** Change or expire one important evidence input and demonstrate that the report no longer treats the affected decision as current/settled. Run targeted tests and the scripted demo from a clean project directory.

## Acceptance gate for today's demo

- A person can state the workload and constraints in under two minutes.
- The report compares at least two candidates and explains the selected one in plain language.
- Every factual quality, price, licence, or deployment claim has a source or measured run with identity and date.
- A hard quality gate is settled only by a matching measured evaluation. If such an evaluation cannot run today, the report says `unknown` and the choice is explicitly conditional.
- The decision contract validates, the human approval covers the exact revision, and changing material evidence invalidates its current standing.
- A fresh checkout can reproduce the demo commands with its declared optional tools and model access.

## Demo sequence

1. Enter one idea: “Classify incoming support tickets into routing categories.”
2. Show the generated workload, constraints, and open questions.
3. Show two or three model/deployment alternatives and the same quality cases applied to each available model.
4. Open the comparison report: passed constraints, failed constraints, unknowns, expected monthly cost assumptions, and evidence links.
5. Show the proposed decision and human approval of the exact hash.
6. Change one important input and show the approval/evidence standing become non-current.

## Dependencies and limits

- This environment has Node 24 at `/home/aaradhya07/.nvm/versions/node/v24.13.1/bin`; frozen workspace dependencies have been installed and the CLI build has passed. Use that Node version for repeatable checks.
- A measured model comparison requires access to candidate models and labelled task examples. API credentials stay outside the project. If they are unavailable, an offline contract-and-conditional-decision demo remains possible, but it does not establish which model meets the quality gate.
- Current prices, licensing, and provider-region claims must be checked against primary sources when the demo evidence is assembled. The historical fixture is for workflow rehearsal, not current model-selection evidence.
- The existing comparison engine deliberately does not rank candidates by one aggregate score. The new report should preserve that behavior.

## After the demo

Record the manual steps, missing evidence, and user confusion in [the project tracker](../../PROJECT-TRACKER.md). The next implementation phase should address the largest observed blocker to a trustworthy model decision.
