import { countPendingSyncOpsByType, getDeviceId, listPendingSyncOps, removePendingSyncOpsById } from '@/lib/sync-queue'

type SyncResult = {
  sent: number
  failed: number
  message: string
}

type SyncErrorState = {
  message: string
  retryable: boolean
  code: 'OFFLINE' | 'MISCONFIG' | 'REMOTE_ERROR' | 'CONFLICT' | 'UNKNOWN'
  at: string
}

type RemoteSyncOperation = {
  id: string
  type: string
  entityId: string
  deviceId: string
  payload: Record<string, unknown>
  createdAt: string
  receivedAt: string
}

type PullResult = {
  pulled: number
  items: RemoteSyncOperation[]
  message: string
}

type SyncAllResult = {
  sent: number
  failed: number
  pulled: number
  items: RemoteSyncOperation[]
  message: string
}

const syncEndpoint = import.meta.env.VITE_SYNC_API_URL
const syncApiKey = import.meta.env.VITE_SYNC_API_KEY
const LAST_PULL_AT_KEY = 'cbta-sync-last-pull-at'
const LAST_SUCCESS_AT_KEY = 'cbta-sync-last-success-at'
const LAST_ERROR_KEY = 'cbta-sync-last-error'
const LAST_ERROR_STATE_KEY = 'cbta-sync-last-error-state'
const MAX_RETRIES = 3
const BACKOFF_BASE_MS = 400

export type SyncStatusSnapshot = {
  lastSuccessfulSyncAt: string | null
  lastSyncError: string | null
  lastSyncErrorState: SyncErrorState | null
  pendingTotal: number
  pendingByType: Record<'STUDENT_CREATE' | 'STUDENT_UPDATE' | 'RECEIPT_CREATE' | 'RECEIPT_REPRINT' | 'CASH_PAYMENT_CREATE' | 'CONCEPT_TARIFF_UPDATE' | 'CONCEPT_SUGGESTED_UPDATE', number>
}

function markSyncSuccess() {
  window.localStorage.setItem(LAST_SUCCESS_AT_KEY, new Date().toISOString())
  window.localStorage.removeItem(LAST_ERROR_KEY)
  window.localStorage.removeItem(LAST_ERROR_STATE_KEY)
}

function markSyncError(message: string, retryable: boolean, code: SyncErrorState['code']) {
  window.localStorage.setItem(LAST_ERROR_KEY, message)
  const state: SyncErrorState = {
    message,
    retryable,
    code,
    at: new Date().toISOString(),
  }
  window.localStorage.setItem(LAST_ERROR_STATE_KEY, JSON.stringify(state))
}

function parseSyncErrorState(raw: string | null) {
  if (!raw) return null
  try {
    return JSON.parse(raw) as SyncErrorState
  } catch {
    return null
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function withRetry<T>(task: () => Promise<T>, canRetry: (error: unknown) => boolean): Promise<T> {
  let attempt = 0
  let lastError: unknown = null

  while (attempt < MAX_RETRIES) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      attempt += 1
      if (attempt >= MAX_RETRIES || !canRetry(error)) {
        throw error
      }
      await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1))
    }
  }

  throw lastError
}

function isConflictResponse(data: unknown) {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return record.conflict === true || record.code === 'REMOTE_NEWER_DATA' || record.errorCode === 'REMOTE_NEWER_DATA'
}

export function getSyncStatusSnapshot(): SyncStatusSnapshot {
  return {
    lastSuccessfulSyncAt: window.localStorage.getItem(LAST_SUCCESS_AT_KEY),
    lastSyncError: window.localStorage.getItem(LAST_ERROR_KEY),
    lastSyncErrorState: parseSyncErrorState(window.localStorage.getItem(LAST_ERROR_STATE_KEY)),
    pendingTotal: listPendingSyncOps().length,
    pendingByType: countPendingSyncOpsByType(),
  }
}

function resolvePullEndpoint() {
  if (!syncEndpoint) return null
  return syncEndpoint.endsWith('/op') ? `${syncEndpoint}s` : `${syncEndpoint}/ops`
}

function getLastPullAt() {
  const saved = window.localStorage.getItem(LAST_PULL_AT_KEY)
  if (!saved) {
    return new Date(0).toISOString()
  }

  const timestamp = new Date(saved)
  if (Number.isNaN(timestamp.getTime())) {
    return new Date(0).toISOString()
  }

  return timestamp.toISOString()
}

