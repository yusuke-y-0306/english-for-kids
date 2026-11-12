import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 計測用のブラウザスクリプト (issue #40)。Node ではなくブラウザでしか動かないので、
    // Next 向けのルールセットで検査しても意味がない (AudioWorklet などは globals が無い)。
    "public/lab/**",
  ]),
]);

export default eslintConfig;
