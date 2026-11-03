'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TIMEZONE = 'Africa/Kigali';
const DEFAULT_STATE_PATH = path.join(__dirname, '..', 'data', 'life-os.json');
const DAY_INDEX = Object.freeze({
    sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2,
    wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5,
    sat: 6, saturday: 6,
});
const TYPE_NAMES = new Set(['morning', 'evening', 'free', 'travel', 'home', 'sunday']);
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function makeItem(id, time, duration, title, options = {}) {
    return {
        id,
        time,
        duration,
        title,
        notify: options.notify !== false,
        leadMinutes: Number.isInteger(options.leadMinutes) ? options.leadMinutes : null,
        category: options.category || 'general',
        slot: options.slot || null,
    };
}

function defaultTemplates() {
    const foundation = [
        makeItem('morning-foundation', '06:00', 60, 'Wake up • prayer • sport • morning preparation', { category: 'foundation', leadMinutes: 0 }),
        makeItem('shower', '07:00', 30, 'Shower and get ready', { notify: false, category: 'preparation' }),
        makeItem('quick-chat', '07:30', 15, 'Quick message check', { category: 'communication', slot: 'quick' }),
    ];
    const cooking = [
        makeItem('cook', '20:00', 60, 'Cook and have dinner', { category: 'personal' }),
        makeItem('commitment-check', '21:10', 10, 'Private daily check-in: 27 / 190', { category: 'private' }),
        makeItem('youtube-night', '21:30', 60, 'Faceless YouTube project / prepare tomorrow', { category: 'deep-work' }),
    ];
    return {
        morning: [
            ...foundation,
            makeItem('university', '08:00', 270, 'University class (08:00–12:30)', { category: 'university', leadMinutes: 10 }),
            makeItem('midday-chat', '12:30', 30, 'Lunch and social message window', { category: 'communication', slot: 'midday-morning' }),
            makeItem('afternoon-work', '13:00', 270, 'Focused Software Engineering / Faceless YouTube work', { category: 'deep-work' }),
            makeItem('evening-chat', '17:30', 30, 'Social chat window', { category: 'communication', slot: 'evening' }),
            makeItem('free-break', '18:00', 120, 'Free break • film, music or rest', { notify: false, category: 'rest' }),
            ...cooking,
        ],
        evening: [
            ...foundation,
            makeItem('morning-work', '07:45', 255, 'Faceless YouTube / Software Engineering focus', { category: 'deep-work' }),
            makeItem('midday-chat', '12:00', 30, 'Lunch and message window', { category: 'communication', slot: 'midday-evening' }),
            makeItem('class-preparation', '12:30', 90, 'Prepare and travel to university', { category: 'preparation' }),
            makeItem('university', '14:00', 180, 'University class (14:00–17:00)', { category: 'university', leadMinutes: 10 }),
            makeItem('evening-chat', '17:15', 30, 'Social chat window after class', { category: 'communication', slot: 'post-class' }),
            makeItem('free-break', '17:45', 135, 'Free break • film, music or rest', { notify: false, category: 'rest' }),
            ...cooking,
        ],
        free: [
            ...foundation,
            makeItem('morning-work', '08:00', 240, 'Software Engineering study / Faceless YouTube focus', { category: 'deep-work' }),
            makeItem('midday-chat', '12:00', 30, 'Lunch and message window', { category: 'communication', slot: 'midday-free' }),
            makeItem('afternoon-work', '12:30', 300, 'Focused project work and skill development', { category: 'deep-work' }),
            makeItem('evening-chat', '17:30', 30, 'Social chat window', { category: 'communication', slot: 'evening' }),
            makeItem('free-break', '18:00', 120, 'Free break • film, music or rest', { notify: false, category: 'rest' }),
            ...cooking,
        ],
        travel: [
            foundation[0],
            foundation[1],
            makeItem('travel-family', '07:30', 600, 'Travel / family / home activities (adjust for today)', { notify: false, category: 'special' }),
            makeItem('evening-chat', '17:30', 30, 'Message check when convenient', { category: 'communication', slot: 'evening' }),
            makeItem('free-break', '18:00', 120, 'Rest and time with family', { notify: false, category: 'rest' }),
            ...cooking,
        ],
        home: [
            foundation[0],
            foundation[1],
            makeItem('home-family', '07:30', 570, 'Family and home responsibilities (editable)', { notify: false, category: 'special' }),
            makeItem('evening-chat', '17:30', 30, 'Social chat window', { category: 'communication', slot: 'evening' }),
            makeItem('free-break', '18:00', 120, 'Free time with family', { notify: false, category: 'rest' }),
            ...cooking,
        ],
        sunday: [
            foundation[0],
            foundation[1],
            makeItem('faith-family', '08:00', 240, 'Faith, family and personal time (edit to fit your Sunday)', { notify: false, category: 'personal' }),
            makeItem('midday-chat', '12:30', 30, 'Lunch and message window', { category: 'communication', slot: 'midday-free' }),
            makeItem('rest', '13:00', 180, 'Rest and reset', { notify: false, category: 'rest' }),
            makeItem('weekly-review', '16:30', 45, 'Weekly review and plan the coming week', { category: 'review' }),
            makeItem('evening-chat', '17:30', 30, 'Social chat window', { category: 'communication', slot: 'evening' }),
            makeItem('free-break', '18:00', 120, 'Free time and family', { notify: false, category: 'rest' }),
            ...cooking,
        ],
    };
}

