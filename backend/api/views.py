import json
import random
import re
from datetime import date, datetime, timedelta
from functools import wraps
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model, login, logout
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .models import (
    HOLD_MINUTES,
    Appointment,
    Clinic,
    Hours,
    OtpCode,
    Patient,
    Prescription,
    Record,
    TimeOff,
    clinic_trends,
    csv,
    day_options,
    free_slots,
    month_summary,
    purge_expired_holds,
    slot_times,
    stranded,
)

User = get_user_model()
PHONE = re.compile(r'^9[78]\d{8}$')  # Nepali mobile, same rule as flow.ts


def send_sms(phone, text):
    """ponytail: prints the message. Swap the body for the gateway call —
    every caller already passes a finished string from the §20 templates."""
    print(f'SMS -> {phone}: {text}')


def body(request):
    try:
        return json.loads(request.body or b'{}')
    except ValueError:
        return {}


def error(message, status=400):
    return JsonResponse({'error': message}, status=status)


def login_required(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return error('Sign in first.', 401)
        return view(request, *args, **kwargs)

    return wrapped


def doctor_only(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_staff:
            return error('Doctor only.', 403)
        return view(request, *args, **kwargs)

    return wrapped


def parse_date(value, fallback=None):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return fallback


def parse_time(value):
    try:
        return datetime.strptime(value, '%H:%M').time()
    except (TypeError, ValueError):
        return None


MAX_UPLOAD = 5 * 1024 * 1024
# The first bytes of each format we accept. A browser's filename and
# Content-Type are both claims by the client; these are the file itself.
SIGNATURES = {
    '.pdf': b'%PDF-',
    '.jpg': b'\xff\xd8\xff',
    '.jpeg': b'\xff\xd8\xff',
    '.png': b'\x89PNG\r\n\x1a\n',
}


def checked_upload(upload):
    """(file, error_response). Either may be None; a missing file is not an
    error here because most records are text only."""
    if not upload:
        return None, None
    if upload.size > MAX_UPLOAD:
        return None, error('That file is bigger than 5 MB. Send a smaller scan.', 413)

    # Never trust the path in the name — keep the last segment and nothing else.
    upload.name = Path(upload.name).name
    signature = SIGNATURES.get(Path(upload.name).suffix.lower())
    if not signature:
        return None, error('Send a PDF, JPG or PNG.')
    head = upload.file.read(len(signature))
    upload.file.seek(0)
    if head != signature:
        return None, error('That file is not the kind of file its name says it is.')
    return upload, None


# --- auth (phone + code, no passwords) --------------------------------------


@ensure_csrf_cookie
@require_GET
def me(request):
    """Also the handshake that plants the CSRF cookie for later POSTs."""
    user = request.user
    if not user.is_authenticated:
        return JsonResponse({'user': None})
    return JsonResponse({'user': {'phone': user.username, 'name': user.first_name,
                                  'isDoctor': user.is_staff}})


@require_POST
def request_code(request):
    phone = str(body(request).get('phone', '')).replace(' ', '')
    if not PHONE.match(phone):
        return error('Enter a 10-digit mobile number starting 98 or 97.')

    # Nothing is actually sent yet, so in DEBUG the code is fixed and the
    # resend throttle — which only exists to protect the SMS bill — is off.
    dev_code = settings.DEV_LOGIN_CODE if settings.DEBUG else ''

    recent = OtpCode.objects.filter(phone=phone, created__gt=timezone.now() - timedelta(seconds=20))
    if recent.exists() and not dev_code:
        return error('A code was just sent. Wait a few seconds.', 429)

    code = dev_code or f'{random.randint(0, 999999):06d}'
    OtpCode.objects.create(phone=phone, code=code)
    send_sms(phone, f'Sanjivani code: {code}. Valid 10 minutes. Never share it - '
                    f'the clinic will not ask you for it.')
    return JsonResponse({'sent': True})


@require_POST
def verify_code(request):
    data = body(request)
    phone = str(data.get('phone', '')).replace(' ', '')
    code = str(data.get('code', ''))
    otp = OtpCode.objects.filter(phone=phone, code=code).order_by('-created').first()
    if not otp or not otp.is_valid():
        return error('That code is wrong or has expired.')

    otp.used = True
    otp.save(update_fields=['used'])
    user, _ = User.objects.get_or_create(username=phone)

    # A hold made before signing in belongs to whoever just signed in.
    Appointment.objects.filter(session_key=request.session.session_key,
                               status=Appointment.HELD).update(patient=user, phone=phone)
    login(request, user)
    return JsonResponse({'user': {'phone': user.username, 'name': user.first_name,
                                  'isDoctor': user.is_staff}})


@require_POST
@login_required
def update_profile(request):
    """The one thing about an account that is the patient's to change.

    The number is not editable here on purpose: it is the credential, and
    moving it would hand this account's whole record to whoever answers the
    new handset. Changing it is a phone call to the clinic.
    """
    name = str(body(request).get('name', '')).strip()
    if not name:
        return error('Enter the name the clinic should call you by.')
    if len(name) > 150:
        return error('That name is too long.')

    request.user.first_name = name
    request.user.save(update_fields=['first_name'])
    return JsonResponse({'user': {'phone': request.user.username, 'name': name,
                                  'isDoctor': request.user.is_staff}})


@require_POST
def sign_out(request):
    logout(request)
    return JsonResponse({'ok': True})


# --- scheduling, patient side ------------------------------------------------


@require_GET
def days(request):
    start = parse_date(request.GET.get('from'), timezone.localdate())
    clinic = Clinic.get()
    return JsonResponse({
        'days': day_options(start),
        'clinicFee': clinic.clinic_fee,
        'videoFee': clinic.video_fee,
        'videoEnabled': clinic.video_enabled,
        # The landing page states the opening hours rather than hard-coding
        # "closed Saturdays" — a blocked weekday is simply a missing row.
        'hours': [{'weekday': h.weekday, 'opens': clock(h.opens), 'closes': clock(h.closes)}
                  for h in Hours.objects.all()],
    })


@require_GET
def slots(request):
    day = parse_date(request.GET.get('date'))
    if not day:
        return error('Pass ?date=YYYY-MM-DD.')
    return JsonResponse({
        'date': day.isoformat(),
        'slots': [{'value': t.strftime('%H:%M'),
                   'label': clock(t),
                   'taken': taken} for t, taken in free_slots(day)],
    })


@require_POST
def hold(request):
    """Reserve the slot for ten minutes, before the patient has signed in."""
    data = body(request)
    day = parse_date(data.get('date'))
    when = data.get('time')
    if not day or not when:
        return error('Need date and time.')
    if not any(t.strftime('%H:%M') == when and not taken for t, taken in free_slots(day)):
        return error('That time has just gone. Pick another.', 409)

    if not request.session.session_key:
        request.session.create()
    mine = Appointment.objects.filter(status=Appointment.HELD)
    mine = mine.filter(patient=request.user) if request.user.is_authenticated \
        else mine.filter(session_key=request.session.session_key)
    mine.delete()  # one hold at a time — moving to another slot frees the old one

    try:
        appt = Appointment.objects.create(
            date=day, time=when, status=Appointment.HELD,
            session_key=request.session.session_key,
            patient=request.user if request.user.is_authenticated else None,
            hold_expires=timezone.now() + timedelta(minutes=HOLD_MINUTES),
        )
    except IntegrityError:
        return error('That time has just gone. Pick another.', 409)
    return JsonResponse({'id': appt.id, 'expiresAt': appt.hold_expires.isoformat(),
                         'minutes': HOLD_MINUTES}, status=201)


def clock(t):
    """'2:30 PM' — the label every screen and SMS shows."""
    return t.strftime('%I:%M %p').lstrip('0')


def as_json(appt):
    return {
        'id': appt.id,
        'date': appt.date.isoformat(),
        'time': appt.time.strftime('%H:%M'),
        'when': f"{appt.date.strftime('%a')} {appt.date.day} {appt.date.strftime('%b')}, {clock(appt.time)}",
        'mode': appt.mode,
        'reason': appt.reason,
        'notes': appt.notes,
        'name': appt.name,
        'age': appt.age,
        'phone': appt.phone,
        'status': appt.status,
        'payment': appt.payment,
        'fee': appt.fee,
        'paid': appt.paid,
        'visitNote': appt.visit_note,
        'patientId': str(appt.person_id) if appt.person_id else None,
    }


@login_required
@require_POST
def book(request):
    """Turn the patient's held slot into a real booking (F4 · Review)."""
    purge_expired_holds()
    data = body(request)
    appt = Appointment.objects.filter(patient=request.user, status=Appointment.HELD).first()
    if not appt:
        return error('Your hold has expired. Choose a time again.', 409)

    appt.name = str(data.get('name', ''))[:100]
    appt.age = data.get('age') or None
    appt.phone = str(data.get('phone') or request.user.username)
    appt.mode = 'video' if data.get('mode') == 'video' else 'clinic'
    appt.reason = str(data.get('reason', ''))[:100]
    appt.notes = str(data.get('notes', ''))
    appt.payment = data.get('payment', 'clinic')
    appt.lang = 'ne' if data.get('lang') == 'ne' else 'en'
    appt.status = Appointment.CONFIRMED if Clinic.get().auto_accept else Appointment.PENDING
    appt.hold_expires = None
    appt.fee_amount = appt.fee  # freeze today's price onto the booking
    # One record per person, not per handset: the same number booking a
    # different name is a different family member (§17).
    appt.person = Patient.objects.filter(phone=appt.phone, name__iexact=appt.name).first() \
        or Patient.objects.create(phone=appt.phone, name=appt.name, age=appt.age,
                                  account=request.user)
    if appt.age and not appt.person.age:
        appt.person.age = appt.age
        appt.person.save(update_fields=['age'])
    appt.save()

    if appt.status == Appointment.CONFIRMED:
        send_sms(appt.phone, f"Booked: Dr. Anjana Shrestha, {appt.date} "
                             f"{clock(appt.time)}. "
                             f"Rs. {appt.fee} at the clinic.")
    return JsonResponse(as_json(appt), status=201)


@login_required
@require_GET
def my_appointments(request):
    purge_expired_holds()
    qs = request.user.appointments.exclude(status=Appointment.HELD)
    upcoming = qs.filter(date__gte=timezone.localdate()).exclude(status=Appointment.CANCELLED)
    past = qs.filter(date__lt=timezone.localdate())
    return JsonResponse({'upcoming': [as_json(a) for a in upcoming],
                         'past': [as_json(a) for a in past]})


# --- the patient's own record ------------------------------------------------


def my_people(user):
    """The Patient rows this user has actually booked for — themselves and
    whoever else they brought. The only safe basis for showing a record."""
    return {a.person_id for a in user.appointments.exclude(status=Appointment.HELD)
            if a.person_id}


def medicine_rows(scripts):
    """Every medicine ever prescribed, newest prescription first."""
    return [{'name': m.get('name', ''), 'dose': m.get('dose', ''),
             'date': timezone.localtime(rx.created).date().isoformat()}
            for rx in scripts for m in rx.medicines]


def script_json(rx):
    return {'id': rx.id, 'medicines': rx.medicines, 'note': rx.note,
            'date': timezone.localtime(rx.created).date().isoformat()}


@login_required
@require_GET
def history(request):
    """The patient's whole record in one read: past visits, the note the
    doctor wrote at each, the prescription that came out of it, and anything
    filed outside an appointment.

    Scoped by the Appointment -> User foreign key, never by phone.
    `Patient.phone` is deliberately not unique (a household shares a handset),
    so scoping by number would hand one family member everyone else's record.
    """
    purge_expired_holds()
    today = timezone.localdate()
    visits = list(request.user.appointments
                  .exclude(status__in=(Appointment.HELD, Appointment.CANCELLED))
                  .filter(date__lte=today).order_by('-date', '-time'))
    people = my_people(request.user)

    scripts = list(Prescription.objects.filter(patient_id__in=people))  # newest first
    at_visit = {}
    for rx in scripts:
        at_visit.setdefault(rx.appointment_id, rx)  # newest wins, ordering is -created

    return JsonResponse({
        'visits': [{
            **as_json(appt),
            'prescription': script_json(at_visit[appt.id]) if appt.id in at_visit else None,
        } for appt in visits],
        'records': [{
            'id': r.id,
            'date': r.date.isoformat(),
            'kind': r.kind,
            'text': r.text,
            'byDoctor': r.by_doctor,
            'fileUrl': r.file.url if r.file else None,
        } for r in Record.objects.filter(patient_id__in=people)],
        'medicines': medicine_rows(scripts),
        # Only the suggestions half of the assessment. `problem` and `progress`
        # are the doctor's working notes about the patient; what she wants them
        # to do is the part written to be read by them.
        'suggestions': [
            {'name': p.name,
             'text': p.suggestions,
             'date': timezone.localtime(p.assessed).date().isoformat() if p.assessed else None}
            for p in Patient.objects.filter(id__in=people) if p.suggestions
        ],
    })


@login_required
@require_POST
def upload_report(request):
    """The patient adds their own lab report to their record (multipart)."""
    people = my_people(request.user)
    if not people:
        return error('You have no visits yet, so there is nothing to file this against.', 409)

    asked = request.POST.get('patient', '')
    if asked:
        if not asked.isdigit() or int(asked) not in people:
            return error('That is not your record.', 403)
        person_id = int(asked)
    else:
        # Default to whoever the most recent visit was for.
        latest = request.user.appointments.exclude(
            status=Appointment.HELD).exclude(person=None).order_by('-date', '-time').first()
        person_id = latest.person_id

    upload, problem = checked_upload(request.FILES.get('file'))
    if problem:
        return problem
    if not upload:
        return error('Choose a file first.')

    rec = Record.objects.create(
        patient_id=person_id, date=timezone.localdate(), kind=Record.REPORT,
        text=str(request.POST.get('text', ''))[:2000], file=upload, by_doctor=False,
    )
    return JsonResponse({'id': rec.id, 'fileUrl': rec.file.url,
                         'date': rec.date.isoformat()}, status=201)


@login_required
@require_POST
def reschedule(request, pk):
    """"Change time" moves the booking. Booking a second one and leaving the
    first standing is how a clinic ends up with two of the same patient."""
    purge_expired_holds()
    data = body(request)
    day = parse_date(data.get('date'))
    when = parse_time(data.get('time'))
    appt = request.user.appointments.filter(
        pk=pk, status__in=(Appointment.PENDING, Appointment.CONFIRMED)).first()
    if not appt:
        return error('No such appointment.', 404)
    if not day or not when:
        return error('Need date and time.')

    # The patient may have held the new slot on the way here; their own hold
    # must not block their own move.
    Appointment.objects.filter(patient=request.user, status=Appointment.HELD).delete()
    if not any(t == when and not taken for t, taken in free_slots(day)):
        return error('That time has just gone. Pick another.', 409)

    was = appt.starts_at
    appt.date, appt.time = day, when
    # A moved booking needs her nod again, exactly like a new one.
    appt.status = Appointment.CONFIRMED if Clinic.get().auto_accept else Appointment.PENDING
    try:
        appt.save()
    except IntegrityError:
        return error('That time has just gone. Pick another.', 409)

    send_sms(appt.phone, f'Moved: Dr. Anjana Shrestha, {was.date()} {clock(was.time())} '
                         f'-> {appt.date} {clock(appt.time)}.')
    return JsonResponse(as_json(appt))


@login_required
@require_POST
def cancel(request, pk):
    appt = request.user.appointments.filter(pk=pk).first()
    if not appt:
        return error('No such appointment.', 404)
    appt.status = Appointment.CANCELLED
    appt.save(update_fields=['status'])
    return JsonResponse(as_json(appt))


# --- doctor side -------------------------------------------------------------


@doctor_only
@require_GET
def agenda(request):
    """D1 · Today: the booked times and the gaps between them."""
    day = parse_date(request.GET.get('date'), timezone.localdate())
    booked = {a.time: a for a in Appointment.objects.filter(
        date=day, status=Appointment.CONFIRMED)}
    rows = []
    for t, _taken in free_slots(day):
        appt = booked.get(t)
        rows.append(as_json(appt) if appt else
                    {'time': t.strftime('%H:%M'), 'free': True})
    return JsonResponse({'date': day.isoformat(), 'agenda': rows})


@doctor_only
@require_GET
def month_load(request):
    """D1 · How full each day of a month is, for the calendar grid. Counts
    only, so one query answers the whole month instead of thirty agenda calls."""
    year, mon = asked_month(request)
    start = date(year, mon, 1)
    end = date(year + (mon == 12), mon % 12 + 1, 1)
    counts = {}
    for day, status in Appointment.objects.filter(
            date__gte=start, date__lt=end).exclude(
            status=Appointment.HELD).values_list('date', 'status'):
        row = counts.setdefault(day.isoformat(), {'booked': 0, 'pending': 0})
        if status == Appointment.CONFIRMED:
            row['booked'] += 1
        elif status == Appointment.PENDING:
            row['pending'] += 1
    # Closed all day, or only partly — the calendar draws them differently,
    # because "away" and "away until two" are different decisions to review.
    # A weekday she never works reads as closed too: the reason the day is
    # empty does not change what she needs to see.
    #
    # The week and the month's time off are read once, up front; slot_times()
    # is only asked about the handful of days that have a part-day block on
    # them, since that is the only case the cheap test cannot settle.
    week = {h.weekday: h for h in Hours.objects.all()}
    offs = list(TimeOff.objects.filter(starts__lt=end, ends__gte=start))
    shut, partial = [], []
    day = start
    while day < end:
        hours = week.get(day.weekday())
        touching = [off for off in offs if off.covers(day)]
        if not hours or hours.opens >= hours.closes or any(o.whole_day for o in touching):
            shut.append(day.isoformat())
        elif touching:
            # A part-day block can still swallow every slot the day had.
            (partial if slot_times(day) else shut).append(day.isoformat())
        day += timedelta(days=1)

    return JsonResponse({
        'month': start.strftime('%Y-%m'),
        'days': counts,
        'blocked': shut,
        'partial': partial,
    })


@doctor_only
@require_GET
def requests_waiting(request):
    """D2 · Waiting for you, oldest first."""
    purge_expired_holds()
    now = timezone.now()
    pending = Appointment.objects.filter(status=Appointment.PENDING).order_by('created')
    return JsonResponse({'requests': [
        dict(as_json(a), waitingMinutes=int((now - a.created).total_seconds() // 60))
        for a in pending
    ]})


@doctor_only
@require_POST
def settle(request, pk):
    appt = Appointment.objects.filter(pk=pk, status=Appointment.PENDING).first()
    if not appt:
        return error('No such request.', 404)
    accepted = bool(body(request).get('accept'))
    appt.status = Appointment.CONFIRMED if accepted else Appointment.DECLINED
    appt.save(update_fields=['status'])
    send_sms(appt.phone, f"{'Booked' if accepted else 'Could not confirm'}: Dr. Anjana Shrestha, "
                         f"{appt.date} {clock(appt.time)}.")
    return JsonResponse(as_json(appt))


# --- doctor side: records (D4, D6, D7, D8) -----------------------------------


def real_visits(person):
    """Everything that counts as a visit: no holds, no cancellations."""
    return person.visits.exclude(status__in=(Appointment.HELD, Appointment.CANCELLED))


def summary_json(person):
    """One row in the search results (D7)."""
    visits = list(real_visits(person))
    today = timezone.localdate()
    last = max(visits, key=lambda a: (a.date, a.time), default=None)
    if not last:
        seen = 'Not seen yet'
    elif last.date == today:
        seen = f'Today, {clock(last.time)} · {last.reason or "Consultation"}'
    elif last.date > today:
        seen = f'Booked {last.date.day} {last.date.strftime("%b")} · {last.reason or "Consultation"}'
    else:
        seen = f'Last seen {last.date.day} {last.date.strftime("%b")} · {last.reason or "Consultation"}'
    first = min((a.date.year for a in visits), default=None)
    return {
        'id': str(person.id),
        'name': person.name,
        'age': person.age,
        'phone': person.phone,
        'flags': csv(person.flags),
        'allergies': csv(person.allergies),
        'since': f'{len(visits)} visit{"" if len(visits) == 1 else "s"}'
                 + (f' since {first}' if first else ''),
        'lastSeen': seen,
    }


@doctor_only
@require_GET
def patients(request):
    """D7 · Search by name or number. A number matches the whole household."""
    query = request.GET.get('q', '').strip()
    found = Patient.objects.all()
    if query:
        found = found.filter(Q(name__icontains=query) | Q(phone__contains=query))
    return JsonResponse({'patients': [summary_json(p) for p in found[:50]]})


def assessment_json(person):
    """D4 · What the doctor currently makes of this patient."""
    return {
        'problem': person.problem,
        'progress': person.progress,
        'suggestions': person.suggestions,
        'assessed': timezone.localtime(person.assessed).date().isoformat()
                    if person.assessed else None,
    }


@doctor_only
@require_GET
def patient_detail(request, pk):
    """D4 · The whole record: chips, assessment, every visit with its own
    note and prescription, and everything filed outside a visit."""
    person = Patient.objects.filter(pk=pk).first()
    if not person:
        return error('No such patient.', 404)
    today = timezone.localdate()
    past = sorted((a for a in real_visits(person) if a.date <= today),
                  key=lambda a: (a.date, a.time), reverse=True)
    scripts = list(person.prescriptions.all())  # newest first
    at_visit = {}
    for rx in scripts:
        at_visit.setdefault(rx.appointment_id, rx)

    return JsonResponse({
        **summary_json(person),
        'assessment': assessment_json(person),
        'visits': [{
            'id': a.id,
            'date': f'{a.date.day} {a.date.strftime("%b %Y")} · '
                    f'{"Video" if a.mode == "video" else "Clinic"}',
            'when': a.date.isoformat(),
            'reason': a.reason,
            # Raw, and empty when unwritten. The placeholder is a UI string:
            # sending English prose from here would not translate (§19).
            'note': a.visit_note,
            'prescription': script_json(at_visit[a.id]) if a.id in at_visit else None,
        } for a in past],
        'records': [{
            'id': r.id,
            'date': r.date.isoformat(),
            'kind': r.kind,
            'text': r.text,
            'byDoctor': r.by_doctor,
            'fileUrl': r.file.url if r.file else None,
        } for r in person.records.all()],
        'prescriptions': [script_json(rx) for rx in scripts],
        'lastPrescription': scripts[0].medicines if scripts else [],
    })


@doctor_only
@require_POST
def write_visit_note(request, pk):
    """D4 · The note lands on the visit named in the URL, and only that one.

    This replaces a version that guessed "the latest visit" and silently
    overwrote whatever was already there — editing a March note rewrote
    August's.
    """
    visit = Appointment.objects.exclude(
        status__in=(Appointment.HELD, Appointment.CANCELLED)).filter(pk=pk).first()
    if not visit:
        return error('No such visit.', 404)
    note = str(body(request).get('note', '')).strip()
    if not note:
        return error('Write something first.')
    visit.visit_note = note[:2000]
    visit.save(update_fields=['visit_note'])
    return JsonResponse(as_json(visit))


@doctor_only
@require_POST
def add_record(request, pk):
    """D4 · A dated entry with no appointment behind it: a walk-in, a phone
    follow-up, a lab report. Multipart, because it may carry a file."""
    person = Patient.objects.filter(pk=pk).first()
    if not person:
        return error('No such patient.', 404)
    upload, problem = checked_upload(request.FILES.get('file'))
    if problem:
        return problem
    text = str(request.POST.get('text', '')).strip()
    if not text and not upload:
        return error('Write something or attach a file.')

    rec = Record.objects.create(
        patient=person, date=parse_date(request.POST.get('date'), timezone.localdate()),
        kind=Record.REPORT if upload else Record.NOTE, text=text[:2000],
        file=upload, by_doctor=True,
    )
    return JsonResponse({'id': rec.id, 'date': rec.date.isoformat(), 'kind': rec.kind,
                         'text': rec.text, 'byDoctor': True,
                         'fileUrl': rec.file.url if rec.file else None}, status=201)


@doctor_only
@require_POST
def write_assessment(request, pk):
    """D4 · Problem, progress, suggestions. One current answer to each."""
    person = Patient.objects.filter(pk=pk).first()
    if not person:
        return error('No such patient.', 404)
    data = body(request)
    for field in ('problem', 'progress', 'suggestions'):
        if field in data:
            setattr(person, field, str(data[field]).strip()[:2000])
    person.assessed = timezone.now()
    person.save(update_fields=['problem', 'progress', 'suggestions', 'assessed'])
    return JsonResponse(assessment_json(person))


@doctor_only
@require_POST
def prescribe(request, pk):
    """D6 · Write a prescription and text it. Drug names stay Latin in both
    languages (§20 msg 6), so there is one message body, not two."""
    person = Patient.objects.filter(pk=pk).first()
    if not person:
        return error('No such patient.', 404)
    data = body(request)
    medicines = [{'name': str(m.get('name', ''))[:80], 'dose': str(m.get('dose', ''))[:80]}
                 for m in data.get('medicines', []) if m.get('name')]
    if not medicines:
        return error('Add at least one medicine first.')

    today = timezone.localdate()
    visit = max((a for a in real_visits(person) if a.date <= today),
                key=lambda a: (a.date, a.time), default=None)
    rx = Prescription.objects.create(
        patient=person, appointment=visit, medicines=medicines,
        note=str(data.get('note', ''))[:200],
    )
    lines = '\n'.join(f'{m["name"]} - {m["dose"]}' for m in medicines)
    send_sms(person.phone, f'Dr. Anjana Shrestha, {today.day} {today.strftime("%b")}\n{lines}'
                           + (f'\n{rx.note}' if rx.note else ''))
    return JsonResponse({'id': rx.id, 'medicines': rx.medicines, 'note': rx.note,
                         'sentTo': person.phone}, status=201)


@doctor_only
@require_POST
def mark_paid(request, pk):
    """D8 needs to know what actually came in; nothing else sets this."""
    appt = Appointment.objects.filter(pk=pk).first()
    if not appt:
        return error('No such appointment.', 404)
    data = body(request)
    appt.paid = bool(data.get('paid', True))
    if data.get('payment') in ('clinic', 'esewa', 'khalti'):
        appt.payment = data['payment']
    appt.save(update_fields=['paid', 'payment'])
    return JsonResponse(as_json(appt))


def asked_month(request):
    """?month=YYYY-MM, defaulting to the one she is in."""
    today = timezone.localdate()
    try:
        year, mon = (int(part) for part in request.GET.get('month', '').split('-'))
        date(year, mon, 1)
    except ValueError:
        return today.year, today.month
    return year, mon


@doctor_only
@require_GET
def month(request):
    """D8 · This month's takings."""
    return JsonResponse(month_summary(*asked_month(request)))


@doctor_only
@require_GET
def trends(request):
    """D8 · What the month says across every patient, not just the money."""
    return JsonResponse(clinic_trends(*asked_month(request)))


# The doctor's own settings: what the JSON calls it, the model field, and the
# range it has to stay inside. slot_minutes is bounded because a zero-minute
# slot makes slot_times() loop forever, not because 0 is merely silly.
CLINIC_FIELDS = {
    'slotMinutes': ('slot_minutes', (5, 240)),
    'clinicFee': ('clinic_fee', (0, 100_000)),
    'videoFee': ('video_fee', (0, 100_000)),
    'videoEnabled': ('video_enabled', None),
    'autoAccept': ('auto_accept', None),
}


def save_hours(rows):
    """Rewrite the week. A day with no times, or one that closes before it
    opens, is a closed day — the row goes, which is exactly what slot_times()
    reads as closed."""
    for row in rows:
        weekday = row.get('weekday')
        if weekday not in (0, 1, 2, 3, 4, 5, 6):
            raise ValueError('Weekday must be 0 (Monday) to 6.')
        opens, closes = parse_time(row.get('opens')), parse_time(row.get('closes'))
        if not opens or not closes or opens >= closes:
            Hours.objects.filter(weekday=weekday).delete()
            continue
        start, end = parse_time(row.get('breakStart')), parse_time(row.get('breakEnd'))
        if (start or end) and not (start and end):
            raise ValueError('Give both a break start and a break end, or neither.')
        if start and start >= end:
            raise ValueError('The break has to end after it starts.')
        # A break that has fallen outside the day is spent, not wrong. Pulling
        # a Friday's closing time back to 1pm must not make the whole save fail
        # over the lunch break it just stranded — drop it and let her get on.
        if start and (end <= opens or start >= closes):
            start = end = None
        Hours.objects.update_or_create(
            weekday=weekday,
            defaults={'opens': opens, 'closes': closes,
                      'break_start': start, 'break_end': end},
        )


def schedule(clinic):
    return {
        **{key: getattr(clinic, field) for key, (field, _) in CLINIC_FIELDS.items()},
        'hours': [{'weekday': h.weekday,
                   'opens': h.opens.strftime('%H:%M'),
                   'closes': h.closes.strftime('%H:%M'),
                   'breakStart': h.break_start and h.break_start.strftime('%H:%M'),
                   'breakEnd': h.break_end and h.break_end.strftime('%H:%M')}
                  for h in Hours.objects.all()],
        # Everything still to come, however far out — she books holidays
        # months ahead and the calendar has to show them when she gets there.
        'timeOff': [off_json(o) for o in
                    TimeOff.objects.filter(ends__gte=timezone.localdate())],
        'stranded': [as_json(a) for a in stranded()],
    }


def off_json(off):
    return {
        'id': off.id,
        'starts': off.starts.isoformat(),
        'ends': off.ends.isoformat(),
        'startTime': off.start_time and off.start_time.strftime('%H:%M'),
        'endTime': off.end_time and off.end_time.strftime('%H:%M'),
        'wholeDay': off.whole_day,
        'reason': off.reason,
        'label': (f'{off.starts:%d %b}' if off.starts == off.ends
                  else f'{off.starts:%d %b} – {off.ends:%d %b}')
                 + ('' if off.whole_day
                    else f', {clock(off.start_time)}–{clock(off.end_time)}'),
    }


@doctor_only
def availability(request):
    """D3 · GET her schedule, POST to change the weekly pattern — opening
    hours, breaks, slot length, fees. One-off changes are time off, below."""
    clinic = Clinic.get()
    if request.method == 'POST':
        data = body(request)
        try:
            # All of it or none of it: a half-written week would leave the
            # booking page offering times she never agreed to.
            with transaction.atomic():
                for key, (field, limits) in CLINIC_FIELDS.items():
                    if key not in data:
                        continue
                    value = data[key]
                    if limits is None:
                        setattr(clinic, field, bool(value))
                    elif isinstance(value, int) and not isinstance(value, bool) \
                            and limits[0] <= value <= limits[1]:
                        setattr(clinic, field, value)
                    else:
                        raise ValueError(
                            f'{key} must be a whole number between {limits[0]} and {limits[1]}.')
                clinic.save()
                save_hours(data.get('hours') or [])
        except ValueError as bad:
            return error(str(bad))
    elif request.method != 'GET':
        return error('GET or POST.', 405)

    return JsonResponse(schedule(clinic))


MAX_TIME_OFF_DAYS = 366


@doctor_only
@require_POST
def add_time_off(request):
    """D3 · Cross out a stretch of the diary: an afternoon, a day, a fortnight.

    It never refuses because someone is already booked in there — when she has
    to close, she has to close. The reply carries the bookings it stranded so
    the screen can tell her who to ring."""
    data = body(request)
    starts = parse_date(data.get('starts'))
    ends = parse_date(data.get('ends')) or starts
    start_time = parse_time(data.get('startTime'))
    end_time = parse_time(data.get('endTime'))

    if not starts:
        return error('Pick a date.')
    if ends < starts:
        return error('The last day cannot come before the first.')
    if ends < timezone.localdate():
        return error('That is already in the past.')
    if (ends - starts).days > MAX_TIME_OFF_DAYS:
        return error('A stretch of time off cannot be longer than a year.')
    # One time without the other is almost always a half-finished form, and
    # guessing which half she meant is worse than asking.
    if bool(start_time) != bool(end_time):
        return error('Give both a start and an end time, or neither for the whole day.')
    if start_time and start_time >= end_time:
        return error('The time off has to end after it starts.')

    TimeOff.objects.create(
        starts=starts, ends=ends, start_time=start_time, end_time=end_time,
        reason=str(data.get('reason') or '')[:100],
    )
    return JsonResponse(schedule(Clinic.get()), status=201)


@doctor_only
@require_POST
def drop_time_off(request, pk):
    """Put a stretch back. The slots reopen; anyone already turned away is
    not coming back on their own."""
    TimeOff.objects.filter(pk=pk).delete()
    return JsonResponse(schedule(Clinic.get()))
