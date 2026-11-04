'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
    createLifeOS,
    localDateTimeToEpoch,
    localParts,
} = require('../lib/life-os');

async function makePath(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mushii-life-os-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    return path.join(dir, 'life-os.json');
}

test('Kigali local time conversion round-trips correctly', () => {
    const epoch = localDateTimeToEpoch('2026-11-03', '06:00', 'Africa/Kigali');
    assert.deepEqual(localParts(epoch, 'Africa/Kigali'), {
        date: '2026-11-03',
        time: '06:00',
        weekday: 'tue',
    });
});

test('default timezone and morning agenda reminder are configured for Kigali', async t => {
    const life = createLifeOS({ filePath: await makePath(t) });
    const settings = life.getSettings();
    assert.equal(settings.timezone, 'Africa/Kigali');
    assert.equal(settings.dailyAgenda, true);
    assert.equal(settings.dailyAgendaTime, '06:05');
    assert.equal(settings.dailyCheckin, true);
    assert.equal(settings.dailyCheckinTime, '06:00');
    assert.equal(settings.purposeReminders, true);
    assert.deepEqual(settings.purposeReminderTimes, { morning: '06:30', midday: '13:00', evening: '20:30' });
    assert.equal(settings.advanceMinutes, 10);
});

test('legacy default reminder times migrate to the 06:00 routine without changing custom times', async t => {
    const filePath = await makePath(t);
    await fs.writeFile(filePath, JSON.stringify({
        version: 2,
        timezone: 'Africa/Kigali',
        settings: {
            dailyAgenda: true,
            dailyAgendaTime: '05:55',
            dailyCheckin: true,
            dailyCheckinTime: '05:45',
            purposeReminders: true,
        },
    }));
    const migrated = createLifeOS({ filePath });
    assert.equal(migrated.getSettings().dailyAgendaTime, '06:05');
    assert.equal(migrated.getSettings().dailyCheckinTime, '06:00');
    const customPath = await makePath(t);
    await fs.writeFile(customPath, JSON.stringify({
        version: 2,
        timezone: 'Africa/Kigali',
        settings: { dailyAgendaTime: '06:20', dailyCheckinTime: '06:10' },
    }));
    const custom = createLifeOS({ filePath: customPath });
    assert.equal(custom.getSettings().dailyAgendaTime, '06:20');
    assert.equal(custom.getSettings().dailyCheckinTime, '06:10');
});

test('weekly class patterns choose morning and evening templates, with date overrides', async t => {
    const life = createLifeOS({ filePath: await makePath(t) });
    life.setWeeklyClassType('tue', 'morning');
    life.setWeeklyClassType('wed', 'evening');

    const morning = life.getAgenda('2026-11-03');
    const morningClass = morning.find(item => item.id === 'university');
    assert.equal(morningClass.time, '08:00');
    assert.equal(morningClass.duration, 270);
    assert.ok(morning.some(item => item.id === 'midday-chat'));
    assert.ok(morning.some(item => item.id === 'evening-chat'));

    const evening = life.getAgenda('2026-11-04');
    const eveningClass = evening.find(item => item.id === 'university');
    assert.equal(eveningClass.time, '14:00');
    assert.equal(eveningClass.duration, 180);

    life.setDayType('travel', '2026-11-04', 'Visiting family');
    assert.equal(life.getDayType('2026-11-04'), 'travel');
    assert.equal(life.getDayType('2026-11-08'), 'sunday');
});

test('agenda templates are editable and task completion advances next action', async t => {
    const filePath = await makePath(t);
    const now = localDateTimeToEpoch('2026-11-03', '06:10', 'Africa/Kigali');
    const life = createLifeOS({ filePath, now: () => now });
    life.setDayType('morning', '2026-11-03');

    const current = life.getNextAction(now);
    assert.equal(current.id, 'morning-foundation');
    assert.equal(current.phase, 'current');

    assert.equal(life.markAgendaItem('2026-11-03', current.id, 'done'), true);
    assert.equal(life.getNextAction(now).id, 'shower');

    const id = life.addAgendaItem('morning', '19:00', 45, 'YouTube research');
    assert.equal(life.updateAgendaItem('morning', id, { time: '19:15', title: 'Research video ideas' }), true);
    assert.equal(life.getAgenda('2026-11-03').find(item => item.id === id).time, '19:15');
    assert.equal(life.removeAgendaItem('morning', id), true);
});

