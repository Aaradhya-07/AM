import { describe, expect, it } from "vitest";

import { collapseUnchanged, diffLines } from "../src/review/line-diff.js";

/** Compact form: "=" context, "+" added, "-" removed. */
function shape(base: string, head: string) {
  return diffLines(base, head).lines.map(
    (line) =>
      `${line.kind === "context" ? "=" : line.kind === "added" ? "+" : "-"}${line.text}`,
  );
}

/** Applying the removals and additions must reproduce the head text. */
function applied(base: string, head: string) {
  return diffLines(base, head)
    .lines.filter((line) => line.kind !== "removed")
    .map((line) => line.text)
    .join("\n");
}

describe("diffLines", () => {
  it("reports identical texts as context only", () => {
    const diff = diffLines("a\nb\nc\n", "a\nb\nc\n");
    expect(diff).toMatchObject({ added: 0, removed: 0, truncated: false });
    expect(diff.lines.map((line) => line.kind)).toEqual([
      "context",
      "context",
      "context",
    ]);
    expect(diff.lines[1]).toMatchObject({ base_line: 2, head_line: 2 });
  });

  it("reports an inserted line", () => {
    expect(shape("a\nc\n", "a\nb\nc\n")).toEqual(["=a", "+b", "=c"]);
  });

  it("reports a deleted line", () => {
    expect(shape("a\nb\nc\n", "a\nc\n")).toEqual(["=a", "-b", "=c"]);
  });

  it("reports a replaced line with both sides", () => {
    expect(shape("a\nb\n", "a\nB\n")).toEqual(["=a", "-b", "+B"]);
  });

  it("numbers lines on the side they belong to", () => {
    const diff = diffLines("keep\nold\n", "keep\nnew\ntail\n");
    for (const line of diff.lines) {
      if (line.kind === "added") expect(line.base_line).toBeNull();
      if (line.kind === "removed") expect(line.head_line).toBeNull();
    }
    expect(diff).toMatchObject({ added: 2, removed: 1 });
  });

  it.each([
    ["", "a\nb\n"],
    ["a\nb\n", ""],
    ["a\nb\nc\nd\ne\n", "e\nd\nc\nb\na\n"],
    ["x\n".repeat(50), "x\n".repeat(20) + "y\n" + "x\n".repeat(29)],
  ])("reconstructs the head text (%#)", (base, head) => {
    expect(applied(base, head)).toBe(
      head.endsWith("\n") ? head.slice(0, -1) : head,
    );
  });

  it("gives up as a whole-file replacement beyond its limits", () => {
    const base = "a\n".repeat(30);
    const head = "b\n".repeat(30);
    const diff = diffLines(base, head, { maxLines: 10 });
    expect(diff).toMatchObject({ truncated: true, added: 30, removed: 30 });

    const tooDifferent = diffLines(base, head, { maxEdits: 4 });
    expect(tooDifferent.truncated).toBe(true);
  });
});

describe("collapseUnchanged", () => {
  it("hides runs of unchanged lines and counts them", () => {
    const base = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const head = base.replace("line 10", "line ten");
    const collapsed = collapseUnchanged(diffLines(base, head), 2);

    // 19 context entries plus one removed and one added line; a window of two
    // around each change keeps six of them.
    const gaps = collapsed.filter((entry) => entry.kind === "gap");
    expect(gaps).toHaveLength(2);
    expect(
      gaps.reduce(
        (total, gap) => total + ("hidden" in gap ? gap.hidden : 0),
        0,
      ),
    ).toBe(15);
    expect(collapsed.filter((entry) => entry.kind !== "gap")).toHaveLength(6);
  });

  it("keeps everything when every line changed", () => {
    const collapsed = collapseUnchanged(diffLines("a\n", "b\n"), 2);
    expect(collapsed.some((entry) => entry.kind === "gap")).toBe(false);
  });
});
