/// <reference types="node" />
// prisma/scripts/deleteUserByEmail.ts
//
// One-off ops script: permanently deletes a single user and all their field answers.
// Defaults to a DRY RUN (prints what would be deleted, deletes nothing) — pass --confirm
// to actually run it. Usage:
//   npx tsx prisma/scripts/deleteUserByEmail.ts someone@example.com            (dry run)
//   npx tsx prisma/scripts/deleteUserByEmail.ts someone@example.com --confirm  (deletes)

import { prisma, Prisma } from "../../src/utils/prisma.js";

async function main() {
  const email = process.argv[2];
  const confirm = process.argv.includes("--confirm");

  if (!email) {
    console.error("Usage: npx tsx prisma/scripts/deleteUserByEmail.ts <email> [--confirm]");
    process.exit(1);
  }

  const user = await prisma.dimUser.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email "${email}".`);
    process.exit(1);
  }

  const [answerCount, answerGroupCount] = await Promise.all([
    prisma.fctUserFieldAnswer.count({ where: { userId: user.id } }),
    prisma.fctUserFieldAnswerGroup.count({ where: { userId: user.id } }),
  ]);

  console.log(`User: ${user.firstName} ${user.lastName} <${user.email}> (id: ${user.id}, role: ${user.role})`);
  console.log(`Field answers to delete: ${answerCount}`);
  console.log(`Field answer groups to delete: ${answerGroupCount}`);

  if (!confirm) {
    console.log("\nDRY RUN — nothing deleted. Re-run with --confirm to actually delete.");
    process.exit(0);
  }

  try {
    await prisma.$transaction([
      prisma.fctUserFieldAnswer.deleteMany({ where: { userId: user.id } }),
      prisma.fctUserFieldAnswerGroup.deleteMany({ where: { userId: user.id } }),
      prisma.dimUser.delete({ where: { id: user.id } }),
    ]);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      console.error(
        `\nDelete failed: "${email}" is still referenced elsewhere (e.g. as createdBy/updatedBy on a ` +
          `benefit, field, or other admin resource — likely means this account was used to create ` +
          `content, not just answer fields). Reassign or clear those references before deleting the user.`,
      );
      process.exit(1);
    }
    throw error;
  }

  console.log(`\nDeleted user "${email}" and ${answerCount} answer(s) / ${answerGroupCount} answer group(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
