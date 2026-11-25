/**
 * Architecture boundaries, enforced (ADR 0015, ARCHITECTURE.md).
 * Each rule states the boundary and why it exists. Run: `pnpm arch` (part of `pnpm check`).
 * Paths are resolved paths, so `@pochimail/x/...` imports land on `packages/x/src/...`.
 */

/** Files that never ship: tests, stories, benches, test support. They may reach into testing. */
const NOT_SHIPPED = "\\.(test|stories|bench|arch\\.test)\\.tsx?$|/test-support/|/bench/";

/**
 * Production files allowed to import @pochimail/testing. Each one is compiled out of release
 * builds at build time. Adding a path here needs a reason in the PR; the list should shrink, not grow.
 */
const DEV_ONLY_ENTRIES = [
  "^apps/desktop/src/worker/fixture-adapters\\.ts$",
  "^apps/desktop/src/model-host/fixture-engine\\.ts$",
  "^apps/cli/src/", // the CLI is dev-only and never shipped (ADR 0001)
].join("|");

/** Package kinds (ADR 0015, AGENTS.md "Packages"). */
const DOMAINS = "accounts|mailbox|classification|cleanup|actions|documents";
const ADAPTERS = "db|net|gmail|graph|ai";

module.exports = {
  forbidden: [
    {
      name: "kernel-is-base",
      severity: "error",
      comment:
        "kernel holds the few types every domain shares; it imports nothing of ours (ADR 0015).",
      from: { path: "^packages/kernel/src/" },
      to: { path: "^(packages|apps)/", pathNot: "^packages/kernel/src/" },
    },
    {
      name: "domains-are-independent",
      severity: "error",
      comment:
        "A domain package imports only kernel and its own files. Domains share ids and events, never types; they meet only in workflows (ADR 0015).",
      from: { path: `^packages/(${DOMAINS})/src/` },
      to: { path: "^(packages|apps)/", pathNot: ["^packages/$1/src/", "^packages/kernel/src/"] },
    },
    {
      name: "workflows-only-orchestrate",
      severity: "error",
      comment:
        "workflows turns events into commands across domains and assembles the scan as pipeline jobs (the job runner, retry policy and outbox types it is built from). It never touches adapters, ui or apps; the direction is workflows uses pipeline, never the reverse (pipeline-knows-no-domain).",
      from: { path: "^packages/workflows/src/", pathNot: NOT_SHIPPED },
      to: { path: `^apps/|^packages/(${ADAPTERS}|ui|testing)/` },
    },
    {
      name: "adapters-are-independent",
      severity: "error",
      comment:
        "An adapter implements domain ports. It never imports another adapter (gmail and graph may use net), workflows, ui or apps. Pipeline is covered by adapters-use-only-pipeline-ports.",
      from: { path: `^packages/(${ADAPTERS})/src/`, pathNot: NOT_SHIPPED },
      to: {
        path: `^apps/|^packages/(${ADAPTERS}|workflows|ui|testing)/`,
        pathNot: ["^packages/$1/src/", "^packages/net/src/"],
      },
    },
    {
      name: "adapters-use-only-pipeline-ports",
      severity: "error",
      comment:
        "Only db (the JobQueue and OutboxStore ports it implements and the outbox-backed event sink: job-queue.ts, outbox.ts, outbox-event-sink.ts) and net (the pure retry backoff: retry.ts) may import pipeline, and only those files. No adapter runs pipeline code.",
      from: {
        path: `^packages/(${ADAPTERS})/src/`,
        pathNot: [NOT_SHIPPED, "^packages/(db|net)/src/"],
      },
      to: { path: "^packages/pipeline/src/" },
    },
    {
      name: "net-uses-only-pipeline-backoff",
      severity: "error",
      comment: "net shares pipeline's pure retry backoff (retry.ts) and nothing else of pipeline.",
      from: { path: "^packages/net/src/", pathNot: NOT_SHIPPED },
      to: { path: "^packages/pipeline/src/", pathNot: "^packages/pipeline/src/retry\\.ts$" },
    },
    {
      name: "db-uses-only-pipeline-ports",
      severity: "error",
      comment:
        "db implements pipeline's JobQueue and OutboxStore ports, builds its transaction's event sink over the outbox, and uses nothing else of pipeline.",
      from: { path: "^packages/db/src/", pathNot: NOT_SHIPPED },
      to: {
        path: "^packages/pipeline/src/",
        pathNot: "^packages/pipeline/src/(job-queue|outbox|outbox-event-sink)\\.ts$",
      },
    },
    {
      name: "only-mail-adapters-use-net",
      severity: "error",
      comment:
        "net is the network exit for mail providers; other packages have no reason to call the network. testing is test support (never shipped) and hosts the net contract suites.",
      from: { path: "^packages/(?!gmail/|graph/|net/|testing/)[^/]+/src/" },
      to: { path: "^packages/net/src/" },
    },
    {
      name: "pipeline-knows-no-domain",
      severity: "error",
      comment: "pipeline runs the handlers it is given; it imports only kernel and logger.",
      from: { path: "^packages/pipeline/src/" },
      to: { path: "^(packages|apps)/", pathNot: ["^packages/(pipeline|kernel|logger)/src/"] },
    },
    {
      name: "domain-testing-only-in-tests",
      severity: "error",
      comment:
        "A domain's in-memory adapters and contract suites (src/testing) are for tests, the testing package and dev-only entries; never shipped code.",
      from: {
        path: "^(packages|apps)/",
        pathNot: [
          NOT_SHIPPED,
          "^packages/testing/",
          `^packages/(${DOMAINS})/src/testing/`,
          DEV_ONLY_ENTRIES,
        ],
      },
      to: { path: `^packages/(${DOMAINS})/src/testing/` },
    },
    {
      name: "no-circular",
      severity: "error",
      comment:
        "A cycle means two modules are one responsibility split badly. Extract the shared part.",
      from: {},
      to: { circular: true },
    },
    {
      name: "domains-npm-allowlist",
      severity: "error",
      comment:
        "A domain may only use zod from npm. Anything else is an adapter concern and belongs behind a port. Tests and src/testing (contract suites) may use test tooling.",
      from: {
        path: `^packages/(${DOMAINS})/src/`,
        pathNot: [NOT_SHIPPED, `^packages/(${DOMAINS})/src/testing/`],
      },
      to: {
        dependencyTypes: ["npm", "npm-dev", "npm-peer", "npm-optional"],
        pathNot: "node_modules/zod/",
      },
    },
    {
      name: "logger-depends-only-on-kernel",
      severity: "error",
      comment:
        "The logger and its redaction are privacy-critical and used by every process; they depend only on kernel (its error codes and id shape) so they can be tested exhaustively on their own (ADR 0015).",
      from: { path: "^packages/logger/src/" },
      to: { path: "^(packages|apps)/", pathNot: "^packages/(logger|kernel)/src/" },
    },
    {
      name: "ui-is-presentational",
      severity: "error",
      comment:
        "packages/ui renders props. It knows nothing about the domain, IPC or adapters, so every component works in Storybook with plain data.",
      from: { path: "^packages/ui/src/" },
      to: { path: "^(packages|apps)/", pathNot: "^packages/ui/src/" },
    },
    {
      name: "testing-only-in-tests",
      severity: "error",
      comment:
        "Fixtures and contracts are for tests and developers only and must not reach release builds. Shipped code that needs a fixture goes through one listed dev-only entry.",
      from: {
        path: "^(packages|apps)/",
        pathNot: [NOT_SHIPPED, "^packages/testing/", DEV_ONLY_ENTRIES],
      },
      to: { path: "^packages/testing/" },
    },
    {
      name: "contracts-live-in-testing",
      severity: "error",
      comment:
        "A reusable contract suite is test code: it belongs in packages/testing, not in the adapter's shipped source.",
      from: {
        path: "^packages/(?!testing/)[^/]+/src/.*-contract\\.ts$",
        // ADR 0015: a domain's own contract suites live in its src/testing/.
        pathNot: `^packages/(${DOMAINS})/src/testing/`,
      },
      to: { path: "node_modules/vitest/" },
    },
    {
      name: "packages-never-import-apps",
      severity: "error",
      comment: "Apps compose packages. A package importing an app inverts the dependency graph.",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "renderer-is-isolated",
      severity: "error",
      comment:
        "The renderer is a sandboxed web page. It reaches main, worker and model host only through the typed IPC contract in shared/ (ADR 0002).",
      from: { path: "^apps/desktop/src/renderer/", pathNot: NOT_SHIPPED },
      to: { path: "^apps/desktop/src/(main|worker|model-host|preload)/" },
    },
    {
      name: "main-does-not-render",
      severity: "error",
      comment: "Main owns windows, OS calls and secrets. It never imports renderer or worker code.",
      from: { path: "^apps/desktop/src/main/", pathNot: NOT_SHIPPED },
      to: { path: "^apps/desktop/src/(renderer|worker|model-host)/" },
    },
    {
      name: "preload-is-tiny",
      severity: "error",
      comment:
        "The preload bridge may only use shared/ contracts: every import widens the attack surface.",
      from: { path: "^apps/desktop/src/preload/" },
      to: { path: "^apps/desktop/src/(?!shared/|preload/)" },
    },
    {
      name: "shared-is-leaf",
      severity: "error",
      comment: "shared/ holds contracts used by every process; it imports none of them.",
      from: { path: "^apps/desktop/src/shared/" },
      to: { path: "^apps/desktop/src/(main|renderer|worker|model-host|preload)/" },
    },
    {
      name: "features-are-independent",
      severity: "error",
      comment:
        "A feature folder never imports another feature. Shared pieces move to renderer lib/ or to packages/ui; routes compose features.",
      // dev-gallery is the one exception: it renders the other features' stories (M4-18, dev builds only).
      from: {
        path: "^apps/desktop/src/renderer/src/features/([^/]+)/",
        pathNot: [NOT_SHIPPED, "^apps/desktop/src/renderer/src/features/dev-gallery/"],
      },
      to: {
        path: "^apps/desktop/src/renderer/src/features/",
        pathNot: "^apps/desktop/src/renderer/src/features/$1/",
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(node_modules|dist|out|out-e2e|build|coverage|storybook-static)/" },
    // TypeScript 7.0 lacks the compiler API dependency-cruiser uses; SWC parses TS/TSX without it.
    parser: "swc",
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
      extensions: [".ts", ".tsx", ".js"],
    },
  },
};
