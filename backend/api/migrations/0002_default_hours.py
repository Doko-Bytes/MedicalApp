from datetime import time

from django.db import migrations

# Sun–Thu 9–5, Friday 9–1, Saturday closed. Monday is 0 (date.weekday()).
WEEK = {6: (9, 17), 0: (9, 17), 1: (9, 17), 2: (9, 17), 3: (9, 17), 4: (9, 13)}


def seed(apps, schema_editor):
    Hours = apps.get_model('api', 'Hours')
    for weekday, (opens, closes) in WEEK.items():
        Hours.objects.get_or_create(
            weekday=weekday,
            defaults={'opens': time(opens), 'closes': time(closes),
                      'break_start': time(13), 'break_end': time(14)},
        )
    apps.get_model('api', 'Clinic').objects.get_or_create(pk=1)


class Migration(migrations.Migration):
    dependencies = [('api', '0001_initial')]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
