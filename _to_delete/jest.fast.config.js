/**
 * Transpile-only variant of jest.config.js.
 *
 * ts-jest type-checks every file it loads, which on a slow filesystem dominates
 * the run. Types are verified separately by `tsc --noEmit`, so for a behavioural
 * run that work is pure duplication. Scratch config — not part of the repo's
 * normal workflow; `npm test` still runs the type-checking configuration.
 */
const base = require("./jest.config.js");

module.exports = {
  ...base,
  transform: {
    ...base.transform,
    "^.+\\.tsx?$": [
      "ts-jest",
      { tsconfig: { noEmit: false }, isolatedModules: true },
    ],
  },
};
