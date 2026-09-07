import { useState } from 'react'
import { Link } from 'react-router-dom'
import { get, post, type Appointment, type History, type MedicalRecord, type Prescription, type User } from './api'
import { formatDate, formatTime, money, useAuth, useT } from './state'
import { Empty, Field, Loader, Problem, Section, StatusPill, useAsync, useErrorText } from './ui'
import { SlotPicker } from './Booking'
import type { StringKey } from './strings'

const TABS: [string, StringKey][] = [
  ['appointments', 'tabAppointments'],
  ['history', 'tabHistory'],
  ['prescriptions', 'tabPrescriptions'],
  ['reports', 'tabReports'],
  ['advice', 'tabAdvice'],
]

export default function Account() {
  const { t } = useT()
  const [tab, setTab] = useState('appointments')
  const appointments = useAsync(
    () => get<{ upcoming: Appointment[]; past: Appointment[] }>('/appointments/'), [])
  const history = useAsync(() => get<History>('/history/'), [])

  return (
    <div className="wide">
      <h1>{t('accountTitle')}</h1>
      <ProfileCard />

      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'is-active' : ''}
            onClick={() => setTab(key)}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {tab === 'appointments' && (
        <Loader state={appointments}>
          {(data) => (
            <Appointments
              data={data}
              onChanged={() => { appointments.reload(); history.reload() }}
            />
          )}
        </Loader>
      )}
      {tab === 'history' && <Loader state={history}>{(data) => <Visits data={data} />}</Loader>}
      {tab === 'prescriptions' && <Loader state={history}>{(data) => <Prescriptions data={data} />}</Loader>}
      {tab === 'reports' && (
        <Loader state={history}>
          {(data) => <Reports records={data.records} onChanged={history.reload} />}
        </Loader>
      )}
      {tab === 'advice' && <Loader state={history}>{(data) => <Advice data={data} />}</Loader>}
    </div>
  )
}

function ProfileCard() {
  const { t } = useT()
  const { user, setUser } = useAuth()
  const readError = useErrorText()
  const [name, setName] = useState(user?.name ?? '')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    try {
      const data = await post<{ user: User }>('/auth/profile/', { name })
      setUser(data.user)
      setSaved(true)
    } catch (err) {
      setError(readError(err))
    }
  }

  return (
    <section className="card profile">
      <Field label={t('yourName')} hint={t('yourNameHint')}>
        <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false) }} />
      </Field>
      <div className="row">
        <span className="phone-chip">{user?.phone}</span>
        <button type="button" className="btn ghost" disabled={!name.trim()} onClick={() => void save()}>
          {saved ? t('saved') : t('save')}
        </button>
      </div>
      {error && <Problem message={error} />}
    </section>
  )
}

