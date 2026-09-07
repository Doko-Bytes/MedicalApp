from django.db import migrations, models


def close_the_range(apps, schema_editor):
    """Every blocked day was one whole day, so it ends the day it starts."""
    TimeOff = apps.get_model('api', 'TimeOff')
    for off in TimeOff.objects.all():
        off.ends = off.starts
        off.save(update_fields=['ends'])


class Migration(migrations.Migration):
    """BlockedDay grows a range of dates and a range of times, and becomes
    TimeOff. Renamed rather than replaced so the days she has already blocked
    off survive — they are one-day, whole-day rows in the new shape."""

    dependencies = [('api', '0005_alter_appointment_id_alter_blockedday_id_and_more')]

    operations = [
        migrations.RenameModel(old_name='BlockedDay', new_name='TimeOff'),
        migrations.RenameField(model_name='timeoff', old_name='date', new_name='starts'),
        migrations.AlterField(
            model_name='timeoff',
            name='starts',
            field=models.DateField(db_index=True),  # no longer unique: many per day
        ),
        migrations.AddField(
            model_name='timeoff',
            name='ends',
            field=models.DateField(db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='timeoff',
            name='start_time',
            field=models.TimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='timeoff',
            name='end_time',
            field=models.TimeField(blank=True, null=True),
        ),
        migrations.RunPython(close_the_range, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='timeoff',
            name='ends',
            field=models.DateField(db_index=True),
        ),
        migrations.AlterModelOptions(
            name='timeoff',
            options={'ordering': ['starts', 'start_time']},
        ),
    ]
