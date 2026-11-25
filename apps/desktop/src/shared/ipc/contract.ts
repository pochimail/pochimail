import { AUTONOMY_LEVELS } from "@pochimail/actions/policies/autonomy";
import { emailTypeSchema } from "@pochimail/classification/model/email-type";
import { digestFiguresSchema } from "@pochimail/cleanup/model/digest";
import { CLEANABLE_LABELS } from "@pochimail/cleanup/policies/labels";
import { z } from "zod";
import { DEVICE_NAMES } from "../platform-port.ts";
import { CAPABILITIES, SETTINGS_LOCALES, THEMES, TIDY_CADENCES } from "../settings.ts";

/**
 * The typed contract every screen uses (ADR 0002, M4-01). Handlers backed by core use cases live in worker/handlers.ts (M4-02).
 * Nothing here carries message bodies (D11): the renderer only ever sees counts, ids, states and progress.
 */
const accountId = z.string().min(1).max(200);
const jobId = z.string().min(1).max(200);
const actionId = z.string().min(1).max(200);

const autonomySchema = z.enum(AUTONOMY_LEVELS);
const themeSchema = z.enum(THEMES);
const localeSchema = z.enum(SETTINGS_LOCALES);
const tidyCadenceSchema = z.enum(TIDY_CADENCES);
const count = z.number().int().nonnegative();
/** The cleanable types, shared by the Overview and Review figures; counts only (ADR 0014). */
const cleanableSchema = z
  .array(
    z.object({
      category: z.enum(CLEANABLE_LABELS),
      count,
    }),
  )
  .max(CLEANABLE_LABELS.length);
const capabilitiesSchema = z.object(
  Object.fromEntries(CAPABILITIES.map((name) => [name, z.boolean()])) as Record<
    (typeof CAPABILITIES)[number],
    z.ZodBoolean
  >,
);

const queries = {
  "accounts.list": {
    input: z.undefined(),
    output: z
      .array(
        z.object({
          id: accountId,
          provider: z.enum(["google", "microsoft"]),
          displayName: z.string().max(200),
        }),
      )
      .max(100),
  },
  /** The Overview's figures, for every account or the one named; counts only, never content. */
  "overview.get": {
    input: z.object({ accountId: accountId.optional() }),
    output: z.object({
      scanned: z.number().int().nonnegative(),
      toReview: z.number().int().nonnegative(),
      waiting: z.number().int().nonnegative(),
      deadlines: z.number().int().nonnegative(),
      important: z.number().int().nonnegative(),
      oldestWaitingDays: z.number().int().nonnegative(),
      cleanable: cleanableSchema,
      /** Action- and size-derived figures (#114); sizes are bytes, counts only, never content. */
      figures: z.object({
        archived: count,
        savedCount: count,
        savedSize: z.number().int().nonnegative(),
        deletableSize: z.number().int().nonnegative(),
        unsubscribed: count,
        totalSize: z.number().int().nonnegative(),
      }),
    }),
  },
  /** The Review screen's stored figures (#98): counts only, never a subject, sender, snippet or URL. */
  "review.get": {
    input: z.object({ accountId: accountId.optional() }),
    output: z.object({
      toReview: count,
      waiting: count,
      deadlines: count,
      important: count,
      cleanable: cleanableSchema,
      /** True only when no stored account matches the selection, not a live session probe. */
      noAccount: z.boolean(),
    }),
  },
  /** Email counts per type over the given accounts (the switcher's selection); counts only, never content. */
  "mailbox.types": {
    input: z.object({ accountIds: z.array(accountId).max(100) }),
    output: z.record(emailTypeSchema, z.number().int().nonnegative()),
  },
  /** Read-only: the live (running or paused) scan jobs of the given accounts, so a screen can show Pause or Resume after a reload. */
  "scan.status": {
    input: z.object({ accountIds: z.array(accountId).max(100) }),
    output: z
      .array(
        z.object({
          accountId,
          jobId,
          status: z.enum(["running", "paused"]),
          processed: z.number().int().nonnegative(),
        }),
      )
      .max(100),
  },
  /** One account's newest digest items, or every account's summed latest for All accounts (#110); never cumulative Overview totals (#227). */
  "digest.get": {
    input: z.object({ accountId: accountId.optional() }),
    output: z.object({ ready: z.boolean(), itemCount: count }).extend(digestFiguresSchema.shape),
  },
  "settings.get": {
    input: z.undefined(),
    // Optional so a caller written before these preferences existed stays valid; the controller defaults it.
    output: z.object({
      autonomy: autonomySchema,
      capabilities: capabilitiesSchema,
      notifications: z.boolean(),
      theme: themeSchema.optional(),
      locale: localeSchema.nullable().optional(),
      tidyCadence: tidyCadenceSchema.optional(),
      summaryShown: z.boolean().optional(),
    }),
  },
  "app.state": {
    input: z.undefined(),
    output: z.object({
      status: z.enum(["starting", "ready", "locked"]),
      hasConnectedAccount: z.boolean(),
    }),
  },
  /** M4-07: copy uses deviceName(), never a hard-coded OS name (brief §5.9). */
  "device.name": {
    input: z.undefined(),
    output: z.enum(DEVICE_NAMES),
  },
} as const;

/** Why a sign-in failed, as a closed set the screen can explain; never a provider message, URL or token. */
export const CONNECT_FAILURES = [
  "not-configured",
  "no-address",
  "provider-failed",
  "storage-unavailable",
  "unknown",
] as const;