function defaultState() {
    return {
        version: 2,
        timezone: DEFAULT_TIMEZONE,
        weeklyClassTypes: {},
        dayOverrides: {},
        templates: defaultTemplates(),
        routines: [],
        reminders: [],
        records: [],
        goals: [],
        journal: [],
        checkins: [],
        dailyProgress: {},
        sentEvents: {},
        notificationDeliveries: {},
        routineProgress: {},
        settings: {
            advanceMinutes: 10,
            androidNotifications: false,
            whatsappNotifications: true,
            emailNotifications: false,
            autoBackup: false,
            autoBackupTime: '22:45',
            focusMode: false,
            dailyAgenda: true,
            dailyAgendaTime: '05:55',
        },
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function validTimezone(timezone) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
        return true;
    } catch {
        return false;
    }
}

function validateTime(value) {
    return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function localParts(value, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
    }).formatToParts(value instanceof Date ? value : new Date(value));
    const data = {};
    for (const part of parts) if (part.type !== 'literal') data[part.type] = part.value;
    return {
        date: data.year + '-' + data.month + '-' + data.day,
        time: data.hour + ':' + data.minute,
        weekday: String(data.weekday || '').slice(0, 3).toLowerCase(),
    };
}

function localDateTimeToEpoch(date, time, timezone) {
    if (!validateDate(date) || !validateTime(time) || !validTimezone(timezone)) {
        throw new TypeError('Use a valid YYYY-MM-DD date, HH:MM time and IANA timezone.');
    }
    const target = Date.parse(date + 'T' + time + ':00Z');
    let guess = target;
    for (let i = 0; i < 4; i++) {
        const parts = localParts(guess, timezone);
        const represented = Date.parse(parts.date + 'T' + parts.time + ':00Z');
        const next = target - (represented - guess);
        if (next === guess) break;
        guess = next;
    }
    const verified = localParts(guess, timezone);
    if (verified.date !== date || verified.time !== time) {
        throw new TypeError('That local time does not exist in the selected timezone.');
    }
    return guess;
}

function addDays(dateKey, amount) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + amount));
    return date.toISOString().slice(0, 10);
}

function weekdayIndex(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function normalizeRecurrence(input) {
    const value = String(input || '').trim().toLowerCase();
    if (value === 'daily') return [0, 1, 2, 3, 4, 5, 6];
    if (value === 'weekdays') return [1, 2, 3, 4, 5];
    if (value === 'weekends') return [0, 6];
    const days = value.split(',').map(day => DAY_INDEX[day.trim()]).filter(day => Number.isInteger(day));
    return [...new Set(days)].sort((a, b) => a - b);
}

function mergeState(parsed) {
    const base = defaultState();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || ![1, 2].includes(parsed.version)) {
        throw new Error('Life OS data has an unsupported or invalid format; the original file was left untouched.');
    }
    return {
        ...base,
        ...parsed,
        version: 2,
        settings: { ...base.settings, ...(parsed.settings || {}) },
        templates: { ...base.templates, ...(parsed.templates || {}) },
        weeklyClassTypes: parsed.weeklyClassTypes || {},
        dayOverrides: parsed.dayOverrides || {},
        routines: Array.isArray(parsed.routines) ? parsed.routines : [],
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
        records: Array.isArray(parsed.records) ? parsed.records : [],
        goals: Array.isArray(parsed.goals) ? parsed.goals : [],
        journal: Array.isArray(parsed.journal) ? parsed.journal : [],
        checkins: Array.isArray(parsed.checkins) ? parsed.checkins : [],
        dailyProgress: parsed.dailyProgress || {},
        sentEvents: parsed.sentEvents || {},
        notificationDeliveries: parsed.notificationDeliveries || {},
        routineProgress: parsed.routineProgress || {},
    };
}

