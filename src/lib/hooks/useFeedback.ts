import { useState, useCallback, useRef } from 'react'

type FeedbackScope = 'control-escolar' | 'ingresos-propios' | 'secretaria' | 'configuracion' | 'sync'

type UseFeedbackOptions = {
  autoClearDelay?: number
}

export function useFeedback({ autoClearDelay = 4200 }: UseFeedbackOptions = {}) {
  const [feedbackByScope, setFeedbackByScope] = useState<Record<FeedbackScope, string | null>>({
    'control-escolar': null,
    'ingresos-propios': null,
    secretaria: null,
    configuracion: null,
    sync: null,
  })

  const timersRef = useRef<Record<FeedbackScope, number | null>>({
    'control-escolar': null,
    'ingresos-propios': null,
    secretaria: null,
    configuracion: null,
    sync: null,
  })

  const setFeedback = useCallback((scope: FeedbackScope, message: string | null, delay?: number) => {
    setFeedbackByScope((current) => ({
      ...current,
      [scope]: message,
    }))

    // Clear previous timer if exists
    if (timersRef.current[scope]) {
      window.clearTimeout(timersRef.current[scope]!)
    }

    // Set auto-clear timer if message is not null
    if (message !== null) {
      timersRef.current[scope] = window.setTimeout(() => {
        setFeedbackByScope((current) => ({
          ...current,
          [scope]: null,
        }))
        timersRef.current[scope] = null
      }, delay ?? autoClearDelay)
    }
  }, [autoClearDelay])

  const clearFeedback = useCallback((scope: FeedbackScope) => {
    if (timersRef.current[scope]) {
      window.clearTimeout(timersRef.current[scope]!)
      timersRef.current[scope] = null
    }
    
    setFeedbackByScope((current) => ({
      ...current,
      [scope]: null,
    }))
  }, [])

  const clearAllFeedback = useCallback(() => {
    Object.keys(timersRef.current).forEach((scope) => {
      const typedScope = scope as FeedbackScope
      if (timersRef.current[typedScope]) {
        window.clearTimeout(timersRef.current[typedScope]!)
        timersRef.current[typedScope] = null
      }
    })

    setFeedbackByScope({
      'control-escolar': null,
      'ingresos-propios': null,
      secretaria: null,
      configuracion: null,
      sync: null,
    })
  }, [])

  return {
    feedbackByScope,
    setFeedback,
    clearFeedback,
    clearAllFeedback,
  }
}