/** Sign-in waits for the person in their browser (five minutes, ADR 0007), so this one call outlives the default RPC timeout. */
export const CONNECT_CALL_TIMEOUT_MS = 6 * 60_000;

const mutations = {
  /** Real sign-in in the system browser, run by the worker. The answer carries no token: those never leave it. */
  "accounts.connect": {
    input: z.object({ provider: z.literal("google") }),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("connected"), accountId }),
      z.object({ status: z.literal("cancelled") }),
      z.object({ status: z.literal("failed"), reason: z.enum(CONNECT_FAILURES) }),
    ]),
  },
  /** Stops a sign-in that is waiting for the person; the waiting `accounts.connect` then answers `cancelled`. */
  "accounts.cancelConnect": {
    input: z.undefined(),
    output: z.undefined(),
  },
  "scan.start": {
    input: z.object({ accountId }),
    output: z.object({ jobId }),
  },
  "scan.pause": {
    input: z.object({ jobId }),
    output: z.undefined(),
  },
  "scan.resume": {
    input: z.object({ jobId }),
    output: z.undefined(),
  },
  /** Stops the scan for good; starting again continues from where the stored cursor stopped. */
  "scan.cancel": {
    input: z.object({ jobId }),
    output: z.undefined(),
  },
  "settings.update": {
    input: z.object({
      autonomy: autonomySchema.optional(),
      capabilities: capabilitiesSchema.optional(),
      notifications: z.boolean().optional(),
      theme: themeSchema.optional(),
      locale: localeSchema.nullable().optional(),
      tidyCadence: tidyCadenceSchema.optional(),
      summaryShown: z.boolean().optional(),
    }),
    output: z.undefined(),
  },
} as const;

/** `coalesceKey` names the field whose value identifies "the same state": only the latest event per key is kept in a buffer. */
const subscriptions = {
  "scan.progress": {
    input: z.object({ accountId }),
    event: z.object({
      accountId,
      phase: z.enum(["listing", "fetching", "classifying", "done"]),
      processed: z.number().int().nonnegative(),
      /** `null` while the provider cannot say how many emails there are. */
      total: z.number().int().nonnegative().nullable(),
    }),
    coalesceKey: (event: { accountId: string }) => event.accountId,
  },
  "app.events": {
    input: z.undefined(),
    event: z.discriminatedUnion("type", [
      z.object({ type: z.literal("ActionApplied"), actionId }),
      z.object({
        type: z.literal("ActionFailed"),
        actionId,
        reason: z.enum(["not-found", "conflict", "provider-error", "cancelled", "unknown"]),
      }),
      z.object({
        type: z.literal("ScanCompleted"),
        accountId,
        processed: z.number().int().nonnegative(),
      }),
      z.object({
        type: z.literal("ScanFailed"),
        accountId,
        reason: z.enum(["offline", "rate-limited", "auth-expired", "unknown"]),
      }),
      z.object({ type: z.literal("ScanCancelled"), accountId, jobId }),
      z.object({ type: z.literal("DigestReady"), itemCount: z.number().int().nonnegative() }),
      // Required-state triggers (M4-16). M2/M3/M8 emit the real events; fixtures emit them until then.
      z.object({ type: z.literal("Offline") }),
      z.object({ type: z.literal("Online") }),
      z.object({
        type: z.literal("RateLimited"),
        provider: z.string().min(1),
        /** Epoch milliseconds when sync resumes by itself. */
        resumeAt: z.number().int().nonnegative(),
      }),
      z.object({ type: z.literal("SyncResumed") }),
      z.object({ type: z.literal("NeedsReauth"), accountId, provider: z.string().min(1) }),
      z.object({ type: z.literal("Reconnected"), accountId }),
      z.object({ type: z.literal("ModelDownloadFailed") }),
      z.object({ type: z.literal("ModelDownloadStarted") }),
      z.object({ type: z.literal("UpdateReady"), version: z.string().min(1) }),
    ]),
    coalesceKey: undefined,
  },
} as const;

type Queries = typeof queries;
type Mutations = typeof mutations;
type Subscriptions = typeof subscriptions;
export type ProcedureName = keyof Queries | keyof Mutations;
export type SubscriptionName = keyof Subscriptions;

export type InputOf<N extends ProcedureName> = N extends keyof Queries
  ? z.input<Queries[N]["input"]>
  : N extends keyof Mutations
    ? z.input<Mutations[N]["input"]>
    : never;
export type OutputOf<N extends ProcedureName> = N extends keyof Queries
  ? z.output<Queries[N]["output"]>
  : N extends keyof Mutations
    ? z.output<Mutations[N]["output"]>
    : never;
export type SubInputOf<N extends SubscriptionName> = z.input<Subscriptions[N]["input"]>;
export type EventOf<N extends SubscriptionName> = z.output<Subscriptions[N]["event"]>;

/** Looks a procedure up by name; queries and mutations share one namespace. */
export const procedureSchemas = (name: string) => {
  if (Object.hasOwn(queries, name)) return queries[name as keyof Queries];
  if (Object.hasOwn(mutations, name)) return mutations[name as keyof Mutations];
  return undefined;
};
export const subscriptionSchemas = (name: string) =>
  Object.hasOwn(subscriptions, name) ? subscriptions[name as SubscriptionName] : undefined;
