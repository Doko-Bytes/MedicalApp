import { useEffect, useState, useSyncExternalStore } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { get, post, type Appointment, type DaysResponse, type Slot } from './api'
import { altDay, dayNumber, formatDate, formatTime, formatWeekday, money, useAuth, useT } from './state'
import { Field, Loader, Problem, useAsync, useErrorText } from './ui'
import { PhoneSignIn } from './Login'

/**
 * Fourteen days and the free times on the chosen one. Lives here because
 * booking is its first use, but "Change time" in the account reuses it — the
 * two screens must never disagree about what is free.
 */
export function SlotPicker({
  date, time, onPickDay, onPickTime,
}: {
  date: string | null
  time: string | null
  onPickDay: (date: string) => void
  onPickTime: (time: string) => void
}) {
  const { t, lang } = useT()
  const days = useAsync(() => get<DaysResponse>('/days/'), [])
  const slots = useAsync(
    () => (date ? get<{ slots: Slot[] }>(`/slots/?date=${date}`) : Promise.resolve({ slots: [] })),
    [date],
  )

  return (
    <>
      <h3>{t('stepDay')}</h3>
      <Loader state={days}>
        {(data) => (
          <ul className="day-strip">
            {data.days.map((day) => {
              const full = !day.closed && day.freeCount === 0
              return (
                <li key={day.value}>
                  <button
                    type="button"
                    className={`day-chip${date === day.value ? ' is-picked' : ''}`}
                    disabled={day.closed || full}
                    aria-pressed={date === day.value}
                    onClick={() => onPickDay(day.value)}
                  >
                    {/* `day.weekday`/`day.day` come off the API in English and
                        in the Gregorian calendar — rebuilt from the raw date so
                        Nepali gets Nepali weekdays and Bikram Sambat numbers. */}
                    <span className="day-weekday">{formatWeekday(day.value, lang)}</span>
                    <span className="day-number">{dayNumber(day.value, lang)}</span>
                    <span className="day-free">
                      {day.closed ? t('dayClosed') : full ? t('dayFull') : t('slotsFree', { n: day.freeCount })}
                    </span>
                    <span className="date-alt">{altDay(day.value, lang, true)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Loader>

      <h3>{t('stepTime')}</h3>
      {!date ? (
        <p className="muted">{t('pickDayFirst')}</p>
      ) : (
        <Loader state={slots}>
          {(data) => (data.slots.length === 0 ? (
            <p className="muted">{t('noSlots')}</p>
          ) : (
            <ul className="slot-grid">
              {data.slots.map((slot) => (
                <li key={slot.value}>
                  <button
                    type="button"
                    className={`slot${time === slot.value ? ' is-picked' : ''}`}
                    disabled={slot.taken}
                    aria-pressed={time === slot.value}
                    onClick={() => onPickTime(slot.value)}
                  >
                    {formatTime(slot.value, lang)}
                    {slot.taken && <small>{t('taken')}</small>}
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </Loader>
      )}
    </>
  )
}

// The wall clock is an external store that changes on its own, which is
// exactly what useSyncExternalStore is for — mirroring it into state instead
// means a setState cascade every second and a value that is always one tick old.
const everySecond = (changed: () => void) => {
  const timer = setInterval(changed, 1000)
  return () => clearInterval(timer)
}
const secondsNow = () => Math.floor(Date.now() / 1000)

/** Seconds until `iso`; null when nothing is held. */
function useCountdown(iso: string | null) {
  const now = useSyncExternalStore(everySecond, secondsNow)
  return iso ? Math.max(0, Math.round(new Date(iso).getTime() / 1000 - now)) : null
}

export default function Booking() {
  const { t, lang } = useT()
  const { user } = useAuth()
  const navigate = useNavigate()
  const readError = useErrorText()
  const [params] = useSearchParams()

  const [date, setDate] = useState<string | null>(params.get('date'))
  const [time, setTime] = useState<string | null>(null)
  const [hold, setHold] = useState<{ id: number; expiresAt: string } | null>(null)
  // null means "not typed in yet", which is what lets the signed-in patient's
  // own name act as the default without overwriting an edit that cleared it.
  const [typedName, setTypedName] = useState<string | null>(null)
  const [form, setForm] = useState({ age: '', reason: '', notes: '' })
  const name = typedName ?? user?.name ?? ''
  const [fee, setFee] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const left = useCountdown(hold?.expiresAt ?? null)
  const expired = hold !== null && left === 0

  // The clinic fee shown on the review panel is whatever /days/ says today;
  // the backend freezes its own copy onto the booking when it is made.
  useEffect(() => {
    get<DaysResponse>('/days/').then((data) => setFee(data.clinicFee)).catch(() => {})
  }, [])

  async function pickTime(next: string) {
    setError(null)
    setBusy(true)
    try {
      const held = await post<{ id: number; expiresAt: string }>('/hold/', { date, time: next })
      setTime(next)
      setHold(held)
    } catch (err) {
      setError(readError(err))
      setTime(null)
      setHold(null)
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setError(null)
    setBusy(true)
    try {
      const appt = await post<Appointment>('/appointments/book/', {
        name: name.trim(),
        age: form.age ? Number(form.age) : null,
        reason: form.reason.trim(),
        notes: form.notes.trim(),
        mode: 'clinic', // the clinic does not do video consultations
        payment: 'clinic',
        lang,
      })
      navigate(`/bill/${appt.id}`, { replace: true, state: { appointment: appt } })
    } catch (err) {
      setError(readError(err))
      setBusy(false)
    }
  }

  const ready = Boolean(hold) && !expired && name.trim().length > 0

  return (
    <div className="narrow">
      <h1>{t('bookTitle')}</h1>
      {error && <Problem message={error} />}

      <section className="card">
        <SlotPicker
          date={date}
          time={time}
          onPickDay={(next) => { setDate(next); setTime(null); setHold(null) }}
          onPickTime={(next) => { void pickTime(next) }}
        />
        {hold && (
          expired
            ? <p className="hold-bar is-expired">{t('holdExpired')}</p>
            : <p className="hold-bar">{t('holdingSlot', {
                mm: String(Math.floor((left ?? 0) / 60)).padStart(2, '0'),
                ss: String((left ?? 0) % 60).padStart(2, '0'),
              })}</p>
        )}
      </section>

      {hold && !expired && (
        <section className="card">
          <h2>{t('stepDetails')}</h2>
          <Field label={t('patientName')} hint={t('patientNameHint')}>
            <input
              value={name}
              maxLength={100}
              onChange={(e) => setTypedName(e.target.value)}
              required
            />
          </Field>
          <Field label={`${t('patientAge')} (${t('optional')})`}>
            <input
              type="number"
              min={0}
              max={120}
              value={form.age}
              onChange={(e) => setForm({ ...form, age: e.target.value })}
            />
          </Field>
          <Field label={t('visitReason')} hint={t('visitReasonHint')}>
            <input
              value={form.reason}
              maxLength={100}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </Field>
          <Field label={`${t('visitNotes')} (${t('optional')})`}>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </section>
      )}

      {hold && !expired && !user && (
        <section className="card">
          <h2>{t('signInTitle')}</h2>
          {/* Signing in claims the hold made a moment ago — the session key on
              it is swapped for the account that just proved the number. */}
          <PhoneSignIn onDone={() => {}} />
        </section>
      )}

      {hold && !expired && user && (
        <section className="card">
          <h2>{t('reviewHeading')}</h2>
          <dl className="review">
            <dt>{t('reviewWhen')}</dt>
            <dd>{date && time ? `${formatDate(date, lang)}, ${formatTime(time, lang)}` : '—'}</dd>
            <dt>{t('reviewWho')}</dt>
            <dd>{name || '—'}{form.age ? ` · ${t('years', { n: form.age })}` : ''}</dd>
            <dt>{t('reviewWhere')}</dt>
            <dd>{t('clinicAddress')} · {t('inPersonOnly')}</dd>
            <dt>{t('reviewReason')}</dt>
            <dd>{form.reason || '—'}</dd>
            <dt>{t('reviewFee')}</dt>
            <dd>{fee === null ? '—' : money(fee, lang)} · <span className="muted">{t('feeNote')}</span></dd>
          </dl>
          <button type="button" className="btn primary big" disabled={!ready || busy} onClick={() => void confirm()}>
            {busy ? t('booking') : t('confirmBooking')}
          </button>
        </section>
      )}
    </div>
  )
}