test('routines notify once, support recurrence, and respect daily completion', async t => {
    const filePath = await makePath(t);
    let now = localDateTimeToEpoch('2026-11-03', '06:06', 'Africa/Kigali');
    const life = createLifeOS({ filePath, now: () => now });
    const routine = life.addRoutine('06:15', 'weekdays', 'Read and exercise');
    const due = life.getDueNotifications(now);
    assert.ok(due.events.some(item => item.kind === 'routine' && item.key === 'routine:2026-11-03:' + routine.id));

    assert.equal(life.markRoutine('2026-11-03', routine.id, 'done'), true);
    assert.ok(!life.getDueNotifications(now).events.some(item => item.kind === 'routine'));

    assert.equal(life.updateRoutine(routine.id, { active: false }), true);
    assert.equal(life.listRoutines()[0].active, false);
    assert.equal(life.deleteRoutine(routine.id), true);
});

test('one-time reminders are timezone-aware, persistent and idempotent after send', async t => {
    const filePath = await makePath(t);
    let now = localDateTimeToEpoch('2026-11-03', '06:00', 'Africa/Kigali');
    const life = createLifeOS({ filePath, now: () => now });
    const reminder = life.addReminder('2026-11-03', '06:10', 'Submit assignment');
    now = localDateTimeToEpoch('2026-11-03', '06:11', 'Africa/Kigali');

    const due = life.getDueNotifications(now);
    assert.ok(due.events.some(item => item.kind === 'reminder' && item.key === 'reminder:' + reminder.id));
    life.markNotificationSent('reminder:' + reminder.id);
    assert.ok(!life.getDueNotifications(now).events.some(item => item.key === 'reminder:' + reminder.id));

    const restarted = createLifeOS({ filePath, now: () => now });
    assert.equal(restarted.listReminders()[0].status, 'sent');
});

test('goals, private journal entries and coded check-ins persist across restart', async t => {
    const filePath = await makePath(t);
    const now = localDateTimeToEpoch('2026-11-03', '20:00', 'Africa/Kigali');
    const first = createLifeOS({ filePath, now: () => now });
    const goal = first.addGoal('Publish the first faceless YouTube video');
    const journal = first.addJournalEntry('Today I completed my software engineering assignment.');
    first.recordCheckin('27', 'kept', 'Stayed with my commitment.');
    first.recordCheckin('190', 'urge', 'Used my reset plan.');

    const second = createLifeOS({ filePath, now: () => now });
    assert.equal(second.listGoals()[0].id, goal.id);
    assert.equal(second.searchJournal('software engineering')[0].id, journal.id);
    assert.deepEqual(second.getCheckins(2).map(item => item.code), ['190', '27']);
    assert.equal(second.updateGoal(goal.id, { status: 'done' }), true);
    assert.equal(second.updateJournalEntry(journal.id, 'Updated entry.'), true);
});

test('daily agenda time and notification settings can be edited', async t => {
    const life = createLifeOS({ filePath: await makePath(t) });
    assert.deepEqual(life.setDailyAgenda(true, '06:10'), { enabled: true, time: '06:10' });
    assert.equal(life.setAdvanceMinutes(5), 5);
    assert.equal(life.setTimezone('Africa/Kigali'), 'Africa/Kigali');
    assert.equal(life.setAndroidNotifications(true), true);
    assert.equal(life.setFocusMode(true), true);
    assert.throws(() => life.setDailyAgenda(true, '25:99'), /HH:MM/);
    assert.throws(() => life.setTimezone('Not/A_Timezone'), /IANA timezone/);
});

test('missed reminders are marked so reconnect does not flood the owner', async t => {
    const filePath = await makePath(t);
    let now = localDateTimeToEpoch('2026-11-03', '06:00', 'Africa/Kigali');
    const life = createLifeOS({ filePath, now: () => now });
    const reminder = life.addReminder('2026-11-03', '06:05', 'Read lecture notes');
    now = localDateTimeToEpoch('2026-11-04', '08:00', 'Africa/Kigali');
    const due = life.getDueNotifications(now);
    assert.ok(due.stale.includes('reminder:' + reminder.id));
    life.markNotificationMissed('reminder:' + reminder.id);
    assert.equal(life.listReminders()[0].status, 'missed');
});

