import ts from "typescript";

import type { RepositoryReader } from "./boundary.js";
import type { SanitizerDeclaration, SourceDeclaration } from "./config.js";
import type { Span, UnknownReason } from "./model.js";
import { compareSpans, compareStrings, spanKey } from "./model.js";
import { spanOf } from "./program.js";
import type { CompilerSetup } from "./program.js";
import type { RecognizerSet } from "./recognizers/index.js";
import { boundaryFor, isUnsupportedSdk } from "./recognizers/index.js";
import type { ProviderCallFact } from "./semantics.js";
import type { FunctionNode } from "./symbols.js";
import {
  GLOBAL_TYPE_PACKAGES,
  globalNameOf,
  isGlobalDeclaration,
  ambientModuleOf,
  calledDeclaration,
  constantObjectUnmodified,
  enclosingSymbol,
  functionOfSymbol,
  isAnyType,
  isFunctionNode,
  literalText,
  memberName,
  packageOfFile,
  resolveAlias,
} from "./symbols.js";
import { dataImportSpecifier } from "./resolution.js";
import { FLOW_MODEL } from "./version.js";

/**
 * Flow stage: bounded, declaration-driven data flow.
 *
 * Supported (deterministic within these rules):
 *
 * - intraprocedural def-use through variables, reassignment, destructuring,
 *   object properties, array elements, spreads, template strings and string
 *   concatenation, `await`, and conditional/logical expressions;
 * - aliases the checker resolves (imports, re-exports, `const f = g`);
 * - calls into TypeScript's default library propagate the receiver's and
 *   arguments' classifications to the result (`raw.trim()` is still raw);
 * - declared sources: a call's return value, or a declared parameter;
 * - declared sanitizers: the return value no longer carries the cleared
 *   classification from the declared argument. The argument itself is not
 *   changed, so sending the original after calling a sanitizer still sends
 *   raw data. The sanitizer body is not analysed: this is an assumption;
 * - ONE LEVEL of direct-call propagation: from each analysis root (every
 *   function body and every module's top level), a call whose signature
 *   resolves to a repository function with a body is followed once — its body
 *   is evaluated with the caller's argument values and its return values flow
 *   back. Calls made inside that followed body to further repository
 *   functions are not followed; their results are `call_depth_exceeded`.
 * - branches and loops join both paths; a classification present on only one
 *   path is marked `conditional`. Implicit flows (data affecting control
 *   decisions) are not tracked.
 *
 * Everything else that could carry declared data produces an explicit
 * unknown reason instead of silence.
 */

export interface TraceStep {
  readonly kind:
    | "source"
    | "parameter_source"
    | "assignment"
    | "argument"
    | "return"
    | "sanitizer"
    | "sink";
  readonly span: Span;
  readonly symbol: string | null;
  readonly declaration: string | null;
}

export interface Fact {
  readonly classification: string;
  readonly state: "raw" | "sanitized";
  /** For a sanitized fact, the classification that was cleared. */
  readonly derived_from: string | null;
  /** The source or sanitizer declaration that established the fact. */
  readonly declaration: string;
  readonly conditional: boolean;
  readonly trace: readonly TraceStep[];
}

export interface Opaque {
  readonly reason: UnknownReason;
  readonly span: Span;
  readonly symbol: string | null;
  readonly detail: string | null;
  readonly conditional: boolean;
  readonly trace: readonly TraceStep[];
}

export interface Value {
  /** Identities in the current frame's immutable, branch-local heap. */
  readonly refs?: readonly number[];
  readonly facts: readonly Fact[];
  readonly opaque: readonly Opaque[];
  readonly props: ReadonlyMap<string, Value> | null;
  readonly elements: Value | null;
}

export interface FlatValue {
  readonly facts: readonly Fact[];
  readonly opaque: readonly Opaque[];
}

export interface ContextRoot {
  readonly span: Span;
  readonly symbol: string | null;
}

export interface SinkContext {
  readonly key: string;
  readonly kind: "intraprocedural" | "module" | "direct_call";
  readonly root: ContextRoot;
  readonly call_site: Span | null;
  readonly value: FlatValue;
  /** True when every in-repository reference to the root function was followed as a direct call. */
  readonly superseded: boolean;
}

export interface FlowEvent {
  readonly reason: UnknownReason;
  readonly span: Span;
  readonly symbol: string | null;
  readonly context: {
    readonly kind: SinkContext["kind"];
    readonly root: ContextRoot;
    readonly call_site: Span | null;
  };
  readonly classifications: readonly string[];
  /** True when part of what reached this point could not be established. */
  readonly unresolved: boolean;
  readonly detail: string | null;
  readonly trace: readonly TraceStep[];
}

export interface FlowResult {
  readonly sinks: ReadonlyMap<ts.CallExpression, readonly SinkContext[]>;
  readonly events: readonly FlowEvent[];
  readonly budgetExceeded: readonly ContextRoot[];
}

export interface FlowDeclarations {
  readonly sources: ReadonlyMap<FunctionNode, SourceDeclaration>;
  readonly parameterSources: ReadonlyMap<
    FunctionNode,
    readonly SourceDeclaration[]
  >;
  readonly sanitizers: ReadonlyMap<FunctionNode, SanitizerDeclaration>;
}

const EMPTY: Value = { facts: [], opaque: [], props: null, elements: null };
const MAX_TRACE = 24;
const MAX_DEPTH = 5;
/** Distinct unresolved points one value carries before they are summarized. */
const MAX_OPAQUE = 48;
/**
 * Properties tracked per object before the rest collapse into the catch-all
 * `*` member. Generated modules hold objects with hundreds of entries, and an
 * object that wide costs more to carry through every join than tracking each
 * of its fields is worth. A read of a collapsed field falls back to `*`, so
 * the collapse can only widen what is reported, never narrow it.
 */
const MAX_PROPS = 64;
export const EVALUATION_BUDGET = 400_000;

class BudgetExceeded extends Error {}

function isEmpty(value: Value): boolean {
  return (
    value.facts.length === 0 &&
    value.opaque.length === 0 &&
    (value.props === null || [...value.props.values()].every(isEmpty)) &&
    (value.elements === null || isEmpty(value.elements))
  );
}

function factKey(fact: Fact): string {
  const origin = fact.trace[0];
  return `${fact.classification}|${fact.state}|${fact.declaration}|${origin === undefined ? "" : spanKey(origin.span)}`;
}

function opaqueKey(entry: Opaque): string {
  return `${entry.reason}|${spanKey(entry.span)}|${entry.detail ?? ""}`;
}

function appendStep<T extends { trace: readonly TraceStep[] }>(
  item: T,
  step: TraceStep,
): T {
  const last = item.trace[item.trace.length - 1];
  if (
    last !== undefined &&
    last.kind === step.kind &&
    spanKey(last.span) === spanKey(step.span)
  ) {
    return item;
  }
  const trace =
    item.trace.length >= MAX_TRACE
      ? [
          ...item.trace.slice(0, MAX_TRACE / 2),
          ...item.trace.slice(-(MAX_TRACE / 2 - 1)),
          step,
        ]
      : [...item.trace, step];
  return { ...item, trace };
}

function withStep(value: Value, step: TraceStep, depth = 0): Value {
  if (isEmpty(value)) return value;
  return {
    ...value,
    facts: value.facts.map((fact) => appendStep(fact, step)),
    opaque: value.opaque.map((entry) => appendStep(entry, step)),
    props:
      value.props === null || depth > MAX_DEPTH
        ? value.props
        : new Map(
            [...value.props].map(([key, member]) => [
              key,
              withStep(member, step, depth + 1),
            ]),
          ),
    elements:
      value.elements === null || depth > MAX_DEPTH
        ? value.elements
        : withStep(value.elements, step, depth + 1),
  };
}

function conditional(value: Value, depth = 0): Value {
  if (isEmpty(value)) return value;
  return {
    ...value,
    facts: value.facts.map((fact) =>
      fact.conditional ? fact : { ...fact, conditional: true },
    ),
    opaque: value.opaque.map((entry) =>
      entry.conditional ? entry : { ...entry, conditional: true },
    ),
    props:
      value.props === null || depth > MAX_DEPTH
        ? value.props
        : new Map(
            [...value.props].map(([key, member]) => [
              key,
              conditional(member, depth + 1),
            ]),
          ),
    elements:
      value.elements === null || depth > MAX_DEPTH
        ? value.elements
        : conditional(value.elements, depth + 1),
  };
}

function mergeFacts(left: readonly Fact[], right: readonly Fact[]): Fact[] {
  const merged = new Map<string, Fact>();
  for (const fact of [...left, ...right]) {
    const key = factKey(fact);
    const existing = merged.get(key);
    merged.set(
      key,
      existing === undefined
        ? fact
        : {
            ...existing,
            conditional: existing.conditional && fact.conditional,
          },
    );
  }
  return [...merged.values()];
}

/**
 * Merge two sets of unresolved values, keeping at most `MAX_OPAQUE` of them.
 *
 * A value that flows through generated or highly dynamic code can collect
 * thousands of distinct unresolved points, and every later merge, join and
 * copy walks all of them, so the analysis slows quadratically. Beyond the cap
 * the individual points are replaced by one `analysis_budget_exceeded` entry
 * at the first dropped span: the call still reports that something unresolved
 * reaches it, with fewer locations naming where.
 */
