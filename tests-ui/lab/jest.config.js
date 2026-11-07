/**
 * Isolated Jest configuration for the lab run panel. It exists so the shared
 * jest.config.js is not changed. It transforms JSX (the project's own TypeScript
 * setup leaves JSX for Next), maps the @/ alias, and uses no DOM library: the
 * panel's logic is exercised through its exported start function, with fetch mocked.
 * Run: npx jest -c tests-ui/lab/jest.config.js
 */
const path = require("path");

module.exports = {
  testEnvironment: "node",
  rootDir: __dirname,
  roots: ["<rootDir>"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": path.resolve(__dirname, "../../src/$1"),
  },
  transform: {
    "^.+\.tsx?$": [
      "ts-jest",
      {
        diagnostics: false,
        tsconfig: {
          jsx: "react-jsx",
          module: "commonjs",
          target: "ES2021",
          esModuleInterop: true,
          skipLibCheck: true,
          noEmit: false,
        },
      },
    ],
  },
};
