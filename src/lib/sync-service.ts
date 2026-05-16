import { listPendingSyncOps, removePendingSyncOpsById } from '@/lib/sync-queue'

type SyncResult = {
  sent: number
  failed: number
  message: string
}

const syncEndpoint = import.meta.env.VITE_SYNC_API_URL
const syncApiKey = import.meta.env.VITE_SYNC_API_KEY

export async function syncNow(): Promise<SyncResult> {
  const pending = listPendingSyncOps()

  if (pending.length === 0) {
    return { sent: 0, failed: 0, message: 'No hay cambios pendientes por sincronizar.' }
  }

  if (!navigator.onLine) {
    return { sent: 0, failed: pending.length, message: 'Sin internet. No se pudo sincronizar.' }
  }

  if (!syncEndpoint || !syncApiKey) {
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
    return { sent, failed, message: `Sincronizacion completada. ${sent} cambios enviados.` }
  }

  if (sent > 0 && failed > 0) {
    return { sent, failed, message: `Se enviaron ${sent} cambios. Quedan ${failed} pendientes.` }
  }

  return { sent: 0, failed, message: 'No se pudo enviar ningun cambio al servidor.' }
}