function mergeOpaque(
  left: readonly Opaque[],
  right: readonly Opaque[],
): Opaque[] {
  // Most merges combine nothing with something: keep those allocation-free.
  if (left.length === 0) return right as Opaque[];
  if (right.length === 0) return left as Opaque[];
  const merged = new Map<string, Opaque>();
  let dropped: Opaque | null = null;
  for (const entry of [...left, ...right]) {
    const key = opaqueKey(entry);
    const existing = merged.get(key);
    if (existing === undefined && merged.size >= MAX_OPAQUE) {
      if (dropped === null || compareSpans(entry.span, dropped.span) < 0)
        dropped = entry;
      continue;
    }
    merged.set(
      key,
      existing === undefined
        ? entry
        : {
            ...existing,
            conditional: existing.conditional && entry.conditional,
          },
    );
  }
  if (dropped !== null) {
    const summary: Opaque = {
      reason: "analysis_budget_exceeded",
      span: dropped.span,
      symbol: dropped.symbol,
      detail: "more unresolved values here than the analysis carries",
      conditional: dropped.conditional,
      trace: dropped.trace,
    };
    merged.set(opaqueKey(summary), summary);
  }
  return [...merged.values()];
}

function union(left: Value, right: Value, depth = 0): Value {
  // The same value joined with itself (both branches of a condition read the
  // same variable, a loop re-reads its own state) is by far the commonest
  // merge, and walking its whole tree to rebuild an identical value is pure
  // cost.
  if (left === right) return left;
  if (
    isEmpty(left) &&
    !left.refs?.length &&
    left.props === null &&
    left.elements === null
  )
    return right;
  if (
    isEmpty(right) &&
    !right.refs?.length &&
    right.props === null &&
    right.elements === null
  )
    return left;
  if (depth > MAX_DEPTH) {
    const a = flatten(left);
    const b = flatten(right);
    return {
      facts: mergeFacts(a.facts, b.facts),
      opaque: mergeOpaque(a.opaque, b.opaque),
      props: null,
      elements: null,
    };
  }
  let props: Map<string, Value> | null = null;
  if (left.props !== null || right.props !== null) {
    props = new Map();
    const keys = new Set([
      ...(left.props?.keys() ?? []),
      ...(right.props?.keys() ?? []),
    ]);
    for (const key of keys) {
      const a = left.props?.get(key);
      const b = right.props?.get(key);
      props.set(
        key,
        a !== undefined && b !== undefined
          ? union(a, b, depth + 1)
          : (a ?? b ?? EMPTY),
      );
    }
  }
  const elements =
    left.elements !== null && right.elements !== null
      ? union(left.elements, right.elements, depth + 1)
      : (left.elements ?? right.elements);
  return {
    refs: [...new Set([...(left.refs ?? []), ...(right.refs ?? [])])],
    facts: mergeFacts(left.facts, right.facts),
    opaque: mergeOpaque(left.opaque, right.opaque),
    props,
    elements,
  };
}

/** Join two alternative paths: what only one path has becomes conditional. */
function join(left: Value | undefined, right: Value | undefined): Value {
  if (left === undefined) return conditional(right ?? EMPTY);
  if (right === undefined) return conditional(left);
  if (left === right) return left;
  const leftFlat = flatten(left);
  const rightFlat = flatten(right);
  const leftFacts = new Set(leftFlat.facts.map(factKey));
  const rightFacts = new Set(rightFlat.facts.map(factKey));
  const leftOpaque = new Set(leftFlat.opaque.map(opaqueKey));
  const rightOpaque = new Set(rightFlat.opaque.map(opaqueKey));
  const mark = (
    value: Value,
    otherFacts: Set<string>,
    otherOpaque: Set<string>,
    depth = 0,
  ): Value => ({
    ...value,
    facts: value.facts.map((fact) =>
      otherFacts.has(factKey(fact)) || fact.conditional
        ? fact
        : { ...fact, conditional: true },
    ),
    opaque: value.opaque.map((entry) =>
      otherOpaque.has(opaqueKey(entry)) || entry.conditional
        ? entry
        : { ...entry, conditional: true },
    ),
    props:
      value.props === null || depth > MAX_DEPTH
        ? value.props
        : new Map(
            [...value.props].map(([key, member]) => [
              key,
              mark(member, otherFacts, otherOpaque, depth + 1),
            ]),
          ),
    elements:
      value.elements === null || depth > MAX_DEPTH
        ? value.elements
        : mark(value.elements, otherFacts, otherOpaque, depth + 1),
  });
  return union(
    mark(left, rightFacts, rightOpaque),
    mark(right, leftFacts, leftOpaque),
  );
}

export function flatten(value: Value, depth = 0): FlatValue {
  let facts = [...value.facts];
  let opaque = [...value.opaque];
  if (depth <= MAX_DEPTH + 2) {
    for (const member of [
      ...(value.props?.values() ?? []),
      ...(value.elements === null ? [] : [value.elements]),
    ]) {
      const inner = flatten(member, depth + 1);
      facts = mergeFacts(facts, inner.facts);
      opaque = mergeOpaque(opaque, inner.opaque);
    }
  }
  return { facts, opaque };
}

function flat(value: Value): Value {
  const { facts, opaque } = flatten(value);
  return { facts, opaque, props: null, elements: null };
}

function topLevel(value: Value): Value {
  return {
    facts: value.facts,
    opaque: value.opaque,
    props: null,
    elements: null,
  };
}

function getProperty(value: Value, name: string): Value {
  const member = value.props?.get(name) ?? value.props?.get("*");
  return union(member ?? EMPTY, topLevel(value));
}

function getElement(value: Value): Value {
  if (value.elements !== null) return union(value.elements, topLevel(value));
  return flat(value);
}

function opaqueValue(entry: Opaque, carried: Value = EMPTY): Value {
  const base = flat(carried);
  return {
    facts: base.facts,
    opaque: mergeOpaque(base.opaque, [entry]),
    props: null,
    elements: null,
  };
}

type Env = Map<ts.Symbol, Value>;
type Heap = Map<number, Value>;

/**
 * Record one property, collapsing into the catch-all `*` member once the
 * object is wider than `MAX_PROPS` or its key is not a literal.
 */
function setProp(
  props: Map<string, Value>,
  key: string | null,
  value: Value,
): void {
  const collapse = key === null || (!props.has(key) && props.size >= MAX_PROPS);
  if (collapse) props.set("*", union(props.get("*") ?? EMPTY, value));
  else props.set(key, value);
}

function joinEnv(left: Env, right: Env): Env {
  const result: Env = new Map();
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    result.set(key, join(left.get(key), right.get(key)));
  }
  return result;
}

function joinHeap(left: Heap, right: Heap): Heap {
  return new Map(
    [...new Set([...left.keys(), ...right.keys()])].map((id) => [
      id,
      join(left.get(id), right.get(id)),
    ]),
  );
}

interface Frame {
  readonly depth: number;
  readonly fn: FunctionNode | null;
  readonly file: ts.SourceFile;
  readonly path: string;
  readonly context: FlowEvent["context"];
  readonly stack: readonly FunctionNode[];
  readonly silent: boolean;
  env: Env;
  heap: Heap;
  conditional: boolean;
  returns: Value;
}

/** Library functions known not to mutate their arguments. */
const NON_MUTATING: Readonly<Record<string, readonly string[] | "all">> = {
  JSON: ["stringify", "parse"],
  Console: "all",
  Math: "all",
  ObjectConstructor: [
    "keys",
    "values",
    "entries",
    "getOwnPropertyNames",
    "isFrozen",
  ],
  ArrayConstructor: ["isArray"],
  NumberConstructor: ["isFinite", "isInteger", "isNaN", "isSafeInteger"],
  BufferConstructor: ["byteLength", "isBuffer"],
  String: "all",
  StringConstructor: "all",
};

function nonMutating(owner: string | null, member: string | null): boolean {
  if (owner === null || member === null) return false;
  const entry = NON_MUTATING[owner];
  return entry === "all" || (entry !== undefined && entry.includes(member));
}

/** A network request whose URL literal (or template) starts with `/`: the page's own origin. */
function sameOriginRequest(call: ts.CallExpression): boolean {
  const first = call.arguments[0];
  if (first === undefined) return false;
  const text = ts.isStringLiteralLike(first)
    ? first.text
    : ts.isTemplateExpression(first)
      ? first.head.text
      : null;
  return text !== null && text.startsWith("/") && !text.startsWith("//");
}

