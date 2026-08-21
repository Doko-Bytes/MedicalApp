import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { get, post, type User } from './api'
import { strings, type StringKey } from './strings'
import type { Lang } from './dates'

// Date and money formatting lives in ./dates, which knows nothing about React
// so it can be run — and checked — on its own. Screens still reach for it
// through here, where the language they format in comes from.
export * from './dates'

// --- language ----------------------------------------------------------------

type LangValue = {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: StringKey, vars?: Record<string, string | number>) => string
}

const LangContext = createContext<LangValue | null>(null)

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem('lang') === 'ne' ? 'ne' : 'en'),
  )

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem('lang', next)
    setLangState(next)
    document.documentElement.lang = next
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo<LangValue>(() => {
    const index = lang === 'ne' ? 1 : 0
    return {
      lang,
      setLang,
      t: (key, vars) => {
        const text = strings[key][index]
        if (!vars) return text
        return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
          name in vars ? String(vars[name]) : whole)
      },
    }
  }, [lang, setLang])

  return <LangContext value={value}>{children}</LangContext>
}

export function useT() {
  const value = use(LangContext)
  if (!value) throw new Error('useT outside LangProvider')
  return value
}

// --- who is signed in --------------------------------------------------------

type AuthValue = {
  user: User | null
  ready: boolean
  setUser: (user: User | null) => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  // This call is also the CSRF handshake — Django plants the cookie on it, so
  // it has to finish before any POST goes out.
  useEffect(() => {
    get<{ user: User | null }>('/auth/me/')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true))
  }, [])

  const value = useMemo<AuthValue>(() => ({
    user,
    ready,
    setUser,
    signOut: async () => {
      await post('/auth/signout/').catch(() => {})
      setUser(null)
    },
  }), [user, ready])

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth() {
  const value = use(AuthContext)
  if (!value) throw new Error('useAuth outside AuthProvider')
  return value
}

