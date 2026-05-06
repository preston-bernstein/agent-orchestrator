// Sonar-only pass: typescript-eslint `configs.base` (parser/plugin wiring, no recommended rule dupes) + SonarJS.
// Use with `pnpm run lint:sonar`. Pair with `lint:base` for full coverage without overlapping typescript-eslint rules.
import tseslint from "typescript-eslint";
import { ignorePatterns } from "./shared.mjs";
import sonarFragment from "./sonar.fragment.mjs";

export default [{ ignores: ignorePatterns }, tseslint.configs.base, ...sonarFragment];
