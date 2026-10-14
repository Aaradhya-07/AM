import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanup, cli, scriptedIo, tempDir } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  return cleanup();
});

describe("anvilmark quality cache", () => {
  it("refreshes live benchmark data, then reads a dated local snapshot", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              rank: 1,
              modelId: "example/model",
              value: 81.2,
              verified: false,
              lower_is_better: false,
            },
          ]),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const root = await tempDir();
    const db = join(root, "quality.sqlite");
    const refresh = scriptedIo({
      cwd: root,
      clock: () => "2026-10-14T00:00:00.000Z",
    });
    expect(
      await cli(
        ["quality", "cache", "refresh", "leaderboard", "cais/hle", "--db", db],
        refresh,
      ),
    ).toBe(0);
    expect(refresh.out()).toContain("Saved 1 leaderboard observation");
    expect(fetcher).toHaveBeenCalledOnce();

    const show = scriptedIo({
      cwd: root,
      clock: () => "2026-10-16T00:00:00.000Z",
    });
    expect(
      await cli(
        [
          "quality",
          "cache",
          "show",
          "leaderboard",
          "cais/hle",
          "--db",
          db,
          "--json",
        ],
        show,
      ),
    ).toBe(0);
    const saved = JSON.parse(show.out()) as {
      freshness: string;
      source_key: string;
      observations: { model_id: string; verified: boolean }[];
    };
    expect(saved.freshness).toBe("stale");
    expect(saved.source_key).toBe("huggingface-benchmark-leaderboard:cais/hle");
    expect(saved.observations).toMatchObject([
      { model_id: "example/model", verified: false },
    ]);
    expect(fetcher).toHaveBeenCalledOnce();

    const history = scriptedIo({ cwd: root });
    expect(
      await cli(
        ["quality", "cache", "history", "leaderboard", "cais/hle", "--db", db],
        history,
      ),
    ).toBe(0);
    expect(history.out()).toContain("Saved history");
    expect(history.out()).toContain("stale");
  });
});
