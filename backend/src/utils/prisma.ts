import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = new PrismaClient({
  adapter,
  // Global default for every prisma.$transaction(...) call in the app (interactive
  // transactions only — a plain query has no timeout of its own) — Prisma's own default is
  // maxWait: 2000ms / timeout: 5000ms, sized for a transaction talking to a local/same-region
  // Postgres. Against a higher-latency serverless-to-Neon connection (especially on a cold
  // start), several call sites (fieldHierarchy/fieldOptions/fieldRuleGroup/field/benefitBundle
  // .service.ts) were hitting P2028 "transaction expired" under the default. Bumped once here
  // instead of passing { timeout, maxWait } to every individual $transaction() call — any call
  // site can still override this locally by passing its own options as the 2nd argument.
  transactionOptions: { maxWait: 10000, timeout: 20000 },
});
export { Prisma };

// Either the normal client or a transaction-scoped client (the `tx` a service function
// receives when called from inside another service's `prisma.$transaction(...)`, e.g.
// field.service.ts's composite create/edit running across several tables atomically).
// Every service's bulk "...With(db, ...)" function takes this, so it can run standalone
// OR participate in a caller's own transaction.
export type DbClient = typeof prisma | Prisma.TransactionClient;
