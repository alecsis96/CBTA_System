import { countPendingSyncOpsByType, getDeviceId, listPendingSyncOps, removePendingSyncOpsById } from '@/lib/sync-queue'

type SyncResult = {
  sent: number
  failed: number
  message: string
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

export type SyncStatusSnapshot = {
  lastSuccessfulSyncAt: string | null
  lastSyncError: string | null
  pendingTotal: number
  pendingByType: Record<'STUDENT_CREATE' | 'STUDENT_UPDATE' | 'RECEIPT_CREATE' | 'RECEIPT_REPRINT', number>
}

function markSyncSuccess() {
  window.localStorage.setItem(LAST_SUCCESS_AT_KEY, new Date().toISOString())
  window.localStorage.removeItem(LAST_ERROR_KEY)
}

function markSyncError(message: string) {
  window.localStorage.setItem(LAST_ERROR_KEY, message)
}

export function getSyncStatusSnapshot(): SyncStatusSnapshot {
  return {
    lastSuccessfulSyncAt: window.localStorage.getItem(LAST_SUCCESS_AT_KEY),
    lastSyncError: window.localStorage.getItem(LAST_ERROR_KEY),
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
    markSyncError('Sin internet. No se pudo sincronizar.')
    return { sent: 0, failed: pending.length, message: 'Sin internet. No se pudo sincronizar.' }
  }

  if (!syncEndpoint || !syncApiKey) {
    markSyncError(
      'Falta configurar VITE_SYNC_API_URL o VITE_SYNC_API_KEY para sincronizacion remota por internet.',
    )
    return {
      sent: 0,
      failed: pending.length,
      message:
        'Falta configurar VITE_SYNC_API_URL o VITE_SYNC_API_KEY para sincronizacion remota por internet.',
    }
  }

  const successIds: string[] = []

  for (const operation of pending) {
    try {
      const response = await fetch(syncEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': syncApiKey },
        body: JSON.stringify(operation),
      })

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
    markSyncError(`Se enviaron ${sent} cambios. Quedan ${failed} pendientes.`)
    return { sent, failed, message: `Se enviaron ${sent} cambios. Quedan ${failed} pendientes.` }
  }

  markSyncError('No se pudo enviar ningun cambio al servidor.')
  return { sent: 0, failed, message: 'No se pudo enviar ningun cambio al servidor.' }
}

export async function pullNow(): Promise<PullResult> {
  if (!navigator.onLine) {
    markSyncError('Sin internet. No se pudo consultar cambios remotos.')
    return { pulled: 0, items: [], message: 'Sin internet. No se pudo consultar cambios remotos.' }
  }

  const pullEndpoint = resolvePullEndpoint()
  if (!pullEndpoint || !syncApiKey) {
    markSyncError(
      'Falta configurar VITE_SYNC_API_URL o VITE_SYNC_API_KEY para sincronizacion remota por internet.',
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
    const response = await fetch(`${pullEndpoint}?${params.toString()}`, {
      method: 'GET',
      headers: { 'x-api-key': syncApiKey },
    })

    if (!response.ok) {
      markSyncError('No se pudo consultar cambios remotos.')
      return { pulled: 0, items: [], message: 'No se pudo consultar cambios remotos.' }
    }

    const data = (await response.json()) as {
      ok: boolean
      items?: RemoteSyncOperation[]
      serverTime?: string
    }

    const items = Array.isArray(data.items) ? data.items : []
    if (typeof data.serverTime === 'string' && data.serverTime.length > 0) {
      window.localStorage.setItem(LAST_PULL_AT_KEY, data.serverTime)
    }

    markSyncSuccess()

    return {
      pulled: items.length,
      items,
      message: items.length > 0 ? `Se recibieron ${items.length} cambios remotos.` : 'Sin cambios remotos nuevos.',
    }
  } catch {
    markSyncError('No se pudo consultar cambios remotos.')
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
