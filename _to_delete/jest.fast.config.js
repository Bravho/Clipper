// Scratch config: same as jest.config.js but ts-jest skips type-checking
// (isolatedModules) so single suites fit a short shell time limit.
const base = require("../jest.config.js");
const fastTs = ["ts-jest", { isolatedModules: true, tsconfig: { noEmit: false } }];
module.exports = {
  ...base,
  rootDir: "..",
  transform: { ...base.transform, "^.+\\.tsx?$": fastTs },
};
