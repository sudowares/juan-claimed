/**
 * One-line setup/teardown for a route test file:
 *
 *   const ctx = useTestContext();
 *   // ...inside a test: ctx.actors.superadmin.auth
 *
 * Registers node:test's before/after hooks itself, so each file only declares
 * what it needs. The returned object is populated in `before`, which runs before
 * any test body — so reading `ctx.actors` at module top level would be undefined,
 * but reading it inside a test is always safe.
 */
import { after, before } from "node:test";
import { startServer, stopServer } from "./server.js";
import { loadActors, loadReferences, type Actors, type References } from "./actors.js";
import { purgeTestData } from "./fixtures.js";

export type TestContext = {
  baseUrl: string;
  actors: Actors;
  refs: References;
};

export const useTestContext = (): TestContext => {
  const ctx = {} as TestContext;

  before(async () => {
    ctx.baseUrl = await startServer();
    ctx.actors = await loadActors();
    ctx.refs = await loadReferences();
  });

  after(async () => {
    await purgeTestData();
    await stopServer();
  });

  return ctx;
};

/**
 * Every non-2xx response in this API is supposed to carry the same envelope:
 * { success, message, error, errorCode, data }. Several controllers only emit a
 * subset, which is exactly the kind of drift this asserts on.
 */
export const expectEnvelope = (body: any) => {
  const missing = (["success", "message", "error", "errorCode", "data"] as const).filter(
    (key) => !(body && typeof body === "object" && key in body),
  );
  return missing;
};

/**
 * The PSGC reference API (psgc.gitlab.io) is an external dependency of
 * benefit.service.ts. Tests that genuinely need it probe once and skip with a
 * clear reason when it's unreachable, instead of reporting a false failure.
 */
let psgcReachable: boolean | undefined;

export const isPsgcReachable = async (): Promise<boolean> => {
  if (psgcReachable !== undefined) return psgcReachable;
  try {
    const response = await fetch("https://psgc.gitlab.io/api/regions/", {
      signal: AbortSignal.timeout(8000),
    });
    psgcReachable = response.ok;
  } catch {
    psgcReachable = false;
  }
  return psgcReachable;
};
