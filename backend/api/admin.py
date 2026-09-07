from django.contrib import admin

from .models import Appointment, Clinic, Hours, Patient, Prescription, TimeOff

admin.site.register([Clinic, Hours, TimeOff, Prescription])


# Allergies and flags are typed here — the booking form must not be the place
# a patient declares their own penicillin allergy.
@admin.register(Patient)
class PatientAdmin(admin.ModelAdmin):
    list_display = ('name', 'age', 'phone', 'allergies', 'flags')
    search_fields = ('name', 'phone')


@admin.register(Appointment)
class AppointmentAdmin(admin.ModelAdmin):
    list_display = ('date', 'time', 'name', 'phone', 'mode', 'status')
    list_filter = ('status', 'mode', 'date')
