import { z } from "zod";

/** Gmail REST v1, the parts this adapter reads. Anything else in a response is dropped by zod. */
export const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Quota units of the calls that net's table does not list (Gmail "usage limits" page). */
export const EXTRA_QUOTA_UNITS = { profile: 1, trash: 5, labels: 1 } as const;

export const profileSchema = z.object({ historyId: z.string() });

export const messageListSchema = z.object({
  messages: z.array(z.object({ id: z.string(), threadId: z.string() })).default([]),
  nextPageToken: z.string().optional(),
});

const headerSchema = z.object({ name: z.string(), value: z.string() });

/** What attachment counting reads of a top-level part: its filename. Names are never kept. */
const attachmentPartSchema = z.object({
  filename: z.string().default(""),
});

/** Metadata only: ids, labels, size, date, three headers and the part structure. Never a subject, snippet or body. */
export const metadataSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).default([]),
  sizeEstimate: z.number().optional(),
  internalDate: z.string(),
  payload: z
    .object({
      mimeType: z.string().default(""),
      filename: z.string().default(""),
      headers: z.array(headerSchema).default([]),
      parts: z.array(attachmentPartSchema).default([]),
    })
    .default({ mimeType: "", filename: "", headers: [], parts: [] }),
});
export type GmailMetadata = z.infer<typeof metadataSchema>;

const changedSchema = z.object({ message: z.object({ id: z.string() }) });

export const historySchema = z.object({
  history: z
    .array(
      z.object({
        messagesAdded: z.array(changedSchema).default([]),
        labelsAdded: z.array(changedSchema).default([]),
        labelsRemoved: z.array(changedSchema).default([]),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
  historyId: z.string(),
});

export const labelsSchema = z.object({
  labels: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
});
export const createdLabelSchema = z.object({ id: z.string(), name: z.string() });

const partSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    mimeType: z.string().default(""),
    body: z.object({ data: z.string().optional() }).default({}),
    parts: z.array(partSchema).default([]),
  }),
);
export interface GmailPart {
  mimeType: string;
  body: { data?: string | undefined };
  parts: GmailPart[];
}
export const fullMessageSchema = z.object({ payload: partSchema });

/** The fields a display screen may fetch live, by id; never stored (ADR 0014). */
export const displaySchema = z.object({
  id: z.string(),
  snippet: z.string().default(""),
  payload: z.object({ headers: z.array(headerSchema).default([]) }).default({ headers: [] }),
});