export function analyzeFlows(input: {
  readonly setup: CompilerSetup;
  readonly reader: RepositoryReader;
  readonly recognizers: RecognizerSet;
  readonly declarations: FlowDeclarations;
  readonly calls: readonly ProviderCallFact[];
  readonly budget?: number;
}): FlowResult {
  const { setup, reader, recognizers, declarations } = input;
  const { checker, program } = setup;
  const sinkCalls = new Map(input.calls.map((call) => [call.node, call]));
  const sinkContexts = new Map<ts.CallExpression, Map<string, SinkContext>>();
  const events = new Map<string, FlowEvent>();
  const inlinedCalls = new Set<ts.Node>();
  const moduleConstants = new Map<
    ts.VariableDeclaration,
    { value: Value; heap: Heap } | "pending"
  >();
  const budgetExceeded: ContextRoot[] = [];
  const budget = input.budget ?? EVALUATION_BUDGET;
  let evaluations = 0;
  let nextObject = 0;

  const pathOf = (file: ts.SourceFile) => reader.relative(file.fileName);
  const span = (node: ts.Node, frame: Frame): Span => {
    const file = node.getSourceFile();
    return spanOf(node, file, file === frame.file ? frame.path : pathOf(file));
  };
  const analysableNode = (node: ts.Node) =>
    setup.analysable.has(node.getSourceFile().fileName);

  const record = (
    frame: Frame,
    reason: UnknownReason,
    node: ts.Node,
    carried: Value,
    detail: string | null,
  ) => {
    if (frame.silent) return;
    const content = flatten(carried);
    const at = span(node, frame);
    const key = `${reason}|${spanKey(at)}|${frame.context.root.span.path}:${spanKey(frame.context.root.span)}|${frame.context.call_site === null ? "" : spanKey(frame.context.call_site)}`;
    const existing = events.get(key);
    const classifications = [
      ...new Set(
        content.facts.map((fact) => `${fact.classification}:${fact.state}`),
      ),
    ];
    const trace = content.facts[0]?.trace ?? content.opaque[0]?.trace ?? [];
    events.set(key, {
      reason,
      span: at,
      symbol: enclosingSymbol(node),
      context: frame.context,
      classifications: [
        ...new Set([...(existing?.classifications ?? []), ...classifications]),
      ].sort(compareStrings),
      unresolved: (existing?.unresolved ?? false) || content.opaque.length > 0,
      detail,
      trace: existing?.trace.length ? existing.trace : trace,
    });
  };

  const opaqueAt = (
    frame: Frame,
    reason: UnknownReason,
    node: ts.Node,
    detail: string | null = null,
  ): Opaque => ({
    reason,
    span: span(node, frame),
    symbol: enclosingSymbol(node),
    detail,
    conditional: frame.conditional,
    trace: [],
  });

  const allocate = (value: Value, frame: Frame): Value => {
    const id = nextObject++;
    frame.heap.set(id, value);
    return { ...value, refs: [id] };
  };

  const invalidateReferences = (
    value: Value,
    frame: Frame,
    node: ts.Node,
    reason: UnknownReason,
    detail: string,
  ) => {
    const visited = new Set<number>();
    const visit = (entry: Value, depth = 0): void => {
      if (depth > MAX_DEPTH) return;
      for (const id of entry.refs ?? []) {
        if (visited.has(id)) continue;
        visited.add(id);
        const state = frame.heap.get(id);
        if (state === undefined) continue;
        frame.heap.set(id, {
          ...state,
          opaque: mergeOpaque(state.opaque, [
            opaqueAt(frame, reason, node, detail),
          ]),
        });
        for (const child of state.props?.values() ?? [])
          visit(child, depth + 1);
        if (state.elements !== null) visit(state.elements, depth + 1);
      }
    };
    visit(value);
  };

  const requestInputs = (
    sink: ProviderCallFact,
    arguments_: readonly Value[],
    frame: Frame,
  ): Value => {
    const { operation, node } = sink;
    const values = arguments_.map((value) => currentValue(value, frame));
    let payload = values[operation.payloadArgument] ?? EMPTY;
    let supplemental = EMPTY;
    const options = operation.requestOptions;
    let unresolved = false;
    if (options !== undefined && values[options.argument] !== undefined) {
      const value = values[options.argument]!;
      if (
        value.props === null ||
        value.facts.length ||
        value.opaque.length ||
        value.elements !== null
      )
        unresolved = true;
      for (const [key, member] of value.props ?? []) {
        if (key === options.bodyOverride) payload = member;
        else if (options.sentProperties.includes(key))
          supplemental = union(supplemental, flat(member));
        else if (!options.localProperties.includes(key)) unresolved = true;
      }
    }
    const sentArguments = operation.sentArguments ?? [];
    values.forEach((value, index) => {
      if (sentArguments.includes(index))
        supplemental = union(supplemental, flat(value));
    });
    if (
      values.some(
        (_, index) =>
          index !== operation.payloadArgument &&
          index !== options?.argument &&
          !sentArguments.includes(index),
      )
    )
      unresolved = true;
    if (unresolved) {
      const carried = values.reduce((a, b) => union(a, flat(b)), EMPTY);
      record(
        frame,
        "request_transport_unresolved",
        node,
        carried,
        "request options or transformation not modelled",
      );
      return opaqueValue({
        ...opaqueAt(
          frame,
          "request_transport_unresolved",
          node,
          "unmodelled request transformation",
        ),
        trace: flatten(carried).facts[0]?.trace ?? [],
      });
    }
    return union(flat(payload), supplemental);
  };

  // Values retain object identities through assignments, destructuring and
  // calls. Resolve their fields at each use, never from an old alias snapshot.
  const currentValue = (
    value: Value,
    frame: Frame,
    seen = new Set<number>(),
    depth = 0,
  ): Value => {
    if (depth > MAX_DEPTH || value.refs?.some((id) => seen.has(id))) {
      return opaqueValue(
        {
          reason: "property_not_tracked",
          span: frame.context.root.span,
          symbol: frame.context.root.symbol,
          detail: "cyclic or deeply nested object",
          conditional: frame.conditional,
          trace: [],
        },
        flat(value),
      );
    }
    let resolved = value;
    if (value.refs?.length) {
      const states = value.refs.map((id) => frame.heap.get(id) ?? EMPTY);
      resolved = states.reduce((a, b) => join(a, b));
      resolved = {
        ...resolved,
        facts: mergeFacts(resolved.facts, value.facts),
        opaque: mergeOpaque(resolved.opaque, value.opaque),
      };
    }
    const visited = new Set([...seen, ...(value.refs ?? [])]);
    return {
      ...resolved,
      refs: value.refs ?? [],
      props:
        resolved.props === null
          ? null
          : new Map(
              [...resolved.props].map(([key, member]) => [
                key,
                currentValue(member, frame, visited, depth + 1),
              ]),
            ),
      elements:
        resolved.elements === null
          ? null
          : currentValue(resolved.elements, frame, visited, depth + 1),
    };
  };

  // Both expression and statement branches must fork the heap as well as
  // locals. Inlined calls share the selected heap, not the sibling branch.
  const alternatives = (
    frame: Frame,
    left: () => Value,
    right: () => Value,
    choice: boolean | null = null,
  ): Value => {
    if (choice !== null) return choice ? left() : right();
    const env = frame.env,
      heap = frame.heap,
      returns = frame.returns,
      guarded = frame.conditional;
    frame.env = new Map(env);
    frame.heap = new Map(heap);
    frame.conditional = true;
    const a = left(),
      aEnv = frame.env,
      aHeap = frame.heap,
      aReturns = frame.returns;
    frame.env = new Map(env);
    frame.heap = new Map(heap);
    frame.returns = returns;
    const b = right();
    frame.env = joinEnv(aEnv, frame.env);
    frame.heap = joinHeap(aHeap, frame.heap);
    frame.returns = join(aReturns, frame.returns);
    frame.conditional = guarded;
    return join(a, b);
  };

  const knownCondition = (
    expression: ts.Expression,
    nullish = false,
  ): boolean | null => {
    if (ts.isParenthesizedExpression(expression))
      return knownCondition(expression.expression, nullish);
    if (
      expression.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(expression) &&
        expression.text === "undefined" &&
        checker.getSymbolAtLocation(expression) === undefined)
    )
      return false;
    if (
      nullish &&
      (ts.isStringLiteralLike(expression) ||
        ts.isNumericLiteral(expression) ||
        expression.kind === ts.SyntaxKind.TrueKeyword ||
        expression.kind === ts.SyntaxKind.FalseKeyword)
    )
      return true;
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isStringLiteralLike(expression)) return expression.text.length > 0;
    if (ts.isNumericLiteral(expression)) return Number(expression.text) !== 0;
    return null;
  };

  const containerOf = (node: ts.Node): FunctionNode | ts.SourceFile => {
    for (let current = node.parent; current; current = current.parent) {
      if (isFunctionNode(current) || ts.isSourceFile(current)) return current;
    }
    return node.getSourceFile();
  };

  // ---------------------------------------------------------------- lookup

  const evaluateModuleConstant = (
    declaration: ts.VariableDeclaration,
    frame: Frame,
    use: ts.Node = declaration,
  ): Value => {
    if (
      declaration.initializer &&
      (ts.isObjectLiteralExpression(declaration.initializer) ||
        ts.isArrayLiteralExpression(declaration.initializer)) &&
      !constantObjectUnmodified(checker, declaration, use)
    ) {
      return opaqueValue(
        opaqueAt(
          frame,
          "captured_variable_not_tracked",
          declaration,
          "mutable or escaped module object",
        ),
      );
    }
    const cached = moduleConstants.get(declaration);
    if (cached === "pending") {
      return opaqueValue(
        opaqueAt(
          frame,
          "captured_variable_not_tracked",
          declaration,
          "cyclic module constant",
        ),
      );
    }
    if (cached !== undefined) {
      for (const [id, entry] of cached.heap)
        if (!frame.heap.has(id)) frame.heap.set(id, entry);
      return cached.value;
    }
    moduleConstants.set(declaration, "pending");
    const file = declaration.getSourceFile();
    const moduleFrame: Frame = {
      depth: 0,
      fn: null,
      file,
      path: pathOf(file),
      context: {
        kind: "module",
        root: { span: spanOf(file, file, pathOf(file)), symbol: null },
        call_site: null,
      },
      stack: [],
      silent: true,
      env: new Map(),
      heap: new Map(),
      conditional: false,
      returns: EMPTY,
    };
    let value = EMPTY;
    if (declaration.initializer !== undefined) {
      value = evaluate(declaration.initializer, moduleFrame);
      if (ts.isIdentifier(declaration.name)) {
        value = withStep(value, {
          kind: "assignment",
          span: spanOf(declaration.name, file, pathOf(file)),
          symbol: declaration.name.text,
          declaration: null,
        });
      } else {
        value = flat(value);
      }
    }
    moduleConstants.set(declaration, { value, heap: moduleFrame.heap });
    for (const [id, entry] of moduleFrame.heap)
      if (!frame.heap.has(id)) frame.heap.set(id, entry);
    return value;
  };

  const lookup = (identifier: ts.Identifier, frame: Frame): Value => {
    const symbol = checker.getSymbolAtLocation(identifier);
    if (symbol === undefined) {
      if (identifier.text === "undefined") return EMPTY;
      return isAnyType(checker.getTypeAtLocation(identifier))
        ? opaqueValue(
            opaqueAt(
              frame,
              "unresolved_any",
              identifier,
              "unresolved identifier",
            ),
          )
        : EMPTY;
    }
    const local = frame.env.get(symbol);
    if (local !== undefined) return local;
    const resolved = resolveAlias(checker, symbol) ?? symbol;
    const declaration = resolved.valueDeclaration ?? resolved.declarations?.[0];
    if (declaration === undefined) return EMPTY;
    if (!analysableNode(declaration)) {
      if (
        declaration.getSourceFile().isDeclarationFile ||
        program.isSourceFileDefaultLibrary(declaration.getSourceFile())
      ) {
        return EMPTY;
      }
      return EMPTY;
    }
    if (
      isFunctionNode(declaration) ||
      ts.isClassDeclaration(declaration) ||
      ts.isEnumDeclaration(declaration) ||
      ts.isModuleDeclaration(declaration) ||
      ts.isSourceFile(declaration)
    ) {
      return EMPTY;
    }
    const container = containerOf(declaration);
    if (
      container === frame.fn ||
      (frame.fn === null && container === frame.file)
    ) {
      return EMPTY; // local, not yet assigned on this path
    }
    if (ts.isVariableDeclaration(declaration) && ts.isSourceFile(container)) {
      const list = declaration.parent;
      if (
        ts.isVariableDeclarationList(list) &&
        (list.flags & ts.NodeFlags.Const) !== 0
      ) {
        if (functionOfSymbol(checker, resolved) !== null) return EMPTY;
        if (ts.isIdentifier(declaration.name))
          return evaluateModuleConstant(declaration, frame, identifier.parent);
        return flat(evaluateModuleConstant(declaration, frame));
      }
    }
    if (
      ts.isBindingElement(declaration) ||
      ts.isVariableDeclaration(declaration) ||
      ts.isParameter(declaration)
    ) {
      return opaqueValue(
        opaqueAt(frame, "captured_variable_not_tracked", identifier, null),
      );
    }
    return EMPTY;
  };

  // --------------------------------------------------------------- binding

  const bindName = (
    name: ts.BindingName,
    value: Value,
    frame: Frame,
    stepSpan: ts.Node,
  ) => {
    if (ts.isIdentifier(name)) {
      const symbol = checker.getSymbolAtLocation(name);
      if (symbol === undefined) return;
      frame.env.set(
        symbol,
        withStep(value, {
          kind: "assignment",
          span: span(stepSpan, frame),
          symbol: name.text,
          declaration: null,
        }),
      );
      return;
    }
    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        let member: Value;
        if (element.dotDotDotToken !== undefined) {
          member = value;
        } else {
          const property = element.propertyName;
          let key: string | null = null;
          if (property === undefined && ts.isIdentifier(element.name))
            key = element.name.text;
          else if (
            property !== undefined &&
            (ts.isIdentifier(property) ||
              ts.isStringLiteral(property) ||
              ts.isNumericLiteral(property))
          )
            key = property.text;
          else if (
            property !== undefined &&
            ts.isComputedPropertyName(property)
          ) {
            key = literalText(checker, property.expression);
          }
          member =
            key === null
              ? opaqueValue(
                  opaqueAt(frame, "dynamic_property_access", element, null),
                  value,
                )
              : getProperty(value, key);
        }
        if (element.initializer !== undefined) {
          member = join(member, evaluate(element.initializer, frame));
        }
        bindName(element.name, member, frame, element);
      }
      return;
    }
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      let member =
        element.dotDotDotToken !== undefined ? value : getElement(value);
      if (element.initializer !== undefined)
        member = join(member, evaluate(element.initializer, frame));
      bindName(element.name, member, frame, element);
    }
  };

  const assign = (
    target: ts.Expression,
    value: Value,
    frame: Frame,
    node: ts.Node,
  ) => {
    const inner = ts.isParenthesizedExpression(target)
      ? target.expression
      : target;
    if (ts.isIdentifier(inner)) {
      const symbol = checker.getSymbolAtLocation(inner);
      if (symbol === undefined) return;
      const declaration = symbol.valueDeclaration;
      const container =
        declaration === undefined ? null : containerOf(declaration);
      if (
        container === frame.fn ||
        (frame.fn === null && container === frame.file) ||
        frame.env.has(symbol)
      ) {
        frame.env.set(
          symbol,
          withStep(value, {
            kind: "assignment",
            span: span(node, frame),
            symbol: inner.text,
            declaration: null,
          }),
        );
      }
      return;
    }
    if (
      ts.isPropertyAccessExpression(inner) ||
      ts.isElementAccessExpression(inner)
    ) {
      const target = evaluate(inner.expression, frame);
      const key = ts.isPropertyAccessExpression(inner)
        ? inner.name.text
        : literalText(checker, inner.argumentExpression);
      const numeric =
        ts.isElementAccessExpression(inner) &&
        (ts.isNumericLiteral(inner.argumentExpression) ||
          (checker.getTypeAtLocation(inner.argumentExpression).flags &
            ts.TypeFlags.NumberLike) !==
            0);
      for (const id of target.refs ?? []) {
        const state = frame.heap.get(id) ?? EMPTY;
        if (state.elements !== null && numeric) {
          // Arrays are element-insensitive: a write may replace only one
          // member, so retain the other possible elements.
          frame.heap.set(id, {
            ...state,
            elements: union(state.elements, value),
          });
        } else if (key !== null) {
          const props = new Map(state.props ?? []);
          if (props.has(key) || props.size < MAX_PROPS)
            props.set(
              key,
              target.refs?.length === 1 ? value : join(props.get(key), value),
            );
          else setProp(props, key, value);
          frame.heap.set(id, { ...state, props });
        } else {
          const unresolved = opaqueValue(
            opaqueAt(
              frame,
              "dynamic_property_access",
              node,
              "unresolved object write",
            ),
            value,
          );
          frame.heap.set(id, {
            ...state,
            opaque: mergeOpaque(state.opaque, unresolved.opaque),
            facts: mergeFacts(state.facts, unresolved.facts),
          });
          record(
            frame,
            "dynamic_property_access",
            node,
            value,
            "unresolved object write",
          );
        }
      }
      if (!target.refs?.length) {
        record(
          frame,
          "property_not_tracked",
          node,
          value,
          "write to an untracked object",
        );
        // Invalidate the root variable when a structured path cannot be
        // represented. Never keep its previous sanitized-only snapshot.
        let base: ts.Expression = inner.expression;
        while (
          ts.isPropertyAccessExpression(base) ||
          ts.isElementAccessExpression(base)
        )
          base = base.expression;
        if (ts.isIdentifier(base)) {
          const symbol = checker.getSymbolAtLocation(base);
          if (symbol !== undefined)
            frame.env.set(
              symbol,
              opaqueValue(
                opaqueAt(
                  frame,
                  "property_not_tracked",
                  node,
                  "untracked object write",
                ),
                union(frame.env.get(symbol) ?? EMPTY, value),
              ),
            );
        }
      }
      return;
    }
    if (ts.isArrayLiteralExpression(inner)) {
      for (const element of inner.elements) {
        if (ts.isOmittedExpression(element)) continue;
        assign(
          ts.isSpreadElement(element) ? element.expression : element,
          getElement(value),
          frame,
          node,
        );
      }
      return;
    }
    if (ts.isObjectLiteralExpression(inner)) {
      for (const property of inner.properties) {
        if (ts.isShorthandPropertyAssignment(property))
          assign(
            property.name,
            getProperty(value, property.name.text),
            frame,
            node,
          );
        else if (ts.isPropertyAssignment(property)) {
          const key = memberName(property);
          assign(
            property.initializer,
            key === null ? flat(value) : getProperty(value, key),
            frame,
            node,
          );
        } else if (ts.isSpreadAssignment(property))
          assign(property.expression, value, frame, node);
      }
    }
  };

  // ------------------------------------------------------------ statements

  const execBlock = (
    statements: readonly ts.Statement[] | ts.NodeArray<ts.Statement>,
    frame: Frame,
  ) => {
    for (const statement of statements) exec(statement, frame);
  };

  const exec = (statement: ts.Statement, frame: Frame): void => {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const value =
          declaration.initializer === undefined
            ? EMPTY
            : evaluate(declaration.initializer, frame);
        bindName(declaration.name, value, frame, declaration.name);
      }
    } else if (ts.isExpressionStatement(statement)) {
      evaluate(statement.expression, frame);
    } else if (ts.isReturnStatement(statement)) {
      if (statement.expression !== undefined) {
        frame.returns = union(
          frame.returns,
          evaluate(statement.expression, frame),
        );
      }
    } else if (ts.isBlock(statement)) {
      execBlock(statement.statements, frame);
    } else if (ts.isIfStatement(statement)) {
      evaluate(statement.expression, frame);
      alternatives(
        frame,
        () => {
          exec(statement.thenStatement, frame);
          return EMPTY;
        },
        () => {
          if (statement.elseStatement !== undefined)
            exec(statement.elseStatement, frame);
          return EMPTY;
        },
        knownCondition(statement.expression),
      );
    } else if (
      ts.isForStatement(statement) ||
      ts.isForOfStatement(statement) ||
      ts.isForInStatement(statement) ||
      ts.isWhileStatement(statement) ||
      ts.isDoStatement(statement)
    ) {
      if (ts.isForStatement(statement)) {
        if (statement.initializer !== undefined) {
          if (ts.isVariableDeclarationList(statement.initializer)) {
            for (const declaration of statement.initializer.declarations) {
              bindName(
                declaration.name,
                declaration.initializer === undefined
                  ? EMPTY
                  : evaluate(declaration.initializer, frame),
                frame,
                declaration.name,
              );
            }
          } else {
            evaluate(statement.initializer, frame);
          }
        }
      }
      const before = frame.env,
        beforeHeap = frame.heap,
        guarded = frame.conditional;
      frame.env = new Map(before);
      frame.heap = new Map(beforeHeap);
      frame.conditional = true;
      for (let iteration = 0; iteration < 2; iteration += 1) {
        if (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) {
          const iterable = evaluate(statement.expression, frame);
          const element = ts.isForOfStatement(statement)
            ? getElement(iterable)
            : EMPTY;
          if (ts.isVariableDeclarationList(statement.initializer)) {
            for (const declaration of statement.initializer.declarations)
              bindName(declaration.name, element, frame, declaration.name);
          } else {
            assign(
              statement.initializer,
              element,
              frame,
              statement.initializer,
            );
          }
        } else if (
          ts.isWhileStatement(statement) ||
          ts.isDoStatement(statement)
        ) {
          evaluate(statement.expression, frame);
        } else if (statement.condition !== undefined) {
          evaluate(statement.condition, frame);
        }
        exec(statement.statement, frame);
        if (ts.isForStatement(statement) && statement.incrementor !== undefined)
          evaluate(statement.incrementor, frame);
      }
      frame.env = joinEnv(before, frame.env);
      frame.heap = joinHeap(beforeHeap, frame.heap);
      frame.conditional = guarded;
    } else if (ts.isTryStatement(statement)) {
      const before = frame.env,
        beforeHeap = frame.heap,
        guarded = frame.conditional;
      frame.env = new Map(before);
      frame.heap = new Map(beforeHeap);
      frame.conditional = true;
      execBlock(statement.tryBlock.statements, frame);
      const afterTry = frame.env,
        afterTryHeap = frame.heap;
      if (statement.catchClause !== undefined) {
        frame.env = joinEnv(before, afterTry);
        frame.heap = joinHeap(beforeHeap, afterTryHeap);
        const variable = statement.catchClause.variableDeclaration;
        if (variable !== undefined)
          bindName(variable.name, EMPTY, frame, variable);
        execBlock(statement.catchClause.block.statements, frame);
        frame.env = joinEnv(afterTry, frame.env);
        frame.heap = joinHeap(afterTryHeap, frame.heap);
      }
      frame.conditional = guarded;
      if (statement.finallyBlock !== undefined)
        execBlock(statement.finallyBlock.statements, frame);
    } else if (ts.isSwitchStatement(statement)) {
      evaluate(statement.expression, frame);
      const before = frame.env,
        beforeHeap = frame.heap,
        guarded = frame.conditional;
      let joinedHeap = new Map(beforeHeap);
      let joined: Env = new Map(before);
      frame.conditional = true;
      let hasDefault = false;
      for (const clause of statement.caseBlock.clauses) {
        if (ts.isDefaultClause(clause)) hasDefault = true;
        else evaluate(clause.expression, frame);
        frame.env = new Map(before);
        frame.heap = new Map(beforeHeap);
        execBlock(clause.statements, frame);
        joined = joinEnv(joined, frame.env);
        joinedHeap = joinHeap(joinedHeap, frame.heap);
      }
      frame.env = hasDefault ? joined : joinEnv(joined, before);
      frame.heap = joinedHeap;
      frame.conditional = guarded;
    } else if (ts.isThrowStatement(statement)) {
      evaluate(statement.expression, frame);
    } else if (ts.isLabeledStatement(statement)) {
      exec(statement.statement, frame);
    } else if (ts.isWithStatement(statement)) {
      record(
        frame,
        "reflection_or_code_generation",
        statement,
        evaluate(statement.expression, frame),
        "with statement",
      );
    }
    // Declarations of functions and classes are separate analysis roots;
    // break/continue/empty/type declarations carry no data.
  };

  // ----------------------------------------------------------- expressions

  const evaluate = (expression: ts.Expression, frame: Frame): Value =>
    currentValue(evaluateExpression(expression, frame), frame);

  const evaluateExpression = (
    expression: ts.Expression,
    frame: Frame,
  ): Value => {
    evaluations += 1;
    if (evaluations > budget) throw new BudgetExceeded();

    if (
      ts.isStringLiteralLike(expression) ||
      ts.isNumericLiteral(expression) ||
      ts.isBigIntLiteral(expression) ||
      ts.isRegularExpressionLiteral(expression) ||
      expression.kind === ts.SyntaxKind.TrueKeyword ||
      expression.kind === ts.SyntaxKind.FalseKeyword ||
      expression.kind === ts.SyntaxKind.NullKeyword ||
      expression.kind === ts.SyntaxKind.UndefinedKeyword
    ) {
      return EMPTY;
    }
    if (ts.isIdentifier(expression)) return lookup(expression, frame);
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isAwaitExpression(expression)
    ) {
      return evaluate(expression.expression, frame);
    }
    if (ts.isTemplateExpression(expression)) {
      let value = EMPTY;
      for (const part of expression.templateSpans)
        value = union(value, flat(evaluate(part.expression, frame)));
      return value;
    }
    if (ts.isBinaryExpression(expression)) {
      const operator = expression.operatorToken.kind;
      if (operator === ts.SyntaxKind.EqualsToken) {
        const value = evaluate(expression.right, frame);
        assign(expression.left, value, frame, expression);
        return value;
      }
      if (operator === ts.SyntaxKind.PlusEqualsToken) {
        const value = union(
          evaluate(expression.left, frame),
          evaluate(expression.right, frame),
        );
        assign(expression.left, value, frame, expression);
        return value;
      }
      const logical =
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken ||
        operator === ts.SyntaxKind.AmpersandAmpersandToken;
      const logicalAssignment =
        operator === ts.SyntaxKind.BarBarEqualsToken ||
        operator === ts.SyntaxKind.QuestionQuestionEqualsToken ||
        operator === ts.SyntaxKind.AmpersandAmpersandEqualsToken;
      if (logical || logicalAssignment) {
        const left = evaluate(expression.left, frame);
        const isAnd =
          operator === ts.SyntaxKind.AmpersandAmpersandToken ||
          operator === ts.SyntaxKind.AmpersandAmpersandEqualsToken;
        const known = knownCondition(
          expression.left,
          operator === ts.SyntaxKind.QuestionQuestionToken ||
            operator === ts.SyntaxKind.QuestionQuestionEqualsToken,
        );
        const takeRight = known === null ? null : isAnd ? known : !known;
        return alternatives(
          frame,
          () => {
            const right = evaluate(expression.right, frame);
            if (logicalAssignment)
              assign(expression.left, right, frame, expression);
            return right;
          },
          () => left,
          takeRight,
        );
      }
      if (operator === ts.SyntaxKind.CommaToken) {
        evaluate(expression.left, frame);
        return evaluate(expression.right, frame);
      }
      const left = evaluate(expression.left, frame);
      const right = evaluate(expression.right, frame);
      if (operator === ts.SyntaxKind.PlusToken)
        return union(flat(left), flat(right));
      return EMPTY; // comparisons and arithmetic produce no declared data
    }
    if (ts.isConditionalExpression(expression)) {
      evaluate(expression.condition, frame);
      return alternatives(
        frame,
        () => evaluate(expression.whenTrue, frame),
        () => evaluate(expression.whenFalse, frame),
        knownCondition(expression.condition),
      );
    }
    if (ts.isObjectLiteralExpression(expression)) {
      let props = new Map<string, Value>();
      let top = EMPTY;
      for (const property of expression.properties) {
        if (ts.isPropertyAssignment(property)) {
          const value = evaluate(property.initializer, frame);
          let key = memberName(property);
          if (key === null && ts.isComputedPropertyName(property.name))
            key = literalText(checker, property.name.expression);
          if (key === null && ts.isNumericLiteral(property.name))
            key = property.name.text;
          setProp(props, key, value);
        } else if (ts.isShorthandPropertyAssignment(property)) {
          const symbol = checker.getShorthandAssignmentValueSymbol(property);
          const local =
            symbol === undefined ? undefined : frame.env.get(symbol);
          setProp(
            props,
            property.name.text,
            local ?? lookup(property.name, frame),
          );
        } else if (ts.isSpreadAssignment(property)) {
          const spread = evaluate(property.expression, frame);
          if (spread.props !== null)
            props = new Map([...props, ...spread.props]);
          top = union(top, topLevel(spread));
          if (spread.elements !== null) top = union(top, flat(spread.elements));
        } else {
          // Accessors/toJSON/method-based values cannot be read as ordinary
          // data properties without executing source code.
          const value = opaqueValue(
            opaqueAt(
              frame,
              "property_not_tracked",
              property,
              "object accessor or method",
            ),
          );
          setProp(props, memberName(property), value);
        }
      }
      return allocate(
        { facts: top.facts, opaque: top.opaque, props, elements: null },
        frame,
      );
    }
    if (ts.isArrayLiteralExpression(expression)) {
      let elements = EMPTY;
      for (const element of expression.elements) {
        if (ts.isOmittedExpression(element)) continue;
        elements = union(
          elements,
          ts.isSpreadElement(element)
            ? getElement(evaluate(element.expression, frame))
            : evaluate(element, frame),
        );
      }
      return allocate({ facts: [], opaque: [], props: null, elements }, frame);
    }
    if (ts.isPropertyAccessExpression(expression)) {
      const target = expression.expression;
      if (
        target.kind === ts.SyntaxKind.ThisKeyword ||
        target.kind === ts.SyntaxKind.SuperKeyword
      ) {
        return opaqueValue(
          opaqueAt(
            frame,
            "property_not_tracked",
            expression,
            "instance property",
          ),
        );
      }
      if (
        ts.isPropertyAccessExpression(target) &&
        target.name.text === "env" &&
        ((ts.isIdentifier(target.expression) &&
          target.expression.text === "process") ||
          ts.isMetaProperty(target.expression))
      ) {
        return EMPTY;
      }
      if (ts.isIdentifier(target)) {
        const targetSymbol = checker.getSymbolAtLocation(target);
        const aliased = resolveAlias(checker, targetSymbol);
        if (
          targetSymbol !== undefined &&
          aliased !== undefined &&
          (aliased.flags & ts.SymbolFlags.ValueModule) !== 0
        ) {
          const member = resolveAlias(
            checker,
            checker.getSymbolAtLocation(expression.name),
          );
          const declaration = member?.valueDeclaration;
          if (
            declaration !== undefined &&
            ts.isVariableDeclaration(declaration) &&
            analysableNode(declaration) &&
            ts.isVariableDeclarationList(declaration.parent) &&
            (declaration.parent.flags & ts.NodeFlags.Const) !== 0
          ) {
            return evaluateModuleConstant(
              declaration,
              frame,
              expression.parent,
            );
          }
          return EMPTY;
        }
      }
      return getProperty(evaluate(target, frame), expression.name.text);
    }
    if (ts.isElementAccessExpression(expression)) {
      const target = evaluate(expression.expression, frame);
      const argument = expression.argumentExpression;
      evaluate(argument, frame);
      const key = literalText(checker, argument);
      if (key !== null) return getProperty(target, key);
      if (ts.isNumericLiteral(argument)) return getElement(target);
      const argumentType = checker.getTypeAtLocation(argument);
      if (
        (argumentType.flags & ts.TypeFlags.NumberLike) !== 0 &&
        target.props === null
      ) {
        return getElement(target);
      }
      if (isEmpty(target)) return EMPTY;
      return opaqueValue(
        opaqueAt(frame, "dynamic_property_access", expression, null),
        target,
      );
    }
    if (ts.isCallExpression(expression)) return evaluateCall(expression, frame);
    if (ts.isNewExpression(expression)) {
      let value = EMPTY;
      for (const argument of expression.arguments ?? [])
        value = union(value, flat(evaluate(argument, frame)));
      const constructed = calledDeclaration(checker, expression);
      if (constructed !== undefined) {
        const constructedFile = constructed.getSourceFile();
        const boundary = boundaryFor(recognizers, {
          packageName: packageOfFile(constructedFile.fileName),
          ambientModule: ambientModuleOf(constructed),
          global: globalNameOf(program, constructed),
        });
        if (boundary !== null) {
          const reason: UnknownReason =
            boundary.boundary === "network"
              ? "unmodelled_network_hop"
              : "unmodelled_handoff";
          if (!isEmpty(value))
            record(frame, reason, expression, value, boundary.boundary);
          return opaqueValue(
            opaqueAt(frame, reason, expression, boundary.boundary),
          );
        }
      }
      if (
        ts.isIdentifier(expression.expression) &&
        (expression.expression.text === "Function" ||
          expression.expression.text === "Proxy")
      ) {
        const what = `${expression.expression.text} constructor`;
        const symbol = checker.getSymbolAtLocation(expression.expression);
        const declaration = symbol?.declarations?.[0];
        if (
          declaration !== undefined &&
          program.isSourceFileDefaultLibrary(declaration.getSourceFile())
        ) {
          record(
            frame,
            "reflection_or_code_generation",
            expression,
            value,
            what,
          );
          return opaqueValue(
            opaqueAt(frame, "reflection_or_code_generation", expression, what),
            value,
          );
        }
      }
      return value;
    }
    if (
      ts.isArrowFunction(expression) ||
      ts.isFunctionExpression(expression) ||
      ts.isClassExpression(expression)
    ) {
      return EMPTY;
    }
    if (
      ts.isPrefixUnaryExpression(expression) ||
      ts.isPostfixUnaryExpression(expression)
    ) {
      evaluate(expression.operand, frame);
      return EMPTY;
    }
    if (
      ts.isTypeOfExpression(expression) ||
      ts.isVoidExpression(expression) ||
      ts.isDeleteExpression(expression)
    ) {
      evaluate(expression.expression, frame);
      return EMPTY;
    }
    if (
      expression.kind === ts.SyntaxKind.ThisKeyword ||
      expression.kind === ts.SyntaxKind.SuperKeyword
    ) {
      return EMPTY;
    }
    if (ts.isSpreadElement(expression))
      return flat(evaluate(expression.expression, frame));
    if (ts.isMetaProperty(expression) || ts.isOmittedExpression(expression))
      return EMPTY;

    // Unmodelled syntax: carry whatever its children carry, and say so.
    let carried = EMPTY;
    ts.forEachChild(expression, (child) => {
      if (ts.isExpression(child))
        carried = union(carried, flat(evaluate(child, frame)));
    });
    if (isEmpty(carried)) return EMPTY;
    const kind = ts.SyntaxKind[expression.kind] ?? "unknown";
    record(frame, "unsupported_construct", expression, carried, kind);
    return opaqueValue(
      opaqueAt(frame, "unsupported_construct", expression, kind),
      carried,
    );
  };

  // ----------------------------------------------------------------- calls

  const bindParameters = (
    fn: FunctionNode,
    frame: Frame,
    argumentValues: readonly Value[] | null,
  ) => {
    const parameterSources = declarations.parameterSources.get(fn) ?? [];
    fn.parameters.forEach((parameter, index) => {
      let value: Value;
      if (argumentValues === null) {
        let reason: UnknownReason = "parameter_value_from_caller";
        let detail: string | null = null;
        const parent = fn.parent;
        if (
          (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
          parent !== undefined &&
          (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
          ((parent.arguments ?? []) as readonly ts.Node[]).includes(fn)
        ) {
          const target = calledDeclaration(checker, parent);
          const file = target?.getSourceFile();
          const boundary =
            target === undefined || file === undefined
              ? null
              : boundaryFor(recognizers, {
                  packageName: packageOfFile(file.fileName),
                  ambientModule: ambientModuleOf(target),
                  global: globalNameOf(program, target),
                });
          reason =
            boundary === null
              ? "callback_not_followed"
              : boundary.boundary === "network"
                ? "unmodelled_network_hop"
                : "unmodelled_handoff";
          detail = boundary === null ? null : boundary.boundary;
        }
        value = opaqueValue(opaqueAt(frame, reason, parameter, detail));
      } else if (parameter.dotDotDotToken !== undefined) {
        let rest = EMPTY;
        for (const argument of argumentValues.slice(index))
          rest = union(rest, argument);
        value = { facts: [], opaque: [], props: null, elements: rest };
      } else {
        value = argumentValues[index] ?? EMPTY;
        if (
          argumentValues[index] === undefined &&
          parameter.initializer !== undefined
        ) {
          value = evaluate(parameter.initializer, frame);
        }
      }
      for (const source of parameterSources) {
        if (source.parameter === index) {
          const at = span(parameter, frame);
          value = union(value, {
            facts: [
              {
                classification: source.data_classification,
                state: "raw",
                derived_from: null,
                declaration: source.id,
                conditional: false,
                trace: [
                  {
                    kind: "parameter_source",
                    span: at,
                    symbol: enclosingSymbol(parameter),
                    declaration: source.id,
                  },
                ],
              },
            ],
            opaque: [],
            props: null,
            elements: null,
          });
        }
      }
      bindName(parameter.name, value, frame, parameter.name);
    });
  };

  const runBody = (fn: FunctionNode, frame: Frame) => {
    const body = fn.body;
    if (body === undefined) return;
    if (ts.isBlock(body)) execBlock(body.statements, frame);
    else frame.returns = union(frame.returns, evaluate(body, frame));
  };

  const implementationOf = (
    declaration: ts.Declaration,
  ): FunctionNode | null => {
    if (isFunctionNode(declaration) && declaration.body !== undefined)
      return declaration;
    if (
      ts.isFunctionDeclaration(declaration) ||
      ts.isMethodDeclaration(declaration) ||
      ts.isConstructorDeclaration(declaration)
    ) {
      const symbol =
        declaration.name === undefined
          ? undefined
          : checker.getSymbolAtLocation(declaration.name);
      const implementation = symbol?.declarations?.find(
        (entry) => isFunctionNode(entry) && entry.body !== undefined,
      );
      return implementation === undefined
        ? null
        : (implementation as FunctionNode);
    }
    return null;
  };

  const evaluateCall = (call: ts.CallExpression, frame: Frame): Value => {
    const argumentValues = call.arguments.map((argument) =>
      ts.isSpreadElement(argument)
        ? flat(evaluate(argument.expression, frame))
        : evaluate(argument, frame),
    );
    let argumentsValue = EMPTY;
    for (const value of argumentValues)
      argumentsValue = union(argumentsValue, flat(currentValue(value, frame)));
    const functionArguments = call.arguments.some(
      (argument) =>
        ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
    );

    if (call.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = call.arguments[0];
      if (specifier !== undefined && ts.isStringLiteralLike(specifier))
        return EMPTY;
      // A dynamically chosen data file (locales, fixtures) is not code.
      if (dataImportSpecifier(specifier))
        return opaqueValue(
          opaqueAt(frame, "external_call_not_modelled", call, "data import"),
        );
      const entry = opaqueAt(frame, "runtime_selected_import", call, null);
      if (!isEmpty(argumentsValue))
        record(frame, "runtime_selected_import", call, argumentsValue, null);
      return opaqueValue(entry);
    }

    const declaration = calledDeclaration(checker, call);
    const receiver =
      ts.isPropertyAccessExpression(call.expression) ||
      ts.isElementAccessExpression(call.expression)
        ? call.expression.expression
        : null;

    // Provider sink: record what reaches it, in this context.
    const sink = sinkCalls.get(call);
    if (sink !== undefined) {
      const transmitted = requestInputs(sink, argumentValues, frame);
      if (!frame.silent) {
        const contexts =
          sinkContexts.get(call) ?? new Map<string, SinkContext>();
        const kind = frame.context.kind;
        const key = `${kind}|${spanKey(frame.context.root.span)}|${frame.context.call_site === null ? "" : spanKey(frame.context.call_site)}`;
        const at = span(call, frame);
        const reaching = flatten(
          withStep(frame.conditional ? conditional(transmitted) : transmitted, {
            kind: "sink",
            span: at,
            symbol: enclosingSymbol(call),
            declaration: null,
          }),
        );
        const existing = contexts.get(key);
        contexts.set(key, {
          key,
          kind,
          root: frame.context.root,
          call_site: frame.context.call_site,
          value:
            existing === undefined
              ? reaching
              : {
                  facts: mergeFacts(existing.value.facts, reaching.facts),
                  opaque: mergeOpaque(existing.value.opaque, reaching.opaque),
                },
          superseded: false,
        });
        sinkContexts.set(call, contexts);
      }
      return EMPTY;
    }

    if (declaration === undefined) {
      if (
        ts.isIdentifier(call.expression) &&
        call.expression.text === "require" &&
        checker.getSymbolAtLocation(call.expression) === undefined
      ) {
        const specifier = call.arguments[0];
        if (specifier !== undefined && ts.isStringLiteralLike(specifier))
          return EMPTY;
        if (!isEmpty(argumentsValue))
          record(frame, "runtime_selected_import", call, argumentsValue, null);
        return opaqueValue(
          opaqueAt(frame, "runtime_selected_import", call, null),
        );
      }
      const receiverValue =
        receiver === null ? EMPTY : flat(evaluate(receiver, frame));
      const carried = union(argumentsValue, receiverValue);
      const reason: UnknownReason = isAnyType(
        checker.getTypeAtLocation(call.expression),
      )
        ? "unresolved_any"
        : "dynamic_dispatch";
      if (!isEmpty(carried)) record(frame, reason, call, carried, null);
      for (const argument of argumentValues)
        invalidateReferences(
          argument,
          frame,
          call,
          reason,
          "unresolved call may mutate this object",
        );
      if (receiver !== null)
        invalidateReferences(
          evaluate(receiver, frame),
          frame,
          call,
          reason,
          "unresolved receiver mutation",
        );
      return opaqueValue(opaqueAt(frame, reason, call, null), carried);
    }

    const target = implementationOf(declaration);
    // Declared sources and sanitizers match by the resolved function itself.
    if (target !== null) {
      const source = declarations.sources.get(target);
      if (source !== undefined) {
        const at = span(call, frame);
        return {
          facts: [
            {
              classification: source.data_classification,
              state: "raw",
              derived_from: null,
              declaration: source.id,
              conditional: false,
              trace: [
                {
                  kind: "source",
                  span: at,
                  symbol: enclosingSymbol(call),
                  declaration: source.id,
                },
              ],
            },
          ],
          opaque: [],
          props: null,
          elements: null,
        };
      }
      const sanitizer = declarations.sanitizers.get(target);
      if (sanitizer !== undefined) {
        const at = span(call, frame);
        const step: TraceStep = {
          kind: "sanitizer",
          span: at,
          symbol: enclosingSymbol(call),
          declaration: sanitizer.id,
        };
        let other = EMPTY;
        argumentValues.forEach((value, index) => {
          if (index !== sanitizer.argument) other = union(other, flat(value));
        });
        const input = flatten(argumentValues[sanitizer.argument] ?? EMPTY);
        const facts = input.facts.map((fact) =>
          fact.state === "raw" && sanitizer.clears.includes(fact.classification)
            ? appendStep(
                {
                  ...fact,
                  classification: sanitizer.produces ?? fact.classification,
                  state: "sanitized" as const,
                  derived_from: fact.classification,
                  declaration: sanitizer.id,
                },
                step,
              )
            : appendStep(fact, step),
        );
        return union(
          {
            facts,
            opaque: input.opaque.map((entry) => appendStep(entry, step)),
            props: null,
            elements: null,
          },
          other,
        );
      }
    }

    const file = declaration.getSourceFile();
    const packageName = packageOfFile(file.fileName);
    // Global declarations from runtime type packages (`console`, `Buffer`,
    // `URL` in @types/node) behave like the default library.
    const isLibrary =
      program.isSourceFileDefaultLibrary(file) ||
      (GLOBAL_TYPE_PACKAGES.includes(packageName ?? "") &&
        isGlobalDeclaration(program, declaration));
    const boundary = boundaryFor(recognizers, {
      packageName,
      ambientModule: ambientModuleOf(declaration),
      global: globalNameOf(program, declaration),
    });
    const receiverValue =
      receiver === null ? EMPTY : flat(evaluate(receiver, frame));
    const carried = union(argumentsValue, receiverValue);

    if (boundary !== null && sameOriginRequest(call)) {
      // A relative URL such as "/api/..." reaches this application's own
      // server, not a third party. Its response is still not tracked.
      return opaqueValue(
        opaqueAt(
          frame,
          "external_call_not_modelled",
          call,
          "same-origin request",
        ),
      );
    }
    if (boundary !== null) {
      const reason: UnknownReason =
        boundary.boundary === "network"
          ? "unmodelled_network_hop"
          : "unmodelled_handoff";
      if (!isEmpty(carried))
        record(frame, reason, call, carried, boundary.boundary);
      return opaqueValue(opaqueAt(frame, reason, call, boundary.boundary));
    }
    if (isLibrary) {
      if (ts.isIdentifier(call.expression) && call.expression.text === "eval") {
        record(frame, "reflection_or_code_generation", call, carried, "eval");
        return opaqueValue(
          opaqueAt(frame, "reflection_or_code_generation", call, "eval"),
          carried,
        );
      }
      const owner =
        declaration.parent !== undefined &&
        ts.isInterfaceDeclaration(declaration.parent)
          ? declaration.parent.name.text
          : null;
      if (
        receiver !== null &&
        owner === "Array" &&
        ["push", "unshift"].includes(memberName(declaration) ?? "")
      ) {
        const array = evaluate(receiver, frame);
        for (const id of array.refs ?? []) {
          const state = frame.heap.get(id) ?? EMPTY;
          frame.heap.set(id, {
            ...state,
            elements: union(state.elements ?? EMPTY, argumentsValue),
          });
        }
        return EMPTY; // length, not the inserted elements
      }
      if (!nonMutating(owner, memberName(declaration))) {
        for (const argument of argumentValues)
          invalidateReferences(
            argument,
            frame,
            call,
            "external_call_not_modelled",
            "library mutation not modelled",
          );
        if (receiver !== null)
          invalidateReferences(
            evaluate(receiver, frame),
            frame,
            call,
            "external_call_not_modelled",
            "library mutation not modelled",
          );
      }
      if (owner === "Reflect" || owner === "ProxyConstructor") {
        record(frame, "reflection_or_code_generation", call, carried, owner);
        return opaqueValue(
          opaqueAt(frame, "reflection_or_code_generation", call, owner),
          carried,
        );
      }
      if (functionArguments && !isEmpty(carried))
        record(frame, "callback_not_followed", call, carried, null);
      return carried;
    }
    if (isUnsupportedSdk(recognizers, packageName)) {
      if (!isEmpty(carried))
        record(frame, "unsupported_provider_sdk", call, carried, packageName);
      return opaqueValue(
        opaqueAt(frame, "unsupported_provider_sdk", call, packageName),
      );
    }
    if (
      packageName !== null ||
      !analysableNode(declaration) ||
      file.isDeclarationFile
    ) {
      for (const argument of argumentValues)
        invalidateReferences(
          argument,
          frame,
          call,
          "external_call_not_modelled",
          "external call may mutate this object",
        );
      if (isEmpty(carried)) return EMPTY;
      record(frame, "external_call_not_modelled", call, carried, packageName);
      return opaqueValue(
        opaqueAt(frame, "external_call_not_modelled", call, packageName),
        carried,
      );
    }
    if (target === null) {
      for (const argument of argumentValues)
        invalidateReferences(
          argument,
          frame,
          call,
          "dynamic_dispatch",
          "unresolved function may mutate this object",
        );
      if (!isEmpty(carried))
        record(frame, "dynamic_dispatch", call, carried, null);
      return opaqueValue(
        opaqueAt(frame, "dynamic_dispatch", call, null),
        carried,
      );
    }
    if (frame.stack.includes(target) || target === frame.fn) {
      for (const argument of argumentValues)
        invalidateReferences(
          argument,
          frame,
          call,
          "recursive_call",
          "recursive mutation not followed",
        );
      if (!isEmpty(carried))
        record(frame, "recursive_call", call, carried, null);
      return opaqueValue(
        opaqueAt(frame, "recursive_call", call, null),
        carried,
      );
    }
    if (frame.depth >= FLOW_MODEL.call_depth) {
      for (const argument of argumentValues)
        invalidateReferences(
          argument,
          frame,
          call,
          "call_depth_exceeded",
          "mutation beyond call depth",
        );
      record(frame, "call_depth_exceeded", call, carried, null);
      return opaqueValue(
        opaqueAt(frame, "call_depth_exceeded", call, null),
        carried,
      );
    }

    // One level of direct-call propagation.
    if (!frame.silent) inlinedCalls.add(call);
    const at = span(call, frame);
    const calleeFile = target.getSourceFile();
    const inner: Frame = {
      depth: frame.depth + 1,
      fn: target,
      file: calleeFile,
      path: pathOf(calleeFile),
      context: {
        kind: frame.silent ? frame.context.kind : "direct_call",
        root: frame.context.root,
        call_site: at,
      },
      stack: [...frame.stack, ...(frame.fn === null ? [] : [frame.fn])],
      silent: frame.silent,
      env: new Map(),
      heap: frame.heap,
      conditional: frame.conditional,
      returns: EMPTY,
    };
    bindParameters(
      target,
      inner,
      argumentValues.map((value) =>
        withStep(value, {
          kind: "argument",
          span: at,
          symbol: enclosingSymbol(call),
          declaration: null,
        }),
      ),
    );
    runBody(target, inner);
    frame.heap = inner.heap;
    return withStep(inner.returns, {
      kind: "return",
      span: at,
      symbol: enclosingSymbol(call),
      declaration: null,
    });
  };

  // ----------------------------------------------------------------- roots

  const files = program
    .getSourceFiles()
    .filter((file) => setup.analysable.has(file.fileName))
    .sort((left, right) => compareStrings(pathOf(left), pathOf(right)));
  const functions: FunctionNode[] = [];

  for (const file of files) {
    const path = pathOf(file);
    const moduleRoot: ContextRoot = {
      span: spanOf(file, file, path),
      symbol: null,
    };
    const moduleFrame: Frame = {
      depth: 0,
      fn: null,
      file,
      path,
      context: { kind: "module", root: moduleRoot, call_site: null },
      stack: [],
      silent: false,
      env: new Map(),
      heap: new Map(),
      conditional: false,
      returns: EMPTY,
    };
    try {
      execBlock(file.statements, moduleFrame);
    } catch (error) {
      if (!(error instanceof BudgetExceeded)) throw error;
      budgetExceeded.push(moduleRoot);
      evaluations = 0;
    }
    const collect = (node: ts.Node) => {
      if (isFunctionNode(node) && node.body !== undefined) functions.push(node);
      ts.forEachChild(node, collect);
    };
    collect(file);
  }

  for (const fn of functions) {
    const file = fn.getSourceFile();
    const path = pathOf(file);
    const root: ContextRoot = {
      span: spanOf(fn, file, path),
      symbol: enclosingSymbol(fn),
    };
    const frame: Frame = {
      depth: 0,
      fn,
      file,
      path,
      context: { kind: "intraprocedural", root, call_site: null },
      stack: [],
      silent: false,
      env: new Map(),
      heap: new Map(),
      conditional: false,
      returns: EMPTY,
    };
    evaluations = 0;
    try {
      bindParameters(fn, frame, null);
      runBody(fn, frame);
    } catch (error) {
      if (!(error instanceof BudgetExceeded)) throw error;
      budgetExceeded.push(root);
    }
  }

  // An intraprocedural context is superseded when every in-repository
  // reference to its function is a direct call that was followed.
  const references = new Map<FunctionNode, ts.Node[]>();
  for (const file of files) {
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        const parent = node.parent;
        const isDeclarationName =
          parent !== undefined &&
          (ts.isFunctionDeclaration(parent) ||
            ts.isMethodDeclaration(parent) ||
            ts.isVariableDeclaration(parent) ||
            ts.isPropertyAssignment(parent) ||
            ts.isPropertyDeclaration(parent)) &&
          parent.name === node;
        const isModuleSpecifier =
          parent !== undefined &&
          (ts.isImportSpecifier(parent) ||
            ts.isExportSpecifier(parent) ||
            ts.isImportClause(parent) ||
            ts.isNamespaceImport(parent) ||
            ts.isImportEqualsDeclaration(parent));
        if (!isDeclarationName && !isModuleSpecifier) {
          const fn = functionOfSymbol(
            checker,
            checker.getSymbolAtLocation(node),
          );
          if (fn !== null) {
            const list = references.get(fn) ?? [];
            list.push(node);
            references.set(fn, list);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  const followedOnly = (fn: FunctionNode): boolean => {
    const list = references.get(fn) ?? [];
    if (list.length === 0) return false;
    return list.every((reference) => {
      let callee: ts.Node = reference;
      if (
        reference.parent !== undefined &&
        ts.isPropertyAccessExpression(reference.parent) &&
        reference.parent.name === reference
      ) {
        callee = reference.parent;
      }
      const call = callee.parent;
      return (
        call !== undefined &&
        ts.isCallExpression(call) &&
        call.expression === callee &&
        inlinedCalls.has(call)
      );
    });
  };
  const functionByRootSpan = new Map(
    functions.map((fn) => [
      spanKey(spanOf(fn, fn.getSourceFile(), pathOf(fn.getSourceFile()))),
      fn,
    ]),
  );

  const sinks = new Map<ts.CallExpression, SinkContext[]>();
  for (const [call, contexts] of sinkContexts) {
    const list = [...contexts.values()].map((context) => {
      if (context.kind !== "intraprocedural") return context;
      const fn = functionByRootSpan.get(spanKey(context.root.span));
      return fn !== undefined && followedOnly(fn)
        ? { ...context, superseded: true }
        : context;
    });
    sinks.set(
      call,
      list.sort(
        (left, right) =>
          compareStrings(left.kind, right.kind) ||
          compareSpans(left.root.span, right.root.span) ||
          (left.call_site === null
            ? -1
            : right.call_site === null
              ? 1
              : compareSpans(left.call_site, right.call_site)),
      ),
    );
  }

  return {
    sinks,
    events: [...events.values()].sort(
      (left, right) =>
        compareSpans(left.span, right.span) ||
        compareStrings(left.reason, right.reason) ||
        compareSpans(left.context.root.span, right.context.root.span),
    ),
    budgetExceeded,
  };
}
