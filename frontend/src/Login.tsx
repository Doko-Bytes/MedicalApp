import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { post, type User } from './api'
import { useAuth, useT } from './state'
import { Field, Problem, useErrorText } from './ui'

/**
 * Phone + SMS code, no password. Used as a page at /login and inlined into the
 * booking flow, which is why the sign-in itself is a component and not a route.
 */
export function PhoneSignIn({ onDone }: { onDone: (user: User) => void }) {
  const { t } = useT()
  const { setUser } = useAuth()
  const readError = useErrorText()

  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(work: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError(readError(err))
    } finally {
      setBusy(false)
    }
  }

  const requestCode = () => run(async () => {
    await post('/auth/request-code/', { phone })
    setSent(true)
  })

  const verify = () => run(async () => {
    const data = await post<{ user: User }>('/auth/verify/', { phone, code })
    setUser(data.user)
    onDone(data.user)
  })

  return (
    <div className="signin">
      <p className="muted">{t('signInBody')}</p>
      {error && <Problem message={error} />}

      {!sent ? (
        <form onSubmit={(e) => { e.preventDefault(); void requestCode() }}>
          <Field label={t('phoneLabel')} hint={t('phoneHint')}>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              maxLength={10}
              placeholder="98XXXXXXXX"
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              required
            />
          </Field>
          <button type="submit" className="btn primary" disabled={busy || phone.length !== 10}>
            {busy ? t('sending') : t('sendCode')}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void verify() }}>
          <p className="muted">{t('codeSentTo', { phone })}</p>
          <Field label={t('codeLabel')}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="code-input"
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
            />
          </Field>
          <div className="row">
            <button type="submit" className="btn primary" disabled={busy || code.length !== 6}>
              {busy ? t('verifying') : t('verify')}
            </button>
            <button type="button" className="link" disabled={busy} onClick={() => void requestCode()}>
              {t('resend')}
            </button>
            <button type="button" className="link" onClick={() => { setSent(false); setCode('') }}>
              {t('changeNumber')}
            </button>
          </div>
          <p className="muted small">{t('neverShare')}</p>
        </form>
      )}
    </div>
  )
}

export default function Login() {
  const { t } = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from

  return (
    <div className="narrow">
      <section className="card">
        <h1>{t('signInTitle')}</h1>
        <PhoneSignIn
          onDone={(user) => navigate(from ?? (user.isDoctor ? '/doctor' : '/account'), { replace: true })}
        />
      </section>
    </div>
  )
}
