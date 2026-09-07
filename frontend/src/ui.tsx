import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, Link, useNavigate } from 'react-router-dom'
import { ApiError } from './api'
import { useAuth, useT } from './state'
import type { StringKey } from './strings'

// --- loading a thing from the API --------------------------------------------

export type Async<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void }

/**
 * Every screen loads something and can fail while doing it. One hook, so the
 * loading and error branches are written once rather than ten times.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): Async<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  // Kept in a ref so changing the closure does not re-fire the effect; `deps`
  // is what decides when to reload.
  const latest = useRef(load)
  latest.current = load

  useEffect(() => {
    let live = true
    setLoading(true)
    latest.current()
      .then((value) => { if (live) { setData(value); setError(null) } })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, error, loading, reload: useCallback(() => setNonce((n) => n + 1), []) }
}

/** The three states of a fetch, rendered the same way everywhere. */
export function Loader<T>({ state, children }: { state: Async<T>; children: (data: T) => ReactNode }) {
  const { t } = useT()
  if (state.data !== null) return <>{children(state.data)}</>
  if (state.loading) return <p className="muted pad">{t('loading')}</p>
  if (state.error) return <Problem message={state.error} onRetry={state.reload} />
  return null
}

export function Problem({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useT()
  return (
    <div className="problem" role="alert">
      <span>{message}</span>
      {onRetry && <button type="button" className="link" onClick={onRetry}>{t('retry')}</button>}
    </div>
  )
}

/** Turns a thrown ApiError into the message we show, in the current language. */
export function useErrorText() {
  const { t } = useT()
  return useCallback((err: unknown) => {
    if (err instanceof ApiError) {
      if (err.status === 401) return t('errSignInFirst')
      if (err.status === 403) return t('errDoctorOnly')
      return err.message // Django's own message — already specific and actionable
    }
    return err instanceof Error ? err.message : t('errGeneric')
  }, [t])
}

// --- chrome ------------------------------------------------------------------

export function Header() {
  const { t, lang, setLang } = useT()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const links: [string, StringKey][] = user?.isDoctor
    ? [['/doctor', 'navDashboard'], ['/doctor/patients', 'navPatients'],
       ['/doctor/schedule', 'navSchedule'], ['/doctor/analytics', 'navAnalytics']]
    : [['/', 'navHome'], ['/book', 'navBook'], ...(user ? [['/account', 'navAccount'] as [string, StringKey]] : [])]

  return (
    <header className="site-header no-print">
      <Link to={user?.isDoctor ? '/doctor' : '/'} className="brand">
        <span className="brand-mark" aria-hidden="true">स</span>
        <span>
          <strong>{t('appName')}</strong>
          <small>{t('doctorName')}</small>
        </span>
      </Link>

      <nav aria-label={t('appName')}>
        {links.map(([to, key]) => (
          <NavLink key={to} to={to} end={to === '/' || to === '/doctor'}>{t(key)}</NavLink>
        ))}
      </nav>

      <div className="header-right">
        <div className="lang-toggle" role="group" aria-label={t('language')}>
          <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
          <button type="button" aria-pressed={lang === 'ne'} onClick={() => setLang('ne')}>नेपाली</button>
        </div>
        {user ? (
          <button
            type="button"
            className="btn primary"
            onClick={() => { void signOut().then(() => navigate('/')) }}
          >
            {t('signOut')}
          </button>
        ) : (
          <Link to="/login" className="btn primary">{t('signIn')}</Link>
        )}
      </div>
    </header>
  )
}

export function Footer() {
  const { t } = useT()
  const menu: [string, StringKey][] = [
    ['/', 'navHome'],
    ['/book', 'navBook'],
    ['/account', 'navAccount'],
  ]

  return (
    <footer className="site-footer no-print">
      <div className="footer-inner">
        <div className="footer-col">
          <h2>{t('footerMenu')}</h2>
          <ul>
            {menu.map(([to, key]) => (
              <li key={to}><Link to={to}>{t(key)}</Link></li>
            ))}
          </ul>
        </div>

        <div className="footer-col">
          <h2>{t('footerContact')}</h2>
          <ul>
            <li>{t('clinicAddress')}</li>
            <li>{t('clinicAddressLine')}</li>
            <li><a href={`tel:${t('clinicPhone')}`}>{t('clinicPhone')}</a></li>
          </ul>
        </div>

        <div className="footer-col footer-cta">
          <h2>{t('appName')}</h2>
          <p>{t('inPersonNote')}</p>
          <Link to="/book" className="btn white big">{t('heroCta')}</Link>
        </div>
      </div>

      <p className="footer-legal">
        © {new Date().getFullYear()} {t('appName')} · {t('footerRights')}
      </p>
    </footer>
  )
}

// --- small pieces ------------------------------------------------------------

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

const STATUS_KEY = {
  pending: 'statusPending',
  confirmed: 'statusConfirmed',
  declined: 'statusDeclined',
  cancelled: 'statusCancelled',
  held: 'statusPending',
} as const

export function StatusPill({ status }: { status: keyof typeof STATUS_KEY }) {
  const { t } = useT()
  return <span className={`pill status-${status}`}>{t(STATUS_KEY[status])}</span>
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return <div className="empty"><p className="muted">{text}</p>{action}</div>
}

/** A horizontal bar chart. Two rules of CSS beats a charting library. */
export function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="bars">
      {rows.map((row) => (
        <li key={row.label}>
          <span className="bar-label">{row.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(row.value / max) * 100}%` }} />
          </span>
          <span className="bar-value">{row.value}</span>
        </li>
      ))}
    </ul>
  )
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {sub && <small className="muted">{sub}</small>}
    </div>
  )
}
