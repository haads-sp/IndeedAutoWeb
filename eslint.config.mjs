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
      { type: "app", pattern: "src/app/**", partialMatch: false },
      { type: "features", pattern: "src/features/*/**", partialMatch: false, capture: ["feature"] },
      { type: "lib", pattern: "src/lib/**", partialMatch: false },
      { type: "types", pattern: "src/types/**", partialMatch: false },
    ],
    "boundaries/include": ["src/**/*"],
  },
  rules: {
    // ON as of Stage 3, which introduced the first feature (src/features/auth). This was
    // the one-line change the empty ruleset existed to make possible.
    "boundaries/dependencies": [
      "error",
      {
        default: "disallow",
        message:
          "{{ from.element.type }} may not import {{ to.element.type }}. See docs/ARCHITECTURE.md.",
        policies: [
          {
            // Routes compose. They may reach anything below them, and their own
            // colocated files — a page importing its ./actions or ./globals.css is
            // normal and is not a layering violation.
            from: { element: { type: "app" } },
            allow: [
              { to: { element: { type: "app" } } },
              { to: { element: { type: "features" } } },
              { to: { element: { type: "lib" } } },
              { to: { element: { type: "types" } } },
            ],
          },
          {
            // A feature may use its OWN files, plus the layers below. The capture is what
            // makes "its own" precise: features/auth cannot import features/billing.
            from: { element: { type: "features" } },
            allow: [
              {
                to: {
                  element: {
                    type: "features",
                    captured: { feature: "{{ from.element.captured.feature }}" },
                  },
                },
              },
              { to: { element: { type: "lib" } } },
              { to: { element: { type: "types" } } },
            ],
          },
          {
            // Shared capability. Knows nothing about any use case, so it cannot reach up.
            from: { element: { type: "lib" } },
            allow: [
              { to: { element: { type: "lib" } } },
              { to: { element: { type: "types" } } },
            ],
          },
          {
            // Types import nothing but types.
            from: { element: { type: "types" } },
            allow: [{ to: { element: { type: "types" } } }],
          },
        ],
      },
    ],
    "boundaries/no-unknown-dependencies": "off",
    "boundaries/no-unknown-files": "off",
  },
};

/**
 * An underscore prefix means "deliberately unused" — a parameter kept for its position in
 * a signature, or a destructured value skipped over. Without this, the only way to silence
 * the warning is to delete the name, which loses the documentation of what that slot is.
 */
const unusedVarsConfig = {
  files: ["**/*.{ts,tsx,js,jsx,mjs,mts}"],
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  boundariesConfig,
  unusedVarsConfig,
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
