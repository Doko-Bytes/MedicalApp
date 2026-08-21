// The homepage as drawn in the Mecliw Figma file: mint page, dark-teal brand,
// oversized Urbanist headings, white rounded cards on a 1450px grid.
//
// The template's placeholder blocks are filled with what the clinic actually
// has — live opening days, the real fee, the real hours — rather than the
// lorem the design ships with. Photography is still a grey block: the Figma
// file has no images in it either.

import { Link } from 'react-router-dom'
import { get, type DaysResponse } from './api'
import { formatDayMonth, formatTime, money, useT, weekdayNames } from './state'
import { Loader, useAsync } from './ui'
import type { StringKey } from './strings'

const STEPS: [StringKey, StringKey][] = [
  ['step1Title', 'step1Body'],
  ['step2Title', 'step2Body'],
  ['step3Title', 'step3Body'],
  ['step4Title', 'step4Body'],
]

const SERVICES: [StringKey, StringKey, string][] = [
  ['svc1Title', 'svc1Body', 'stethoscope'],
  ['svc2Title', 'svc2Body', 'ecg'],
  ['svc3Title', 'svc3Body', 'vaccines'],
  ['svc4Title', 'svc4Body', 'prescriptions'],
]

const QUOTES: StringKey[] = ['quote1', 'quote2', 'quote3']

