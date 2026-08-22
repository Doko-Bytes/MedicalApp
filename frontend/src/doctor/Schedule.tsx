import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  get, post, type Hours, type Schedule as ScheduleData, type Slot, type TimeOff,
} from '../api'
import {
  formatDate, formatTime, money, todayIso, useT, weekdayNames, weekdayOf,
} from '../state'
import { Empty, Field, Loader, Problem, Section, useAsync, useErrorText } from '../ui'
import Calendar from './Calendar'

/** The server only stores the days she is open, so the missing ones are the
 *  closed ones — the editor needs all seven either way. */
const week = (hours: Hours[]): Hours[] =>
  Array.from({ length: 7 }, (_, weekday) =>
    hours.find((h) => h.weekday === weekday)
    ?? { weekday, opens: '', closes: '', breakStart: '', breakEnd: '' })

/** Time off is stored as a range, so a day is affected when it falls inside
 *  one — ISO dates compare correctly as plain strings. */
const offOn = (all: TimeOff[], day: string) =>
  all.filter((off) => off.starts <= day && day <= off.ends)

export default function Schedule() {
  const { t } = useT()
  const loaded = useAsync(() => get<ScheduleData>('/doctor/availability/'), [])

  return (
    <div className="wide">
      <h1>{t('scheduleTitle')}</h1>
      <Loader state={loaded}>{(data) => <Editor initial={data} />}</Loader>
    </div>
  )
}

/** Every change here is a POST that returns the whole schedule back, so the
 *  server stays the one source of truth — including which bookings the change
 *  just stranded. */
