import { useState, useCallback, useRef } from 'react'

type UseRocNumberOptions = {
  initialSuggested?: string
  initialNumber?: string
}

export function useRocNumber({ initialSuggested = 'DGETAYCM-ROC-0001', initialNumber = 'DGETAYCM-ROC-0001' }: UseRocNumberOptions = {}) {
  const [rocNumber, setRocNumber] = useState(initialNumber)
  const [suggestedRocNumber, setSuggestedRocNumber] = useState(initialSuggested)
  const [rocInitialNumber, setRocInitialNumber] = useState(initialNumber)
  const rocNumberEditedRef = useRef(false)

  const handleChangeRocNumber = useCallback((value: string) => {
    rocNumberEditedRef.current = true
    setRocNumber(value)
  }, [])

  const applySuggestedRocNumber = useCallback((value: string, force = false) => {
    setSuggestedRocNumber(value)
    setRocNumber((current) => {
      if (force || !rocNumberEditedRef.current || current.trim().length === 0) {
        return value
      }
      return current
    })
  }, [])

  const resetEditedFlag = useCallback(() => {
    rocNumberEditedRef.current = false
  }, [])

  return {
    rocNumber,
    setRocNumber,
    suggestedRocNumber,
    setSuggestedRocNumber,
    rocInitialNumber,
    setRocInitialNumber,
    handleChangeRocNumber,
    applySuggestedRocNumber,
    resetEditedFlag,
    isEdited: rocNumberEditedRef.current,
  }
}
