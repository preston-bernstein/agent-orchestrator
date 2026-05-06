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

export default {
  forbidden,
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
