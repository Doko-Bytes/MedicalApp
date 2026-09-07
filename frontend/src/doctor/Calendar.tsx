import { useState } from 'react'
import { get, type MonthLoad } from '../api'
import {
  altDay, dayNumber, formatMonth, monthGrid, stepMonth, todayIso, useT, weekdayNames,
} from '../state'
import { Loader, Section, useAsync } from '../ui'

/** A month at a glance: how full each day is, and which days are closed.
 *
 * In Nepali the month drawn is a Bikram Sambat one, so it straddles two
 * Gregorian months and the load has to be fetched for both — the endpoint
 * only knows `YYYY-MM`. Two calls, merged; the grid itself never learns which
 * calendar it is in.
 *
 * Shared by the dashboard, which uses it to walk the diary, and the schedule,
 * which uses it to change the diary — same picture, and it has to stay the
 * same picture or the second screen would be lying about the first. */
export default function Calendar({
  date, onPick, refresh = 0,
}: {
  date: string
  onPick: (date: string) => void
  /** Bump after changing the schedule to re-read the month. */
  refresh?: number
}) {
  const { t, lang } = useT()
  const [anchor, setAnchor] = useState(date) // any day inside the month on show
  const { days, lead } = monthGrid(anchor, lang)

  const months = [...new Set(days.map((iso) => iso.slice(0, 7)))]
  const load = useAsync(async () => {
    const parts = await Promise.all(
      months.map((month) => get<MonthLoad>(`/doctor/month-load/?month=${month}`)))
    return {
      days: Object.assign({}, ...parts.map((p) => p.days)) as MonthLoad['days'],
      blocked: parts.flatMap((p) => p.blocked),
      partial: parts.flatMap((p) => p.partial),
    }
  }, [months.join(), refresh])

  const today = todayIso()

  return (
    <Section
      title={t('calendar')}
      aside={
        <span className="row">
          <button type="button" className="btn ghost small" aria-label={t('prevMonth')} onClick={() => setAnchor(stepMonth(anchor, -1, lang))}>‹</button>
          <span className="month-label">{formatMonth(anchor, lang)}</span>
          <button type="button" className="btn ghost small" aria-label={t('nextMonth')} onClick={() => setAnchor(stepMonth(anchor, 1, lang))}>›</button>
        </span>
      }
    >
      <div className="cal-weekdays">
        {weekdayNames(lang).map((name) => <span key={name}>{name}</span>)}
      </div>
      <Loader state={load}>
        {(data) => (
          <div className="cal-grid">
            {Array.from({ length: lead }, (_, i) => <span key={`pad-${i}`} className="cal-pad" />)}
            {days.map((iso) => {
              const counts = data.days[iso]
              const blocked = data.blocked.includes(iso)
              return (
                <button
                  key={iso}
                  type="button"
                  className={[
                    'cal-day',
                    iso === date ? 'is-picked' : '',
                    iso === today ? 'is-today' : '',
                    blocked ? 'is-blocked' : '',
                    !blocked && data.partial.includes(iso) ? 'is-partial' : '',
                  ].join(' ')}
                  aria-pressed={iso === date}
                  onClick={() => onPick(iso)}
                >
                  <span className="cal-number">{dayNumber(iso, lang)}</span>
                  <span className="date-alt">{altDay(iso, lang)}</span>
                  {counts && (
                    <span className="cal-load">
                      {counts.booked > 0 && <span className="dot booked">{counts.booked}</span>}
                      {counts.pending > 0 && <span className="dot pending">{counts.pending}</span>}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </Loader>
      {/* Each swatch is wrapped with its own label so a wrap never strands
          one from the other — four of these do not fit on one line. */}
      <p className="muted legend">
        <span><span className="dot booked" /> {t('statusConfirmed')}</span>
        <span><span className="dot pending" /> {t('statusPending')}</span>
        <span><span className="swatch is-partial" /> {t('partlyClosed')}</span>
        <span><span className="swatch is-blocked" /> {t('closedDay')}</span>
      </p>
    </Section>
  )
}
