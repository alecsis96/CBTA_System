# AGENTS.md

## Current Repo State
- Single Electron desktop app with React 18, TypeScript, Vite, Prisma, and SQLite.
- Verified project artifacts in the repo include:
  - `roc 2026.xlsx` - official ROC receipt template/reference
  - `Plantilla_Levantamiento_Requerimientos.docx` - interview and requirements gathering template
  - `prisma/schema.prisma` - source of truth for the current data model
- SQLite is local/offline-first. The active development database is `prisma/dev.db`, referenced by `.env` as `DATABASE_URL="file:./dev.db"` relative to `prisma/schema.prisma`.
- Ignore temporary Office lockfiles such as `~$roc 2026.xlsx` and `~$antilla_Levantamiento_Requerimientos.docx`.

## Commands
- Install dependencies: `corepack pnpm install`
- First install after cloning: `corepack pnpm approve-builds --all` to allow required Prisma/Electron/esbuild scripts
- Start desktop app in dev mode: `corepack pnpm dev`
- Validation order: `corepack pnpm typecheck` -> `corepack pnpm exec prisma validate`
- Refresh Prisma client after schema changes: `corepack pnpm exec prisma generate`
- Apply schema to local SQLite DB: `corepack pnpm exec prisma db push`
- Do not run build as routine verification in this repo yet.

## Source Of Truth
- Treat `roc 2026.xlsx` as the current source of truth for the printed ROC layout and visible receipt fields.
- Treat the Word interview template as the current source of truth for discovered business-process questions and requirements gathering structure.
- Treat `package.json`, `vite.config.ts`, `electron/main.ts`, and `prisma/schema.prisma` as executable sources of truth for stack and runtime wiring.
- If docs conflict with implemented code or config, prefer executable sources of truth.

## Project Context
- The urgent MVP is new student intake plus ROC issuance for `Control Escolar` and `Ingresos Propios / Financieros`.
- `Control Escolar` owns student capture and validation. `Ingresos Propios` should select an already validated student, review the prefilled ROC data, choose one or more official concept keys, and print the ROC.
- The system is intended to grow into a larger modular school and financial platform, but the only implemented UI flow right now is the MVP overview for `Control Escolar` and `Ingresos Propios`.
- Do not document or code future modules as if they already exist; keep verified MVP scope separate from planned expansion.

## Architecture Entry Points
- Renderer entry: `src/main.tsx`
- Main desktop shell: `electron/main.ts`
- Electron preload bridge: `electron/preload.ts`
- Electron IPC handlers for renderer-to-Prisma operations: `electron/ipc.ts`
- Baseline catalog seeding on app startup: `electron/seed.ts`
- Current MVP screen composition: `src/App.tsx`
- Prisma client bootstrap lives in `electron/db.ts`.

## Verified Business Constraints
- The system must work without internet.
- Student data originates in `Control Escolar`; financial staff should consume validated student records rather than recapturing them.
- ROC/Folio is an official consecutive number assigned externally.
- ROC output must use the official template; templates are filled automatically, not edited manually.
- Concept selection should come from official keys/catalogs, with tariffs maintained separately.
- `CURP`, `matricula`, and `ROC` are unique identifiers in their respective scopes. Student name is editable and must not be treated as unique.
- Tariffs are maintained separately from concept keys and should be editable only by `Ingresos Propios` responsibility.

## Instructions For Future Agents
- Keep desktop/offline constraints in mind before introducing web-only assumptions or cloud-dependent flows.
- Prefer evolving the Prisma schema and local SQLite model instead of hardcoding business fields in UI components.
- Current student capture and validated-student listing already use Prisma through Electron IPC; continue extending that path instead of reintroducing renderer-only mocks for the same flow.
- Keep this file compact: only add facts that are verified in the repository or required to avoid likely mistakes.
