from datetime import date, datetime, time, timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

OTP_MINUTES = 10
HOLD_MINUTES = 10


class OtpCode(models.Model):
    """A sign-in code sent by SMS. No passwords anywhere (see sms.ts §7)."""

    phone = models.CharField(max_length=15, db_index=True)
    code = models.CharField(max_length=6)
    created = models.DateTimeField(auto_now_add=True)
    used = models.BooleanField(default=False)

    def is_valid(self):
        return not self.used and timezone.now() - self.created < timedelta(minutes=OTP_MINUTES)


class Clinic(models.Model):
    """Singleton: the one doctor's settings (D3 · Availability)."""

    slot_minutes = models.PositiveIntegerField(default=30)
    video_enabled = models.BooleanField(default=True)
    auto_accept = models.BooleanField(default=False)
    clinic_fee = models.PositiveIntegerField(default=800)
    video_fee = models.PositiveIntegerField(default=500)

    @classmethod
    def get(cls):
        return cls.objects.get_or_create(pk=1)[0]


class Hours(models.Model):
    """Opening hours for one weekday. No row, or open==close, means closed."""

    weekday = models.PositiveSmallIntegerField(unique=True)  # 0 = Monday (date.weekday())
    opens = models.TimeField(default=time(9, 0))
    closes = models.TimeField(default=time(17, 0))
    break_start = models.TimeField(null=True, blank=True, default=time(13, 0))
    break_end = models.TimeField(null=True, blank=True, default=time(14, 0))

    class Meta:
        ordering = ['weekday']


class TimeOff(models.Model):
    """A stretch of the diary the doctor has crossed out, on top of the weekly
    pattern in Hours (D3).

    One row is a range of dates and, optionally, a range of times inside each
    of those days:

        10–14 Oct, no times          — a week away
        12 Oct, 11:00–13:00          — a meeting on one morning
        10–14 Oct, 09:00–12:00       — five mornings off in a row

    Whole-day and part-day are the same shape because she does the same thing
    to make them: pick a stretch of the diary and cross it out. `ends` is
    inclusive — a one-day absence has starts == ends, which is what a doctor
    means by "I am away on the 12th"."""

    starts = models.DateField(db_index=True)
    ends = models.DateField(db_index=True)  # inclusive
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    reason = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ['starts', 'start_time']

    @property
    def whole_day(self):
        return self.start_time is None or self.end_time is None

    def covers(self, day):
        return self.starts <= day <= self.ends


class Patient(models.Model):
    """One person's record (D4). Phone is not unique on purpose — a household
    shares one handset, so a search by number finds the whole family (§17)."""

    account = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='people',
    )
    name = models.CharField(max_length=100)
    age = models.PositiveSmallIntegerField(null=True, blank=True)
    phone = models.CharField(max_length=15, db_index=True)
    allergies = models.CharField(max_length=200, blank=True)  # comma separated
    flags = models.CharField(max_length=200, blank=True)  # comma separated
    # The doctor's running assessment (D4). One current answer to each of the
    # three questions, not a log — she rewrites it, she does not append to it.
    problem = models.TextField(blank=True)
    progress = models.TextField(blank=True)
    suggestions = models.TextField(blank=True)
    assessed = models.DateTimeField(null=True, blank=True)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.phone})'


def csv(value):
    return [part.strip() for part in value.split(',') if part.strip()]


