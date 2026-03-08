/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  moduleNameMapper: {
    // Resolve @/ path alias to src/
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          noEmit: false,
        },
      },
    ],
  },
  collectCoverageFrom: [
    "src/services/**/*.ts",
    "src/repositories/**/*.ts",
    "src/lib/auth/**/*.ts",
    "!src/**/*.d.ts",
  ],
};

module.exports = config;
