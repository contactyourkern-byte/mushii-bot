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
    assert.equal(settings.dailyAgendaTime, '05:55');
    assert.equal(settings.advanceMinutes, 10);
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
