# Scenario Coverage Analysis

## Scenario A: A non-expert starts with an idea

### Completion criteria

A complete solution would:

1. turn an ambiguous idea into testable requirements;
2. collect budget, privacy, latency, traffic, residency, team, and operational constraints;
3. compare viable application architectures;
4. evaluate managed, open-source, cloud, on-premises, and hybrid components;
5. determine whether the user's existing CPU/GPU/RAM/VRAM can run candidate models;
6. evaluate model quality for the user's actual task;
7. show assumptions, evidence, trade-offs, and cost ranges;
8. provide an editable visual architecture backed by a machine-readable graph;
9. convert the approved design into an implementation contract for any coding agent;
10. verify what was ultimately built.

### Current coverage

| Capability                                        | Strongest existing coverage                               | Status                                    |
| ------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| Idea clarification and specification              | Archie, Spec Kit, BMAD, Replit Agent                      | Solved by several products                |
| Interactive architecture generation               | BackArch, ArchGenie, Visual Paradigm, OpenArchFlow        | Largely solved                            |
| Multi-cloud cost and infrastructure code          | ArchGenie, Brainboard, Holori                             | Largely solved                            |
| Agent-native architecture guidance                | AWS Agent Plugins, Archcore, Spec Kit                     | Solved within particular scopes           |
| Open-model discovery                              | Hugging Face, Artificial Analysis, model comparison sites | Solved as data discovery                  |
| Owned-hardware model fit                          | llmfit, ModelFit, LocalAIRun, Hugging Face estimator      | Solved as approximate fit analysis        |
| Task-specific quality proof                       | Braintrust, Stax, Aptyx, prompt/eval platforms            | Solved separately, requires customer data |
| Provider-neutral combined decision                | No complete product found                                 | Open but narrow                           |
| Continuous design-to-code-to-runtime verification | No complete product found                                 | Strongest remaining opening               |

### Verdict

No single product found completely solves Scenario A as specified. Approximately 70–80% can be assembled from existing products. The remaining value is not diagram generation; it is combining constraints, live evidence, quality evaluation, owned hardware, and agent conformance into one authoritative decision object.

## Scenario B: Audit an existing repository

### Completion criteria

A complete solution would:

1. parse the repository deterministically;
2. identify application components, AI calls, dependencies, infrastructure, and data flows;
3. reconstruct an evidence-linked current architecture;
4. compare it against documented intent and constraints;
5. combine static analysis with runtime volume, cost, quality, latency, caching, retry, and concurrency evidence;
6. recommend component/model/architecture changes;
7. prove cheaper model substitutions against evaluations;
8. produce a target architecture and migration plan;
9. give the implementation to a coding agent;
10. verify the resulting code and runtime.

### Current coverage

| Capability                                     | Strongest existing coverage                                  | Status                                   |
| ---------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| Repository architecture reconstruction         | CodeBoarding, DeepRepo, NodeScope, Graphist, CodeArchy       | Solved by multiple emerging products     |
| Architecture and source drift                  | NodeScope, Graphist, Brainboard, architecture fitness tools  | Solved within particular representations |
| General modernization findings and remediation | AWS Transform, vFunction, Moderne, CAST                      | Mature or rapidly maturing               |
| AI-specific static cost findings               | PromptScan, AI Architecture Scanner, CostCanary, Neurometric | Early but directly competed              |
| Runtime cost attribution                       | Helicone, Langfuse, LLM Tracer, OpenTelemetry ecosystem      | Solved                                   |
| Quality-safe model replacement                 | Braintrust and evaluation platforms                          | Solved separately                        |
| Architecture rules for coding agents           | ArchRails, GovForge, Qodo, Archcore                          | Rapidly emerging                         |
| Intent-to-code-to-runtime economic conformance | No complete product found                                    | Remaining opening                        |

### Verdict

The generic statement “scan a repository and find inefficiencies or replacements” is already solved and is not a viable differentiated promise.

The narrower unresolved statement is:

> Given the approved architecture, workload-specific quality tests, measured usage, and available infrastructure, determine whether the repository and runtime still satisfy the application's architectural and economic constraints—and provide verified migrations when they do not.

## Combined substitute stack

A technically capable user can approximate the experience today:

```text
Spec Kit or BMAD
        ↓
BackArch, ArchGenie, or Brainboard
        ↓
Hugging Face + llmfit + evaluation platform
        ↓
Claude Code, Codex, Cursor, or Replit
        ↓
CodeBoarding or NodeScope + PromptScan
        ↓
Qodo, ArchRails, or AWS Transform
```

This is fragmented, but fragmentation is not automatically a business opportunity. ANVILMARK must produce a better decision and durable evidence—not only provide one interface over the stack.
