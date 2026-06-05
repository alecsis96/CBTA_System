import 'dotenv/config'
import express = require('express')
import type { Request, Response } from 'express'
import { z } from 'zod'
import { Prisma } from '../prisma/generated/backend-client'
import { prisma } from './prisma'
import {
  cancelReceipt,
  createPayment,
  createStudent,
  exportMonthlyReceipts,
  generateBatch,
  getRocConfig,
  getNextRocNumberSuggestion,
  getNextInternalFolioPreview,
  getStudent,
  listConcepts,
  listPayments,
  listReceipts,
  listReceiptsByStudent,
  listRecentAuditLogs,
  listStudents,
  updateRocConfig,
  updateConceptSuggested,
  updateConceptTariff,
  updateStudent,
} from './hybrid-store'
import { ensureBackendBaseData } from './seed-backend'

const app = express()
const port = Number(process.env.PORT ?? process.env.SYNC_SERVER_PORT ?? '8787')
const host = process.env.SYNC_SERVER_HOST?.trim() || '0.0.0.0'
const syncApiKey = process.env.SYNC_API_KEY
const corsAllowedOrigins = (process.env.SYNC_CORS_ORIGINS ?? '*')
  .split(',')
  .map((item) => item.trim())
  .filter((item) => item.length > 0)

const allowedTypes = [
  'STUDENT_CREATE',
  'STUDENT_UPDATE',
  'RECEIPT_CREATE',
  'RECEIPT_REPRINT',
  'CASH_PAYMENT_CREATE',
  'CONCEPT_TARIFF_UPDATE',
  'CONCEPT_SUGGESTED_UPDATE',
] as const

const syncOperationSchema = z.object({
  id: z.string().min(1),
  type: z.enum(allowedTypes),
  entityId: z.string().min(1),
  deviceId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
})

const pullQuerySchema = z.object({
  since: z.string().datetime(),
  deviceId: z.string().min(1),
})

const remoteActorSchema = z.object({
  username: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  role: z.string().trim().min(1),
})

const remoteStudentInputSchema = z.object({
  enrollmentNumber: z.string().trim().optional().default(''),
  curp: z.string().trim().min(1),
  rfc: z.string().trim().optional().default(''),
  firstName: z.string().trim().min(1),
  paternalLastName: z.string().trim().min(1),
  maternalLastName: z.string().trim().min(1),
  birthDate: z.string().optional().default(''),
  age: z.number().int().nullable().optional().default(null),
  sex: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  studentPhoneSecondary: z.string().optional().default(''),
  email: z.string().optional().default(''),
  motherTongue: z.string().optional().default(''),
  addressLine: z.string().trim().min(1),
  neighborhood: z.string().optional().default(''),
  locality: z.string().optional().default(''),
  municipality: z.string().optional().default(''),
  state: z.string().optional().default(''),
  postalCode: z.string().optional().default(''),
  previousSchool: z.string().optional().default(''),
  secondaryAverage: z.number().nullable().optional().default(null),
  examRoom: z.string().optional().default(''),
  schoolCycle: z.string().trim().min(1),
  academicStatus: z.string().optional().default(''),
  guardianFullName: z.string().trim().min(1),
  guardianRelationship: z.string().optional().default(''),
  guardianPhone: z.string().trim().min(1),
  guardianPhoneSecondary: z.string().optional().default(''),
  guardianEmail: z.string().optional().default(''),
  validateNow: z.boolean().default(true),
})

const remoteTariffInputSchema = z.object({
  code: z.string().trim().min(1),
  amount: z.number().nonnegative(),
  periodLabel: z.string().trim().min(1),
})

const remoteSuggestedInputSchema = z.object({
  code: z.string().trim().min(1),
  isSuggested: z.boolean(),
})

const remotePaymentCreateSchema = z.object({
  studentId: z.string().trim().min(1),
  conceptItems: z.array(z.object({ code: z.string().trim().min(1), amount: z.number().nonnegative() })).min(1),
  notes: z.string().optional(),
})

const remotePaymentBatchSchema = z.object({
  paymentIds: z.array(z.string().trim().min(1)).min(1),
  startingRocNumber: z.string().trim().min(1),
})

const remoteMonthlyReceiptSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
})

const remoteRocConfigSchema = z.object({
  initialRocNumber: z.string().trim().min(1),
})

const remoteCancelReceiptSchema = z.object({
  receiptId: z.string().min(1),
  reason: z.string().trim().min(3),
})

type StoredOperation = z.infer<typeof syncOperationSchema> & { receivedAt: string }

const receivedOperationIds = new Set<string>()
const operationLog: StoredOperation[] = []

const publicPreRegistrationSchema = z.object({
  firstName: z.string().trim().min(1),
  paternalLastName: z.string().trim().min(1),
  maternalLastName: z.string().trim().min(1),
  curp: z.string().trim().toUpperCase().length(18),
  phone: z.string().trim().min(7).max(20),
  studentPhoneSecondary: z.string().trim().max(20).optional(),
  motherTongue: z.string().trim().optional(),
  addressLine: z.string().trim().min(1),
  examRoom: z.string().trim().optional(),
  guardianFullName: z.string().trim().min(1),
  guardianPhone: z.string().trim().min(7).max(20),
  guardianPhoneSecondary: z.string().trim().max(20).optional(),
})

function normalizeOptional(value: string | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

let publicPreRegistrationSequence = 0
const publicPreRegistrationSchoolCycle =
  process.env.PUBLIC_PRE_REGISTRATION_SCHOOL_CYCLE?.trim() || '2026-2027'

app.set('trust proxy', true)
app.use(express.json())

app.use((req: Request, res: Response, next) => {
  const origin = req.header('origin')
  const allowAny = corsAllowedOrigins.includes('*')

  if (allowAny) {
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else if (origin && corsAllowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-key,x-device-id,x-actor-username,x-actor-name,x-actor-role')

  if (req.method === 'OPTIONS') {
    return res.status(204).send()
  }

  return next()
})

app.get('/', (_req: Request, res: Response) => {
  return res.status(200).json({
    ok: true,
    service: 'cbta-sync-server',
    mode: 'shared-cloud-ready',
    endpoint: '/api/sync/op',
    health: '/healthz',
  })
})

app.get('/healthz', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    return res.status(200).json({
      ok: true,
      status: 'healthy',
      database: 'reachable',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return res.status(503).json({
      ok: false,
      status: 'degraded',
      database: 'unreachable',
      error: error instanceof Error ? error.message : 'db_unreachable',
      timestamp: new Date().toISOString(),
    })
  }
})

function maskCurp(curp: string) {
  const normalized = curp.trim().toUpperCase()
  if (normalized.length <= 8) {
    return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`
  }

  return `${normalized.slice(0, 4)}******${normalized.slice(-4)}`
}

function createPublicPreRegistrationFolio(now: Date) {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  publicPreRegistrationSequence += 1
  const sequence = String(publicPreRegistrationSequence).padStart(4, '0')
  return `PR-${stamp}-${sequence}`
}

type PublicPreRegistrationVoucherRecord = {
  folio: string
  status: string
  submittedAt: Date | null
  firstName: string
  paternalLastName: string
  maternalLastName: string
  curp: string
  phone: string | null
  guardianFullName: string
}

function buildPublicPreRegistrationSummary(record: PublicPreRegistrationVoucherRecord) {
  return {
    folio: record.folio,
    status: record.status,
    submittedAt: (record.submittedAt ?? new Date()).toISOString(),
    studentFullName: [record.firstName, record.paternalLastName, record.maternalLastName]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
    curpMasked: maskCurp(record.curp),
    phone: record.phone ?? '',
    guardianFullName: record.guardianFullName,
  }
}

const publicPreRegistrationHtml = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pre-registro CBTA</title>
  <style>
    body { font-family: sans-serif; margin: 0; background: #f5f7fb; color: #111827; }
    .container { max-width: 760px; margin: 0 auto; padding: 24px 16px 40px; }
    .card { background: #fff; border: 1px solid #d1d5db; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    h1 { font-size: 1.5rem; margin: 0 0 12px; }
    p { margin: 0 0 12px; }
    form { display: grid; gap: 10px; }
    label { display: grid; gap: 4px; font-size: 0.95rem; }
    input { border: 1px solid #9ca3af; border-radius: 6px; padding: 8px; font-size: 0.95rem; }
    button { border: 0; background: #0f766e; color: #fff; border-radius: 6px; padding: 10px 14px; cursor: pointer; font-size: 0.95rem; }
    button.secondary { background: #334155; }
    .row { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
    .hidden { display: none; }
    .error { color: #b91c1c; }
    .voucher-line { margin: 6px 0; }
  </style>
</head>
<body>
  <main class="container">
    <section class="card">
      <h1>Pre-registro publico</h1>
      <p>Completá los datos del alumno y tutor para generar el voucher de pre-registro.</p>
      <form id="preRegForm">
        <div class="row">
          <label>Nombre(s) <input name="firstName" required /></label>
          <label>Apellido paterno <input name="paternalLastName" required /></label>
          <label>Apellido materno <input name="maternalLastName" required /></label>
        </div>
        <div class="row">
          <label>CURP (18 caracteres) <input name="curp" maxlength="18" minlength="18" required /></label>
          <label>Telefono alumno <input name="phone" required /></label>
          <label>Telefono alumno alterno <input name="studentPhoneSecondary" type="tel" /></label>
        </div>
        <div class="row">
          <label>Lengua materna <input name="motherTongue" /></label>
          <label>Salon de examen <input name="examRoom" /></label>
        </div>
        <label>Domicilio <input name="addressLine" required /></label>
        <div class="row">
          <label>Nombre tutor <input name="guardianFullName" required /></label>
          <label>Telefono tutor <input name="guardianPhone" required /></label>
          <label>Telefono tutor alterno <input name="guardianPhoneSecondary" type="tel" /></label>
        </div>
        <button type="submit">Enviar pre-registro</button>
        <p id="error" class="error"></p>
      </form>
    </section>

    <section id="voucher" class="card hidden">
      <h2>Voucher</h2>
      <p class="voucher-line"><strong>Folio:</strong> <span id="folio"></span></p>
      <p class="voucher-line"><strong>Alumno:</strong> <span id="studentFullName"></span></p>
      <p class="voucher-line"><strong>CURP:</strong> <span id="curpMasked"></span></p>
      <p class="voucher-line"><strong>Estatus:</strong> <span id="status"></span></p>
      <p class="voucher-line"><strong>Enviado:</strong> <span id="submittedAt"></span></p>
      <p>Presentate en Control Escolar con este folio para seguimiento.</p>
      <button id="printVoucher" class="secondary" type="button">Imprimir voucher</button>
    </section>
  </main>

  <script>
    const form = document.getElementById('preRegForm');
    const errorEl = document.getElementById('error');
    const voucherEl = document.getElementById('voucher');
    const fieldIds = ['folio', 'studentFullName', 'curpMasked', 'status', 'submittedAt'];
    const printBtn = document.getElementById('printVoucher');

    printBtn.addEventListener('click', () => window.print());

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorEl.textContent = '';

      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());

      try {
        const response = await fetch('/api/public/pre-registrations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.error || 'No se pudo crear el pre-registro.');
        }

        const summary = data.summary || {};
        fieldIds.forEach((key) => {
          const target = document.getElementById(key);
          if (target) {
            target.textContent = summary[key] || '';
          }
        });

        voucherEl.classList.remove('hidden');
      } catch (error) {
        errorEl.textContent = error instanceof Error ? error.message : 'Error inesperado';
      }
    });
  </script>
</body>
</html>`

app.get('/pre-registro', (_req: Request, res: Response) => {
  return res.status(200).type('html').send(publicPreRegistrationHtml)
})

app.post('/api/public/pre-registrations', async (req: Request, res: Response) => {
  const parsed = publicPreRegistrationSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'invalid_payload' })
  }

  const submittedAt = new Date()
  const folio = createPublicPreRegistrationFolio(submittedAt)

  try {
    const created = await prisma.preRegistration.create({
      data: {
        folio,
        status: 'PRE_REGISTRO_ENVIADO',
        firstName: parsed.data.firstName,
        paternalLastName: parsed.data.paternalLastName,
        maternalLastName: parsed.data.maternalLastName,
        curp: parsed.data.curp,
        phone: parsed.data.phone,
        studentPhoneSecondary: normalizeOptional(parsed.data.studentPhoneSecondary),
        motherTongue: normalizeOptional(parsed.data.motherTongue),
        addressLine: parsed.data.addressLine,
        examRoom: normalizeOptional(parsed.data.examRoom),
        schoolCycle: publicPreRegistrationSchoolCycle,
        guardianFullName: parsed.data.guardianFullName,
        guardianPhone: parsed.data.guardianPhone,
        guardianPhoneSecondary: normalizeOptional(parsed.data.guardianPhoneSecondary),
        voucherGeneratedAt: submittedAt,
        submittedAt,
      },
      select: {
        folio: true,
        status: true,
        submittedAt: true,
        firstName: true,
        paternalLastName: true,
        maternalLastName: true,
        curp: true,
        phone: true,
        guardianFullName: true,
      },
    })

    return res.status(201).json({
      ok: true,
      folio: created.folio,
      summary: buildPublicPreRegistrationSummary(created),
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ ok: false, error: 'duplicate_pre_registration' })
    }

    return res.status(500).json({ ok: false, error: 'internal_error' })
  }
})

app.get('/api/public/pre-registrations/:folio/voucher', async (req: Request, res: Response) => {
  const rawFolio = req.params.folio
  const folio = typeof rawFolio === 'string' ? rawFolio.trim() : ''
  if (!folio) {
    return res.status(400).json({ ok: false, error: 'invalid_folio' })
  }

  const record = await prisma.preRegistration.findUnique({
    where: { folio },
    select: {
      folio: true,
      status: true,
      submittedAt: true,
      firstName: true,
      paternalLastName: true,
      maternalLastName: true,
      curp: true,
      phone: true,
      guardianFullName: true,
    },
  })

  if (!record) {
    return res.status(404).json({ ok: false, error: 'not_found' })
  }

  return res.status(200).json({
    ok: true,
    voucher: {
      ...buildPublicPreRegistrationSummary(record),
      instructions: 'Presentate en Control Escolar y conserva este voucher.',
    },
  })
})

app.get('/api/hybrid/health', (_req: Request, res: Response) => {
  return res.status(200).json({ ok: true, mode: 'hybrid-online' })
})

app.get('/api/hybrid/students', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const validatedOnly = req.query.validatedOnly === 'true'
  const items = await listStudents(validatedOnly)
  return res.status(200).json({ ok: true, items })
})