class Appointment(models.Model):
    HELD = 'held'  # slot reserved for 10 min while the patient finishes (§14, E3)
    PENDING = 'pending'  # waiting for the doctor (D2)
    CONFIRMED = 'confirmed'
    DECLINED = 'declined'
    CANCELLED = 'cancelled'
    BLOCKING = (HELD, PENDING, CONFIRMED)

    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE,
        related_name='appointments',
    )
    person = models.ForeignKey(
        Patient, null=True, blank=True, on_delete=models.SET_NULL, related_name='visits',
    )
    session_key = models.CharField(max_length=40, blank=True)  # holds made before sign-in
    name = models.CharField(max_length=100, blank=True)
    age = models.PositiveSmallIntegerField(null=True, blank=True)
    phone = models.CharField(max_length=15, blank=True)
    mode = models.CharField(max_length=6, default='clinic')  # clinic | video
    reason = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    date = models.DateField()
    time = models.TimeField()
    status = models.CharField(max_length=10, default=HELD)
    payment = models.CharField(max_length=10, default='clinic')  # clinic | esewa | khalti
    lang = models.CharField(max_length=2, default='en')
    visit_note = models.TextField(blank=True)  # what the doctor wrote at the visit (D4)
    paid = models.BooleanField(default=False)
    # The fee as it stood when the booking was made. Without the snapshot,
    # changing the fee today would rewrite every past month's takings (D8).
    fee_amount = models.PositiveIntegerField(null=True, blank=True)
    hold_expires = models.DateTimeField(null=True, blank=True)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['date', 'time']
        # One live booking per slot. Expired holds are deleted before booking,
        # so they never trip this.
        constraints = [
            models.UniqueConstraint(
                fields=['date', 'time'],
                condition=models.Q(status__in=('held', 'pending', 'confirmed')),
                name='one_live_appointment_per_slot',
            )
        ]

    @property
    def starts_at(self):
        return timezone.make_aware(datetime.combine(self.date, self.time))

    @property
    def fee(self):
        if self.fee_amount is not None:
            return self.fee_amount
        clinic = Clinic.get()
        return clinic.video_fee if self.mode == 'video' else clinic.clinic_fee


class Prescription(models.Model):
    """D6. Medicines live in one JSON list — they are only ever read and
    written whole, so a second table would buy nothing."""

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name='prescriptions')
    appointment = models.ForeignKey(
        Appointment, null=True, blank=True, on_delete=models.SET_NULL, related_name='prescriptions',
    )
    medicines = models.JSONField(default=list)  # [{'name': ..., 'dose': ...}]
    note = models.TextField(blank=True)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created']


class Record(models.Model):
    """Anything in the record that is not an appointment: a walk-in note, a
    phone follow-up, a lab report. One model for both because a report is a
    dated entry that happens to carry a file."""

    NOTE = 'note'
    REPORT = 'report'

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name='records')
    date = models.DateField()
    kind = models.CharField(max_length=6, default=NOTE)  # note | report
    text = models.TextField(blank=True)
    file = models.FileField(upload_to='reports/%Y/%m/', null=True, blank=True)
    by_doctor = models.BooleanField(default=True)  # False = the patient's own upload
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date', '-created']


def purge_expired_holds():
    """A lapsed hold gives the time back to other patients (§14, E3)."""
    Appointment.objects.filter(
        status=Appointment.HELD, hold_expires__lt=timezone.now()
    ).delete()


def shut_windows(day):
    """The (from, to) times that are crossed out on `day`. A whole day off is
    a window that swallows the day, so callers never special-case it.

    A half-set row — one time filled in, the other not — closes the whole day
    rather than opening it: if the record is wrong, the safe reading is that
    she is not there."""
    return [(off.start_time or time.min, off.end_time or time.max)
            for off in TimeOff.objects.filter(starts__lte=day, ends__gte=day)]


def slot_times(day):
    """Every time the doctor could see someone on `day`, open hours only."""
    hours = Hours.objects.filter(weekday=day.weekday()).first()
    if not hours or hours.opens >= hours.closes:
        return []

    # The lunch break repeats every week, time off is crossed out on the
    # calendar; to a slot they are the same thing — a window it must not touch.
    shut = shut_windows(day)
    if hours.break_start and hours.break_end:
        shut.append((hours.break_start, hours.break_end))

    step = timedelta(minutes=Clinic.get().slot_minutes)
    cursor = datetime.combine(day, hours.opens)
    end = datetime.combine(day, hours.closes)
    out = []
    while cursor + step <= end:
        starts, finishes = cursor.time(), (cursor + step).time()
        # Overlap, not "starts inside" — a break beginning halfway through a
        # slot still eats that slot. The doctor is in it either way.
        if not any(shut_from < finishes and starts < shut_to for shut_from, shut_to in shut):
            out.append(starts)
        cursor += step
    return out


def free_slots(day):
    """(time, taken) for `day`. Times already past today are dropped, not
    marked taken — a patient cannot book backwards in time."""
    purge_expired_holds()
    times = slot_times(day)
    if not times:
        return []
    taken = set(
        Appointment.objects.filter(date=day, status__in=Appointment.BLOCKING)
        .values_list('time', flat=True)
    )
    now = timezone.localtime()
    if day == now.date():
        times = [t for t in times if t > now.time()]
    return [(t, t in taken) for t in times]