function Appointments({
  data, onChanged,
}: {
  data: { upcoming: Appointment[]; past: Appointment[] }
  onChanged: () => void
}) {
  const { t, lang } = useT()
  const readError = useErrorText()
  const [moving, setMoving] = useState<number | null>(null)
  const [confirming, setConfirming] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function cancel(id: number) {
    setError(null)
    try {
      await post(`/appointments/${id}/cancel/`)
      setConfirming(null)
      onChanged()
    } catch (err) {
      setError(readError(err))
    }
  }

  return (
    <>
      {error && <Problem message={error} />}
      <Section title={t('upcoming')}>
        {data.upcoming.length === 0 ? (
          <Empty text={t('noUpcoming')} action={<Link to="/book" className="btn primary">{t('bookOne')}</Link>} />
        ) : (
          <ul className="list">
            {data.upcoming.map((appt) => (
              <li key={appt.id} className="row-item">
                <div>
                  <strong>{formatDate(appt.date, lang)}, {formatTime(appt.time, lang)}</strong>
                  <p className="muted">{appt.name}{appt.reason ? ` · ${appt.reason}` : ''}</p>
                  <StatusPill status={appt.status} />
                </div>
                <div className="row-actions">
                  <span className="money">{money(appt.fee, lang)}</span>
                  <Link to={`/bill/${appt.id}`} className="btn ghost small">{t('viewSlip')}</Link>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => setMoving(moving === appt.id ? null : appt.id)}
                  >
                    {t('reschedule')}
                  </button>
                  {confirming === appt.id ? (
                    <span className="confirm">
                      <span className="muted small">{t('confirmCancel')}</span>
                      <button type="button" className="btn danger small" onClick={() => void cancel(appt.id)}>
                        {t('cancelVisit')}
                      </button>
                      <button type="button" className="link" onClick={() => setConfirming(null)}>
                        {t('close')}
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="btn ghost small" onClick={() => setConfirming(appt.id)}>
                      {t('cancelVisit')}
                    </button>
                  )}
                </div>
                {moving === appt.id && (
                  <Reschedule
                    id={appt.id}
                    onDone={() => { setMoving(null); onChanged() }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('pastVisits')}>
        {data.past.length === 0 ? <Empty text={t('noPast')} /> : (
          <ul className="list">
            {data.past.map((appt) => (
              <li key={appt.id} className="row-item">
                <div>
                  <strong>{formatDate(appt.date, lang)}, {formatTime(appt.time, lang)}</strong>
                  <p className="muted">{appt.name}{appt.reason ? ` · ${appt.reason}` : ''}</p>
                </div>
                <StatusPill status={appt.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}

function Reschedule({ id, onDone }: { id: number; onDone: () => void }) {
  const { t } = useT()
  const readError = useErrorText()
  const [date, setDate] = useState<string | null>(null)
  const [time, setTime] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function move() {
    setBusy(true)
    setError(null)
    try {
      await post(`/appointments/${id}/reschedule/`, { date, time })
      onDone()
    } catch (err) {
      setError(readError(err))
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <h3>{t('rescheduleTitle')}</h3>
      <p className="muted small">{t('rescheduleNote')}</p>
      {error && <Problem message={error} />}
      <SlotPicker
        date={date}
        time={time}
        onPickDay={(next) => { setDate(next); setTime(null) }}
        onPickTime={setTime}
      />
      <button
        type="button"
        className="btn primary"
        disabled={!date || !time || busy}
        onClick={() => void move()}
      >
        {busy ? t('saving') : t('moveHere')}
      </button>
    </div>
  )
}

function Visits({ data }: { data: History }) {
  const { t, lang } = useT()
  if (data.visits.length === 0) return <Empty text={t('noPast')} />

  return (
    <ul className="timeline">
      {data.visits.map((visit) => (
        <li key={visit.id}>
          <div className="timeline-head">
            <strong>{formatDate(visit.date, lang)}, {formatTime(visit.time, lang)}</strong>
            <StatusPill status={visit.status} />
          </div>
          {visit.reason && <p className="reason">{visit.reason}</p>}
          <h4>{t('doctorNote')}</h4>
          <p className={visit.visitNote ? 'note' : 'muted'}>{visit.visitNote || t('noNoteYet')}</p>
          {visit.prescription && <MedicineTable rx={visit.prescription} />}
        </li>
      ))}
    </ul>
  )
}

function MedicineTable({ rx }: { rx: Prescription }) {
  const { t, lang } = useT()
  return (
    <div className="rx">
      <h4>{t('prescribedOn', { date: formatDate(rx.date, lang) })}</h4>
      <table>
        <thead>
          <tr><th>{t('medicine')}</th><th>{t('dose')}</th></tr>
        </thead>
        <tbody>
          {rx.medicines.map((m, i) => (
            <tr key={`${m.name}-${i}`}><td>{m.name}</td><td>{m.dose}</td></tr>
          ))}
        </tbody>
      </table>
      {rx.note && <p className="muted">{rx.note}</p>}
    </div>
  )
}

function Prescriptions({ data }: { data: History }) {
  const { t } = useT()
  const scripts = data.visits.map((v) => v.prescription).filter((rx) => rx !== null)
  if (scripts.length === 0) return <Empty text={t('noPrescriptions')} />
  return (
    <div className="stack">
      {scripts.map((rx) => <Section key={rx.id} title={t('tabPrescriptions')}><MedicineTable rx={rx} /></Section>)}
    </div>
  )
}

function Reports({ records, onChanged }: { records: MedicalRecord[]; onChanged: () => void }) {
  const { t, lang } = useT()
  const readError = useErrorText()
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('text', text)
      await post('/reports/', form)
      setFile(null)
      setText('')
      onChanged()
    } catch (err) {
      setError(readError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Section title={t('uploadReport')}>
        {error && <Problem message={error} />}
        <Field label={t('chooseFile')} hint={t('fileHint')}>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label={t('reportNote')}>
          <input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} />
        </Field>
        <button type="button" className="btn primary" disabled={!file || busy} onClick={() => void upload()}>
          {busy ? t('uploading') : t('upload')}
        </button>
      </Section>

      <Section title={t('tabReports')}>
        {records.length === 0 ? <Empty text={t('noReports')} /> : (
          <ul className="list">
            {records.map((record) => (
              <li key={record.id} className="row-item">
                <div>
                  <strong>{formatDate(record.date, lang)}</strong>
                  <p>{record.text || '—'}</p>
                  <span className="muted small">
                    {record.byDoctor ? t('filedByDoctor') : t('filedByYou')}
                  </span>
                </div>
                {record.fileUrl && (
                  <a className="btn ghost small" href={record.fileUrl} target="_blank" rel="noreferrer">
                    {t('openFile')}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}

function Advice({ data }: { data: History }) {
  const { t, lang } = useT()
  if (data.suggestions.length === 0) return <Empty text={t('noAdvice')} />
  return (
    <div className="stack">
      {data.suggestions.map((item) => (
        <Section
          key={item.name}
          title={t('adviceFor', { name: item.name })}
          aside={item.date && <span className="muted small">{t('updatedOn', { date: formatDate(item.date, lang) })}</span>}
        >
          <p className="note big-note">{item.text}</p>
        </Section>
      ))}
    </div>
  )
}