function createLifeOS(options = {}) {
    const filePath = options.filePath || DEFAULT_STATE_PATH;
    const now = options.now || Date.now;
    let state;
    try {
        state = mergeState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (error) {
        if (error.code === 'ENOENT') state = defaultState();
        else throw error;
    }

    function persist() {
        const directory = path.dirname(filePath);
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const tempPath = filePath + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
        try {
            fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), { mode: 0o600 });
            fs.renameSync(tempPath, filePath);
        } finally {
            try { fs.unlinkSync(tempPath); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    }

    function dateKeyAt(timestamp = now()) {
        return localParts(timestamp, state.timezone).date;
    }

    function dayType(dateKey) {
        const override = state.dayOverrides[dateKey];
        if (override && TYPE_NAMES.has(override.type)) return override.type;
        const weekday = DAY_NAMES[weekdayIndex(dateKey)];
        const weekly = state.weeklyClassTypes[weekday];
        if (weekly === 'morning' || weekly === 'evening') return weekly;
        return weekday === 'sun' ? 'sunday' : 'free';
    }

    function getProgress(dateKey) {
        if (!state.dailyProgress[dateKey]) {
            state.dailyProgress[dateKey] = { statuses: {}, timeOverrides: {} };
        }
        const progress = state.dailyProgress[dateKey];
        if (!progress.statuses) progress.statuses = {};
        if (!progress.timeOverrides) progress.timeOverrides = {};
        return progress;
    }

    function getAgenda(dateKey = dateKeyAt()) {
        if (!validateDate(dateKey)) throw new TypeError('Use date format YYYY-MM-DD.');
        const type = dayType(dateKey);
        const progress = getProgress(dateKey);
        const items = (state.templates[type] || []).map(item => {
            const time = progress.timeOverrides[item.id] || item.time;
            const startAt = localDateTimeToEpoch(dateKey, time, state.timezone);
            return {
                ...clone(item),
                time,
                date: dateKey,
                type,
                startAt,
                endAt: startAt + Math.max(1, Number(item.duration) || 30) * 60000,
                status: progress.statuses[item.id] || 'pending',
            };
        });
        return items.sort((a, b) => a.startAt - b.startAt);
    }

    function getNextAction(timestamp = now()) {
        const dateKey = dateKeyAt(timestamp);
        const candidates = getAgenda(dateKey).filter(item => item.status === 'pending');
        const current = candidates.find(item => item.startAt <= timestamp && item.endAt > timestamp);
        if (current) return { ...current, phase: 'current' };
        const overdue = candidates.find(item => item.startAt <= timestamp && item.endAt <= timestamp);
        if (overdue) return { ...overdue, phase: 'overdue' };
        const next = candidates.find(item => item.startAt > timestamp);
        if (next) return { ...next, phase: 'upcoming' };
        return null;
    }

    function setDayType(type, dateKey = dateKeyAt(), note = '') {
        if (!TYPE_NAMES.has(type)) throw new TypeError('Choose morning, evening, free, travel, home or sunday.');
        if (!validateDate(dateKey)) throw new TypeError('Use date format YYYY-MM-DD.');
        state.dayOverrides[dateKey] = { type, note: String(note || '').slice(0, 300) };
        persist();
        return type;
    }

    function setWeeklyClassType(day, type) {
        const key = String(day || '').toLowerCase().slice(0, 3);
        if (!(key in DAY_INDEX)) throw new TypeError('Use a weekday such as mon, tue or sun.');
        if (!['morning', 'evening', 'off'].includes(type)) throw new TypeError('Choose morning, evening or off.');
        if (type === 'off') delete state.weeklyClassTypes[key];
        else state.weeklyClassTypes[key] = type;
        persist();
        return { day: key, type };
    }

    function addAgendaItem(dateType, time, duration, title) {
        if (!TYPE_NAMES.has(dateType)) throw new TypeError('Choose a valid agenda type.');
        if (!validateTime(time)) throw new TypeError('Use 24-hour time HH:MM.');
        const mins = Number(duration);
        if (!Number.isInteger(mins) || mins < 5 || mins > 720) throw new TypeError('Duration must be 5–720 minutes.');
        const cleanTitle = String(title || '').trim().slice(0, 180);
        if (!cleanTitle) throw new TypeError('Enter an agenda task.');
        const id = 'a' + crypto.randomBytes(3).toString('hex');
        state.templates[dateType].push(makeItem(id, time, mins, cleanTitle, { category: 'custom' }));
        persist();
        return id;
    }

    function updateAgendaItem(dateType, id, patch = {}) {
        if (!TYPE_NAMES.has(dateType)) throw new TypeError('Choose a valid agenda type.');
        const item = (state.templates[dateType] || []).find(entry => entry.id === id);
        if (!item) return false;
        if (patch.time !== undefined) {
            if (!validateTime(patch.time)) throw new TypeError('Use 24-hour time HH:MM.');
            item.time = patch.time;
        }
        if (patch.duration !== undefined) {
            const mins = Number(patch.duration);
            if (!Number.isInteger(mins) || mins < 5 || mins > 720) throw new TypeError('Duration must be 5–720 minutes.');
            item.duration = mins;
        }
        if (patch.title !== undefined) {
            const cleanTitle = String(patch.title || '').trim().slice(0, 180);
            if (!cleanTitle) throw new TypeError('Task title cannot be empty.');
            item.title = cleanTitle;
        }
        if (patch.notify !== undefined) item.notify = Boolean(patch.notify);
        persist();
        return true;
    }

    function removeAgendaItem(dateType, id) {
        if (!TYPE_NAMES.has(dateType)) throw new TypeError('Choose a valid agenda type.');
        const next = (state.templates[dateType] || []).filter(item => item.id !== id);
        if (next.length === (state.templates[dateType] || []).length) return false;
        state.templates[dateType] = next;
        persist();
        return true;
    }

    function markAgendaItem(dateKey, id, status) {
        if (!['done', 'skipped', 'pending'].includes(status)) throw new TypeError('Invalid agenda status.');
        const exists = getAgenda(dateKey).some(item => item.id === id);
        if (!exists) return false;
        getProgress(dateKey).statuses[id] = status;
        persist();
        return true;
    }

    function moveAgendaItem(dateKey, id, time) {
        if (!validateTime(time)) throw new TypeError('Use 24-hour time HH:MM.');
        const exists = getAgenda(dateKey).some(item => item.id === id);
        if (!exists) return false;
        getProgress(dateKey).timeOverrides[id] = time;
        persist();
        return true;
    }

    function addRoutine(time, recurrence, title) {
        if (!validateTime(time)) throw new TypeError('Use 24-hour time HH:MM.');
        const days = normalizeRecurrence(recurrence);
        if (!days.length) throw new TypeError('Use daily, weekdays, weekends or days such as mon,wed,fri.');
        const cleanTitle = String(title || '').trim().slice(0, 180);
        if (!cleanTitle) throw new TypeError('Enter a routine task.');
        if (state.routines.filter(item => item.active).length >= 40) throw new RangeError('Maximum 40 active routines.');
        const id = 'r' + crypto.randomBytes(3).toString('hex');
        const routine = { id, time, days, title: cleanTitle, active: true, createdAt: now() };
        state.routines.push(routine);
        persist();
        return clone(routine);
    }

    function listRoutines() {
        return clone(state.routines);
    }

    function updateRoutine(id, patch = {}) {
        const routine = state.routines.find(item => item.id === id);
        if (!routine) return false;
        if (patch.time !== undefined) {
            if (!validateTime(patch.time)) throw new TypeError('Use 24-hour time HH:MM.');
            routine.time = patch.time;
        }
        if (patch.title !== undefined) {
            const cleanTitle = String(patch.title || '').trim().slice(0, 180);
            if (!cleanTitle) throw new TypeError('Routine title cannot be empty.');
            routine.title = cleanTitle;
        }
        if (patch.days !== undefined) {
            const days = normalizeRecurrence(patch.days);
            if (!days.length) throw new TypeError('Invalid recurrence.');
            routine.days = days;
        }
        if (patch.active !== undefined) routine.active = Boolean(patch.active);
        persist();
        return true;
    }

    function markRoutine(dateKey, id, status) {
        if (!validateDate(dateKey)) throw new TypeError('Use date format YYYY-MM-DD.');
        if (!['done', 'skipped', 'pending'].includes(status)) throw new TypeError('Invalid routine status.');
        if (!state.routines.some(item => item.id === id)) return false;
        if (!state.routineProgress[dateKey]) state.routineProgress[dateKey] = {};
        state.routineProgress[dateKey][id] = status;
        persist();
        return true;
    }

    function deleteRoutine(id) {
        const index = state.routines.findIndex(item => item.id === id);
        if (index < 0) return false;
        state.routines.splice(index, 1);
        for (const progress of Object.values(state.routineProgress || {})) delete progress[id];
        persist();
        return true;
    }

    function addReminder(date, time, title) {
        const dueAt = localDateTimeToEpoch(date, time, state.timezone);
        if (dueAt <= now()) throw new TypeError('Reminder time must be in the future.');
        const cleanTitle = String(title || '').trim().slice(0, 240);
        if (!cleanTitle) throw new TypeError('Enter a reminder task.');
        if (state.reminders.filter(item => item.status === 'pending').length >= 100) {
            throw new RangeError('Maximum 100 pending Life OS reminders.');
        }
        const reminder = {
            id: 'm' + crypto.randomBytes(3).toString('hex'),
            date,
            time,
            dueAt,
            title: cleanTitle,
            status: 'pending',
            createdAt: now(),
        };
        state.reminders.push(reminder);
        persist();
        return clone(reminder);
    }

    function listReminders() {
        return clone(state.reminders);
    }

    function deleteReminder(id) {
        const index = state.reminders.findIndex(item => item.id === id);
        if (index < 0) return false;
        state.reminders.splice(index, 1);
        persist();
        return true;
    }

    function addRecord(category, title, value) {
        const cleanCategory = String(category || 'general').trim().slice(0, 60) || 'general';
        const cleanTitle = String(title || '').trim().slice(0, 180);
        const cleanValue = String(value || '').trim().slice(0, 3000);
        if (!cleanTitle || !cleanValue) throw new TypeError('Enter a record title and value.');
        if (state.records.length >= 1000) throw new RangeError('Maximum 1000 personal records.');
        const record = {
            id: 'p' + crypto.randomBytes(3).toString('hex'),
            category: cleanCategory,
            title: cleanTitle,
            value: cleanValue,
            createdAt: now(),
            updatedAt: now(),
        };
        state.records.push(record);
        persist();
        return clone(record);
    }

    function listRecords(query = '') {
        const term = String(query || '').trim().toLocaleLowerCase();
        const items = term
            ? state.records.filter(item => [item.category, item.title, item.value].some(value => String(value).toLocaleLowerCase().includes(term)))
            : state.records;
        return clone(items.slice(-100).reverse());
    }

    function updateRecord(id, patch = {}) {
        const record = state.records.find(item => item.id === id);
        if (!record) return false;
        if (patch.category !== undefined) record.category = String(patch.category || 'general').trim().slice(0, 60) || 'general';
        if (patch.title !== undefined) {
            const title = String(patch.title || '').trim().slice(0, 180);
            if (!title) throw new TypeError('Record title cannot be empty.');
            record.title = title;
        }
        if (patch.value !== undefined) {
            const value = String(patch.value || '').trim().slice(0, 3000);
            if (!value) throw new TypeError('Record value cannot be empty.');
            record.value = value;
        }
        record.updatedAt = now();
        persist();
        return true;
    }

    function deleteRecord(id) {
        const index = state.records.findIndex(item => item.id === id);
        if (index < 0) return false;
        state.records.splice(index, 1);
        persist();
        return true;
    }

    function addGoal(title) {
        const cleanTitle = String(title || '').trim().slice(0, 240);
        if (!cleanTitle) throw new TypeError('Enter a goal.');
        if (state.goals.filter(item => item.status === 'active').length >= 50) throw new RangeError('Maximum 50 active goals.');
        const goal = { id: 'g' + crypto.randomBytes(3).toString('hex'), title: cleanTitle, status: 'active', createdAt: now(), updatedAt: now() };
        state.goals.push(goal);
        persist();
        return clone(goal);
    }

    function updateGoal(id, patch = {}) {
        const goal = state.goals.find(item => item.id === id);
        if (!goal) return false;
        if (patch.title !== undefined) {
            const cleanTitle = String(patch.title || '').trim().slice(0, 240);
            if (!cleanTitle) throw new TypeError('Goal title cannot be empty.');
            goal.title = cleanTitle;
        }
        if (patch.status !== undefined) {
            if (!['active', 'done', 'paused'].includes(patch.status)) throw new TypeError('Goal status must be active, done or paused.');
            goal.status = patch.status;
        }
        goal.updatedAt = now();
        persist();
        return true;
    }

    function deleteGoal(id) {
        const index = state.goals.findIndex(item => item.id === id);
        if (index < 0) return false;
        state.goals.splice(index, 1);
        persist();
        return true;
    }

    function addJournalEntry(text) {
        const value = String(text || '').trim().slice(0, 3000);
        if (!value) throw new TypeError('Journal entry cannot be empty.');
        const entry = { id: 'j' + crypto.randomBytes(3).toString('hex'), text: value, createdAt: now(), updatedAt: now() };
        state.journal.push(entry);
        if (state.journal.length > 1000) state.journal.shift();
        persist();
        return clone(entry);
    }

    function updateJournalEntry(id, text) {
        const entry = state.journal.find(item => item.id === id);
        if (!entry) return false;
        const value = String(text || '').trim().slice(0, 3000);
        if (!value) throw new TypeError('Journal entry cannot be empty.');
        entry.text = value;
        entry.updatedAt = now();
        persist();
        return true;
    }

    function deleteJournalEntry(id) {
        const index = state.journal.findIndex(item => item.id === id);
        if (index < 0) return false;
        state.journal.splice(index, 1);
        persist();
        return true;
    }

    function searchJournal(query) {
        const term = String(query || '').trim().toLocaleLowerCase();
        if (!term) return clone(state.journal.slice(-10).reverse());
        return clone(state.journal.filter(entry => entry.text.toLocaleLowerCase().includes(term)).slice(-30).reverse());
    }

    function recordCheckin(code, status, note = '') {
        const value = String(code || '');
        if (!['27', '190'].includes(value)) throw new TypeError('Use private commitment code 27 or 190.');
        const result = String(status || '').toLowerCase();
        if (!['kept', 'urge', 'slipped'].includes(result)) throw new TypeError('Choose kept, urge or slipped.');
        const today = dateKeyAt();
        const existing = state.checkins.find(item => item.date === today && item.code === value);
        const entry = {
            id: 'c' + crypto.randomBytes(3).toString('hex'),
            date: today,
            code: value,
            status: result,
            note: String(note || '').trim().slice(0, 160),
            updatedAt: now(),
        };
        if (existing) Object.assign(existing, entry);
        else state.checkins.push(entry);
        if (state.checkins.length > 500) state.checkins.splice(0, state.checkins.length - 500);
        persist();
        return clone(entry);
    }

    function getCheckins(limit = 14) {
        return clone(state.checkins.slice(-Math.max(1, limit)).reverse());
    }

    function setTimezone(timezone) {
        if (!validTimezone(timezone)) throw new TypeError('Use a valid IANA timezone, e.g. Africa/Kigali.');
        state.timezone = timezone;
        persist();
        return timezone;
    }

    function setAdvanceMinutes(value) {
        const minutes = Number(value);
        if (!Number.isInteger(minutes) || minutes < 0 || minutes > 60) throw new TypeError('Advance reminder must be 0–60 minutes.');
        state.settings.advanceMinutes = minutes;
        persist();
        return minutes;
    }

    function setDailyAgenda(enabled, time = state.settings.dailyAgendaTime || '05:55') {
        if (!validateTime(time)) throw new TypeError('Use HH:MM for daily agenda time.');
        state.settings.dailyAgenda = Boolean(enabled);
        state.settings.dailyAgendaTime = time;
        persist();
        return { enabled: state.settings.dailyAgenda, time };
    }

    function setAndroidNotifications(enabled) {
        state.settings.androidNotifications = Boolean(enabled);
        persist();
        return state.settings.androidNotifications;
    }

    function setFocusMode(enabled) {
        state.settings.focusMode = Boolean(enabled);
        persist();
        return state.settings.focusMode;
    }

    function getSettings() {
        return { timezone: state.timezone, ...clone(state.settings) };
    }

    function getDueNotifications(timestamp = now()) {
        const dateKey = dateKeyAt(timestamp);
        const events = [];
        const stale = [];
        for (const item of getAgenda(dateKey)) {
            if (!item.notify || item.status !== 'pending') continue;
            const lead = item.leadMinutes === null ? state.settings.advanceMinutes : item.leadMinutes;
            const notifyAt = item.startAt - lead * 60000;
            const age = timestamp - notifyAt;
            const key = 'agenda:' + dateKey + ':' + item.id;
            if (timestamp >= notifyAt && !state.sentEvents[key]) {
                if (age > 90 * 60 * 1000) stale.push(key);
                else events.push({ key, kind: 'agenda', title: item.title, time: item.time, late: age > 60000 });
            }
        }
        const weekday = weekdayIndex(dateKey);
        for (const routine of state.routines) {
            if (!routine.active || !Array.isArray(routine.days) || !routine.days.includes(weekday)) continue;
            const routineStatus = state.routineProgress?.[dateKey]?.[routine.id];
            if (routineStatus === 'done' || routineStatus === 'skipped') continue;
            const dueAt = localDateTimeToEpoch(dateKey, routine.time, state.timezone);
            const notifyAt = dueAt - state.settings.advanceMinutes * 60000;
            const key = 'routine:' + dateKey + ':' + routine.id;
            const age = timestamp - notifyAt;
            if (timestamp >= notifyAt && !state.sentEvents[key]) {
                if (age > 90 * 60 * 1000) stale.push(key);
                else events.push({ key, kind: 'routine', title: routine.title, time: routine.time, late: age > 60000 });
            }
        }
        for (const reminder of state.reminders) {
            if (reminder.status !== 'pending' || timestamp < reminder.dueAt) continue;
            const key = 'reminder:' + reminder.id;
            const age = timestamp - reminder.dueAt;
            if (state.sentEvents[key]) continue;
            if (age > 24 * 60 * 60 * 1000) stale.push(key);
            else events.push({ key, kind: 'reminder', title: reminder.title, time: reminder.time, late: age > 60000 });
        }
        events.sort((a, b) => String(a.time).localeCompare(String(b.time)));
        return { events, stale };
    }

    function getDailyReport(dateKey = dateKeyAt()) {
        if (!validateDate(dateKey)) throw new TypeError('Use date format YYYY-MM-DD.');
        const agenda = getAgenda(dateKey);
        const weekday = weekdayIndex(dateKey);
        const routines = state.routines.filter(item => item.active && Array.isArray(item.days) && item.days.includes(weekday));
        const routineDone = routines.filter(item => state.routineProgress?.[dateKey]?.[item.id] === 'done').length;
        const routineSkipped = routines.filter(item => state.routineProgress?.[dateKey]?.[item.id] === 'skipped').length;
        const agendaDone = agenda.filter(item => item.status === 'done').length;
        const agendaSkipped = agenda.filter(item => item.status === 'skipped').length;
        return {
            date: dateKey,
            dayType: dayType(dateKey),
            agenda: { total: agenda.length, done: agendaDone, skipped: agendaSkipped, pending: agenda.length - agendaDone - agendaSkipped },
            routines: { total: routines.length, done: routineDone, skipped: routineSkipped, pending: routines.length - routineDone - routineSkipped },
            goals: { active: state.goals.filter(item => item.status === 'active').length, done: state.goals.filter(item => item.status === 'done').length },
            journalEntries: state.journal.filter(item => localParts(item.createdAt, state.timezone).date === dateKey).length,
        };
    }

    function getWeeklyReport(endDate = dateKeyAt()) {
        if (!validateDate(endDate)) throw new TypeError('Use date format YYYY-MM-DD.');
        const days = [];
        for (let offset = 6; offset >= 0; offset--) days.push(getDailyReport(addDays(endDate, -offset)));
        return {
            startDate: days[0].date,
            endDate,
            days,
            totals: days.reduce((total, item) => ({
                agendaDone: total.agendaDone + item.agenda.done,
                agendaTotal: total.agendaTotal + item.agenda.total,
                routinesDone: total.routinesDone + item.routines.done,
                routinesTotal: total.routinesTotal + item.routines.total,
            }), { agendaDone: 0, agendaTotal: 0, routinesDone: 0, routinesTotal: 0 }),
        };
    }

    function markNotificationSent(key) {
        state.sentEvents[key] = now();
        if (key.startsWith('reminder:')) {
            const id = key.slice('reminder:'.length);
            const reminder = state.reminders.find(item => item.id === id);
            if (reminder) reminder.status = 'sent';
        }
        const entries = Object.entries(state.sentEvents).sort((a, b) => a[1] - b[1]);
        while (entries.length > 1000) delete state.sentEvents[entries.shift()[0]];
        persist();
    }

    function getNotificationDelivery(key) {
        return clone(state.notificationDeliveries[key] || {});
    }

    function markNotificationChannelSent(key, channel) {
        if (!['android', 'whatsapp', 'email'].includes(channel)) throw new TypeError('Unknown notification channel.');
        if (!state.notificationDeliveries[key]) state.notificationDeliveries[key] = {};
        state.notificationDeliveries[key][channel] = now();
        state.notificationDeliveries[key].updatedAt = now();
        const entries = Object.entries(state.notificationDeliveries).sort((a, b) =>
            Number(a[1].updatedAt || 0) - Number(b[1].updatedAt || 0));
        while (entries.length > 1000) delete state.notificationDeliveries[entries.shift()[0]];
        persist();
        return true;
    }

    function exportState() {
        return clone(state);
    }

    function importState(parsed) {
        const next = mergeState(parsed);
        const previous = state;
        state = next;
        try {
            persist();
            return { imported: true, version: state.version, records: state.records.length };
        } catch (error) {
            state = previous;
            throw error;
        }
    }

    function setWhatsAppNotifications(enabled) {
        state.settings.whatsappNotifications = Boolean(enabled);
        persist();
        return state.settings.whatsappNotifications;
    }

    function setEmailNotifications(enabled) {
        state.settings.emailNotifications = Boolean(enabled);
        persist();
        return state.settings.emailNotifications;
    }

    function setAutoBackup(enabled, time = state.settings.autoBackupTime || '22:45') {
        if (!validateTime(time)) throw new TypeError('Use HH:MM for automatic backup time.');
        state.settings.autoBackup = Boolean(enabled);
        state.settings.autoBackupTime = time;
        persist();
        return { enabled: state.settings.autoBackup, time };
    }

    function markNotificationMissed(key) {
        state.sentEvents[key] = now();
        if (key.startsWith('reminder:')) {
            const id = key.slice('reminder:'.length);
            const reminder = state.reminders.find(item => item.id === id);
            if (reminder) reminder.status = 'missed';
        }
        persist();
    }

    return {
        getTimezone: () => state.timezone,
        getDateKey: dateKeyAt,
        getDayType: dayType,
        getAgenda,
        getNextAction,
        setDayType,
        setWeeklyClassType,
        addAgendaItem,
        updateAgendaItem,
        removeAgendaItem,
        markAgendaItem,
        moveAgendaItem,
        addRoutine,
        listRoutines,
        updateRoutine,
        deleteRoutine,
        addReminder,
        listReminders,
        deleteReminder,
        addRecord,
        listRecords,
        updateRecord,
        deleteRecord,
        addGoal,
        updateGoal,
        deleteGoal,
        listGoals: () => clone(state.goals),
        addJournalEntry,
        updateJournalEntry,
        deleteJournalEntry,
        searchJournal,
        recordCheckin,
        getCheckins,
        setTimezone,
        setAdvanceMinutes,
        setDailyAgenda,
        setWhatsAppNotifications,
        setEmailNotifications,
        setAutoBackup,
        markRoutine,
        setAndroidNotifications,
        setFocusMode,
        getSettings,
        getDueNotifications,
        getDailyReport,
        getWeeklyReport,
        getNotificationDelivery,
        markNotificationChannelSent,
        markNotificationSent,
        markNotificationMissed,
        exportState,
        importState,
        _getState: () => clone(state),
    };
}

module.exports = {
    DEFAULT_TIMEZONE,
    DEFAULT_STATE_PATH,
    createLifeOS,
    localDateTimeToEpoch,
    localParts,
    normalizeRecurrence,
    validateDate,
    validateTime,
};