app.get('/api/hybrid/students/next-folio-preview', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const nextFolio = await getNextInternalFolioPreview()
  return res.status(200).json({ ok: true, nextFolio })
})

app.get('/api/hybrid/students/:id', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const studentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
  const student = await getStudent(studentId)
  if (!student) return res.status(404).json({ ok: false, error: 'not_found' })
  return res.status(200).json({ ok: true, student })
})

app.post('/api/hybrid/students', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const parsed = remoteStudentInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'invalid_payload' })
  try {
    const actor = await resolveRemoteActor(req)
    const student = await createStudent(parsed.data, actor)
    recordOperation(buildServerOperation('STUDENT_CREATE', student.id, req.header('x-device-id') ?? 'remote-api', { studentId: student.id }))
    return res.status(201).json({ ok: true, student })
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'create_failed' })
  }
})

app.put('/api/hybrid/students/:id', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const parsed = remoteStudentInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'invalid_payload' })
  try {
    const actor = await resolveRemoteActor(req)
    const studentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const student = await updateStudent(studentId, parsed.data, actor)
    recordOperation(buildServerOperation('STUDENT_UPDATE', student.id, req.header('x-device-id') ?? 'remote-api', { studentId: student.id }))
    return res.status(200).json({ ok: true, student })
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'update_failed' })
  }
})

