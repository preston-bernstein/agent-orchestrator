// Root ESLint config for IDE + `pnpm run lint` (core + SonarJS).
// Split scripts: `lint:base` / `lint:sonar` — see eslint/core.config.mjs and eslint/sonar.standalone.mjs.
import core from "./eslint/core.config.mjs";
import sonarFragment from "./eslint/sonar.fragment.mjs";

export default [...core, ...sonarFragment];
