/**
 * Run: node --experimental-strip-types src/dates.test.ts
 *
 * Guards the Bikram Sambat calendar: a month that straddles two Gregorian ones
 * still has to come out as one contiguous run of days, stepping has to land in
 * the neighbouring BS month rather than the neighbouring Gregorian one, and the
 * English path has to stay exactly what it was.
 */
import assert from 'node:assert/strict'
import { altDay, dayNumber, formatDate, formatMonth, monthGrid, stepMonth } from './dates.ts'

// BS 2083 Baisakh 1 is 2026-04-14, the Nepali new year.
assert.equal(dayNumber('2026-04-14', 'ne'), '1')
assert.equal(dayNumber('2026-04-13', 'ne'), '30') // last day of Chaitra 2082
assert.equal(dayNumber('2026-04-14', 'en'), '14')
assert.match(formatDate('2026-04-14', 'ne'), /2083$/)
assert.equal(formatDate('2026-04-14', 'en'), 'Tue, 14 Apr 2026')
assert.equal(formatMonth('2026-04-14', 'en'), 'April 2026')

// Outside BS 2000–2090 the tables cannot answer, so Nepali falls back to
// Gregorian instead of throwing the page away — or, worse, quietly showing the
// wrong day, which is what the converter does on its own for dates before 1943.
assert.equal(dayNumber('1900-01-05', 'ne'), '5')
assert.equal(dayNumber('2044-01-09', 'ne'), '9')
assert.match(formatDate('1900-01-05', 'ne'), /1900/) // Nepali words, Gregorian year

// The corner of a day cell carries the calendar the reader is *not* in. Wide
// cards ask for `long`, which names the month on the 1st; narrow ones must not
// get it, because the month name will not fit beside the load dots.
assert.equal(altDay('2026-08-21', 'ne'), '21')                // Gregorian, under Bhadra 5
assert.equal(altDay('2026-08-21', 'en'), '5')                 // Bikram Sambat, under 21
assert.equal(altDay('2026-09-01', 'ne'), '1')                 // narrow: number only
assert.equal(altDay('2026-09-01', 'ne', true), '1 Sept')      // en-GB writes it 'Sept'
assert.match(altDay('2026-04-14', 'en', true), /^1 \S+$/)     // Baisakh 1, month named

for (const lang of ['en', 'ne'] as const) {
  const grid = monthGrid('2026-04-20', lang)

  // Contiguous, sane length, and the lead pad puts day 1 on the right weekday.
  assert.ok(grid.days.length >= 28 && grid.days.length <= 32, `${lang} length`)
  grid.days.forEach((iso, i) => {
    if (i === 0) return
    const gap = (Date.parse(iso) - Date.parse(grid.days[i - 1])) / 86400000
    assert.equal(gap, 1, `${lang} gap at ${iso}`)
  })
  assert.equal(grid.lead, (new Date(`${grid.days[0]}T00:00:00`).getDay() + 6) % 7, `${lang} lead`)
  assert.equal(dayNumber(grid.days[0], lang), '1', `${lang} starts on the 1st`)
  assert.ok(grid.days.includes('2026-04-20'), `${lang} holds its anchor`)

  // Stepping either way lands in the adjoining month and never back in this one.
  for (const delta of [1, -1] as const) {
    const next = monthGrid(stepMonth('2026-04-20', delta, lang), lang)
    assert.ok(!next.days.some((iso) => grid.days.includes(iso)), `${lang} ${delta} overlaps`)
    const [a, b] = delta === 1 ? [grid, next] : [next, grid]
    assert.equal(
      (Date.parse(b.days[0]) - Date.parse(a.days.at(-1)!)) / 86400000, 1,
      `${lang} ${delta} leaves a gap`)
  }
}

// A BS month really does span two Gregorian months — the reason the doctor's
// calendar has to fetch the load for both.
assert.equal(new Set(monthGrid('2026-04-20', 'ne').days.map((d) => d.slice(0, 7))).size, 2)
assert.equal(new Set(monthGrid('2026-04-20', 'en').days.map((d) => d.slice(0, 7))).size, 1)

console.log('dates: ok')
