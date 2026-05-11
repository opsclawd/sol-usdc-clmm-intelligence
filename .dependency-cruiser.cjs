/* eslint-disable */
module.exports = {
  forbidden: [
    {
      name: "domain-no-outbound",
      severity: "error",
      from: { path: "^src/domain" },
      to: {
        path: [
          "^src/application",
          "^src/jobs",
          "^src/adapters",
          "^src/ports",
          "^scripts",
          "^node_modules/(?!typescript)"
        ],
        pathNot: ["^src/contracts/snapshots\\.ts$"]
      }
    },
    {
      name: "domain-no-output-contracts",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/contracts/(outputs|cron-config)\\.ts$" }
    },
    {
      name: "contracts-no-runtime",
      severity: "error",
      from: { path: "^src/contracts" },
      to: {
        path: ["^src/application", "^src/jobs", "^src/adapters", "^src/ports", "^scripts"]
      }
    },
    {
      name: "ports-no-app-or-adapters",
      severity: "error",
      from: { path: "^src/ports" },
      to: { path: ["^src/application", "^src/jobs", "^src/adapters", "^scripts"] }
    },
    {
      name: "application-no-adapters-or-jobs",
      severity: "error",
      from: { path: "^src/application" },
      to: { path: ["^src/jobs", "^src/adapters", "^scripts"] }
    },
    {
      name: "jobs-no-adapters-or-domain-internals",
      severity: "error",
      from: { path: "^src/jobs" },
      to: { path: ["^src/adapters", "^scripts", "^src/domain"] }
    },
    {
      name: "adapters-no-app-or-jobs",
      severity: "error",
      from: { path: "^src/adapters" },
      to: { path: ["^src/application", "^src/jobs", "^scripts"] }
    },
    {
      name: "inner-layers-no-node-builtins",
      severity: "error",
      from: { path: "^src/(domain|application|jobs|ports|contracts)" },
      to: { dependencyTypes: ["core"] }
    },
    {
      name: "db-no-upstream",
      severity: "error",
      from: { path: "^src/db" },
      to: {
        path: ["^src/application", "^src/jobs", "^src/adapters", "^src/scripts", "^src/ports"]
      }
    },
    {
      name: "inner-layers-no-db",
      severity: "error",
      from: { path: "^src/(domain|contracts|application|jobs|ports)" },
      to: { path: ["^src/db"] }
    }
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    includeOnly: "^src",
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node"]
    }
  }
};
