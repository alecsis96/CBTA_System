import { useState, useEffect, useCallback, useRef } from 'react'
import { getSyncStatusSnapshot, syncAll } from '@/lib/sync-service'
import type { SyncStatusSnapshot } from '@/lib/sync-service'

const EMPTY_SYNC_STATUS: SyncStatusSnapshot = {
  lastSuccessfulSyncAt: null,
  lastSyncError: null,
  lastSyncErrorState: null,
  pendingTotal: 0,
  pendingByType: {
    STUDENT_CREATE: 0,
    STUDENT_UPDATE: 0,
    RECEIPT_CREATE: 0,
    RECEIPT_REPRINT: 0,
    CASH_PAYMENT_CREATE: 0,
    CONCEPT_TARIFF_UPDATE: 0,
    CONCEPT_SUGGESTED_UPDATE: 0,
  },
}

type UseSyncOptions = {
  autoSyncInterval?: number
  onSyncSuccess?: () => void
  onSyncError?: (error: string) => void
}

export function useSync({ autoSyncInterval = 30000, onSyncSuccess, onSyncError }: UseSyncOptions = {}) {
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [syncStatus, setSyncStatus] = useState<SyncStatusSnapshot>(EMPTY_SYNC_STATUS)
  const [syncing, setSyncing] = useState(false)
  const autoSyncTimerRef = useRef<number | null>(null)

  const refreshSyncStatus = useCallback(() => {
    setSyncStatus(getSyncStatusSnapshot())
  }, [])

  const handleSyncNow = useCallback(async () => {
    if (syncing) return

    setSyncing(true)
    try {
      const result = await syncAll()
      refreshSyncStatus()
      
      if (result.pulled > 0 || result.sent > 0) {
        onSyncSuccess?.()
      }
      
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al sincronizar'
      onSyncError?.(message)
      throw error
    } finally {
      setSyncing(false)
    }
  }, [syncing, refreshSyncStatus, onSyncSuccess, onSyncError])

  // Monitor online/offline status
  useEffect(() => {
    function onOnline() {
      setIsOnline(true)
    }

    function onOffline() {
      setIsOnline(false)
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // Initial sync status
  useEffect(() => {
    refreshSyncStatus()
  }, [refreshSyncStatus])

  // Auto-sync when coming online
  useEffect(() => {
    if (!isOnline || syncing) {
      return
    }

    void handleSyncNow()
  }, [isOnline, syncing, handleSyncNow])

  // Periodic auto-sync
  useEffect(() => {
    if (autoSyncTimerRef.current) {
      window.clearInterval(autoSyncTimerRef.current)
    }

    autoSyncTimerRef.current = window.setInterval(() => {
      if (navigator.onLine && !syncing) {
        void handleSyncNow()
      }
    }, autoSyncInterval)

    return () => {
      if (autoSyncTimerRef.current) {
        window.clearInterval(autoSyncTimerRef.current)
      }
    }
  }, [autoSyncInterval, syncing, handleSyncNow])

  return {
    isOnline,
    syncStatus,
    syncing,
    handleSyncNow,
    refreshSyncStatus,
  }
}