app.get('/api/hybrid/concepts', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const items = await listConcepts()
  return res.status(200).json({ ok: true, items })
})

app.patch('/api/hybrid/concepts/:code/tariff', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const parsed = remoteTariffInputSchema.safeParse({ ...req.body, code: req.params.code })
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'invalid_payload' })
  try {
    const actor = await resolveRemoteActor(req)
    const concept = await updateConceptTariff(parsed.data, actor)
    recordOperation(buildServerOperation('CONCEPT_TARIFF_UPDATE', concept.code, req.header('x-device-id') ?? 'remote-api', parsed.data as unknown as Record<string, unknown>))
    return res.status(200).json({ ok: true, concept })
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'tariff_failed' })
  }
})

app.patch('/api/hybrid/concepts/:code/suggested', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const parsed = remoteSuggestedInputSchema.safeParse({ ...req.body, code: req.params.code })
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'invalid_payload' })
  try {
    const actor = await resolveRemoteActor(req)
    const concept = await updateConceptSuggested(parsed.data, actor)
    recordOperation(buildServerOperation('CONCEPT_SUGGESTED_UPDATE', concept.code, req.header('x-device-id') ?? 'remote-api', parsed.data as unknown as Record<string, unknown>))
    return res.status(200).json({ ok: true, concept })
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'suggested_failed' })
  }
})

