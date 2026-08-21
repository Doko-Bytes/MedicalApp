import { useState } from 'react'
import { Link } from 'react-router-dom'
import { get, type MonthSummary, type PatientSummary, type Trends } from '../api'
import { formatMonth, money, todayIso, useT } from '../state'
import { Bars, Empty, Field, Loader, Section, Stat, useAsync } from '../ui'

export default function Analytics() {
  const { t, lang } = useT()
  const [month, setMonth] = useState(todayIso().slice(0, 7))

  const summary = useAsync(() => get<MonthSummary>(`/doctor/month/?month=${month}`), [month])
  const trends = useAsync(() => get<Trends>(`/doctor/trends/?month=${month}`), [month])
  // A flag is a property of the record, not of the month, so there is no
  // month-scoped endpoint to ask — the list comes back whole and is filtered here.
  // ponytail: /doctor/patients/ returns the first 50 rows, so past 50 patients
  // this panel misses flagged people. Add ?flagged=1 to that endpoint if it does.
  const everyone = useAsync(() => get<{ patients: PatientSummary[] }>('/doctor/patients/'), [])

  return (
    <div className="wide">
      <div className="page-head">
        <h1>{t('analyticsTitle')}</h1>
        <Field label={t('pickMonth')}>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value || todayIso().slice(0, 7))}
          />
        </Field>
      </div>
      {/* The report is a Gregorian month because the backend aggregates by one.
          Dated from mid-month so the Nepali label names the Bikram Sambat month
          it mostly overlaps rather than the one it barely starts in; `range`
          under the totals gives the exact dates either way. */}
      <p className="lede">{formatMonth(`${month}-16`, lang)}</p>

      <Loader state={summary}>
        {(data) => (
          <>
            <div className="stat-row">
              <Stat label={t('collected')} value={money(data.collected, lang)} sub={data.range} />
              <Stat label={t('consultations')} value={String(data.consultations)} />
              <Stat label={t('averageFee')} value={money(data.average, lang)} />
              <Stat label={t('unpaid')} value={money(data.unpaid, lang)} />
            </div>

            <div className="doctor-grid">
              <Section title={t('busiestHours')}>
                {data.busiest.length === 0 ? <Empty text={t('noData')} /> : (
                  <>
                    <Bars rows={data.busiest.map((b) => ({ label: `${b.hour}`, value: b.value }))} />
                    <p className="muted small">{data.conclusion}</p>
                  </>
                )}
              </Section>

              <Section title={t('collected')}>
                <Bars
                  rows={[
                    { label: t('atClinic'), value: data.atClinic },
                    { label: t('wallets'), value: data.wallets },
                    { label: t('unpaid'), value: data.unpaid },
                  ]}
                />
              </Section>
            </div>
          </>
        )}
      </Loader>

      <Loader state={trends}>
        {(data) => (
          <div className="doctor-grid">
            <Section title={t('whyTheyCame')}>
              {data.reasons.length === 0 ? <Empty text={t('noData')} /> : (
                <>
                  <Bars rows={data.reasons} />
                  <p className="muted small">{data.conclusion}</p>
                </>
              )}
            </Section>

            <div className="stack">
              <Section title={t('peopleTitle')}>
                <div className="stat-row">
                  <Stat label={t('newPatients')} value={String(data.newPatients)} />
                  <Stat label={t('returningPatients')} value={String(data.returningPatients)} />
                </div>
              </Section>

              <Section title={t('keptTitle')}>
                <div className="stat-row">
                  <Stat label={t('kept')} value={String(data.kept)} />
                  <Stat label={t('dropped')} value={`${data.dropped} · ${data.droppedPercent}%`} />
                </div>
                <p className="muted small">{t('keptNote')}</p>
              </Section>
            </div>
          </div>
        )}
      </Loader>

      <Section title={t('flaggedPatients')}>
        <p className="muted small">{t('flaggedNote')}</p>
        <Loader state={everyone}>
          {(data) => {
            const flagged = data.patients.filter(
              (p) => p.flags.length > 0 || p.allergies.length > 0)
            return flagged.length === 0 ? <Empty text={t('noFlagged')} /> : (
              <ul className="list">
                {flagged.map((person) => (
                  <li key={person.id} className="row-item">
                    <div>
                      <Link to={`/doctor/patients/${person.id}`} className="patient-link">{person.name}</Link>
                      <p className="muted">{person.phone} · {person.lastSeen}</p>
                    </div>
                    <div className="chips">
                      {person.flags.map((flag) => <span key={flag} className="pill flag">{flag}</span>)}
                      {person.allergies.map((item) => (
                        <span key={item} className="pill allergy">{t('allergies')}: {item}</span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )
          }}
        </Loader>
      </Section>
    </div>
  )
}
