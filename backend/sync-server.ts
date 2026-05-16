import 'dotenv/config'
import express = require('express')
import type { Request, Response } from 'express'
import { z } from 'zod'

const app = express()
const port = Number(process.env.SYNC_SERVER_PORT ?? '8787')
const syncApiKey = process.env.SYNC_API_KEY

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

const receivedOperationIds = new Set<string>()

app.use(express.json())

app.post('/api/sync/op', (req: Request, res: Response) => {
  const requestKey = req.header('x-api-key')

  if (!syncApiKey || !requestKey || requestKey !== syncApiKey) {
    return res.status(401).json({ ok: false, error: 'unauthorized' })
  }

  const parsed = syncOperationSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'invalid_payload' })
  }

  const operationId = parsed.data.id
  if (!receivedOperationIds.has(operationId)) {
    receivedOperationIds.add(operationId)
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
