#!/usr/bin/env node
import { run } from "./cli.js";
import { processIo } from "./io.js";

const io = processIo();
run(process.argv.slice(2), io)
  .then((code) => {
    io.close();
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    io.close();
    process.stderr.write(
      `error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
