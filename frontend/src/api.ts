// One fetch wrapper for the whole app. Django authenticates with a session
// cookie, so every call is same-origin with credentials and every write
// carries the CSRF token that GET /api/auth/me/ plants.

const csrfToken = () => document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/)?.[1] ?? ''

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      'X-CSRFToken': csrfToken(),
      ...init?.headers,
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError((data as { error?: string }).error || `Request failed (${res.status})`, res.status)
  }
  return data as T
}

export const get = <T,>(path: string) => request<T>(path)

export const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, {
    method: 'POST',
    body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
  })

// --- shapes the API actually returns ----------------------------------------

export type User = { phone: string; name: string; isDoctor: boolean }

export type DayOption = {
  value: string
  weekday: string
  day: string
  today: boolean
  closed: boolean
  freeCount: number
}

export type Hours = {
  weekday: number
  opens: string
  closes: string
  /** Only the doctor's schedule screen asks for the break; /days/ omits it. */
  breakStart?: string | null
  breakEnd?: string | null
}

export type DaysResponse = {
  days: DayOption[]
  clinicFee: number
  videoFee: number
  videoEnabled: boolean
  hours: Hours[]
}

export type Slot = { value: string; label: string; taken: boolean }

export type Appointment = {
  id: number
  date: string
  time: string
  when: string
  mode: string
  reason: string
  notes: string
  name: string
  age: number | null
  phone: string
  status: 'held' | 'pending' | 'confirmed' | 'declined' | 'cancelled'
  payment: string
  fee: number
  paid: boolean
  visitNote: string
  patientId: string | null
}

/** An agenda row is either a booked appointment or an empty slot. */
export type AgendaRow = Appointment | { time: string; free: true }
export const isFree = (row: AgendaRow): row is { time: string; free: true } => 'free' in row

export type Prescription = {
  id: number
  medicines: { name: string; dose: string }[]
  note: string
  date: string
}

export type MedicalRecord = {
  id: number
  date: string
  kind: 'note' | 'report'
  text: string
  byDoctor: boolean
  fileUrl: string | null
}

export type History = {
  visits: (Appointment & { prescription: Prescription | null })[]
  records: MedicalRecord[]
  medicines: { name: string; dose: string; date: string }[]
  suggestions: { name: string; text: string; date: string | null }[]
}

export type PatientSummary = {
  id: string
  name: string
  age: number | null
  phone: string
  flags: string[]
  allergies: string[]
  since: string
  lastSeen: string
}

export type Assessment = {
  problem: string
  progress: string
  suggestions: string
  assessed: string | null
}

export type PatientDetail = PatientSummary & {
  assessment: Assessment
  visits: {
    id: number
    date: string
    when: string
    reason: string
    note: string
    prescription: Prescription | null
  }[]
  records: MedicalRecord[]
  prescriptions: Prescription[]
  lastPrescription: { name: string; dose: string }[]
}

export type MonthSummary = {
  title: string
  range: string
  collected: number
  consultations: number
  average: number
  atClinic: number
  wallets: number
  unpaid: number
  busiest: { hour: string; value: number }[]
  conclusion: string
}

export type Trends = {
  title: string
  reasons: { label: string; value: number }[]
  newPatients: number
  returningPatients: number
  kept: number
  dropped: number
  droppedPercent: number
  conclusion: string
}

/** A stretch of the diary crossed out: a fortnight away, one afternoon, or
 *  the same window across a run of days. `ends` is inclusive. */
export type TimeOff = {
  id: number
  starts: string
  ends: string
  startTime: string | null
  endTime: string | null
  wholeDay: boolean
  reason: string
  /** Server-rendered, so the two sides cannot disagree about what it says. */
  label: string
}

/** D3. The whole of the doctor's schedule — GET it, edit it, POST it back. */
export type Schedule = {
  slotMinutes: number
  clinicFee: number
  videoFee: number
  videoEnabled: boolean
  autoAccept: boolean
  hours: Hours[]
  timeOff: TimeOff[]
  /** Already booked, but no longer inside the hours she just set. */
  stranded: Appointment[]
}

export type MonthLoad = {
  month: string
  days: Record<string, { booked: number; pending: number }>
  /** No slots at all — closed weekday, or the whole day crossed out. */
  blocked: string[]
  /** Open, but with some of the day crossed out. */
  partial: string[]
}
