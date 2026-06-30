import { useState, useEffect, useCallback } from 'react'
import type { AuthSession, AuthLoginInput } from '@/types/domain'

const REMEMBERED_AUTH_KEY = 'cbta-remembered-auth'

function readRememberedAuth(): AuthLoginInput | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(REMEMBERED_AUTH_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AuthLoginInput> | null
    if (!parsed?.username || !parsed?.password) return null
    return {
      username: parsed.username,
      password: parsed.password,
    }
  } catch {
    return null
  }
}

function writeRememberedAuth(value: AuthLoginInput | null) {
  if (typeof window === 'undefined') return

  if (!value) {
    window.localStorage.removeItem(REMEMBERED_AUTH_KEY)
    return
  }

  window.localStorage.setItem(REMEMBERED_AUTH_KEY, JSON.stringify(value))
}

type UseAuthOptions = {
  api: Window['cbta']
  onSessionChange?: (session: AuthSession | null) => void
}

export function useAuth({ api, onSessionChange }: UseAuthOptions) {
  const rememberedAuth = readRememberedAuth()
  const [authSession, setAuthSession] = useState<AuthSession | null>(null)
  const [authForm, setAuthForm] = useState<AuthLoginInput>(rememberedAuth ?? { username: '', password: '' })
  const [rememberCredentials, setRememberCredentials] = useState(Boolean(rememberedAuth))
  const [authLoading, setAuthLoading] = useState(true)
  const [authSaving, setAuthSaving] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const initializeSession = useCallback(async () => {
    setAuthLoading(true)
    try {
      const session = await api.auth.session()
      setAuthSession(session)
      onSessionChange?.(session)
      return session
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo validar la sesión actual.'
      setAuthError(message)
      return null
    } finally {
      setAuthLoading(false)
    }
  }, [api, onSessionChange])

  useEffect(() => {
    void initializeSession()
  }, [initializeSession])

  const handleLogin = useCallback(async () => {
    setAuthSaving(true)
    setAuthError(null)
    try {
      const session = await api.auth.login(authForm)
      if (rememberCredentials) {
        writeRememberedAuth(authForm)
      } else {
        writeRememberedAuth(null)
      }
      setAuthSession(session)
      onSessionChange?.(session)
      return session
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo iniciar sesión.'
      setAuthError(message)
      throw error
    } finally {
      setAuthSaving(false)
    }
  }, [api, authForm, rememberCredentials, onSessionChange])

  const handleLogout = useCallback(async () => {
    await api.auth.logout()
    setAuthSession(null)
    setAuthForm(rememberCredentials ? (readRememberedAuth() ?? authForm) : { username: '', password: '' })
    onSessionChange?.(null)
  }, [api, rememberCredentials, authForm, onSessionChange])

  const handleRememberCredentialsChange = useCallback((enabled: boolean) => {
    setRememberCredentials(enabled)
    if (!enabled) {
      writeRememberedAuth(null)
    }
  }, [])

  return {
    authSession,
    authForm,
    setAuthForm,
    rememberCredentials,
    setRememberCredentials: handleRememberCredentialsChange,
    authLoading,
    authSaving,
    authError,
    setAuthError,
    handleLogin,
    handleLogout,
  }
}
