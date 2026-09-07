from django.urls import path

from . import views

urlpatterns = [
    path('auth/me/', views.me),
    path('auth/request-code/', views.request_code),
    path('auth/verify/', views.verify_code),
    path('auth/profile/', views.update_profile),
    path('auth/signout/', views.sign_out),

    path('days/', views.days),
    path('slots/', views.slots),
    path('hold/', views.hold),
    path('appointments/', views.my_appointments),
    path('appointments/book/', views.book),
    path('appointments/<int:pk>/cancel/', views.cancel),
    path('appointments/<int:pk>/reschedule/', views.reschedule),
    path('history/', views.history),
    path('reports/', views.upload_report),

    path('doctor/agenda/', views.agenda),
    path('doctor/month-load/', views.month_load),
    path('doctor/requests/', views.requests_waiting),
    path('doctor/requests/<int:pk>/', views.settle),
    path('doctor/availability/', views.availability),
    path('doctor/time-off/', views.add_time_off),
    path('doctor/time-off/<int:pk>/delete/', views.drop_time_off),
    path('doctor/patients/', views.patients),
    path('doctor/patients/<int:pk>/', views.patient_detail),
    path('doctor/patients/<int:pk>/record/', views.add_record),
    path('doctor/patients/<int:pk>/assessment/', views.write_assessment),
    path('doctor/patients/<int:pk>/prescription/', views.prescribe),
    path('doctor/visits/<int:pk>/note/', views.write_visit_note),
    path('doctor/appointments/<int:pk>/paid/', views.mark_paid),
    path('doctor/month/', views.month),
    path('doctor/trends/', views.trends),
]
