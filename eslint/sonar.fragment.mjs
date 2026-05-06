// SonarJS layers — merged after core in eslint.config.js; also composed into sonar.standalone.mjs.
import sonarjs from "eslint-plugin-sonarjs";

export default [
  sonarjs.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    rules: {
      "sonarjs/no-os-command-from-path": "off",
    },
  },
  {
    rules: {
      "sonarjs/no-nested-functions": "off",
      "sonarjs/no-all-duplicated-branches": "off",
      "sonarjs/cognitive-complexity": ["error", 45],
      "sonarjs/todo-tag": "off",
      "sonarjs/slow-regex": "off",
      "sonarjs/concise-regex": "off",
    },
  },
  {
    files: ["tests/**/*.ts", "**/*.test.ts"],
    rules: {
      "sonarjs/cognitive-complexity": "off",
      "sonarjs/publicly-writable-directories": "off",
      "sonarjs/void-use": "off",
    },
  },
  // NUL sentinels in replace callback — core ESLint needs no-control-regex; Sonar duplicate disabled here so `lint:base` does not reference unknown plugin rules in disable comments.
  {
    files: ["src/gates/caveman.ts"],
    rules: {
      "sonarjs/no-control-regex": "off",
    },
  },
];
