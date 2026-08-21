import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { get, post, type Assessment, type PatientDetail, type PatientSummary, type Prescription } from '../api'
import { formatDate, todayIso, useT } from '../state'
import { Empty, Field, Loader, Problem, Section, useAsync, useErrorText } from '../ui'

export default function Patients() {
  const { id } = useParams()
  return id ? <Detail id={id} /> : <Search />
}

function Search() {
  const { t } = useT()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  // The doctor types a name; one request per pause, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  const state = useAsync(
    () => get<{ patients: PatientSummary[] }>(`/doctor/patients/?q=${encodeURIComponent(debounced)}`),
    [debounced],
  )

  return (
    <div className="wide">
      <h1>{t('patientsTitle')}</h1>
      <section className="card">
        <Field label={t('searchPlaceholder')} hint={t('searchHint')}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            autoFocus
          />
        </Field>
      </section>

      <Loader state={state}>
        {(data) => (data.patients.length === 0 ? <Empty text={t('noPatients')} /> : (
          <ul className="list card">
            {data.patients.map((person) => (
              <li key={person.id} className="row-item">
                <div>
                  <Link to={`/doctor/patients/${person.id}`} className="patient-link">
                    {person.name}
                  </Link>
                  <p className="muted">
                    {person.phone}
                    {person.age !== null ? ` · ${t('years', { n: person.age })}` : ''} · {person.since}
                  </p>
                  <span className="muted small">{person.lastSeen}</span>
                </div>
                <Chips person={person} />
              </li>
            ))}
          </ul>
        ))}
      </Loader>
    </div>
  )
}

function Chips({ person }: { person: PatientSummary }) {
  const { t } = useT()
  if (person.flags.length === 0 && person.allergies.length === 0) return null
  return (
    <div className="chips">
      {person.flags.map((flag) => <span key={flag} className="pill flag">{flag}</span>)}
      {person.allergies.map((item) => (
        <span key={item} className="pill allergy">{t('allergies')}: {item}</span>
      ))}
    </div>
  )
}

function Detail({ id }: { id: string }) {
  const { t } = useT()
  const state = useAsync(() => get<PatientDetail>(`/doctor/patients/${id}/`), [id])

  return (
    <div className="wide">
      <Link to="/doctor/patients" className="link back-link">‹ {t('patientsTitle')}</Link>
      <Loader state={state}>
        {(person) => (
          <>
            <div className="page-head">
              <div>
                <h1>{person.name}</h1>
                <p className="muted">
                  {person.phone}
                  {person.age !== null ? ` · ${t('years', { n: person.age })}` : ''} · {person.since}
                </p>
                <Chips person={person} />
              </div>
            </div>

            <AssessmentEditor id={id} initial={person.assessment} />
            <Visits person={person} onChanged={state.reload} />
            <PrescriptionForm id={id} last={person.lastPrescription} onChanged={state.reload} />
            <Records person={person} onChanged={state.reload} />
          </>
        )}
      </Loader>
    </div>
  )
}

function AssessmentEditor({ id, initial }: { id: string; initial: Assessment }) {
  const { t, lang } = useT()
  const readError = useErrorText()
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const next = await post<Assessment>(`/doctor/patients/${id}/assessment/`, {
        problem: draft.problem, progress: draft.progress, suggestions: draft.suggestions,
      })
      setDraft(next)
      setSaved(true)
    } catch (err) {
      setError(readError(err))
    } finally {
      setBusy(false)
    }
  }

  const edit = (key: keyof Assessment) => (value: string) => {
    setDraft({ ...draft, [key]: value })
    setSaved(false)
  }

  return (
    <Section
      title={t('assessmentTitle')}
      aside={
        <span className="muted small">
          {draft.assessed ? t('updatedOn', { date: formatDate(draft.assessed, lang) }) : t('neverAssessed')}
        </span>
      }
    >
      <p className="muted small">{t('assessmentHint')}</p>
      {error && <Problem message={error} />}
      <Field label={t('problemLabel')}>
        <textarea rows={3} value={draft.problem} onChange={(e) => edit('problem')(e.target.value)} />
      </Field>
      <Field label={t('progressLabel')}>
        <textarea rows={3} value={draft.progress} onChange={(e) => edit('progress')(e.target.value)} />
      </Field>
      {/* The one field the patient sees in their own account. */}
      <Field label={t('suggestionsLabel')}>
        <textarea rows={3} value={draft.suggestions} onChange={(e) => edit('suggestions')(e.target.value)} />
      </Field>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
        {busy ? t('saving') : saved ? t('saved') : t('save')}
      </button>
    </Section>
  )
}