app.get('/api/hybrid/payments', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  const items = await listPayments(status as 'PENDIENTE_ROC' | 'ROC_GENERADO' | undefined)
  return res.status(200).json({ ok: true, items })
})

app.post('/api/hybrid/payments', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const parsed = remotePaymentCreateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'invalid_payload' })
  try {
    const actor = await resolveRemoteActor(req)
    const payment = await createPayment(parsed.data, actor)
    recordOperation(buildServerOperation('CASH_PAYMENT_CREATE', payment.id, req.header('x-device-id') ?? 'remote-api', parsed.data as unknown as Record<string, unknown>))
    return res.status(201).json({ ok: true, payment })
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'payment_failed' })
  }
})

app.post('/api/hybrid/payments/batch', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const parsed = remotePaymentBatchSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'invalid_payload' })
  try {
    const actor = await resolveRemoteActor(req)
    const result = await generateBatch(parsed.data, actor)
    recordOperation(buildServerOperation('RECEIPT_CREATE', parsed.data.paymentIds.join(','), req.header('x-device-id') ?? 'remote-api', { count: result.createdCount }))
    return res.status(200).json({ ok: true, result })
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'batch_failed' })
  }
})

app.get('/api/hybrid/receipts', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const studentId = typeof req.query.studentId === 'string' ? req.query.studentId : ''
  const items = studentId ? await listReceiptsByStudent(studentId) : await listReceipts()
  return res.status(200).json({ ok: true, items })
})

app.get('/api/hybrid/receipts/next-roc', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  try {
    const result = await getNextRocNumberSuggestion()
    return res.status(200).json({ ok: true, result })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'next_roc_failed' })
  }
})

app.get('/api/hybrid/receipts/config', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  try {
    const result = await getRocConfig()
    return res.status(200).json({ ok: true, result })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'roc_config_failed' })
  }
})

app.post('/api/hybrid/receipts/config', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const parsed = remoteRocConfigSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'invalid_payload' })
  try {
    const result = await updateRocConfig(parsed.data)
    return res.status(200).json({ ok: true, result })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'roc_config_update_failed' })
  }
})

app.post('/api/hybrid/receipts/cancel', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const parsed = remoteCancelReceiptSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'invalid_payload' })
  try {
    const actor = await resolveRemoteActor(req)
    const result = await cancelReceipt(parsed.data, actor)
    return res.status(200).json({ ok: true, result })
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'receipt_cancel_failed' })
  }
})

app.post('/api/hybrid/receipts/monthly', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const parsed = remoteMonthlyReceiptSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'invalid_payload' })
  try {
    const result = await exportMonthlyReceipts(parsed.data)
    return res.status(200).json({ ok: true, result })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'monthly_export_failed' })
  }
})

app.get('/api/hybrid/audit', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' })
  const items = await listRecentAuditLogs()
  return res.status(200).json({ ok: true, items })
})


function isAuthorized(req: Request) {
  const requestKey = req.header('x-api-key')
  return Boolean(syncApiKey && requestKey && requestKey === syncApiKey)
}