def stranded(days=60):
    """Bookings that no longer fit the schedule. Shortening a day's hours or
    blocking it does not move the people already in the book — she has to see
    who to ring, so the schedule screen shows them (D3).

    ponytail: one slot_times() query per day. 60 days, doctor-only screen —
    if it ever gets slow, group the appointments by weekday first."""
    today = timezone.localdate()
    upcoming = Appointment.objects.filter(
        date__gte=today, date__lte=today + timedelta(days=days),
        status__in=Appointment.BLOCKING,
    )
    return [a for a in upcoming if a.time not in slot_times(a.date)]


def month_summary(year, month):
    """D8 · This month. Only consultations that actually happened (confirmed,
    today or earlier) count — a booking three weeks out is not takings."""
    start = date(year, month, 1)
    end = date(year + (month == 12), month % 12 + 1, 1)
    today = timezone.localdate()
    seen = Appointment.objects.filter(
        date__gte=start, date__lt=end, date__lte=today, status=Appointment.CONFIRMED,
    )

    money = {'atClinic': 0, 'wallets': 0, 'unpaid': 0}
    hours = {}
    for appt in seen:
        if not appt.paid:
            money['unpaid'] += appt.fee
        elif appt.payment in ('esewa', 'khalti'):
            money['wallets'] += appt.fee
        else:
            money['atClinic'] += appt.fee
        hours[appt.time.hour] = hours.get(appt.time.hour, 0) + 1

    collected = money['atClinic'] + money['wallets']
    count = seen.count()
    busiest = [{'hour': str(h % 12 or 12), 'value': n} for h, n in sorted(hours.items())]
    peak = max(busiest, key=lambda b: b['value'], default=None)
    last = min(today, end - timedelta(days=1))
    return {
        'title': start.strftime('%B %Y'),
        'range': f'{start.day}–{last.day} {start.strftime("%B")} · {last.day} days in'
                 if last >= start else f'{start.strftime("%B %Y")} · not started',
        'collected': collected,
        'consultations': count,
        'average': round(collected / count) if count else 0,
        **money,
        'busiest': busiest,
        'conclusion': f'{peak["hour"]} o\'clock fills first — {peak["value"]} consultations.'
                      if peak else 'No consultations yet this month.',
    }


def clinic_trends(year, month):
    """D8 · What the month is telling her, across every patient. Counts only,
    no month-over-month comparison — same restraint as month_summary."""
    start = date(year, month, 1)
    end = date(year + (month == 12), month % 12 + 1, 1)
    today = timezone.localdate()
    booked = Appointment.objects.filter(
        date__gte=start, date__lt=end).exclude(status=Appointment.HELD)
    seen = booked.filter(status=Appointment.CONFIRMED, date__lte=today)

    reasons = {}
    for appt in seen:
        label = (appt.reason or '').strip() or 'Not given'
        reasons[label] = reasons.get(label, 0) + 1
    top = sorted(reasons.items(), key=lambda kv: (-kv[1], kv[0]))[:5]

    # Returning = this person was seen at least once before the month began.
    people = {a.person_id for a in seen if a.person_id}
    returning = Patient.objects.filter(
        id__in=people, visits__date__lt=start, visits__status=Appointment.CONFIRMED,
    ).distinct().count()

    total = booked.count()
    dropped = booked.filter(
        status__in=(Appointment.DECLINED, Appointment.CANCELLED)).count()
    return {
        'title': start.strftime('%B %Y'),
        'reasons': [{'label': label, 'value': n} for label, n in top],
        'newPatients': len(people) - returning,
        'returningPatients': returning,
        'kept': total - dropped,
        'dropped': dropped,
        'droppedPercent': round(dropped * 100 / total) if total else 0,
        'conclusion': f'{top[0][0]} brought the most people in — {top[0][1]} of '
                      f'{seen.count()} consultations.' if top
                      else 'No consultations yet this month.',
    }


def day_options(start, days=14):
    """The patient's whole horizon: fourteen days, each with its free count (§10)."""
    out = []
    for i in range(days):
        day = start + timedelta(days=i)
        slots = free_slots(day)
        out.append({
            'value': day.isoformat(),
            'weekday': day.strftime('%a'),
            'day': str(day.day),
            'today': day == timezone.localdate(),
            'closed': not slots,
            'freeCount': sum(1 for _, taken in slots if not taken),
        })
    return out