function Editor({ initial }: { initial: ScheduleData }) {
  const { t, lang } = useT()
  const readError = useErrorText()
  const [schedule, setSchedule] = useState(initial)
  const [hours, setHours] = useState(week(initial.hours))
  const [day, setDay] = useState(todayIso())
  // Bumped after every change so the calendar and the day's slots re-read.
  const [refresh, setRefresh] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(path: string, payload?: unknown) {
    setError(null)
    setSaving(true)
    try {
      const next = await post<ScheduleData>(path, payload)
      setSchedule(next)
      setHours(week(next.hours))
      setRefresh((n) => n + 1)
      setSaved(true)
      return true
    } catch (err) {
      setError(readError(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  const edit = (weekday: number, patch: Partial<Hours>) => {
    setSaved(false)
    setHours((rows) => rows.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)))
  }

  const set = (patch: Partial<ScheduleData>) => {
    setSaved(false)
    setSchedule((d) => ({ ...d, ...patch }))
  }

  const names = weekdayNames(lang)

  return (
    <>
      {error && <Problem message={error} />}
      {schedule.stranded.length > 0 && <Stranded appointments={schedule.stranded} />}

      <div className="doctor-grid">
        <Calendar date={day} onPick={setDay} refresh={refresh} />
        <DayPanel
          key={day}
          day={day}
          refresh={refresh}
          hours={hours[weekdayOf(day)]}
          off={offOn(schedule.timeOff, day)}
          saving={saving}
          onSend={send}
        />
      </div>

      <Section title={t('comingUp')}>
        {schedule.timeOff.length === 0 ? <Empty text={t('noTimeOff')} /> : (
          <ul className="list">
            {schedule.timeOff.map((off) => (
              <li key={off.id} className="row-item">
                <div>
                  <strong>{off.label}</strong>
                  {off.reason && <p className="muted">{off.reason}</p>}
                </div>
                <div className="row-actions">
                  <button type="button" className="btn ghost small"
                          onClick={() => setDay(off.starts)}>
                    {formatDate(off.starts, lang)}
                  </button>
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={saving}
                    onClick={() => void send(`/doctor/time-off/${off.id}/delete/`)}
                  >
                    {t('removeTimeOff')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('openingHours')}>
        <p className="muted">{t('openingHoursNote')}</p>
        <ul className="list hours-editor">
          {hours.map((row) => {
            const closed = !row.opens || !row.closes
            return (
              <li key={row.weekday}>
                <strong className="hours-day">{names[row.weekday]}</strong>
                <span className="row">
                  <TimeBox label={t('opensAt')} value={row.opens}
                           onChange={(opens) => edit(row.weekday, { opens })} />
                  <span aria-hidden="true">–</span>
                  <TimeBox label={t('closesAt')} value={row.closes}
                           onChange={(closes) => edit(row.weekday, { closes })} />
                  <span className="muted small">{t('breakLabel')}</span>
                  <TimeBox label={`${t('breakLabel')} ${t('fromTime')}`} value={row.breakStart ?? ''}
                           onChange={(breakStart) => edit(row.weekday, { breakStart })} />
                  <span aria-hidden="true">–</span>
                  <TimeBox label={`${t('breakLabel')} ${t('toTime')}`} value={row.breakEnd ?? ''}
                           onChange={(breakEnd) => edit(row.weekday, { breakEnd })} />
                </span>
                {closed ? (
                  <span className="pill">{t('closedDay')}</span>
                ) : (
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => edit(row.weekday,
                      { opens: '', closes: '', breakStart: '', breakEnd: '' })}
                  >
                    {t('clearDay')}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title={t('consultingSettings')}>
        <div className="setting-grid">
          <Field label={t('slotMinutes')} hint={t('slotMinutesNote')}>
            <input
              type="number"
              min={5}
              max={240}
              value={schedule.slotMinutes}
              onChange={(e) => set({ slotMinutes: Number(e.target.value) })}
            />
          </Field>
          <Field label={t('clinicFeeLabel')} hint={t('feeChangeNote')}>
            <input
              type="number"
              min={0}
              value={schedule.clinicFee}
              onChange={(e) => set({ clinicFee: Number(e.target.value) })}
            />
          </Field>
          <Field label={t('videoFeeLabel')}>
            <input
              type="number"
              min={0}
              value={schedule.videoFee}
              onChange={(e) => set({ videoFee: Number(e.target.value) })}
            />
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={schedule.videoEnabled}
            onChange={(e) => set({ videoEnabled: e.target.checked })}
          />
          {t('videoEnabledLabel')}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={schedule.autoAccept}
            onChange={(e) => set({ autoAccept: e.target.checked })}
          />
          {t('autoAcceptLabel')}
        </label>

        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={saving}
            onClick={() => void send('/doctor/availability/', {
              hours,
              slotMinutes: schedule.slotMinutes,
              clinicFee: schedule.clinicFee,
              videoFee: schedule.videoFee,
              videoEnabled: schedule.videoEnabled,
              autoAccept: schedule.autoAccept,
            })}
          >
            {saving ? t('saving') : saved ? t('saved') : t('saveSchedule')}
          </button>
          <span className="muted small">
            {t('clinicFeeLabel')} {money(schedule.clinicFee, lang)}
            {schedule.videoEnabled && ` · ${t('videoFeeLabel')} ${money(schedule.videoFee, lang)}`}
          </span>
        </div>
      </Section>
    </>
  )
}

function TimeBox({
  label, value, onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <input type="time" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function Stranded({ appointments }: { appointments: ScheduleData['stranded'] }) {
  const { t } = useT()
  return (
    <Section title={t('strandedTitle')}>
      <p className="muted">{t('strandedNote')}</p>
      <ul className="list">
        {appointments.map((appt) => (
          <li key={appt.id} className="row-item">
            <div>
              <strong>{appt.name || '—'}</strong>
              <p className="muted">{appt.when} · {appt.phone}</p>
            </div>
            <div className="row-actions">
              <a href={`tel:${appt.phone}`} className="btn ghost small">{t('callPatient')}</a>
              {appt.patientId && (
                <Link to={`/doctor/patients/${appt.patientId}`} className="btn ghost small">
                  {t('openRecord')}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** One day, opened from the calendar: what is left of it, what has been
 *  crossed out, and the form to cross out more. Mounted with the date as its
 *  key, so picking another day starts the form clean rather than carrying
 *  yesterday's half-typed times across. */
function DayPanel({
  day, refresh, hours, off, saving, onSend,
}: {
  day: string
  refresh: number
  hours: Hours
  off: TimeOff[]
  saving: boolean
  onSend: (path: string, payload?: unknown) => Promise<boolean>
}) {
  const { t, lang } = useT()
  const [whole, setWhole] = useState(true)
  const [from, setFrom] = useState(hours.opens || '09:00')
  const [to, setTo] = useState(hours.closes || '17:00')
  const [until, setUntil] = useState(day)
  const [reason, setReason] = useState('')

  const slots = useAsync(
    () => get<{ slots: Slot[] }>(`/slots/?date=${day}`), [day, refresh])

  // Midday splits the day in the shortcuts. It is not a rule about clinics,
  // it is where a doctor draws the line when she says "I am out this morning".
  const midday = '12:00'
  const openDay = Boolean(hours.opens && hours.closes)
  const part = (start: string, end: string) => {
    setWhole(false)
    setFrom(start)
    setTo(end)
  }

  async function crossOut() {
    const done = await onSend('/doctor/time-off/', {
      starts: day,
      ends: until < day ? day : until,
      startTime: whole ? null : from,
      endTime: whole ? null : to,
      reason,
    })
    if (done) setReason('')
  }

  const booked = slots.data?.slots.filter((s) => s.taken).length ?? 0

  return (
    <Section
      title={formatDate(day, lang)}
      aside={off.length > 0 ? <span className="pill soft">{t('partlyClosed')}</span> : undefined}
    >
      <h3 className="panel-heading">{t('openTimes')}</h3>
      <Loader state={slots}>
        {(data) => (data.slots.length === 0 ? <Empty text={t('dayIsClosed')} /> : (
          <>
            <ul className="slot-grid">
              {data.slots.map((slot) => (
                <li key={slot.value}>
                  <span className={slot.taken ? 'slot is-taken' : 'slot'}>
                    {formatTime(slot.value, lang)}
                    {slot.taken && <small>{t('taken')}</small>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted small">
              {t('slotsOpen', { n: data.slots.length - booked })}
            </p>
          </>
        ))}
      </Loader>

      {off.length > 0 && (
        <>
          <h3 className="panel-heading">{t('offOnThisDay')}</h3>
          <ul className="list">
            {off.map((entry) => (
              <li key={entry.id} className="row-item">
                <div>
                  <strong>{entry.wholeDay ? t('wholeDayOff')
                    : `${formatTime(entry.startTime!, lang)} – ${formatTime(entry.endTime!, lang)}`}</strong>
                  <p className="muted">{entry.reason || entry.label}</p>
                </div>
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={saving}
                  onClick={() => void onSend(`/doctor/time-off/${entry.id}/delete/`)}
                >
                  {t('removeTimeOff')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="panel-heading">{t('crossOut')}</h3>
      {booked > 0 && <p className="warn-line">{t('closingBookedDay')}</p>}

      <div className="tabs small-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={whole}
                className={whole ? 'is-active' : ''} onClick={() => setWhole(true)}>
          {t('wholeDayOff')}
        </button>
        <button type="button" role="tab" aria-selected={!whole}
                className={!whole ? 'is-active' : ''} onClick={() => setWhole(false)}>
          {t('partOfDay')}
        </button>
      </div>

      {!whole && (
        <div className="row">
          <TimeBox label={t('fromTime')} value={from} onChange={setFrom} />
          <span aria-hidden="true">–</span>
          <TimeBox label={t('toTime')} value={to} onChange={setTo} />
          {openDay && (
            <>
              <button type="button" className="btn ghost small"
                      onClick={() => part(hours.opens, midday)}>
                {t('morningOff')}
              </button>
              <button type="button" className="btn ghost small"
                      onClick={() => part(midday, hours.closes)}>
                {t('afternoonOff')}
              </button>
            </>
          )}
        </div>
      )}

      <Field label={t('untilDate')} hint={t('untilNote')}>
        <input type="date" min={day} value={until} onChange={(e) => setUntil(e.target.value || day)} />
      </Field>
      <Field label={t('reasonOptional')}>
        <input value={reason} maxLength={100} onChange={(e) => setReason(e.target.value)} />
      </Field>

      <button
        type="button"
        className="btn primary"
        disabled={saving || (!whole && from >= to)}
        onClick={() => void crossOut()}
      >
        {t('addTimeOff')}
      </button>
    </Section>
  )
}
