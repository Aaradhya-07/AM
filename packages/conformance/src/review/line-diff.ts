export interface DiffLine {
  readonly kind: "context" | "added" | "removed";
  /** 1-based line number in the base text, or null for an added line. */
  readonly base_line: number | null;
  /** 1-based line number in the head text, or null for a removed line. */
  readonly head_line: number | null;
  readonly text: string;
}

export interface LineDiff {
  readonly lines: readonly DiffLine[];
  readonly added: number;
  readonly removed: number;
  /**
   * The texts were too large or too different to diff within the limits, so
   * the result is the whole base removed and the whole head added.
   */
  readonly truncated: boolean;
}

export interface LineDiffLimits {
  /** Largest number of lines in either text. */
  readonly maxLines?: number;
  /** Largest edit distance to search before giving up. */
  readonly maxEdits?: number;
}

const DEFAULT_LIMITS: Required<LineDiffLimits> = {
  maxLines: 4000,
  maxEdits: 1200,
};

function split(text: string): string[] {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body === "" ? [] : body.split("\n");
}

function wholeFile(
  base: string[],
  head: string[],
  truncated: boolean,
): LineDiff {
  const lines: DiffLine[] = [
    ...base.map((text, index): DiffLine => ({
      kind: "removed",
      base_line: index + 1,
      head_line: null,
      text,
    })),
    ...head.map((text, index): DiffLine => ({
      kind: "added",
      base_line: null,
      head_line: index + 1,
      text,
    })),
  ];
  return { lines, added: head.length, removed: base.length, truncated };
}

/**
 * A line diff of two texts, by Myers' shortest edit script. Pure and
 * dependency-free so it runs in the browser as well as in Node. Texts beyond
 * the limits return as a whole-file replacement marked `truncated`, which
 * keeps a very large or wholly rewritten file from blocking the page.
 */
export function diffLines(
  baseText: string,
  headText: string,
  limits: LineDiffLimits = {},
): LineDiff {
  const { maxLines, maxEdits } = { ...DEFAULT_LIMITS, ...limits };
  const base = split(baseText);
  const head = split(headText);

  if (base.length > maxLines || head.length > maxLines) {
    return wholeFile(base, head, true);
  }

  const n = base.length;
  const m = head.length;
  const max = Math.min(n + m, maxEdits);
  const offset = n + m;
  const size = 2 * (n + m) + 1;
  const v = new Int32Array(size);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!)
          ? v[k + 1 + offset]!
          : v[k - 1 + offset]! + 1;
      let y = x - k;
      while (x < n && y < m && base[x] === head[y]) {
        x += 1;
        y += 1;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) {
        return backtrack(base, head, trace, d, offset);
      }
    }
  }

  // More differences than the search allows.
  return wholeFile(base, head, true);
}

function backtrack(
  base: readonly string[],
  head: readonly string[],
  trace: readonly Int32Array[],
  edits: number,
  offset: number,
): LineDiff {
  const lines: DiffLine[] = [];
  let x = base.length;
  let y = head.length;
  let added = 0;
  let removed = 0;

  const emit = (line: DiffLine) => lines.push(line);

  for (let d = edits; d > 0; d--) {
    const v = trace[d]!;
    const k = x - y;
    const previousK =
      k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!)
        ? k + 1
        : k - 1;
    const previousX = v[previousK + offset]!;
    const previousY = previousX - previousK;

    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      emit({
        kind: "context",
        base_line: x + 1,
        head_line: y + 1,
        text: base[x]!,
      });
    }
    if (x === previousX) {
      y -= 1;
      added += 1;
      emit({
        kind: "added",
        base_line: null,
        head_line: y + 1,
        text: head[y]!,
      });
    } else {
      x -= 1;
      removed += 1;
      emit({
        kind: "removed",
        base_line: x + 1,
        head_line: null,
        text: base[x]!,
      });
    }
  }

  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    emit({
      kind: "context",
      base_line: x + 1,
      head_line: y + 1,
      text: base[x]!,
    });
  }

  lines.reverse();
  return { lines, added, removed, truncated: false };
}

/** Keep only changed lines and `context` lines around them. */
export function collapseUnchanged(
  diff: LineDiff,
  context = 3,
): readonly (DiffLine | { readonly kind: "gap"; readonly hidden: number })[] {
  const keep = new Set<number>();
  diff.lines.forEach((line, index) => {
    if (line.kind === "context") return;
    for (let i = index - context; i <= index + context; i++) {
      if (i >= 0 && i < diff.lines.length) keep.add(i);
    }
  });

  const out: (DiffLine | { kind: "gap"; hidden: number })[] = [];
  let hidden = 0;
  diff.lines.forEach((line, index) => {
    if (keep.has(index)) {
      if (hidden > 0) {
        out.push({ kind: "gap", hidden });
        hidden = 0;
      }
      out.push(line);
    } else {
      hidden += 1;
    }
  });
  if (hidden > 0) out.push({ kind: "gap", hidden });
  return out;
}
