/**
 * Strict preset: dependency-cruiser `recommended-strict` (no orphans/circular/unresolvable/…)
 * plus TS resolution options for NodeNext / package exports.
 *
 * @type {import("dependency-cruiser").IConfiguration}
 * @see https://github.com/sverweij/dependency-cruiser
 */
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const recommendedStrict = require(
  path.join(__dirname, "node_modules", "dependency-cruiser", "configs", "recommended-strict.cjs"),
);

const forbidden = recommendedStrict.forbidden.filter((rule) => {
  // Native addons (e.g. better-sqlite3) may trip couldNotResolve under enhanced-resolve even when installed.
  // Knip + `tsc --noEmit` still guard imports; revisit when dependency-cruiser resolves native bindings cleanly.
  return rule.name !== "not-to-unresolvable";
});

/** Architectural boundaries — see docs/specs/2026-05-05-clean-code-enforcement/layers.md */
const layerForbidden = [
  {
    name: "no-src-runs-to-src-workflows",
    comment:
      "Run load/state/context stay beneath orchestration; workflows (and cli) compose runs — not the reverse.",
    severity: "error",
    from: { path: "^src/runs" },
    to: { path: "^src/workflows" },
  },
  {
    name: "src-util-leaf-no-sibling-packages",
    comment:
      "src/util is shared leaf-only; importing other src subtrees hides coupling and risks cycles (audit/llm may depend on util, never vice versa).",
    severity: "error",
    from: { path: "^src/util" },
    to: { path: "^src/", pathNot: "^src/util/" },
  },
  {
    name: "no-src-gates-to-src-workflows",
    comment:
      "Gates run tools and pure checks; orchestration graphs live in workflows/cli so gate modules stay reusable in tests.",
    severity: "error",
    from: { path: "^src/gates" },
    to: { path: "^src/workflows" },
  },
];

export default {
  forbidden: [...forbidden, ...layerForbidden],
  options: {
    ...recommendedStrict.options,
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports", "main"],
      conditionNames: ["import", "module", "require", "node", "default"],
    },
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/[^/]+",
      },
    },
  },
};
