import { PrismaClient } from '@prisma/client'

type SqliteColumnRow = {
  name: string
}

type SqliteIndexRow = {
  name: string
}

async function listTableColumns(prisma: PrismaClient, tableName: string) {
  const rows = await prisma.$queryRawUnsafe<SqliteColumnRow[]>(`PRAGMA table_info("${tableName}")`)
  return new Set(rows.map((row) => row.name))
}

async function listTableIndexes(prisma: PrismaClient, tableName: string) {
  const rows = await prisma.$queryRawUnsafe<SqliteIndexRow[]>(`PRAGMA index_list("${tableName}")`)
  return new Set(rows.map((row) => row.name))
}

async function tableExists(prisma: PrismaClient, tableName: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}' LIMIT 1`,
  )
  return rows.length > 0
}

export async function ensureLocalDbCompatibility() {
  const prisma = new PrismaClient()

  try {
    const studentColumns = await listTableColumns(prisma, 'Student')
    if (!studentColumns.has('semesterLevel')) {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "Student" ADD COLUMN "semesterLevel" INTEGER NOT NULL DEFAULT 1',
      )
      console.info('[db] Added missing Student.semesterLevel column to local SQLite database.')
    }

    const intakeGroupColumns = await listTableColumns(prisma, 'IntakeGroup')
    if (!intakeGroupColumns.has('semesterLevel')) {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "IntakeGroup" ADD COLUMN "semesterLevel" INTEGER NOT NULL DEFAULT 1',
      )
      console.info('[db] Added missing IntakeGroup.semesterLevel column to local SQLite database.')
    }

    if (!intakeGroupColumns.has('advisorName')) {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "IntakeGroup" ADD COLUMN "advisorName" TEXT',
      )
      console.info('[db] Added missing IntakeGroup.advisorName column to local SQLite database.')
    }

    const intakeGroupIndexes = await listTableIndexes(prisma, 'IntakeGroup')
    if (intakeGroupIndexes.has('IntakeGroup_schoolCycle_label_shift_key')) {
      await prisma.$executeRawUnsafe('DROP INDEX "IntakeGroup_schoolCycle_label_shift_key"')
      console.info('[db] Removed legacy IntakeGroup unique index without semesterLevel.')
    }

    if (!intakeGroupIndexes.has('IntakeGroup_schoolCycle_semesterLevel_label_shift_key')) {
      await prisma.$executeRawUnsafe(
        'CREATE UNIQUE INDEX IF NOT EXISTS "IntakeGroup_schoolCycle_semesterLevel_label_shift_key" ON "IntakeGroup"("schoolCycle", "semesterLevel", "label", "shift")',
      )
      console.info('[db] Ensured IntakeGroup unique index with semesterLevel.')
    }

    if (!(await tableExists(prisma, 'StudentAcademicMovement'))) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "StudentAcademicMovement" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "studentId" TEXT NOT NULL,
          "movementType" TEXT NOT NULL,
          "reasonCode" TEXT NOT NULL,
          "reasonLabel" TEXT NOT NULL,
          "notes" TEXT,
          "previousSemesterLevel" INTEGER,
          "nextSemesterLevel" INTEGER,
          "previousGroupId" TEXT,
          "previousGroupLabel" TEXT,
          "nextGroupId" TEXT,
          "nextGroupLabel" TEXT,
          "previousEnrollmentStatus" TEXT,
          "nextEnrollmentStatus" TEXT,
          "effectiveDate" DATETIME,
          "actorId" TEXT,
          "actorRole" TEXT NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "StudentAcademicMovement_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "StudentAcademicMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
        )
      `)
      console.info('[db] Created missing StudentAcademicMovement table in local SQLite database.')
    }
  } finally {
    await prisma.$disconnect()
  }
}
