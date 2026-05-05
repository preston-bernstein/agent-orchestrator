// Minimal flat config — type-aware checks deferred (parserOptions.project would
// double tsc work). Scope: critical bug-class rules, not style.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "node_modules/**",
      "runs/**",
      "Orchestration PoC/**",
      "coverage/**",
      ".stryker-tmp-*/**",
      "reports/mutation/**",
      "**/*.d.ts",
    ],
  },
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
      // Overzealous on let-init-then-reassign-in-loop patterns we use
      // intentionally for read-after-assignment guarantees.
      "no-useless-assignment": "off",
    },
  },
  {
    files: ["tests/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
];
