import { useState } from 'react'
import { Link } from 'react-router-dom'
import { get, isFree, post, type AgendaRow, type Appointment } from '../api'
import { formatDate, formatTime, money, todayIso, useT } from '../state'
import { Empty, Loader, Problem, Section, useAsync, useErrorText, type Async } from '../ui'
import Calendar from './Calendar'

export default function Dashboard() {
  const { t, lang } = useT()
  const [date, setDate] = useState(todayIso())

  const agenda = useAsync(
    () => get<{ date: string; agenda: AgendaRow[] }>(`/doctor/agenda/?date=${date}`), [date])
  const waiting = useAsync(
    () => get<{ requests: (Appointment & { waitingMinutes: number })[] }>('/doctor/requests/'), [])

  return (
    <div className="wide">
      <div className="page-head">
        <h1>{t('dashboardTitle')}</h1>
        <div className="row">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value || todayIso())} />
          <button type="button" className="btn white" onClick={() => setDate(todayIso())}>{t('today')}</button>
        </div>
      </div>

      <Requests state={waiting} onSettled={() => { waiting.reload(); agenda.reload() }} />

      <div className="doctor-grid">
        <Calendar date={date} onPick={setDate} />
        <Section title={`${t('theDay')} · ${formatDate(date, lang)}`}>
          <Loader state={agenda}>
            {(data) => (data.agenda.length === 0 ? <Empty text={t('dayBlocked')} /> : (
              <ul className="agenda">
                {data.agenda.map((row) => (
                  <li key={row.time} className={isFree(row) ? 'is-free' : ''}>
                    <span className="agenda-time">{formatTime(row.time, lang)}</span>
                    {isFree(row) ? (
                      <span className="muted">{t('free')}</span>
                    ) : (
                      <AgendaEntry appt={row} onChanged={agenda.reload} />
                    )}
                  </li>
                ))}
              </ul>
            ))}
          </Loader>
        </Section>
      </div>
    </div>
  )
}

function AgendaEntry({ appt, onChanged }: { appt: Appointment; onChanged: () => void }) {
  const { t, lang } = useT()
  const readError = useErrorText()
  const [error, setError] = useState<string | null>(null)

  async function togglePaid() {
    setError(null)
    try {
      await post(`/doctor/appointments/${appt.id}/paid/`, { paid: !appt.paid })
      onChanged()
    } catch (err) {
      setError(readError(err))
    }
  }

  return (
    <div className="agenda-entry">
      <div>
        <strong>{appt.name || '—'}</strong>
        <p className="muted">
          {appt.reason || '—'}
          {appt.age ? ` · ${t('years', { n: appt.age })}` : ''} · {appt.phone}
        </p>
        {error && <Problem message={error} />}
      </div>
      <div className="row-actions">
        <span className={appt.paid ? 'pill paid' : 'pill unpaid'}>{money(appt.fee, lang)}</span>
        <button type="button" className="btn ghost small" onClick={() => void togglePaid()}>
          {appt.paid ? t('markUnpaid') : t('markPaid')}
        </button>
        {appt.patientId && (
          <Link to={`/doctor/patients/${appt.patientId}`} className="btn ghost small">
            {t('openRecord')}
          </Link>
        )}
      </div>
    </div>
  )
}

function Requests({
  state, onSettled,
}: {
  state: Async<{ requests: (Appointment & { waitingMinutes: number })[] }>
  onSettled: () => void
}) {
  const { t, lang } = useT()
  const readError = useErrorText()
  const [error, setError] = useState<string | null>(null)

  async function settle(id: number, accept: boolean) {
    setError(null)
    try {
      await post(`/doctor/requests/${id}/`, { accept })
      onSettled()
    } catch (err) {
      setError(readError(err))
    }
  }

  return (
    <Section title={t('waitingOnYou')}>
      {error && <Problem message={error} />}
      <Loader state={state}>
        {(data) => (data.requests.length === 0 ? <Empty text={t('noRequests')} /> : (
          <ul className="list">
            {data.requests.map((req) => (
              <li key={req.id} className="row-item">
                <div>
                  <strong>{req.name || '—'}</strong>
                  <p className="muted">
                    {formatDate(req.date, lang)}, {formatTime(req.time, lang)}
                    {req.reason ? ` · ${req.reason}` : ''} · {req.phone}
                  </p>
                  <span className="muted small">{t('waitingMinutes', { n: req.waitingMinutes })}</span>
                </div>
                <div className="row-actions">
                  <button type="button" className="btn primary small" onClick={() => void settle(req.id, true)}>
                    {t('accept')}
                  </button>
                  <button type="button" className="btn danger small" onClick={() => void settle(req.id, false)}>
                    {t('decline')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ))}
      </Loader>
    </Section>
  )
}