export default function Landing() {
  const { t, lang } = useT()
  const state = useAsync(() => get<DaysResponse>('/days/'), [])
  const openDays = (state.data?.days ?? []).filter((day) => !day.closed && day.freeCount > 0)

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">{t('heroKicker')}</p>
          <h1>
            {t('heroTitle')}
            <AvatarPill />
          </h1>
          <p className="lede">{t('heroBody')}</p>
          <div className="row hero-actions">
            <Link to="/book" className="btn primary big">{t('heroCta')}</Link>
            <Link to="/account" className="btn outline big">{t('heroSecondary')}</Link>
          </div>

          <dl className="hero-stats">
            <div>
              <dt>{t('yearsPractising')}</dt>
              <dd>{t('yearsPractisingLabel')}</dd>
            </div>
            <div>
              <dt>{state.data ? money(state.data.clinicFee, lang) : '—'}</dt>
              <dd>{t('consultationFee')}</dd>
            </div>
          </dl>
        </div>

        <div className="hero-art">
          <Photo className="hero-photo" />
          <article className="doctor-chip">
            <span className="doctor-chip-face" aria-hidden="true" />
            <span>
              <strong>{t('doctorName')}</strong>
              <small>{t('doctorTitle')}</small>
            </span>
            <img src="/fig/arrow-badge.svg" alt="" width="53" height="53" />
          </article>
        </div>

        <article className="hero-next">
          <h2>{t('nextAvailable')}</h2>
          <Loader state={state}>
            {() =>
              openDays.length === 0 ? (
                <p className="muted">{t('noSlots')}</p>
              ) : (
                <>
                  <p className="muted small">{t('inPersonNote')}</p>
                  <ul className="chip-row">
                    {openDays.slice(0, 3).map((day) => (
                      <li key={day.value}>
                        <Link to={`/book?date=${day.value}`}>
                          {day.today ? t('today') : formatDayMonth(day.value, lang)}
                          {' · '}
                          {t('slotsFree', { n: day.freeCount })}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )
            }
          </Loader>
        </article>
      </section>

      <section className="step-cards">
        <h2 className="sr-only">{t('howItWorks')}</h2>
        {STEPS.map(([title, body], i) => (
          <article key={title} className="paper step-card">
            <p className="big-number">{String(i + 1).padStart(2, '0')}</p>
            <div>
              <h3>{t(title)}</h3>
              <p className="soft">{t(body)}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="about">
        <Photo className="about-photo" />
        <Photo className="about-photo-small" />
        <div className="about-copy">
          <h2>{t('aboutHeadline')}</h2>
          <p className="soft">{t('doctorBio')}</p>
          <p className="doctor-line">
            <strong>{t('doctorName')}</strong>
            <span className="soft"> — {t('doctorTitle')}</span>
          </p>
        </div>
      </section>

      <section className="clinic">
        <div className="clinic-copy">
          <h2>{t('clinicHeadline')}</h2>
          <p className="doctor-line"><strong>{t('clinicAddress')}</strong></p>
          <p className="soft">{t('clinicAddressLine')}</p>
          <p className="soft">{t('clinicPhone')}</p>
          <Link to="/book" className="btn primary big">{t('heroCta')}</Link>
        </div>

        <article className="paper hours-card">
          <h3>{t('openingHours')}</h3>
          <Loader state={state}>{(data) => <HoursTable hours={data.hours} />}</Loader>
          <p className="hours-foot">
            <span className="soft">{t('openDaysLabel')}</span>
            <strong>{state.data ? openDays.length : '—'}</strong>
          </p>
        </article>
      </section>

      <section className="services">
        <div className="services-head">
          <h2>{t('servicesHeadline')}</h2>
          <article className="paper fee-card">
            <h3>{t('consultationFee')}</h3>
            <p className="fee-amount">{state.data ? money(state.data.clinicFee, lang) : '—'}</p>
            <p className="soft small">{t('feeNote')}</p>
            <span className="outline-chip">{t('inPersonOnly')}</span>
          </article>
        </div>

        <div className="service-grid">
          {SERVICES.map(([title, body, icon]) => (
            <article key={title} className="paper service-card">
              <span className="icon-tile">
                <img src={`/fig/icon-${icon}.svg`} alt="" width="43" height="43" />
              </span>
              <div>
                <h3>{t(title)}</h3>
                <p className="soft">{t(body)}</p>
              </div>
              <Photo className="service-photo" />
            </article>
          ))}
        </div>
      </section>

      <section className="banner">
        <h2>{t('ctaHeadline')}</h2>
        <Link to="/book" className="btn white big">{t('heroCta')}</Link>
      </section>

      <section className="quotes">
        <div className="quotes-head">
          <h2>{t('quotesHeadline')}</h2>
          <AvatarPill />
        </div>
        <ul className="quote-row">
          {QUOTES.map((key) => (
            <li key={key}>
              <img className="stars" src="/fig/star.svg" alt="" width="221" height="29" />
              <p>{t(key)}</p>
              <p className="quote-by">
                <strong>{t('quoteName')}</strong>
                <span className="soft">{t('quotePlace')}</span>
              </p>
              <img className="quote-mark" src="/fig/quote.svg" alt="" width="74" height="74" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/**
 * The design's stacked-faces badge: a dark pill behind the exported avatar
 * row, which is why the SVG alone has no background of its own.
 */
function AvatarPill() {
  return (
    <span className="avatar-pill" aria-hidden="true">
      <img src="/fig/avatar-pill.svg" alt="" width="229" height="53" />
    </span>
  )
}

/** The Figma file ships grey blocks where the photography goes; so do we. */
function Photo({ className }: { className: string }) {
  const { t } = useT()
  return <span className={`photo ${className}`} role="img" aria-label={t('photoPending')} />
}

/** A weekday with no row in `hours` is a day the clinic does not open. */
function HoursTable({ hours }: { hours: DaysResponse['hours'] }) {
  const { t, lang } = useT()
  const names = weekdayNames(lang)
  const byWeekday = new Map(hours.map((h) => [h.weekday, h]))

  return (
    <table className="hours">
      <tbody>
        {names.map((name, weekday) => {
          const row = byWeekday.get(weekday)
          return (
            <tr key={name} className={row ? '' : 'is-closed'}>
              <th scope="row">{name}</th>
              <td>
                {row
                  ? `${formatTime(to24(row.opens), lang)} – ${formatTime(to24(row.closes), lang)}`
                  : t('closed')}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** /days/ sends '9:00 AM'-style labels; formatTime wants 'HH:MM'. */
function to24(label: string) {
  const match = label.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (!match) return label
  const [, hour, minute, meridiem] = match
  let h = Number(hour)
  if (meridiem?.toUpperCase() === 'PM' && h !== 12) h += 12
  if (meridiem?.toUpperCase() === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${minute}`
}
