# Sanjivani Clinic — frontend

React + TypeScript + Vite. Talks to the Django API in `../backend`.

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api and /media to :8000
npm run build    # tsc -b && vite build
npm run lint     # oxlint
```

Or run both halves at once from the repo root: `docker compose up`.

The dev server proxies `/api` to Django (`VITE_API_TARGET`, default
`http://127.0.0.1:8000`), so the browser only ever sees one origin and the
session and CSRF cookies are first-party. There is no CORS config anywhere,
and there is no token in `localStorage` — sign-in is a Django session.

## Screens

| Route | Who | What |
| --- | --- | --- |
| `/` | anyone | Doctor and clinic details, opening hours, next free times |
| `/book` | anyone | Pick a day and time, hold it, sign in, confirm |
| `/bill/:id` | patient | The appointment slip: QR, print / save as PDF, shareable link |
| `/login` | anyone | Phone + SMS code |
| `/account` | patient | Appointments, visit history, prescriptions, reports, the doctor's advice |
| `/doctor` | doctor | The day's list, a month calendar, requests waiting to be accepted |
| `/doctor/patients` | doctor | Search, then the whole record: assessment, visit notes, prescriptions, files |
| `/doctor/analytics` | doctor | Takings, busiest hours, why people came, flagged patients |

## Files

- `api.ts` — the one fetch wrapper (CSRF, errors) and the API's types
- `state.tsx` — language and signed-in-user contexts, plus date/money formatting
- `strings.ts` — every user-facing string, English and Nepali side by side
- `ui.tsx` — the loading/error hook and the handful of shared components
- `styles.css` — the whole stylesheet, including the print rules for the slip

## Language

Two languages, one flat table in `strings.ts`, `t('key')` to read it — no i18n
library. Dates, times and money go through `Intl` with the current locale
rather than being formatted on the server, so the whole page turns over
together. The API does send a few ready-made English labels (`when`, `since`,
`conclusion`); anything a *patient* reads is rebuilt from the raw `date` and
`time` fields instead. Those labels still show in English on the doctor's
analytics prose.

## Two things worth knowing

- **The slip is printed, not generated.** "Save as PDF" is the browser's own
  print dialogue driven by the `@media print` block. A PDF library would ship
  300 kB to produce a worse-looking document.
- **A hold is not a booking.** Picking a time reserves it for ten minutes while
  the patient signs in; the countdown on screen is the same deadline the server
  enforces. Signing in hands the hold to the account that just proved the number.
