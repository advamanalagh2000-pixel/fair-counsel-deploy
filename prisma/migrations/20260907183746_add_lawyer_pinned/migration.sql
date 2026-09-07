-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Lawyer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "init" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "specs" TEXT NOT NULL DEFAULT '[]',
    "city" TEXT NOT NULL DEFAULT '',
    "langs" TEXT NOT NULL DEFAULT '[]',
    "experienceYears" INTEGER NOT NULL DEFAULT 0,
    "badge" TEXT NOT NULL DEFAULT 'verified',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "consultationsCompleted" INTEGER NOT NULL DEFAULT 0,
    "feePaise" INTEGER NOT NULL DEFAULT 0,
    "bar" TEXT NOT NULL DEFAULT '',
    "bio" TEXT NOT NULL DEFAULT '',
    "turnaround" TEXT NOT NULL DEFAULT '',
    "starting" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rejectionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Lawyer" ("badge", "bar", "bio", "city", "consultationsCompleted", "createdAt", "email", "experienceYears", "feePaise", "id", "init", "langs", "name", "phone", "rejectionReason", "specs", "starting", "status", "tags", "turnaround", "updatedAt") SELECT "badge", "bar", "bio", "city", "consultationsCompleted", "createdAt", "email", "experienceYears", "feePaise", "id", "init", "langs", "name", "phone", "rejectionReason", "specs", "starting", "status", "tags", "turnaround", "updatedAt" FROM "Lawyer";
DROP TABLE "Lawyer";
ALTER TABLE "new_Lawyer" RENAME TO "Lawyer";
CREATE UNIQUE INDEX "Lawyer_phone_key" ON "Lawyer"("phone");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
