import 'dotenv/config'
import express = require('express')
import type { Request, Response } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'

const app = express()
const port = Number(process.env.PORT ?? process.env.SYNC_SERVER_PORT ?? '8787')
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

type StoredOperation = z.infer<typeof syncOperationSchema> & { receivedAt: string }

const receivedOperationIds = new Set<string>()
const operationLog: StoredOperation[] = []

const publicPreRegistrationSchema = z.object({
  firstName: z.string().trim().min(1),
  paternalLastName: z.string().trim().min(1),
  maternalLastName: z.string().trim().min(1),
  curp: z.string().trim().toUpperCase().length(18),
  phone: z.string().trim().min(7).max(20),
  addressLine: z.string().trim().min(1),
  guardianFullName: z.string().trim().min(1),
  guardianPhone: z.string().trim().min(7).max(20),
})

let publicPreRegistrationSequence = 0
const publicPreRegistrationSchoolCycle =
  process.env.PUBLIC_PRE_REGISTRATION_SCHOOL_CYCLE?.trim() || '2026-2027'

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-key')

  if (req.method === 'OPTIONS') {
    return res.status(204).send()
  }

  return next()
})

app.get('/', (_req: Request, res: Response) => {
  return res.status(200).json({
    ok: true,
    service: 'cbta-sync-server',
    endpoint: '/api/sync/op',
  })
})

app.get('/health', (_req: Request, res: Response) => {
  return res.status(200).json({ ok: true })
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
        </div>
        <label>Domicilio <input name="addressLine" required /></label>
        <div class="row">
          <label>Nombre tutor <input name="guardianFullName" required /></label>
          <label>Telefono tutor <input name="guardianPhone" required /></label>
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
        addressLine: parsed.data.addressLine,
        schoolCycle: publicPreRegistrationSchoolCycle,
        guardianFullName: parsed.data.guardianFullName,
        guardianPhone: parsed.data.guardianPhone,
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

function isAuthorized(req: Request) {
  const requestKey = req.header('x-api-key')
  return Boolean(syncApiKey && requestKey && requestKey === syncApiKey)
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

app.post('/api/sync/op', (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' })
  }

  const parsed = syncOperationSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'invalid_payload' })
  }

  const operationId = parsed.data.id
  if (!receivedOperationIds.has(operationId)) {
    receivedOperationIds.add(operationId)
    operationLog.push({ ...parsed.data, receivedAt: new Date().toISOString() })
  }

  return res.status(200).json({
    ok: true,
    operationId,
    receivedAt: new Date().toISOString(),
  })
})

app.listen(port, () => {
  console.log(`[sync-server] listening on port ${port}`)
})
