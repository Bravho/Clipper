/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testPathIgnorePatterns: [
    "/node_modules/",
    // Integration suites that require a live, seeded PostgreSQL connection.
    // The services under test resolve repositories from the @/repositories
    // singleton registry (Postgres-backed) and do not support repository
    // injection, so they cannot run as pure unit tests — they fail at the DB
    // layer ("server does not support SSL connections") with no DB present.
    // Excluded from the default unit run; re-enable once the services accept
    // injected repositories (or a test DB is provisioned in CI).
    "tests/services/StaffRequestPresentationService.test.ts",
    "tests/services/RequestWorkflowService.test.ts",
    "tests/services/DueDateConfirmationService.test.ts",
    "tests/services/PublishingService.test.ts",
  ],
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
    // `jose` v6 ships ESM only. Jest runs CJS here, so it must be transpiled
    // rather than skipped like the rest of node_modules (see below).
    "^.+\\.m?js$": [
      "ts-jest",
      {
        tsconfig: {
          allowJs: true,
          module: "commonjs",
          target: "ES2021",
          esModuleInterop: true,
          noEmit: false,
        },
      },
    ],
  },

  // node_modules is normally left untransformed; `jose` is the one exception.
  transformIgnorePatterns: ["/node_modules/(?!jose/)"],
  collectCoverageFrom: [
    "src/services/**/*.ts",
    "src/repositories/**/*.ts",
    "src/lib/auth/**/*.ts",
    "!src/**/*.d.ts",
  ],
};

module.exports = config;
