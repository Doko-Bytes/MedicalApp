import json
import tempfile
from datetime import time, timedelta

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from .models import (
    Appointment,
    Clinic,
    Hours,
    OtpCode,
    Patient,
    Prescription,
    TimeOff,
    free_slots,
    month_summary,
)

PDF = b'%PDF-1.4\nfake but correctly signed\n'
MAX_TEST_UPLOAD = 5 * 1024 * 1024  # matches views.MAX_UPLOAD


def post(client, url, **data):
    return client.post(url, data=json.dumps(data), content_type='application/json')


def next_open_day():
    """Tomorrow onwards, the first day the clinic is actually open."""
    day = timezone.localdate() + timedelta(days=1)
    while not free_slots(day):
        day += timedelta(days=1)
    return day


class BookingFlowTests(TestCase):
    """One patient books, the doctor accepts. Everything else is a detail."""

    def sign_in(self, phone='9801234567', client=None):
        client = client or Client()
        self.assertEqual(post(client, '/api/auth/request-code/', phone=phone).status_code, 200)
        code = OtpCode.objects.filter(phone=phone).latest('created').code
        self.assertEqual(post(client, '/api/auth/verify/', phone=phone, code=code).status_code, 200)
        return client

    def test_book_and_accept(self):
        day = next_open_day()
        slot = free_slots(day)[0][0].strftime('%H:%M')

        # A slot is held before the patient has signed in.
        patient = Client()
        held = post(patient, '/api/hold/', date=day.isoformat(), time=slot)
        self.assertEqual(held.status_code, 201)

        # Someone else cannot take the held time.
        other = post(Client(), '/api/hold/', date=day.isoformat(), time=slot)
        self.assertEqual(other.status_code, 409)

        booked = post(self.sign_in(client=patient), '/api/appointments/book/',
                      name='Ram Bahadur Thapa', age=54, reason='Fever', mode='clinic')
        self.assertEqual(booked.status_code, 201)
        self.assertEqual(booked.json()['status'], 'pending')  # auto-accept is off

        doctor = self.sign_in(phone='9800000001')
        get_user_model().objects.filter(username='9800000001').update(is_staff=True)
        waiting = doctor.get('/api/doctor/requests/').json()['requests']
        self.assertEqual(len(waiting), 1)

        settled = post(doctor, f"/api/doctor/requests/{waiting[0]['id']}/", accept=True)
        self.assertEqual(settled.json()['status'], 'confirmed')
        self.assertEqual(patient.get('/api/appointments/').json()['upcoming'][0]['status'],
                         'confirmed')

    def test_wrong_code_is_refused(self):
        post(Client(), '/api/auth/request-code/', phone='9801234567')
        self.assertEqual(
            post(Client(), '/api/auth/verify/', phone='9801234567', code='000000').status_code, 400)

    @override_settings(DEBUG=True, DEV_LOGIN_CODE='000000')
    def test_dev_login_code_only_works_in_debug(self):
        post(Client(), '/api/auth/request-code/', phone='9801234567')
        self.assertEqual(OtpCode.objects.latest('created').code, '000000')

        # DEBUG off is the only thing standing between this and an auth bypass.
        with override_settings(DEBUG=False):
            post(Client(), '/api/auth/request-code/', phone='9807654321')
            self.assertNotEqual(OtpCode.objects.latest('created').code, '000000')

    def test_expired_hold_frees_the_slot(self):
        day = next_open_day()
        slot = free_slots(day)[0][0].strftime('%H:%M')
        post(Client(), '/api/hold/', date=day.isoformat(), time=slot)
        Appointment.objects.update(hold_expires=timezone.now() - timedelta(minutes=1))
        self.assertEqual(
            post(Client(), '/api/hold/', date=day.isoformat(), time=slot).status_code, 201)

    def test_doctor_only(self):
        self.assertEqual(self.sign_in().get('/api/doctor/requests/').status_code, 403)

    def test_blocked_day_has_no_slots(self):
        day = next_open_day()
        doctor = self.sign_in(phone='9800000001')
        get_user_model().objects.filter(username='9800000001').update(is_staff=True)
        post(doctor, '/api/doctor/time-off/', starts=day.isoformat())
        self.assertEqual(free_slots(day), [])

    def book(self, phone='9801234567', name='Ram Bahadur Thapa', client=None):
        """Hold, sign in, book — the whole patient path, one line at the call site."""
        day = next_open_day()
        client = client or Client()
        post(client, '/api/hold/', date=day.isoformat(),
             time=free_slots(day)[0][0].strftime('%H:%M'))
        booked = post(self.sign_in(phone=phone, client=client), '/api/appointments/book/',
                      name=name, age=54, reason='Fever')
        return client, booked.json()

    def doctor(self, phone='9800000001'):
        client = self.sign_in(phone=phone)
        get_user_model().objects.filter(username=phone).update(is_staff=True)
        return client

    def test_doctor_sets_her_own_hours(self):
        """D3 · She shortens a day, closes another, and is told who that
        stranded — the one thing changing the hours cannot do by itself."""
        doctor = self.doctor()
        day = next_open_day()
        patient, appt = self.book()  # booked at the first slot of that day
        post(doctor, f"/api/doctor/requests/{appt['id']}/", accept=True)

        week = [{'weekday': w, 'opens': '14:00', 'closes': '17:00',
                 'breakStart': '', 'breakEnd': ''} for w in range(7)]
        saved = post(doctor, '/api/doctor/availability/', hours=week, slotMinutes=60).json()
        self.assertEqual(saved['hours'][0]['opens'], '14:00')
        self.assertEqual([s['value'] for s in
                          Client().get(f'/api/slots/?date={day}').json()['slots']],
                         ['14:00', '15:00', '16:00'])
        # The 9 o'clock booking is still there, now outside opening hours.
        self.assertEqual([a['id'] for a in saved['stranded']], [appt['id']])

        # A day with no times is a closed day; a break carves out the middle.
        week[day.weekday()] = {'weekday': day.weekday(), 'opens': '', 'closes': ''}
        closed = post(doctor, '/api/doctor/availability/', hours=week).json()
        self.assertEqual(free_slots(day), [])
        self.assertNotIn(day.weekday(), [h['weekday'] for h in closed['hours']])

        after = next_open_day()
        week[after.weekday()] = {'weekday': after.weekday(), 'opens': '14:00',
                                 'closes': '17:00', 'breakStart': '15:00', 'breakEnd': '16:00'}
        post(doctor, '/api/doctor/availability/', hours=week)
        self.assertEqual([t.strftime('%H:%M') for t, _ in free_slots(after)], ['14:00', '16:00'])

    def test_time_off_takes_out_part_of_a_day(self):
        """D3 · She is out from 11 to 1. Slots that so much as touch that
        window go, including the one that starts at 10:45 and runs into it."""
        doctor = self.doctor()
        day = next_open_day()
        post(doctor, '/api/doctor/availability/',
             hours=[{'weekday': w, 'opens': '09:00', 'closes': '17:00'} for w in range(7)],
             slotMinutes=45)

        post(doctor, '/api/doctor/time-off/', starts=day.isoformat(),
             startTime='11:00', endTime='13:00', reason='School')
        # 10:30 runs into 11:00 and 12:45 runs past 13:00 — both are gone, and
        # 13:30 is the first slot that clears the window outright.
        self.assertEqual([t.strftime('%H:%M') for t, _ in free_slots(day)],
                         ['09:00', '09:45', '13:30', '14:15', '15:00', '15:45'])

        # The rest of the week is untouched — this was one day, not a pattern.
        self.assertTrue(free_slots(day + timedelta(days=7)))

    def test_time_off_spans_days_and_reopens(self):
        doctor = self.doctor()
        day = next_open_day()
        away = post(doctor, '/api/doctor/time-off/', starts=day.isoformat(),
                    ends=(day + timedelta(days=13)).isoformat(), reason='Away').json()

        for offset in (0, 7, 13):
            self.assertEqual(free_slots(day + timedelta(days=offset)), [])
        self.assertTrue(free_slots(day + timedelta(days=14)))
        # The patient's fortnight of choices is entirely shut.
        horizon = Client().get(f'/api/days/?from={day}').json()['days']
        self.assertTrue(all(d['closed'] for d in horizon))

        post(doctor, f"/api/doctor/time-off/{away['timeOff'][0]['id']}/delete/")
        self.assertTrue(free_slots(day))

    def test_a_morning_off_every_day_of_a_stretch(self):
        """One row, a date range and a time range: five mornings off."""
        doctor = self.doctor()
        day = next_open_day()
        post(doctor, '/api/doctor/availability/',
             hours=[{'weekday': w, 'opens': '09:00', 'closes': '17:00'} for w in range(7)])
        post(doctor, '/api/doctor/time-off/', starts=day.isoformat(),
             ends=(day + timedelta(days=4)).isoformat(), startTime='09:00', endTime='12:00')

        for offset in range(5):
            times = [t.strftime('%H:%M') for t, _ in free_slots(day + timedelta(days=offset))]
            self.assertNotIn('09:00', times)
            self.assertNotIn('11:30', times)
            self.assertIn('12:00', times)

    def test_closing_time_strands_the_people_already_booked(self):
        """It never refuses — when she has to close, she has to close. It
        tells her who to ring instead."""
        doctor = self.doctor()
        patient, appt = self.book()
        post(doctor, f"/api/doctor/requests/{appt['id']}/", accept=True)

        reply = post(doctor, '/api/doctor/time-off/', starts=appt['date'], reason='Emergency')
        self.assertEqual(reply.status_code, 201)
        self.assertEqual([a['id'] for a in reply.json()['stranded']], [appt['id']])
        # Still in the book, still confirmed — only she can move a patient.
        self.assertEqual(Appointment.objects.get(pk=appt['id']).status, Appointment.CONFIRMED)

    def test_time_off_the_doctor_did_not_mean(self):
        doctor = self.doctor()
        today = timezone.localdate()
        refusals = [
            ({'starts': ''}, 'Pick a date.'),
            ({'starts': (today + timedelta(days=3)).isoformat(),
              'ends': today.isoformat()}, 'The last day cannot come before the first.'),
            ({'starts': (today - timedelta(days=2)).isoformat()}, 'That is already in the past.'),
            ({'starts': today.isoformat(),
              'ends': (today + timedelta(days=400)).isoformat()}, 'longer than a year'),
            ({'starts': today.isoformat(), 'startTime': '11:00'}, 'both a start and an end time'),
            ({'starts': today.isoformat(), 'startTime': '13:00', 'endTime': '11:00'},
             'has to end after it starts'),
        ]
        for data, says in refusals:
            reply = post(doctor, '/api/doctor/time-off/', **data)
            self.assertEqual(reply.status_code, 400, data)
            self.assertIn(says, reply.json()['error'])
        self.assertEqual(TimeOff.objects.count(), 0)

        # A stretch that started before today but runs into it is not the past.
        live = post(doctor, '/api/doctor/time-off/',
                    starts=(today - timedelta(days=2)).isoformat(), ends=today.isoformat())
        self.assertEqual(live.status_code, 201)

    def test_bad_settings_are_refused_whole(self):
        """A zero-minute slot would make slot_times() spin forever, and a half
        applied week would offer times she never agreed to."""
        doctor = self.doctor()
        bad = post(doctor, '/api/doctor/availability/', slotMinutes=0)
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(Clinic.get().slot_minutes, 30)

        week = [{'weekday': 0, 'opens': '08:00', 'closes': '12:00'},
                {'weekday': 1, 'opens': '09:00', 'closes': '17:00',
                 'breakStart': '14:00', 'breakEnd': '13:00'}]  # break ends before it starts
        refused = post(doctor, '/api/doctor/availability/', hours=week, clinicFee=1200)
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(Clinic.get().clinic_fee, 800)
        self.assertEqual(Hours.objects.get(weekday=0).opens, time(9))

    def test_a_break_left_outside_the_day_is_dropped_not_refused(self):
        """The seeded Friday closes at 1pm with a 1–2pm break on it. Refusing
        that would make her very first save fail on data she never typed."""
        doctor = self.doctor()
        saved = post(doctor, '/api/doctor/availability/', hours=[
            {'weekday': 4, 'opens': '09:00', 'closes': '13:00',
             'breakStart': '13:00', 'breakEnd': '14:00'},
        ])
        self.assertEqual(saved.status_code, 200)
        friday = Hours.objects.get(weekday=4)
        self.assertIsNone(friday.break_start)
        self.assertEqual(friday.closes, time(13))

    def test_change_time_moves_the_booking(self):
        patient, appt = self.book()
        day = next_open_day()
        later = free_slots(day)[1][0].strftime('%H:%M')

        moved = post(patient, f"/api/appointments/{appt['id']}/reschedule/",
                     date=day.isoformat(), time=later)
        self.assertEqual(moved.status_code, 200)
        self.assertEqual(moved.json()['time'], later)
        # Moved, not duplicated — the old time is free again.
        live = Appointment.objects.filter(status__in=Appointment.BLOCKING)
        self.assertEqual(live.count(), 1)
        self.assertEqual(dict(free_slots(day))[free_slots(day)[0][0]], False)

    def test_change_time_into_a_taken_slot_is_refused(self):
        first, mine = self.book()
        day = next_open_day()
        taken = free_slots(day)[1][0].strftime('%H:%M')
        post(Client(), '/api/hold/', date=day.isoformat(), time=taken)  # someone else

        clash = post(first, f"/api/appointments/{mine['id']}/reschedule/",
                     date=day.isoformat(), time=taken)
        self.assertEqual(clash.status_code, 409)
        self.assertEqual(Appointment.objects.get(pk=mine['id']).time.strftime('%H:%M'),
                         free_slots(day)[0][0].strftime('%H:%M'))

    def test_record_search_note_and_prescription(self):
        _, appt = self.book()
        doctor = self.doctor()

        # Booking creates the record; searching the number finds it (D7).
        found = doctor.get('/api/doctor/patients/?q=9801234').json()['patients']
        self.assertEqual(len(found), 1)
        pid = found[0]['id']

        Patient.objects.filter(pk=pid).update(allergies='penicillin', flags='High BP')
        Appointment.objects.filter(pk=appt['id']).update(  # the visit happened
            date=timezone.localdate(), status=Appointment.CONFIRMED)

        note = post(doctor, f"/api/doctor/visits/{appt['id']}/note/", note='BP 150/95.')
        self.assertEqual(note.status_code, 200)

        rx = post(doctor, f'/api/doctor/patients/{pid}/prescription/',
                  medicines=[{'name': 'Amlodipine 5mg', 'dose': '1 tablet, morning'}],
                  note='Less salt.')
        self.assertEqual(rx.status_code, 201)
        self.assertEqual(post(doctor, f'/api/doctor/patients/{pid}/prescription/',
                              medicines=[]).status_code, 400)

        detail = doctor.get(f'/api/doctor/patients/{pid}/').json()
        self.assertEqual(detail['allergies'], ['penicillin'])
        self.assertEqual(detail['visits'][0]['note'], 'BP 150/95.')
        self.assertEqual(detail['lastPrescription'][0]['name'], 'Amlodipine 5mg')

    def test_month_counts_only_what_was_collected(self):
        _, appt = self.book()
        doctor = self.doctor()
        Appointment.objects.filter(pk=appt['id']).update(
            date=timezone.localdate(), status=Appointment.CONFIRMED)

        unpaid = doctor.get('/api/doctor/month/').json()
        self.assertEqual((unpaid['consultations'], unpaid['collected']), (1, 0))
        self.assertEqual(unpaid['unpaid'], 800)

        post(doctor, f"/api/doctor/appointments/{appt['id']}/paid/", paid=True, payment='esewa')
        paid = doctor.get('/api/doctor/month/').json()
        self.assertEqual((paid['collected'], paid['wallets'], paid['unpaid']), (800, 800, 0))

        # Raising the fee today must not rewrite what was already taken.
        Clinic.objects.filter(pk=1).update(clinic_fee=1500)
        today = timezone.localdate()
        self.assertEqual(month_summary(today.year, today.month)['collected'], 800)

    def two_visits(self):
        """One patient, two visits — the shape the old write_note got wrong."""
        patient, appt = self.book()
        Appointment.objects.filter(pk=appt['id']).update(
            date=timezone.localdate() - timedelta(days=30), status=Appointment.CONFIRMED)
        older = Appointment.objects.get(pk=appt['id'])
        recent = Appointment.objects.create(
            patient=older.patient, person=older.person, name=older.name, phone=older.phone,
            date=timezone.localdate(), time=time(11, 30), status=Appointment.CONFIRMED,
            reason='Follow-up', fee_amount=older.fee,
        )
        return patient, older, recent

    def test_note_lands_on_the_visit_it_names(self):
        """The regression: the old endpoint guessed "latest visit", so writing
        up an old consultation silently overwrote the newest one."""
        _, older, recent = self.two_visits()
        doctor = self.doctor()

        self.assertEqual(
            post(doctor, f'/api/doctor/visits/{recent.id}/note/', note='Today: BP 130/85.')
            .status_code, 200)
        self.assertEqual(
            post(doctor, f'/api/doctor/visits/{older.id}/note/', note='Last month: BP 150/95.')
            .status_code, 200)

        older.refresh_from_db()
        recent.refresh_from_db()
        self.assertEqual(older.visit_note, 'Last month: BP 150/95.')
        self.assertEqual(recent.visit_note, 'Today: BP 130/85.')  # untouched
        self.assertEqual(post(doctor, '/api/doctor/visits/999999/note/', note='x').status_code, 404)

    def test_patient_sees_notes_medicines_and_assessment_sources(self):
        patient, older, recent = self.two_visits()
        doctor = self.doctor()
        pid = older.person_id

        post(doctor, f'/api/doctor/visits/{recent.id}/note/', note='BP settling.')
        post(doctor, f'/api/doctor/patients/{pid}/prescription/',
             medicines=[{'name': 'Amlodipine 5mg', 'dose': '1 tablet, morning'}], note='Less salt.')
        assessed = post(doctor, f'/api/doctor/patients/{pid}/assessment/',
                        problem='Hypertension', progress='Down from 150/95.',
                        suggestions='Review in a month.')
        self.assertEqual(assessed.status_code, 200)

        mine = patient.get('/api/history/').json()
        self.assertEqual(len(mine['visits']), 2)
        self.assertEqual(mine['visits'][0]['visitNote'], 'BP settling.')  # newest first
        self.assertEqual(mine['medicines'][0]['name'], 'Amlodipine 5mg')
        self.assertEqual(mine['visits'][0]['prescription']['note'], 'Less salt.')

        # The assessment is the doctor's working note, not patient-facing.
        self.assertNotIn('assessment', mine)
        detail = doctor.get(f'/api/doctor/patients/{pid}/').json()
        self.assertEqual(detail['assessment']['problem'], 'Hypertension')

    def test_history_covers_only_the_people_you_booked_for(self):
        """Patient.phone is not unique — a household shares a handset. Scoping
        a record by number would hand one member the whole family's file."""
        patient, appt = self.book(name='Ram Bahadur Thapa')
        Appointment.objects.filter(pk=appt['id']).update(
            date=timezone.localdate(), status=Appointment.CONFIRMED)
        doctor = self.doctor()
        pid = Appointment.objects.get(pk=appt['id']).person_id
        post(doctor, f'/api/doctor/patients/{pid}/prescription/',
             medicines=[{'name': 'Amlodipine 5mg', 'dose': '1 tablet'}])

        # Same number, different person, never booked through this account.
        sister = Patient.objects.create(name='Sita Thapa', phone='9801234567')
        Prescription.objects.create(patient=sister,
                                    medicines=[{'name': 'Metformin 500mg', 'dose': '2 daily'}])

        names = [m['name'] for m in patient.get('/api/history/').json()['medicines']]
        self.assertEqual(names, ['Amlodipine 5mg'])

        # And another account sees none of it.
        stranger, _ = self.book(phone='9807654321', name='Hari Gurung', client=Client())
        self.assertEqual(stranger.get('/api/history/').json()['medicines'], [])

    @override_settings(MEDIA_ROOT=tempfile.mkdtemp())
    def test_upload_trusts_the_bytes_not_the_filename(self):
        patient, _ = self.book()

        ok = patient.post('/api/reports/', {'file': SimpleUploadedFile('scan.pdf', PDF)})
        self.assertEqual(ok.status_code, 201)

        # An extension we do not accept.
        self.assertEqual(patient.post(
            '/api/reports/', {'file': SimpleUploadedFile('run.exe', PDF)}).status_code, 400)

        # An accepted extension over bytes that are not that format.
        self.assertEqual(patient.post(
            '/api/reports/', {'file': SimpleUploadedFile('scan.pdf', b'MZ\x90\x00')}
        ).status_code, 400)

        # Too big.
        self.assertEqual(patient.post(
            '/api/reports/', {'file': SimpleUploadedFile('big.pdf', PDF + b'0' * MAX_TEST_UPLOAD)}
        ).status_code, 413)

        self.assertEqual(len(patient.get('/api/history/').json()['records']), 1)

    def test_new_endpoints_refuse_the_wrong_role(self):
        signed_out = Client()
        self.assertEqual(signed_out.get('/api/history/').status_code, 401)
        self.assertEqual(signed_out.post('/api/reports/').status_code, 401)

        patient = self.sign_in()
        self.assertEqual(patient.get('/api/doctor/trends/').status_code, 403)
        self.assertEqual(post(patient, '/api/doctor/visits/1/note/', note='x').status_code, 403)
        self.assertEqual(post(patient, '/api/doctor/patients/1/assessment/',
                              problem='x').status_code, 403)

    def test_trends_count_reasons_and_returning_patients(self):
        _, older, recent = self.two_visits()  # same person, two months
        doctor = self.doctor()
        trends = doctor.get('/api/doctor/trends/').json()

        self.assertEqual(trends['reasons'], [{'label': 'Follow-up', 'value': 1}])
        self.assertEqual((trends['returningPatients'], trends['newPatients']), (1, 0))
        self.assertEqual(trends['dropped'], 0)

    def test_patient_sees_suggestions_but_not_the_working_notes(self):
        """The account shows what the doctor wants them to do. `problem` and
        `progress` are what she thinks about them, and stay on her side."""
        patient, older, _ = self.two_visits()
        doctor = self.doctor()
        post(doctor, f'/api/doctor/patients/{older.person_id}/assessment/',
             problem='Hypertension', progress='Down from 150/95.',
             suggestions='Walk daily. Review in a month.')

        advice = patient.get('/api/history/').json()['suggestions']
        self.assertEqual(len(advice), 1)
        self.assertEqual(advice[0]['text'], 'Walk daily. Review in a month.')
        self.assertEqual(advice[0]['name'], 'Ram Bahadur Thapa')
        self.assertNotIn('Hypertension', json.dumps(patient.get('/api/history/').json()))

        # Another account's advice is not this account's to read.
        stranger, _ = self.book(phone='9807654321', name='Hari Gurung', client=Client())
        self.assertEqual(stranger.get('/api/history/').json()['suggestions'], [])

    def test_month_load_counts_each_day_of_the_asked_month(self):
        _, older, recent = self.two_visits()  # one 30 days back, one today
        doctor = self.doctor()
        today = timezone.localdate()

        load = doctor.get(f'/api/doctor/month-load/?month={today:%Y-%m}').json()
        self.assertEqual(load['days'][today.isoformat()], {'booked': 1, 'pending': 0})
        # A visit in a different month is not in this month's grid.
        if older.date.month != today.month:
            self.assertNotIn(older.date.isoformat(), load['days'])

        # Holds are not bookings, so they must not colour a day in.
        day = next_open_day()
        post(Client(), '/api/hold/', date=day.isoformat(),
             time=free_slots(day)[0][0].strftime('%H:%M'))
        fresh = doctor.get(f'/api/doctor/month-load/?month={day:%Y-%m}').json()
        self.assertEqual(fresh['days'].get(day.isoformat(), {}).get('booked', 0),
                         1 if day == today else 0)

        post(doctor, '/api/doctor/time-off/', starts=day.isoformat())
        blocked = doctor.get(f'/api/doctor/month-load/?month={day:%Y-%m}').json()
        self.assertIn(day.isoformat(), blocked['blocked'])
        self.assertEqual(self.sign_in(phone='9809999999')
                         .get('/api/doctor/month-load/').status_code, 403)

    def test_auto_accept_confirms_immediately(self):
        Clinic.objects.filter(pk=1).update(auto_accept=True)
        day = next_open_day()
        patient = Client()
        post(patient, '/api/hold/', date=day.isoformat(),
             time=free_slots(day)[0][0].strftime('%H:%M'))
        booked = post(self.sign_in(client=patient), '/api/appointments/book/', name='Sita', age=32)
        self.assertEqual(booked.json()['status'], 'confirmed')