function Visits({ person, onChanged }: { person: PatientDetail; onChanged: () => void }) {
  const { t } = useT()
  if (person.visits.length === 0) {
    return <Section title={t('visitsTitle')}><Empty text={t('noVisits')} /></Section>
  }
  return (
    <Section title={t('visitsTitle')}>
      <ul className="timeline">
        {person.visits.map((visit) => (
          <li key={visit.id}>
            <div className="timeline-head">
              <strong>{visit.date}</strong>
              {visit.reason && <span className="reason">{visit.reason}</span>}
            </div>
            <NoteEditor id={visit.id} note={visit.note} onChanged={onChanged} />
            {visit.prescription && <RxTable rx={visit.prescription} />}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function NoteEditor({ id, note, onChanged }: { id: number; note: string; onChanged: () => void }) {
  const { t } = useT()
  const readError = useErrorText()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(note)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await post(`/doctor/visits/${id}/note/`, { note: draft })
      setOpen(false)
      onChanged()
    } catch (err) {
      setError(readError(err))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <>
        <p className={note ? 'note' : 'muted'}>{note || t('noNoteYet')}</p>
        <button type="button" className="link" onClick={() => { setDraft(note); setOpen(true) }}>
          {note ? t('editNote') : t('writeNote')}
        </button>
      </>
    )
  }

  return (
    <div className="panel">
      {error && <Problem message={error} />}
      <textarea rows={4} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} />
      <div className="row">
        <button type="button" className="btn primary small" disabled={busy || !draft.trim()} onClick={() => void save()}>
          {busy ? t('saving') : t('save')}
        </button>
        <button type="button" className="link" onClick={() => setOpen(false)}>{t('cancel')}</button>
      </div>
    </div>
  )
}

function RxTable({ rx }: { rx: Prescription }) {
  const { t, lang } = useT()
  return (
    <div className="rx">
      <h4>{t('prescribedOn', { date: formatDate(rx.date, lang) })}</h4>
      <table>
        <thead><tr><th>{t('medicine')}</th><th>{t('dose')}</th></tr></thead>
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

type Row = { name: string; dose: string }

function PrescriptionForm({
  id, last, onChanged,
}: {
  id: string
  last: Row[]
  onChanged: () => void
}) {
  const { t } = useT()
  const readError = useErrorText()
  const [rows, setRows] = useState<Row[]>([{ name: '', dose: '' }])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filled = rows.filter((row) => row.name.trim())

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const result = await post<{ sentTo: string }>(`/doctor/patients/${id}/prescription/`, {
        medicines: filled, note,
      })
      setSentTo(result.sentTo)
      setRows([{ name: '', dose: '' }])
      setNote('')
      onChanged()
    } catch (err) {
      setError(readError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title={t('newPrescription')}
      aside={last.length > 0 && (
        <button type="button" className="link" onClick={() => setRows(last.map((m) => ({ ...m })))}>
          {t('copyLast')}
        </button>
      )}
    >
      {error && <Problem message={error} />}
      {sentTo && <p className="ok-line">{t('prescriptionSent', { phone: sentTo })}</p>}

      <table className="rx-editor">
        <thead><tr><th>{t('medicine')}</th><th>{t('dose')}</th><th /></tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <input
                  value={row.name}
                  maxLength={80}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                />
              </td>
              <td>
                <input
                  value={row.dose}
                  maxLength={80}
                  placeholder="1-0-1, 5 days"
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, dose: e.target.value } : r)))}
                />
              </td>
              <td>
                {rows.length > 1 && (
                  <button
                    type="button"
                    className="link"
                    aria-label={t('removeRow')}
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button type="button" className="link" onClick={() => setRows([...rows, { name: '', dose: '' }])}>
        + {t('addMedicine')}
      </button>

      <Field label={t('prescriptionNote')}>
        <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <button type="button" className="btn primary" disabled={busy || filled.length === 0} onClick={() => void send()}>
        {busy ? t('saving') : t('sendPrescription')}
      </button>
    </Section>
  )
}

function Records({ person, onChanged }: { person: PatientDetail; onChanged: () => void }) {
  const { t, lang } = useT()
  const readError = useErrorText()
  const [date, setDate] = useState(todayIso())
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('date', date)
      form.append('text', text)
      if (file) form.append('file', file)
      await post(`/doctor/patients/${person.id}/record/`, form)
      setText('')
      setFile(null)
      onChanged()
    } catch (err) {
      setError(readError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={t('recordsTitle')}>
      <div className="panel">
        <h3>{t('addRecord')}</h3>
        <p className="muted small">{t('recordHint')}</p>
        {error && <Problem message={error} />}
        <Field label={t('recordDate')}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('recordText')}>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label={`${t('chooseFile')} (${t('optional')})`} hint={t('fileHint')}>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <button
          type="button"
          className="btn primary"
          disabled={busy || (!text.trim() && !file)}
          onClick={() => void add()}
        >
          {busy ? t('saving') : t('addRecord')}
        </button>
      </div>

      {person.records.length === 0 ? <Empty text={t('noReports')} /> : (
        <ul className="list">
          {person.records.map((record) => (
            <li key={record.id} className="row-item">
              <div>
                <strong>{formatDate(record.date, lang)}</strong>
                <p>{record.text || '—'}</p>
                <span className="muted small">
                  {record.byDoctor ? t('filedByDoctor') : t('filedByPatient')}
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
  )
}