async function resolveRemoteActor(req: Request) {
  const parsed = remoteActorSchema.safeParse({
    username: req.header('x-actor-username') ?? 'remote.sync',
    displayName: req.header('x-actor-name') ?? 'Sincronizacion remota',
    role: req.header('x-actor-role') ?? 'ADMIN',
  })

  const actor = parsed.success ? parsed.data : { username: 'remote.sync', displayName: 'Sincronizacion remota', role: 'ADMIN' }

  return prisma.user.upsert({
    where: { username: actor.username },
    update: { displayName: actor.displayName, role: actor.role, isActive: true },
    create: { username: actor.username, displayName: actor.displayName, role: actor.role, passwordHash: '' },
    select: { id: true, username: true, displayName: true, role: true },
  })
}

function recordOperation(operation: z.infer<typeof syncOperationSchema>) {
  if (!receivedOperationIds.has(operation.id)) {
    receivedOperationIds.add(operation.id)
    operationLog.push({ ...operation, receivedAt: new Date().toISOString() })
  }
}

function buildServerOperation(type: (typeof allowedTypes)[number], entityId: string, deviceId: string, payload: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    type,
    entityId,
    deviceId,
    payload,
    createdAt: new Date().toISOString(),
  }
}

async function applySyncOperation(operation: z.infer<typeof syncOperationSchema>) {
  const actor = await prisma.user.upsert({
    where: { username: `sync.${operation.deviceId}` },
    update: { displayName: `Sync ${operation.deviceId}`, role: 'ADMIN', isActive: true },
    create: { username: `sync.${operation.deviceId}`, displayName: `Sync ${operation.deviceId}`, role: 'ADMIN', passwordHash: '' },
    select: { id: true, username: true, displayName: true, role: true },
  })

  if (operation.type === 'STUDENT_CREATE') {
    const payload = operation.payload as { student?: unknown }
    await createStudent(remoteStudentInputSchema.parse(payload.student), actor)
    return
  }

  if (operation.type === 'STUDENT_UPDATE') {
    const payload = operation.payload as { studentId?: unknown; student?: unknown }
    await updateStudent(z.string().min(1).parse(payload.studentId), remoteStudentInputSchema.parse(payload.student), actor)
    return
  }

  if (operation.type === 'CASH_PAYMENT_CREATE') {
    await createPayment(remotePaymentCreateSchema.parse(operation.payload), actor)
    return
  }

  if (operation.type === 'CONCEPT_TARIFF_UPDATE') {
    await updateConceptTariff(remoteTariffInputSchema.parse(operation.payload), actor)
    return
  }

  if (operation.type === 'CONCEPT_SUGGESTED_UPDATE') {
    await updateConceptSuggested(remoteSuggestedInputSchema.parse(operation.payload), actor)
  }
}

app.get('/api/sync/ops', (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' })
  }

  const parsedQuery = pullQuerySchema.safeParse(req.query)
  if (!parsedQuery.success) {
    return res.status(400).json({ ok: false, error: 'invalid_query' })
  }

  const sinceDate = new Date(parsedQuery.data.since)
  const items = operationLog.filter(
    (item) => new Date(item.receivedAt) > sinceDate && item.deviceId !== parsedQuery.data.deviceId,
  )

  return res.status(200).json({
    ok: true,
    items,
    serverTime: new Date().toISOString(),
  })
})

app.post('/api/sync/op', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' })
  }

  const parsed = syncOperationSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'invalid_payload' })
  }

  const operationId = parsed.data.id

  try {
    if (!receivedOperationIds.has(operationId)) {
      await applySyncOperation(parsed.data)
      recordOperation(parsed.data)
    }

    return res.status(200).json({
      ok: true,
      operationId,
      receivedAt: new Date().toISOString(),
    })
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'sync_apply_failed',
    })
  }
})

async function startServer() {
  await ensureBackendBaseData()

  app.listen(port, host, () => {
    console.log(`[sync-server] listening on http://${host}:${port}`)
  })
}

void startServer().catch((error) => {
  console.error('[sync-server] Startup failed before listen.', error)
  process.exit(1)
})