test('personal records persist, support search, update and deletion', async t => {
    const filePath = await makePath(t);
    const first = createLifeOS({ filePath });
    const record = first.addRecord('university', 'Software Engineering', 'Semester project notes');
    assert.equal(first.listRecords('semester')[0].id, record.id);
    const second = createLifeOS({ filePath });
    assert.equal(second.listRecords()[0].title, 'Software Engineering');
    assert.equal(second.updateRecord(record.id, { title: 'SE project', value: 'Updated notes' }), true);
    assert.equal(second.listRecords()[0].value, 'Updated notes');
    assert.equal(second.deleteRecord(record.id), true);
    assert.equal(second.listRecords().length, 0);
});

test('daily and weekly reports summarize agenda, routines, goals and journal activity', async t => {
    const filePath = await makePath(t);
    const now = localDateTimeToEpoch('2026-11-03', '06:10', 'Africa/Kigali');
    const life = createLifeOS({ filePath, now: () => now });
    life.setDayType('morning', '2026-11-03');
    life.setWeeklyClassType('tue', 'morning');
    const next = life.getAgenda('2026-11-03')[0];
    life.markAgendaItem('2026-11-03', next.id, 'done');
    const routine = life.addRoutine('06:15', 'tue', 'Prayer review');
    life.markRoutine('2026-11-03', routine.id, 'done');
    life.addGoal('Finish semester project');
    life.addJournalEntry('Daily review entry');
    const daily = life.getDailyReport('2026-11-03');
    assert.equal(daily.agenda.done, 1);
    assert.equal(daily.routines.done, 1);
    assert.equal(daily.goals.active, 1);
    assert.equal(daily.journalEntries, 1);
    const weekly = life.getWeeklyReport('2026-11-03');
    assert.equal(weekly.days.length, 7);
    assert.equal(weekly.totals.agendaDone, 1);
    assert.equal(weekly.totals.routinesDone, 1);
});

test('notification channel delivery is tracked independently and survives restart', async t => {
    const filePath = await makePath(t);
    const life = createLifeOS({ filePath });
    life.markNotificationChannelSent('reminder:m1', 'android');
    assert.ok(life.getNotificationDelivery('reminder:m1').android);
    assert.equal(life.getNotificationDelivery('reminder:m1').whatsapp, undefined);
    const restarted = createLifeOS({ filePath });
    assert.ok(restarted.getNotificationDelivery('reminder:m1').android);
    restarted.markNotificationSent('reminder:m1');
    assert.ok(restarted._getState().sentEvents['reminder:m1']);
});

test('Life OS version one data migrates while keeping the saved journal', async t => {
    const filePath = await makePath(t);
    const legacy = { version: 1, timezone: 'Africa/Kigali', journal: [{ id: 'j1', text: 'legacy note', createdAt: Date.now() }] };
    await fs.writeFile(filePath, JSON.stringify(legacy));
    const life = createLifeOS({ filePath });
    assert.equal(life.exportState().version, 2);
    assert.equal(life.searchJournal('legacy note')[0].id, 'j1');
    assert.equal(life.listRecords().length, 0);
    assert.equal(life.getSettings().aiCoach, false);
});

test('importing a valid Life OS backup replaces current data and rejects invalid data safely', async t => {
    const filePath = await makePath(t);
    const target = createLifeOS({ filePath });
    target.addGoal('Current local goal');
    const source = createLifeOS({ filePath: await makePath(t) });
    source.addRecord('work', 'Imported record', 'Backup record value');
    const result = target.importState(source.exportState());
    assert.equal(result.imported, true);
    assert.equal(result.version, 2);
    assert.equal(result.records, 1);
    assert.equal(target.listGoals().length, 0);
    assert.equal(target.listRecords()[0].title, 'Imported record');
    assert.throws(() => target.importState({ version: 99 }), /unsupported or invalid format/);
    assert.equal(target.listRecords()[0].title, 'Imported record');
});

test('Life OS notification preferences and scheduled backup times are validated', async t => {
    const life = createLifeOS({ filePath: await makePath(t) });
    assert.equal(life.setWhatsAppNotifications(false), false);
    assert.equal(life.setEmailNotifications(true), true);
    assert.deepEqual(life.setAutoBackup(true, '22:45'), { enabled: true, time: '22:45' });
    assert.throws(() => life.setAutoBackup(true, '29:99'), /HH:MM/);
    assert.equal(life.setAICoach(true), true);
    assert.equal(life.getSettings().aiCoach, true);
});


