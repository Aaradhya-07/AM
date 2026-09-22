import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      // Generated single-file bundles for the published package.
      "**/dist-npm/**",
      "**/.next/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "packages/scanner/test/fixtures/**",
      // Audited upstream checkout; not ANVILMARK source.
      "reference/odysseus/**",
      // Preserved experiment code and the local package cache: not our source.
      "experiments-milestone-3/**",
      "**/.pnpm-store/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        clearTimeout: "readonly",
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
      },
    },
  },
);
