import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@next/next/no-img-element": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      // These effects synchronize route, wallet, RPC, and debounced quote state with external systems.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["scripts/**/*.cjs", "contracts/**/*.cjs", "hardhat.config.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "artifacts/**",
    "cache/**",
    "contracts/artifacts/**",
    "contracts/cache/**",
    "coverage/**",
    "node_modules/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "__MACOSX/**",
  ]),
]);
