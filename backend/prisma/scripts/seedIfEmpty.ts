// Dev-container bootstrap only (see backend/Dockerfile's CMD) — runs after `prisma migrate
// deploy` on every container start. Seeding isn't idempotent (it inserts, doesn't upsert),
// so re-running it against an already-seeded DB would throw unique-constraint errors on
// every `docker compose up` after the first. Gating on "any user exists yet" makes a fresh
// clone self-seed on first boot while every later restart is a safe no-op.
import { execSync } from "node:child_process";
import { prisma } from "../../src/utils/prisma.js";

const userCount = await prisma.dimUser.count();
await prisma.$disconnect();

if (userCount > 0) {
  console.log(`[seed] ${userCount} user(s) already in the database — skipping seed.`);
  process.exit(0);
}

console.log("[seed] Database is empty — seeding reference data + demo accounts...");
execSync("npx prisma db seed", { stdio: "inherit" });
