import type ts from "typescript";

import type {
  ArchitectureNode,
  ProjectContract,
} from "@anvilmark/project-contract";
import {
  architectureContentHash,
  confirmationStanding,
  isArchitectureElementTrusted,
} from "@anvilmark/project-contract";

import type { NodeAssociation } from "./artifact.js";
import type { RepositoryReader } from "./boundary.js";
import type {
  ComponentDeclaration,
  SanitizerDeclaration,
  ScanConfig,
  SinkDeclaration,
  SourceDeclaration,
} from "./config.js";
import type { FlowDeclarations } from "./flow.js";
import { absoluteIn } from "./inventory.js";
import type { CompilerSetup } from "./program.js";
import { spanOf } from "./program.js";
import type { RecognizerSet } from "./recognizers/index.js";
import type { FunctionNode } from "./symbols.js";
import { enclosingSymbol, resolveDeclaredSymbol } from "./symbols.js";
import type { Span } from "./model.js";

/**
 * Declaration stage: bind the user's scan declarations to resolved functions
 * and check every contract reference they make. A declaration that does not
 * resolve, or names something the contract does not contain, is reported and
 * never guessed at.
 */

export interface ResolvedDeclaration {
  readonly id: string;
  readonly kind: "source" | "sanitizer" | "sink" | "component";
  readonly problems: readonly string[];
  readonly span: Span | null;
  readonly symbol: string | null;
  readonly node: FunctionNode | null;
  readonly architectureNode: NodeAssociation | null;
}

export interface DeclarationSet {
  readonly flow: FlowDeclarations;
  readonly records: readonly ResolvedDeclaration[];
  readonly sinks: readonly SinkDeclaration[];
  readonly components: readonly {
    readonly declaration: ComponentDeclaration;
    readonly node: FunctionNode | null;
    readonly usable: boolean;
  }[];
  readonly sources: readonly SourceDeclaration[];
  readonly sanitizers: readonly SanitizerDeclaration[];
}

export function contractClassifications(
  contract: ProjectContract,
): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value !== null && typeof value === "object") {
      for (const [key, member] of Object.entries(value)) {
        if (key === "data_classification" && typeof member === "string") {
          found.add(member);
        } else {
          walk(member);
        }
      }
    }
  };
  walk(contract.architecture);
  walk(contract.conformance_rules);
  walk(contract.constraints);
  return found;
}

/** Architecture node association with hash-aware confirmation standing. */
export function nodeAssociation(
  contract: ProjectContract,
  ref: string | null,
  association: NodeAssociation["association"],
  declarationRef: string | null,
): NodeAssociation {
  const node: ArchitectureNode | undefined =
    ref === null
      ? undefined
      : contract.architecture.nodes.find((entry) => entry.id === ref);
  if (node === undefined) {
    return {
      ref: null,
      association: "unbound",
      declaration_ref: declarationRef,
      trust_boundary: null,
      standing: null,
      content_hash: null,
      trusted: null,
    };
  }
  const element = { type: "node" as const, value: node };
  return {
    ref: node.id,
    association,
    declaration_ref: declarationRef,
    trust_boundary: node.trust_boundary,
    standing: confirmationStanding(element),
    content_hash: architectureContentHash(element),
    trusted: isArchitectureElementTrusted(element),
  };
}

