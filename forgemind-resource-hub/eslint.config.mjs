import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "dist/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  // The CAD workbenches intentionally keep a small imperative bridge around
  // WebGL, OCCT and pointer events. Refs are the deliberate ownership boundary
  // for the imperative viewport runtime, so React Compiler's render-phase ref
  // rule does not describe a defect here. Every other hooks and accessibility
  // check remains active.
  {
    files: [
      "app/kernel-debug/OcctKernelDebug.tsx",
      "app/ThreeWorkbench.tsx",
      "app/kernel-debug/ProfessionalSketcher.tsx",
    ],
    rules: {
      "react-hooks/refs": "off",
    },
  },
  // Assembly viewport callbacks also own long-lived Three.js and OCCT objects,
  // but ordinary effect and dependency checks remain enabled for this file.
  {
    files: ["app/assembly-debug/AssemblyDebug.tsx"],
    rules: {
      "react-hooks/refs": "off",
    },
  },
]);

export default eslintConfig;
