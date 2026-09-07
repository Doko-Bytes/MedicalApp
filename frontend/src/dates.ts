import NepaliDate from 'nepali-date-converter'

// The package ships both a UMD and an ES module. Bundlers take the ES module
// and hand back the class; Node takes the UMD one and wraps it a level deeper
// — which matters, because dates.test.ts runs under plain Node.
const Nepali = (NepaliDate as { default?: typeof NepaliDate }).default ?? NepaliDate

export type Lang = 'en' | 'ne'

// --- formatting --------------------------------------------------------------
//
// The API sends a few ready-made English labels (`when`, `since`, `conclusion`).
// Anything a patient reads is rebuilt here from the raw `date`/`time` fields
// instead, so it turns over into Nepali with the rest of the page.
//
// Nepali also turns over the *calendar*: dates are shown in Bikram Sambat,
// because that is the one a patient in Kathmandu actually keeps appointments
// by. ISO dates on the wire stay Gregorian — the conversion is display-only.

const locale = (lang: Lang) => (lang === 'ne' ? 'ne-NP-u-nu-latn' : 'en-GB')

const dateFrom = (iso: string) => new Date(`${iso}T00:00:00`)

const isoOf = (when: Date) =>
  `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`

/**
 * The Bikram Sambat date, or null when the calendar should stay Gregorian —
 * either because the page is in English, or because the date falls outside
 * BS 2000–2090, the only span the conversion tables cover.
 */
function bs(iso: string, lang: Lang) {
  if (lang !== 'ne') return null
  try {
    const ne = new Nepali(dateFrom(iso))
    // Past the far end of the tables the converter throws, but before the near
    // end it quietly hands back a wrong date instead — so the answer is only
    // trusted when it converts back to the day we asked about.
    return isoOf(ne.toJsDate()) === iso ? ne : null
  } catch {
    return null
  }
}

// Digits stay Latin to match `nu-latn` above; only the month name is Devanagari.
const bsMonthName = (when: NepaliDate) => when.format('MMMM', 'np')

/** Short weekday name. The week itself is the same one in both calendars. */
export const formatWeekday = (iso: string, lang: Lang) =>
  dateFrom(iso).toLocaleDateString(locale(lang), { weekday: 'short' })

export function formatDate(iso: string, lang: Lang) {
  const ne = bs(iso, lang)
  if (ne) return `${formatWeekday(iso, lang)}, ${ne.getDate()} ${bsMonthName(ne)} ${ne.getYear()}`
  return dateFrom(iso).toLocaleDateString(locale(lang), {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

export function formatDayMonth(iso: string, lang: Lang) {
  const ne = bs(iso, lang)
  if (ne) return `${ne.getDate()} ${bsMonthName(ne)}`
  return dateFrom(iso).toLocaleDateString(locale(lang), { day: 'numeric', month: 'short' })
}

/** The month `iso` falls in — Bikram Sambat in Nepali, so it names one BS month. */
export function formatMonth(iso: string, lang: Lang) {
  const ne = bs(iso, lang)
  if (ne) return `${bsMonthName(ne)} ${ne.getYear()}`
  return dateFrom(`${iso.slice(0, 7)}-01`).toLocaleDateString(locale(lang), {
    month: 'long', year: 'numeric',
  })
}

/** Just the day number of a date — 1–32 in Bikram Sambat. */
export function dayNumber(iso: string, lang: Lang) {
  const ne = bs(iso, lang)
  return String(ne ? ne.getDate() : Number(iso.slice(8, 10)))
}

/**
 * The *other* calendar's name for a date, for the corner of a day cell — the
 * Gregorian day while reading Nepali, and the Bikram Sambat one while reading
 * English. `long` names the month on the 1st, which is the only day a bare
 * number leaves you guessing about; ask for it only where the card is wide
 * enough, since '1 Sept' is twice the width of '1'.
 */
export function altDay(iso: string, lang: Lang, long = false) {
  const other: Lang = lang === 'ne' ? 'en' : 'ne'
  const day = dayNumber(iso, other)
  return long && day === '1' ? formatDayMonth(iso, other) : day
}

/** '14:30' as the clinic writes it: '2:30 PM'. */
export function formatTime(hhmm: string, lang: Lang) {
  const [h, m] = hhmm.split(':').map(Number)
  const when = new Date(2000, 0, 1, h, m)
  return when.toLocaleTimeString(locale(lang), { hour: 'numeric', minute: '2-digit' })
}

export const formatWhen = (iso: string, hhmm: string, lang: Lang) =>
  `${formatDate(iso, lang)}, ${formatTime(hhmm, lang)}`

export const money = (amount: number, lang: Lang) =>
  `${lang === 'ne' ? 'रु.' : 'Rs.'} ${amount.toLocaleString('en-US')}`

/** Monday-first weekday names, for the doctor's calendar header. */
export function weekdayNames(lang: Lang) {
  const format = new Intl.DateTimeFormat(locale(lang), { weekday: 'short' })
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(2024, 0, 1 + i)))
}

export const todayIso = () => isoOf(new Date())

/** The weekday as the API numbers them — 0 is Monday, like Hours.weekday and
 *  like the calendar grid, not like JavaScript's Sunday-first getDay(). */
export const weekdayOf = (iso: string) => (dateFrom(iso).getDay() + 6) % 7

/** `days` later, as an ISO date. Adding to the day-of-month rather than to a
 *  timestamp keeps it on the same wall clock across a DST change. */
export function addDays(iso: string, days: number) {
  const when = dateFrom(iso)
  when.setDate(when.getDate() + days)
  return isoOf(when)
}

// --- the calendar grid -------------------------------------------------------
//
// A Bikram Sambat month straddles two Gregorian ones, so the grid cannot be
// derived from a `YYYY-MM` string any more. It is described by any ISO date
// inside it instead, and every cell is a plain ISO date — which keeps the rest
// of the calendar, and every API call it makes, calendar-agnostic.

/** First day of the month holding `iso`, and first day of the one after it. */
function monthBounds(iso: string, lang: Lang): [string, string] {
  const ne = bs(iso, lang)
  if (ne) {
    const [year, month] = [ne.getYear(), ne.getMonth()]
    const first = new Nepali(year, month, 1)
    const next = new Nepali(month === 11 ? year + 1 : year, (month + 1) % 12, 1)
    return [isoOf(first.toJsDate()), isoOf(next.toJsDate())]
  }
  const [year, month] = iso.split('-').map(Number)
  return [`${iso.slice(0, 7)}-01`, isoOf(new Date(year, month, 1))]
}

/** Every day of the month holding `iso`, plus the Monday-first blanks before it. */
export function monthGrid(iso: string, lang: Lang) {
  const [first, next] = monthBounds(iso, lang)
  const days: string[] = []
  for (const day = dateFrom(first); isoOf(day) < next; day.setDate(day.getDate() + 1)) {
    days.push(isoOf(day))
  }
  return { days, lead: (dateFrom(first).getDay() + 6) % 7 }
}

/** A date in the month before or after the one holding `iso`. */
export function stepMonth(iso: string, delta: 1 | -1, lang: Lang) {
  const [first, next] = monthBounds(iso, lang)
  if (delta === 1) return next
  // The day before the 1st is the last day of the month before — true in
  // whichever calendar drew `first`.
  const before = dateFrom(first)
  before.setDate(before.getDate() - 1)
  return isoOf(before)
}
