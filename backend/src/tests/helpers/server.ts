/**
 * Boots the real Express app (src/app.ts — the exact same instance index.ts and
 * api/index.ts serve) on an ephemeral port and hands back a tiny fetch-based
 * client. No supertest/jest dependency: node's built-in test runner plus global
 * fetch is enough, and it keeps the suite runnable with just `tsx`.
 *
 * Every request goes over real HTTP through the real middleware chain, so these
 * are true route-level integration tests — a bug in cors/express.json/errorHandler
 * shows up here the same way it would in production.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import app from "../../app.js";
import { prisma } from "../../utils/prisma.js";

export type ApiResponse<T = any> = {
  status: number;
  body: T;
  /** Raw text, kept for the cases where the body isn't valid JSON at all. */
  text: string;
  headers: Headers;
};

let server: Server | undefined;
let baseUrl = "";

export const startServer = async (): Promise<string> => {
  if (server) return baseUrl;

  server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(0, "127.0.0.1");
    s.once("listening", () => resolve(s));
    s.once("error", reject);
  });

  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  return baseUrl;
};

export const stopServer = async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    baseUrl = "";
  }
  await prisma.$disconnect();
};

type RequestOptions = {
  /** Bearer JWT from POST /api/auth/login. */
  token?: string;
  /** Dev-only `x-user-id` mock-auth header (mockAuth.middleware.ts). */
  userId?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  /** Sent verbatim instead of JSON.stringify(body) — for malformed-payload tests. */
  rawBody?: string;
};

const buildUrl = (path: string, query?: RequestOptions["query"]) => {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
};

const request = async (
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<ApiResponse> => {
  const headers: Record<string, string> = { ...options.headers };

  if (body !== undefined || options.rawBody !== undefined) headers["content-type"] ??= "application/json";
  if (options.token) headers["authorization"] = `Bearer ${options.token}`;
  if (options.userId) headers["x-user-id"] = options.userId;

  const payload =
    options.rawBody !== undefined ? options.rawBody : body === undefined ? undefined : JSON.stringify(body);

  const response = await fetch(buildUrl(path, options.query), { method, headers, body: payload });

  const text = await response.text();
  let parsed: unknown = undefined;
  try {
    parsed = text.length ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  return { status: response.status, body: parsed, text, headers: response.headers };
};

export const api = {
  get: (path: string, options?: RequestOptions) => request("GET", path, undefined, options),
  post: (path: string, body?: unknown, options?: RequestOptions) => request("POST", path, body, options),
  put: (path: string, body?: unknown, options?: RequestOptions) => request("PUT", path, body, options),
  patch: (path: string, body?: unknown, options?: RequestOptions) => request("PATCH", path, body, options),
  del: (path: string, options?: RequestOptions) => request("DELETE", path, undefined, options),
  /** Escape hatch for verb/shape combinations the helpers above don't cover. */
  raw: request,
};
