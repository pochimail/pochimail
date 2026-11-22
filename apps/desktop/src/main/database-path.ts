import { join } from "node:path";

const DATABASE_FILE = "pochimail.db";

/** The one database file of this user's app data, in dev and packaged alike; no environment variable required. */
export const databasePathFor = (userData: string): string => join(userData, DATABASE_FILE);
