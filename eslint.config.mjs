import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

/**
 * The boundary rule from docs/ARCHITECTURE.md, as a mechanism:
 *
 *   app/ -> features/ -> lib/ -> types/, never outward and never between sibling features.
 *
 * The element types below are REAL — they describe the tree we actually have. The rules
 * are deliberately OFF (BUILD-PLAN.md §1c asks for "an empty ruleset that passes"), so
 * turning the first one on is a one-line change from 'off' to 'error' rather than a
 * design exercise under deadline. See docs/DECISIONS.md.
 *
 * Rule names are the v6+ ones: `element-types`, `entry-point`, `no-private` and
 * `external` are all deprecated in favour of the single `boundaries/dependencies`.
 * See docs/DOMAIN.md.
 */
const boundariesConfig = {
  files: ["src/**/*.{ts,tsx,js,jsx,mjs}"],
  plugins: { boundaries },
  settings: {
    "boundaries/elements": [
      { type: "app", pattern: "src/app/**", mode: "full" },
      { type: "features", pattern: "src/features/*/**", mode: "full", capture: ["feature"] },
      { type: "lib", pattern: "src/lib/**", mode: "full" },
      { type: "types", pattern: "src/types/**", mode: "full" },
    ],
    "boundaries/include": ["src/**/*"],
  },
  rules: {
    // OFF by design. The intended policy, for when Stage 3 introduces the first feature:
    //
    //   "boundaries/dependencies": ["error", {
    //     default: "disallow",
    //     rules: [
    //       { from: "app",      allow: ["features", "lib", "types"] },
    //       { from: "features", allow: [["features", { feature: "${from.feature}" }], "lib", "types"] },
    //       { from: "lib",      allow: ["lib", "types"] },
    //       { from: "types",    allow: ["types"] },
    //     ],
    //   }],
    "boundaries/dependencies": "off",
    "boundaries/no-unknown-dependencies": "off",
    "boundaries/no-unknown-files": "off",
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  boundariesConfig,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
