import type { DemoDraft } from "./draft-contract";

export type ArchitecturePattern = "local" | "redacted_remote" | "direct_remote";

export const ARCHITECTURE_PATTERNS: readonly {
  id: ArchitecturePattern;
  title: string;
  flow: string;
  description: string;
}[] = [
  {
    id: "local",
    title: "Keep processing local",
    flow: "Input → application → local model",
    description:
      "The input and model runtime stay inside your local trust boundary. Check hardware fit and operations before use.",
  },
  {
    id: "redacted_remote",
    title: "Redact before a remote model",
    flow: "Input → local application → local redactor → remote model",
    description:
      "Only transformed data is planned to leave the local boundary. The redactor and its effectiveness still need implementation and evidence.",
  },
  {
    id: "direct_remote",
    title: "Send permitted input to a provider",
    flow: "Input → application → remote model",
    description:
      "The input crosses to a provider. Use this only when that data is allowed to leave your boundary and the provider terms are reviewed.",
  },
];

export function architectureConflict(
  draft: Pick<DemoDraft, "privacy" | "architecturePattern">,
): string | null {
  return draft.privacy === "local_only" &&
    draft.architecturePattern === "direct_remote"
    ? "Direct remote processing conflicts with the declared local-only data boundary. Choose local processing or a redaction path, or change the data boundary."
    : null;
}

export function buildDraftArchitecture(
  pattern: ArchitecturePattern,
  workloadId: string,
  inputClassification: string,
  redactionWorkloadId: string,
) {
  const localNode = (
    id: string,
    kind: "actor" | "service" | "runtime",
    name: string,
  ) => ({
    id,
    kind,
    name,
    trust_boundary: "local" as const,
  });
  const source = localNode("input-source", "actor", "Input source");
  const application = localNode("application", "service", "Application");
  const redactor = localNode("redactor", "service", "Local redactor");
  const model =
    pattern === "local"
      ? localNode("model-runtime", "runtime", "Local model runtime")
      : {
          id: "model-provider",
          kind: "external_system" as const,
          name: "Remote model provider",
          trust_boundary: "remote_provider" as const,
        };
  const relationship = (
    id: string,
    from: string,
    to: string,
    data: string,
    workloadRef = workloadId,
  ) => ({
    id,
    kind: "connects" as const,
    source: from,
    destination: to,
    workload_ref: workloadRef,
    data_classification: data,
  });

  return {
    authority: "anvilmark" as const,
    nodes:
      pattern === "redacted_remote"
        ? [source, application, redactor, model]
        : [source, application, model],
    relationships: [
      relationship(
        "input-to-application",
        source.id,
        application.id,
        inputClassification,
        pattern === "redacted_remote" ? redactionWorkloadId : workloadId,
      ),
      ...(pattern === "redacted_remote"
        ? [
            relationship(
              "application-to-redactor",
              application.id,
              redactor.id,
              inputClassification,
              redactionWorkloadId,
            ),
            relationship(
              "redactor-to-provider",
              redactor.id,
              model.id,
              `redacted_${inputClassification}`,
            ),
          ]
        : [
            relationship(
              "application-to-model",
              application.id,
              model.id,
              inputClassification,
            ),
          ]),
    ],
    decision_bindings: [],
  };
}
