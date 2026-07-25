import fs from "node:fs";
import path from "node:path";
import pino from "pino";

// Vercel's serverless filesystem is read-only outside /tmp, and pino's worker-thread-based
// transports (pino-pretty, pino/file) don't reliably bundle into a traced serverless function
// either — so on Vercel (detected via its own VERCEL env var), log plain JSON straight to
// stdout, which Vercel already captures into its own Logs UI. Local dev keeps the pretty
// console output + logs/app.log file, unchanged.
export const logger = process.env.VERCEL
  ? pino({ level: process.env.LOG_LEVEL || "info" })
  : createLocalLogger();

function createLocalLogger() {
  const logDir = path.resolve(process.cwd(), "logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

  return pino(
    { level: process.env.LOG_LEVEL || "info" },
    pino.transport({
      targets: [
        {
          target: "pino-pretty",
          options: { colorize: true },
          level: "info",
        },
        {
          target: "pino/file",
          options: { destination: path.join(logDir, "app.log") },
          level: "info",
        },
      ],
    }),
  );
}