export async function syncNow(): Promise<SyncResult> {
  const pending = listPendingSyncOps()

  if (pending.length === 0) {
    markSyncSuccess()
    return { sent: 0, failed: 0, message: 'No hay cambios pendientes por sincronizar.' }
  }

  if (!navigator.onLine) {
    markSyncError('Sin internet. No se pudo sincronizar.', true, 'OFFLINE')
    return { sent: 0, failed: pending.length, message: 'Sin internet. No se pudo sincronizar.' }
  }

  if (!syncEndpoint || !syncApiKey) {
    markSyncError(
      'Falta configurar VITE_SYNC_API_URL o VITE_SYNC_API_KEY para sincronizacion remota por internet.',
      false,
      'MISCONFIG',
    )
    return {
      sent: 0,
      failed: pending.length,
      message:
        'Falta configurar VITE_SYNC_API_URL o VITE_SYNC_API_KEY para sincronizacion remota por internet.',
    }
  }

  const successIds: string[] = []
  let hadConflict = false

  for (const operation of pending) {
    try {
      const response = await withRetry(
        () =>
          fetch(syncEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': syncApiKey },
            body: JSON.stringify(operation),
          }),
        () => navigator.onLine,
      )

      let payload: unknown = null
      try {
        payload = await response.clone().json()
      } catch {
        payload = null
      }

      if (response.ok && isConflictResponse(payload)) {
        hadConflict = true
        continue
      }

      if (!response.ok) {
        continue
      }

      successIds.push(operation.id)
    } catch {
      // network/transient errors are left in queue
    }
  }

  const remaining = removePendingSyncOpsById(successIds)
  const sent = successIds.length
  const failed = remaining.length

  if (sent > 0 && failed === 0) {
    markSyncSuccess()
    return { sent, failed, message: `Sincronizacion completada. ${sent} cambios enviados.` }
  }

  if (sent > 0 && failed > 0) {
    const message = hadConflict
      ? `Se enviaron ${sent} cambios. Quedan ${failed} pendientes por conflicto remoto de datos mas nuevos.`
      : `Se enviaron ${sent} cambios. Quedan ${failed} pendientes.`
    markSyncError(message, true, hadConflict ? 'CONFLICT' : 'REMOTE_ERROR')
    return { sent, failed, message }
  }

  const message = hadConflict
    ? 'No se aplicaron cambios por conflicto: el servidor reporto datos remotos mas nuevos.'
    : 'No se pudo enviar ningun cambio al servidor.'
  markSyncError(message, !hadConflict, hadConflict ? 'CONFLICT' : 'REMOTE_ERROR')
  return { sent: 0, failed, message }
}

export async function pullNow(): Promise<PullResult> {
  if (!navigator.onLine) {
    markSyncError('Sin internet. No se pudo consultar cambios remotos.', true, 'OFFLINE')
    return { pulled: 0, items: [], message: 'Sin internet. No se pudo consultar cambios remotos.' }
  }

  const pullEndpoint = resolvePullEndpoint()
  if (!pullEndpoint || !syncApiKey) {
    markSyncError(
      'Falta configurar VITE_SYNC_API_URL o VITE_SYNC_API_KEY para sincronizacion remota por internet.',
      false,
      'MISCONFIG',
    )
    return {
      pulled: 0,
      items: [],
      message:
        'Falta configurar VITE_SYNC_API_URL o VITE_SYNC_API_KEY para sincronizacion remota por internet.',
    }
  }

  const params = new URLSearchParams({
    since: getLastPullAt(),
    deviceId: getDeviceId(),
  })

  try {
    const response = await withRetry(
      () =>
        fetch(`${pullEndpoint}?${params.toString()}`, {
          method: 'GET',
          headers: { 'x-api-key': syncApiKey },
        }),
      () => navigator.onLine,
    )

    if (!response.ok) {
      markSyncError('No se pudo consultar cambios remotos.', true, 'REMOTE_ERROR')
      return { pulled: 0, items: [], message: 'No se pudo consultar cambios remotos.' }
    }

    const data = (await response.json()) as {
      ok: boolean
      items?: RemoteSyncOperation[]
      serverTime?: string
    }

    const items = Array.isArray(data.items) ? data.items : []
    const conflicts = items.filter((item) => {
      const payload = item.payload as Record<string, unknown>
      return payload?.conflict === true || payload?.errorCode === 'REMOTE_NEWER_DATA'
    })
    const safeItems = items.filter((item) => !conflicts.includes(item))
    if (typeof data.serverTime === 'string' && data.serverTime.length > 0) {
      window.localStorage.setItem(LAST_PULL_AT_KEY, data.serverTime)
    }

    markSyncSuccess()

    return {
      pulled: safeItems.length,
      items: safeItems,
      message:
        conflicts.length > 0
          ? `Se omitieron ${conflicts.length} cambios por conflicto remoto de version mas nueva.`
          : safeItems.length > 0
            ? `Se recibieron ${safeItems.length} cambios remotos.`
            : 'Sin cambios remotos nuevos.',
    }
  } catch {
    markSyncError('No se pudo consultar cambios remotos.', true, 'UNKNOWN')
    return { pulled: 0, items: [], message: 'No se pudo consultar cambios remotos.' }
  }
}

export async function syncAll(): Promise<SyncAllResult> {
  const pushResult = await syncNow()
  const pullResult = await pullNow()

  return {
    sent: pushResult.sent,
    failed: pushResult.failed,
    pulled: pullResult.pulled,
    items: pullResult.items,
    message: `${pushResult.message} ${pullResult.message}`.trim(),
  }
}