export function resolveDeclarations(input: {
  readonly setup: CompilerSetup;
  readonly reader: RepositoryReader;
  readonly config: ScanConfig;
  readonly contract: ProjectContract;
  readonly recognizers: RecognizerSet;
}): DeclarationSet {
  const { setup, reader, config, contract, recognizers } = input;
  const classifications = contractClassifications(contract);
  const nodeIds = new Set(contract.architecture.nodes.map((node) => node.id));
  const candidateIds = new Set(contract.candidates.map((entry) => entry.id));
  const workloadIds = new Set(contract.workloads.map((entry) => entry.id));
  const records: ResolvedDeclaration[] = [];
  const sources = new Map<FunctionNode, SourceDeclaration>();
  const parameterSources = new Map<FunctionNode, SourceDeclaration[]>();
  const sanitizers = new Map<FunctionNode, SanitizerDeclaration>();

  const resolve = (declared: { path: string; export: string }) =>
    resolveDeclaredSymbol(
      setup.checker,
      setup.program,
      reader,
      setup.analysable,
      declared,
    );
  const locate = (node: ts.Node | null) =>
    node === null
      ? { span: null, symbol: null }
      : {
          span: spanOf(
            node,
            node.getSourceFile(),
            reader.relative(node.getSourceFile().fileName),
          ),
          symbol: enclosingSymbol(node),
        };
  const nodeRef = (ref: string | null, id: string, problems: string[]) => {
    if (ref === null) return null;
    if (!nodeIds.has(ref)) {
      problems.push(`architecture_node_ref_not_in_contract`);
      return nodeAssociation(contract, null, "unbound", id);
    }
    return nodeAssociation(contract, ref, "declared_mapping", id);
  };

  for (const source of config.sources) {
    const problems: string[] = [];
    const resolved = resolve(source.function);
    if (!resolved.ok) problems.push(resolved.problem);
    if (!classifications.has(source.data_classification)) {
      problems.push("data_classification_not_in_contract");
    }
    if (
      resolved.ok &&
      source.parameter !== null &&
      source.parameter >= resolved.node.parameters.length
    ) {
      problems.push("declared_parameter_not_found");
    }
    const node = resolved.ok ? resolved.node : null;
    if (node !== null && !problems.includes("declared_parameter_not_found")) {
      if (source.from === "return") sources.set(node, source);
      else
        parameterSources.set(node, [
          ...(parameterSources.get(node) ?? []),
          source,
        ]);
    }
    records.push({
      id: source.id,
      kind: "source",
      problems,
      node,
      ...locate(node),
      architectureNode: nodeRef(
        source.architecture_node_ref,
        source.id,
        problems,
      ),
    });
  }

  for (const sanitizer of config.sanitizers) {
    const problems: string[] = [];
    const resolved = resolve(sanitizer.function);
    if (!resolved.ok) problems.push(resolved.problem);
    for (const label of [
      ...sanitizer.clears,
      ...(sanitizer.produces === null ? [] : [sanitizer.produces]),
    ]) {
      if (!classifications.has(label)) {
        problems.push("data_classification_not_in_contract");
        break;
      }
    }
    const node = resolved.ok ? resolved.node : null;
    if (node !== null) sanitizers.set(node, sanitizer);
    records.push({
      id: sanitizer.id,
      kind: "sanitizer",
      problems,
      node,
      ...locate(node),
      architectureNode: nodeRef(
        sanitizer.architecture_node_ref,
        sanitizer.id,
        problems,
      ),
    });
  }

  const sinks: SinkDeclaration[] = [];
  for (const sink of config.sinks) {
    const problems: string[] = [];
    const recognizer = recognizers.providers.find(
      (entry) => entry.id === sink.recognizer,
    );
    if (recognizer === undefined) problems.push("recognizer_not_enabled");
    else if (
      recognizer.resourceMethods === undefined &&
      sink.operations.some(
        (operation) =>
          !recognizer.operations.some((entry) => entry.id === operation),
      )
    ) {
      // Resource-derived operations cannot be enumerated in advance.
      problems.push("operation_not_in_recognizer");
    }
    if (sink.candidate_ref !== null && !candidateIds.has(sink.candidate_ref)) {
      problems.push("candidate_ref_not_in_contract");
    }
    const architectureNode = nodeRef(
      sink.architecture_node_ref,
      sink.id,
      problems,
    );
    if (recognizer !== undefined) sinks.push(sink);
    records.push({
      id: sink.id,
      kind: "sink",
      problems,
      node: null,
      span: null,
      symbol: null,
      architectureNode,
    });
  }

  const components: DeclarationSet["components"][number][] = [];
  for (const component of config.components) {
    const problems: string[] = [];
    let node: FunctionNode | null = null;
    const file = setup.program.getSourceFile(
      absoluteIn(reader.root, component.path),
    );
    if (file === undefined || !setup.analysable.has(file.fileName)) {
      problems.push("declared_file_not_in_scan");
    } else if (component.export !== null) {
      const resolved = resolve({
        path: component.path,
        export: component.export,
      });
      if (resolved.ok) node = resolved.node;
      else problems.push(resolved.problem);
    }
    if (
      component.workload_ref !== null &&
      !workloadIds.has(component.workload_ref)
    ) {
      problems.push("workload_ref_not_in_contract");
    }
    const architectureNode = nodeRef(
      component.architecture_node_ref,
      component.id,
      problems,
    );
    const usable =
      !problems.includes("declared_file_not_in_scan") &&
      !problems.some((problem) => problem.startsWith("declared_export"));
    components.push({ declaration: component, node, usable });
    records.push({
      id: component.id,
      kind: "component",
      problems,
      node,
      ...(node === null ? { span: null, symbol: null } : locate(node)),
      architectureNode,
    });
  }

  return {
    flow: { sources, parameterSources, sanitizers },
    records,
    sinks,
    components,
    sources: config.sources,
    sanitizers: config.sanitizers,
  };
}
