import "dotenv/config";
import jwt from "jsonwebtoken";

export type AuthTokenPayload = { sub: string };

/**
 * Read per call rather than captured at import time.
 *
 * `const JWT_SECRET = process.env.JWT_SECRET as string` made this module's behaviour depend
 * on whether something had already imported `dotenv/config` before it — and when the secret
 * was simply unset, the `as string` hid it: `jwt.sign` threw from inside the login handler
 * (every login a 500, with nothing pointing at the real cause) and `jwt.verify` threw on
 * every request, which mockAuth catches and reports as "invalid or expired token". Both
 * failures look like something else entirely.
 */
const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set — authentication cannot work. Set it in backend/.env (see .env.example).");
  }
  return secret;
};

export const signAuthToken = (userId: string): string => {
  return jwt.sign({ sub: userId } satisfies AuthTokenPayload, getJwtSecret(), {
    expiresIn: "7d",
  });
};

export const verifyAuthToken = (token: string): AuthTokenPayload => {
  return jwt.verify(token, getJwtSecret()) as AuthTokenPayload;
};