test('purpose reminders default to three daily checkpoints and validate their order', async t => {
    const filePath = await makePath(t);
    const life = createLifeOS({ filePath });
    const settings = life.getSettings();
    assert.equal(settings.purposeReminders, true);
    assert.deepEqual(settings.purposeReminderTimes, { morning: '06:30', midday: '13:00', evening: '20:30' });
    assert.deepEqual(life.setPurposeReminders(true, { morning: '06:15', midday: '12:45', evening: '20:15' }), {
        enabled: true,
        times: { morning: '06:15', midday: '12:45', evening: '20:15' },
    });
    assert.throws(() => life.setPurposeReminders(true, { morning: '13:00', midday: '12:00', evening: '20:00' }), /morning, midday, evening order/);
    const restarted = createLifeOS({ filePath });
    assert.equal(restarted.getSettings().purposeReminderTimes.morning, '06:15');
});

test('class morning, class afternoon and free day use dedicated schedule templates', async t => {
    const life = createLifeOS({ filePath: await makePath(t) });
    life.setWeeklyClassType('tue', 'morning');
    life.setWeeklyClassType('wed', 'afternoon');
    assert.equal(life.getDayType('2026-11-03'), 'class-morning');
    assert.equal(life.getDayType('2026-11-04'), 'class-afternoon');
    assert.equal(life.getDayType('2026-11-05'), 'free-day');
    const morning = life.getAgenda('2026-11-03');
    assert.equal(morning.find(item => item.id === 'morning-foundation').time, '06:00');
    assert.equal(morning.find(item => item.id === 'university').time, '08:00');
    const afternoon = life.getAgenda('2026-11-04');
    assert.equal(afternoon.find(item => item.id === 'study-focus').time, '08:00');
    assert.equal(afternoon.find(item => item.id === 'university').time, '14:00');
    assert.ok(afternoon.some(item => item.category === 'career'));
    assert.ok(afternoon.some(item => item.category === 'rest'));
    const free = life.getAgenda('2026-11-05');
    assert.ok(free.some(item => item.category === 'education'));
    assert.ok(free.some(item => item.category === 'career'));
});

test('special-day manual tasks are date-specific and respect the 23:00 wind-down boundary', async t => {
    const life = createLifeOS({ filePath: await makePath(t) });
    life.recordDailyCheckin('2026-11-03', 'special', 'Project launch');
    const id = life.addDayAgendaItem('2026-11-03', '10:00', 45, 'Launch checklist');
    assert.ok(life.getAgenda('2026-11-03').some(item => item.id === id && item.title === 'Launch checklist'));
    assert.ok(!life.getAgenda('2026-11-04').some(item => item.id === id));
    assert.throws(() => life.addDayAgendaItem('2026-11-03', '22:30', 60, 'Late task'), /finish special-day tasks by 23:00/);
    assert.equal(life.removeDayAgendaItem('2026-11-03', id), true);
});

test('agenda reminders have separate advance and start events', async t => {
    const filePath = await makePath(t);
    let now = localDateTimeToEpoch('2026-11-03', '07:50', 'Africa/Kigali');
    const life = createLifeOS({ filePath, now: () => now });
    life.setDayType('class-morning', '2026-11-03');
    const early = life.getDueNotifications(now);
    assert.ok(early.events.some(item => item.kind === 'agenda-advance' && item.key === 'agenda:2026-11-03:university'));
    now = localDateTimeToEpoch('2026-11-03', '08:01', 'Africa/Kigali');
    const atStart = life.getDueNotifications(now);
    assert.ok(atStart.events.some(item => item.kind === 'agenda-start' && item.key === 'agenda-start:2026-11-03:university'));
});

test('skipped agenda tasks retain the reason in the daily timeline', async t => {
    const life = createLifeOS({ filePath: await makePath(t) });
    life.recordDailyCheckin('2026-11-03', 'class-morning');
    assert.equal(life.markAgendaItem('2026-11-03', 'university', 'skipped', 'Unexpected university closure'), true);
    assert.equal(life.getAgenda('2026-11-03').find(item => item.id === 'university').note, 'Unexpected university closure');
});
