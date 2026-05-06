// ESLint core (eslint + typescript-eslint + caps) — no SonarJS.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { ignorePatterns } from "./shared.mjs";

export default [
  { ignores: ignorePatterns },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        globalThis: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-escape": "off",
      "no-useless-assignment": "off",
      complexity: ["error", { max: 35 }],
      "max-lines-per-function": [
        "error",
        { max: 320, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ["tests/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
      "max-lines-per-function": "off",
      complexity: "off",
    },
  },
  // NUL sentinels in regex replace — intentional (see caveman mask/unmask).
  {
    files: ["src/gates/caveman.ts"],
    rules: {
      "no-control-regex": "off",
    },
  },
];
