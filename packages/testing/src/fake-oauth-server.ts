import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

/** One request the fake received. Query and form values are decoded into `params`. */
export interface OAuthRequestRecord {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
}

export interface FakeOAuthServer {
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly revokeUrl: string;
  /** Every request received, in order. Fake values only: never use a real provider. */
  requests(): readonly OAuthRequestRecord[];
  /** A refresh token the fake accepts, for seeding a secret store. */
  issueRefreshToken(): string;
  /** Later refreshes with this token answer `invalid_grant` (what a revoked consent looks like). */
  revokeRefreshToken(token: string): void;
  /** The next sign-ins name this address in their id token, as another person choosing another account would. */
  signInAs(address: string): void;
  /** The next `/authorize` answers like a user who clicked "Cancel". */
  denyNextConsent(): void;
  /** How many `grant_type=refresh_token` requests arrived (cache-behaviour checks). */
  refreshRequests(): number;
  /** The PKCE challenge of the last `/authorize`, to prove S256 is used. */
  lastCodeChallenge(): string | undefined;
  close(): Promise<void>;
}

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

const paramsOf = (raw: string): Record<string, string> => {
  const params: Record<string, string> = {};
  for (const [name, value] of new URLSearchParams(raw)) params[name] = value;
  return params;
};

const writeJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    connection: "close",
  });
  response.end(JSON.stringify(body));
};

const s256 = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

/**
 * A local OAuth 2.0 authorization server with PKCE for tests (M2-05). CI never calls Google or
 * Microsoft: sign-in, token refresh and revocation run against this server over loopback http.
 */
export const startFakeOAuthServer = async (
  options: {
    readonly expiresIn?: number;
    readonly rotateRefreshTokens?: boolean;
    /** Signed-in address the code exchange names in an (unsigned, fake) OpenID id token. */
    readonly address?: string;
  } = {},
): Promise<FakeOAuthServer> => {
  const sockets = new Set<Socket>();
  const server: Server = createServer();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  const records: OAuthRequestRecord[] = [];
  const codes = new Map<string, { redirectUri: string; clientId: string; challenge: string }>();
  const refreshTokens = new Set<string>();
  const revokedRefreshTokens = new Set<string>();
  let issued = 0;
  let refreshCount = 0;
  let challenge: string | undefined;
  let denyConsent = false;
  let signedInAs = options.address;
  const expiresIn = options.expiresIn ?? 3600;
  const rotateRefreshTokens = options.rotateRefreshTokens ?? false;

  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("fake server failed");
      resolve(address.port);
    });
  });
  const base = `http://127.0.0.1:${port}`;

  server.on("request", (request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", base);
      const form = request.method === "POST" ? paramsOf(await readBody(request)) : {};
      const params = { ...paramsOf(url.search), ...form };
      records.push({ method: request.method ?? "GET", path: url.pathname, params });

      if (url.pathname === "/authorize" && request.method === "GET") {
        const required = ["client_id", "redirect_uri", "state", "code_challenge", "scope"];
        const missing = required.filter((name) => (params[name] ?? "").length === 0);
        if (missing.length > 0 || params.code_challenge_method !== "S256") {
          writeJson(response, 400, { error: "invalid_request" });
          return;
        }
        challenge = params.code_challenge;
        const redirect = new URL(params.redirect_uri ?? "");
        redirect.searchParams.set("state", params.state ?? "");
        if (denyConsent) {
          denyConsent = false;
          redirect.searchParams.set("error", "access_denied");
        } else {
          const code = `code_${++issued}`;
          codes.set(code, {
            redirectUri: params.redirect_uri ?? "",
            clientId: params.client_id ?? "",
            challenge: params.code_challenge ?? "",
          });
          redirect.searchParams.set("code", code);
        }
        response.writeHead(302, { location: redirect.toString(), connection: "close" });
        response.end();
        return;
      }

      if (url.pathname === "/token" && request.method === "POST") {
        if (params.grant_type === "refresh_token") {
          refreshCount++;
          const token = params.refresh_token ?? "";
          if (!refreshTokens.has(token) || revokedRefreshTokens.has(token)) {
            writeJson(response, 400, { error: "invalid_grant" });
            return;
          }
          issued++;
          // Microsoft rotates the refresh token on every refresh; the old one stops working.
          const refresh = rotateRefreshTokens ? `refresh-${++issued}` : undefined;
          if (refresh !== undefined) {
            refreshTokens.delete(token);
            refreshTokens.add(refresh);
          }
          writeJson(response, 200, {
            access_token: `access-${issued}`,
            ...(refresh === undefined ? {} : { refresh_token: refresh }),
            token_type: "Bearer",
            expires_in: expiresIn,
          });
          return;
        }
        if (params.grant_type === "authorization_code") {
          const code = codes.get(params.code ?? "");
          codes.delete(params.code ?? "");
          const verifier = params.code_verifier ?? "";
          if (
            code === undefined ||
            code.clientId !== (params.client_id ?? "") ||
            code.redirectUri !== (params.redirect_uri ?? "") ||
            s256(verifier) !== code.challenge
          ) {
            writeJson(response, 400, { error: "invalid_grant" });
            return;
          }
          const refresh = `refresh-${++issued}`;
          refreshTokens.add(refresh);
          writeJson(response, 200, {
            access_token: `access-${issued}`,
            refresh_token: refresh,
            ...(signedInAs === undefined
              ? {}
              : {
                  id_token: `e30.${Buffer.from(JSON.stringify({ email: signedInAs })).toString("base64url")}.sig`,
                }),
            token_type: "Bearer",
            expires_in: expiresIn,
          });
          return;
        }
        writeJson(response, 400, { error: "unsupported_grant_type" });
        return;
      }

      if (url.pathname === "/revoke" && request.method === "POST") {
        const token = params.token ?? "";
        revokedRefreshTokens.add(token);
        writeJson(response, 200, {});
        return;
      }

      writeJson(response, 404, { error: "not_found" });
    })();
  });

  return {
    authorizeUrl: `${base}/authorize`,
    tokenUrl: `${base}/token`,
    revokeUrl: `${base}/revoke`,
    requests: () => [...records],
    issueRefreshToken: () => {
      const token = `refresh-${++issued}`;
      refreshTokens.add(token);
      return token;
    },
    revokeRefreshToken: (token) => {
      revokedRefreshTokens.add(token);
    },
    signInAs: (address) => {
      signedInAs = address;
    },
    denyNextConsent: () => {
      denyConsent = true;
    },
    refreshRequests: () => refreshCount,
    lastCodeChallenge: () => challenge,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
};
