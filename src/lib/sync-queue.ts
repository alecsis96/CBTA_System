export type SyncOperationType =
  | 'STUDENT_CREATE'
  | 'STUDENT_UPDATE'
  | 'RECEIPT_CREATE'
  | 'RECEIPT_REPRINT'
  | 'CASH_PAYMENT_CREATE'
  | 'CONCEPT_TARIFF_UPDATE'
  | 'CONCEPT_SUGGESTED_UPDATE'

export type SyncOperation = {
  id: string
  type: SyncOperationType
  entityId: string
  payload: Record<string, unknown>
  deviceId: string
  createdAt: string
}

const SYNC_QUEUE_KEY = 'cbta-sync-pending-ops'
const DEVICE_ID_KEY = 'cbta-sync-device-id'

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function listPendingSyncOps() {
  return safeParse<SyncOperation[]>(window.localStorage.getItem(SYNC_QUEUE_KEY), [])
}

export function countPendingSyncOpsByType() {
  const counts: Record<SyncOperationType, number> = {
    STUDENT_CREATE: 0,
    STUDENT_UPDATE: 0,
    RECEIPT_CREATE: 0,
    RECEIPT_REPRINT: 0,
    CASH_PAYMENT_CREATE: 0,
    CONCEPT_TARIFF_UPDATE: 0,
    CONCEPT_SUGGESTED_UPDATE: 0,
  }

  for (const operation of listPendingSyncOps()) {
    counts[operation.type] += 1
  }

  return counts
}

export function addPendingSyncOp(input: Omit<SyncOperation, 'id' | 'createdAt'>) {
  const queue = listPendingSyncOps()
  const next: SyncOperation = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }

  queue.unshift(next)
  window.localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue))
  return next
}

export function getDeviceId() {
  const existing = window.localStorage.getItem(DEVICE_ID_KEY)
  if (existing && existing.trim().length > 0) {
    return existing
  }

  const next = crypto.randomUUID()
  window.localStorage.setItem(DEVICE_ID_KEY, next)
  return next
}

export function clearPendingSyncOps() {
  window.localStorage.removeItem(SYNC_QUEUE_KEY)
}

export function removePendingSyncOpsById(ids: string[]) {
  if (ids.length === 0) {
    return listPendingSyncOps()
  }

  const idSet = new Set(ids)
  const filtered = listPendingSyncOps().filter((item) => !idSet.has(item.id))
  window.localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(filtered))
  return filtered
}
