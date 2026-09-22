# Scanner test fixtures

- `synthetic-sdks/` holds **synthetic** type declarations for `openai`,
  `ollama` and `bullmq`. They are not those packages: they mirror only the
  declaration shapes the recognizers match, have no implementation, and are
  copied into a temporary `node_modules/` when a test materializes a
  repository. Nothing is installed from a registry.
- `repositories/` holds small TypeScript/JavaScript repositories, one per
  scenario. Tests copy them to a temporary directory before scanning, so the
  files here are never scanned in place and never modified.

These files are inputs whose bytes and positions are asserted; they are
excluded from formatting and linting. Files Git would ignore (for example a
`dist/` or `.gitignore`d `generated/` directory, or `.env`) are created by the
tests at run time instead of being committed.
