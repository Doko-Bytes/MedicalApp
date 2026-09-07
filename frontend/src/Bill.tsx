import { useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import qrcode from 'qrcode-generator'
import { get, type Appointment } from './api'
import { formatDate, formatTime, money, todayIso, useT } from './state'
import { Loader, useAsync } from './ui'

/**
 * An SVG QR, not a canvas one: the slip is meant to be printed, and a raster
 * code at print resolution is what makes a scanner fail at the desk.
 */
function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const code = qrcode(0, 'M') // 0 = pick the smallest version that fits
    code.addData(text)
    code.make()
    return code.createSvgTag({ cellSize: 4, margin: 0, scalable: true })
  }, [text])
  return <div className="qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
}

export default function Bill() {
  const { t, lang } = useT()
  const { id } = useParams()
  const location = useLocation()
  const [copied, setCopied] = useState(false)

  // Straight off the booking POST when we have just arrived; re-fetched when
  // the patient opens the link again later or reloads the page.
  const passed = (location.state as { appointment?: Appointment } | null)?.appointment
  const state = useAsync(async () => {
    if (passed && String(passed.id) === id) return passed
    const data = await get<{ upcoming: Appointment[]; past: Appointment[] }>('/appointments/')
    const found = [...data.upcoming, ...data.past].find((a) => String(a.id) === id)
    if (!found) throw new Error(t('notFound'))
    return found
  }, [id])

  const url = `${window.location.origin}/bill/${id}`

  return (
    <div className="narrow">
      <Loader state={state}>
        {(appt) => (
          <>
            <article className="slip">
              <header className="slip-head">
                <div>
                  <strong>{t('appName')}</strong>
                  <p className="muted small">{t('clinicAddress')} · {t('clinicPhone')}</p>
                </div>
                <div className="slip-head-right">
                  <span className="muted small">{t('billTitle')}</span>
                  <strong className="slip-ref">#{appt.id}</strong>
                </div>
              </header>

              <h1 className={appt.status === 'confirmed' ? 'ok' : ''}>
                {appt.status === 'confirmed' ? t('billBooked') : t('billPending')}
              </h1>
              <p className="muted">
                {appt.status === 'confirmed' ? t('billConfirmedBody') : t('billPendingBody')}
              </p>

              <div className="slip-body">
                <dl className="review">
                  <dt>{t('billPatient')}</dt>
                  <dd>{appt.name || '—'}{appt.age ? ` · ${t('years', { n: appt.age })}` : ''}</dd>
                  <dt>{t('reviewWhen')}</dt>
                  <dd><strong>{formatDate(appt.date, lang)}, {formatTime(appt.time, lang)}</strong></dd>
                  <dt>{t('reviewWhere')}</dt>
                  <dd>{t('doctorName')} · {t('clinicAddressLine')}</dd>
                  <dt>{t('reviewReason')}</dt>
                  <dd>{appt.reason || '—'}</dd>
                  <dt>{t('phoneLabel')}</dt>
                  <dd>{appt.phone}</dd>
                  <dt>{t('billIssued')}</dt>
                  <dd>{formatDate(todayIso(), lang)}</dd>
                </dl>

                <div className="slip-qr">
                  <Qr text={url} />
                  <small className="muted">{t('billScan')}</small>
                </div>
              </div>

              <div className="slip-total">
                <span>{appt.paid ? t('billPaid') : t('billAmount')}</span>
                <strong>{money(appt.fee, lang)}</strong>
              </div>
              <p className="muted small">{appt.paid ? t('feeNote') : t('billPayAtDesk')}</p>
              <p className="muted small slip-footnote">{t('arriveEarly')}</p>
            </article>

            <div className="row no-print">
              <button type="button" className="btn primary" onClick={() => window.print()}>
                {t('print')}
              </button>
              <button
                type="button"
                className="btn white"
                onClick={() => {
                  void navigator.clipboard.writeText(url).then(() => setCopied(true))
                }}
              >
                {copied ? t('linkCopied') : t('copyLink')}
              </button>
              <Link to="/account" className="btn white">{t('goToAccount')}</Link>
            </div>
          </>
        )}
      </Loader>
    </div>
  )
}
