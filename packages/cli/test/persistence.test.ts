import { writeFileSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseProjectContract } from "@anvilmark/project-contract";
import { afterEach, describe, expect, it } from "vitest";

import type { StoreFs } from "../src/store.js";
import { digestText, nodeStoreFs } from "../src/store.js";
import { cleanup, cli, projectText, scriptedIo, tempDir } from "./helpers.js";

afterEach(cleanup);

async function project(): Promise<string> {
  const root = await tempDir();
  expect(
    await cli(
      ["init", "--idea", "Persistence test"],
      scriptedIo({ cwd: root }),
    ),
  ).toBe(0);
  return root;
}

const ADD_USER = ["intent", "add-user", "operator"];

describe("state revisions", () => {
  it("snapshot every commit, chain them, and keep project.yaml equal to the head", async () => {
    const root = await project();
    await cli(ADD_USER, scriptedIo({ cwd: root }));
    await cli(["intent", "add-user", "reviewer"], scriptedIo({ cwd: root }));
    const history = join(root, ".anvilmark", "history");
    expect((await readdir(history)).sort()).toEqual([
      "r000001.committed.json",
      "r000001.json",
      "r000001.yaml",
      "r000002.committed.json",
      "r000002.json",
      "r000002.yaml",
      "r000003.committed.json",
      "r000003.json",
      "r000003.yaml",
    ]);
    const head = JSON.parse(
      await readFile(join(history, "r000003.json"), "utf8"),
    ) as {
      parent: number;
      content_digest: string;
      command: string;
    };
    expect(head.parent).toBe(2);
    expect(head.command).toBe("intent add-user");
    expect(head.content_digest).toBe(digestText(await projectText(root)));
    expect(await readFile(join(history, "r000003.yaml"), "utf8")).toBe(
      await projectText(root),
    );
    // Earlier revisions are untouched.
    expect(await readFile(join(history, "r000001.yaml"), "utf8")).not.toContain(
      "operator",
    );
  });

  it("leaves the previous valid state intact when the final replace fails", async () => {
    const root = await project();
    const before = await projectText(root);
    const failing: StoreFs = {
      writeExclusive: nodeStoreFs.writeExclusive,
      replace: async () => {
        throw new Error("simulated disk failure during rename");
      },
    };
    const io = scriptedIo({ cwd: root });
    expect(await cli(ADD_USER, io, { storeFs: failing })).toBe(1);
    expect(io.err()).toContain("simulated disk failure");
    expect(await projectText(root)).toBe(before);
    expect(parseProjectContract(before, "yaml").ok).toBe(true);

    // The interrupted snapshot is kept but is not part of the chain, and the
    // next commit neither reuses its number nor treats it as a parent.
    expect(await cli(ADD_USER, scriptedIo({ cwd: root }))).toBe(0);
    const history = scriptedIo({ cwd: root });
    await cli(["history"], history);
    expect(history.out()).toContain("r3  ");
    expect(history.out()).not.toContain("r2  ");
    expect(history.out()).toContain(
      "1 snapshot(s) are not part of the committed history",
    );
    expect(history.out()).toMatch(/r2 abandoned: /);
    const r3 = JSON.parse(
      await readFile(
        join(root, ".anvilmark", "history", "r000003.json"),
        "utf8",
      ),
    ) as { parent: number };
    expect(r3.parent).toBe(1);
  });

  it("writes nothing when the snapshot itself cannot be created", async () => {
    const root = await project();
    const before = await readdir(join(root, ".anvilmark", "history"));
    const failing: StoreFs = {
      writeExclusive: async () => {
        throw new Error("simulated full disk");
      },
      replace: nodeStoreFs.replace,
    };
    expect(
      await cli(ADD_USER, scriptedIo({ cwd: root }), { storeFs: failing }),
    ).toBe(1);
    expect(await readdir(join(root, ".anvilmark", "history"))).toEqual(before);
  });

  it("refuses to overwrite a project.yaml that changed while the command ran", async () => {
    const root = await project();
    const file = join(root, ".anvilmark", "project.yaml");
    const changed = `${await projectText(root)}# changed by another writer\n`;
    let calls = 0;
    const io = scriptedIo({
      cwd: root,
      // The edit command reads the project, asks the clock once for its own
      // timestamp, then asks again when it commits: change the file in between.
      clock: () => {
        calls += 1;
        if (calls === 2) {
          writeFileSync(file, changed);
        }
        return new Date(
          Date.parse("2026-09-13T10:00:00Z") + calls * 1000,
        ).toISOString();
      },
    });
    expect(await cli(ADD_USER, io)).toBe(1);
    expect(io.err()).toContain("changed while this command was running");
    expect(await readFile(file, "utf8")).toBe(changed);
  });

  it("refuses a concurrent writer while the lock is held by a live process", async () => {
    const root = await project();
    const lock = join(root, ".anvilmark", ".lock");
    await writeFile(
      lock,
      JSON.stringify({ pid: process.pid, created_at: "now" }),
    );
    const before = await projectText(root);
    const io = scriptedIo({ cwd: root });
    expect(await cli(ADD_USER, io)).toBe(1);
    expect(io.err()).toContain("another anvilmark command is writing");
    expect(await projectText(root)).toBe(before);

    // A lock left by a process that no longer exists is recovered.
    await writeFile(
      lock,
      JSON.stringify({ pid: 2 ** 22 + 12345, created_at: "then" }),
    );
    expect(await cli(ADD_USER, scriptedIo({ cwd: root }))).toBe(0);
  });

  it("reports manual edits and includes them in the next committed state", async () => {
    const root = await project();
    const file = join(root, ".anvilmark", "project.yaml");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        "users: []",
        "users:\n    - hand_edited",
      ),
    );
    const status = scriptedIo({ cwd: root });
    await cli(["status"], status);
    expect(status.out()).toContain("edited outside the CLI");
    const io = scriptedIo({ cwd: root });
    expect(await cli(ADD_USER, io)).toBe(0);
    expect(io.out()).toContain("edited outside the CLI");
    const parsed = parseProjectContract(await projectText(root), "yaml");
    expect(parsed.ok && parsed.value.intent.users).toEqual([
      "hand_edited",
      "operator",
    ]);
  });

  it("refuses to work on an invalid hand edit and leaves the file as it is", async () => {
    const root = await project();
    const file = join(root, ".anvilmark", "project.yaml");
    const broken = (await readFile(file, "utf8")).replace(
      "state: draft",
      "state: finished",
    );
    await writeFile(file, broken);
    const io = scriptedIo({ cwd: root });
    expect(await cli(ADD_USER, io)).toBe(1);
    expect(io.err()).toContain("project.state");
    expect(await readFile(file, "utf8")).toBe(broken);
  });
});
