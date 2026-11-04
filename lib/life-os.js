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
const TYPE_NAMES = new Set(['morning', 'evening', 'free', 'free-day', 'class-morning', 'class-afternoon', 'travel', 'home', 'sunday', 'focus', 'study', 'work', 'spiritual', 'rest', 'special']);
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
        makeItem('morning-foundation', '06:00', 60, 'Wake up • prayer • sport • morning preparation', { category: 'foundation', leadMinutes: 0, notify: false }),
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
        'class-morning': [
            ...foundation,
            makeItem('university', '08:00', 270, 'University class · attend, participate and capture key notes', { category: 'university', leadMinutes: 10 }),
            makeItem('midday-chat', '12:30', 30, 'Planned WhatsApp and public-chat window · 12:30–13:00', { category: 'communication', slot: 'midday' }),
            makeItem('class-review', '13:00', 90, 'Software Engineering · review class notes and complete one exercise', { category: 'education' }),
            makeItem('short-break', '14:30', 15, 'Short break · water, stretch and rest your eyes', { category: 'health', leadMinutes: 0 }),
            makeItem('content-creation', '14:45', 120, 'Faceless YouTube · create one meaningful content deliverable', { category: 'career' }),
            makeItem('self-care', '16:45', 45, 'Personal care, fresh air and a calm reset', { category: 'health' }),
            makeItem('evening-chat', '17:30', 30, 'Planned WhatsApp and public-chat window · 17:30–18:00', { category: 'communication', slot: 'evening' }),
            makeItem('rest', '18:00', 90, 'Rest and personal time · leave non-urgent chats for the next window', { notify: false, category: 'rest' }),
            makeItem('dinner', '19:30', 60, 'Prepare dinner, eat and tidy your space', { category: 'personal' }),
            makeItem('creator-review', '20:30', 45, 'Review the channel plan and choose tomorrow’s next content step', { category: 'career' }),
            makeItem('purpose-review', '21:15', 15, 'Private purpose check-in · Codes 27 and 190', { category: 'private' }),
            makeItem('wind-down', '22:15', 45, 'Personal care, gratitude and screens away', { category: 'rest' }),
            makeItem('sleep', '23:00', 30, 'Sleep · protect your rest and tomorrow’s energy', { category: 'health' }),
        ],
        'class-afternoon': [
            ...foundation,
            makeItem('study-focus', '08:00', 120, 'Software Engineering · focused learning and practice', { category: 'education' }),
            makeItem('short-break', '10:00', 15, 'Short break · water, stretch and rest your eyes', { category: 'health', leadMinutes: 0 }),
            makeItem('content-creation', '10:15', 120, 'Faceless YouTube · research, script or edit one deliverable', { category: 'career' }),
            makeItem('lunch-preparation', '12:15', 105, 'Lunch, prepare for class and travel with enough time', { category: 'preparation' }),
            makeItem('university', '14:00', 180, 'University class · attend, participate and capture key notes', { category: 'university', leadMinutes: 10 }),
            makeItem('evening-chat', '17:15', 30, 'Planned WhatsApp and public-chat window · 17:15–17:45', { category: 'communication', slot: 'post-class' }),
            makeItem('rest', '17:45', 75, 'Short recovery break and personal time', { notify: false, category: 'rest' }),
            makeItem('self-care', '19:00', 30, 'Personal care and reset', { category: 'health' }),
            makeItem('dinner', '19:30', 60, 'Prepare dinner, eat and tidy your space', { category: 'personal' }),
            makeItem('creator-review', '20:30', 45, 'Review content progress and prepare tomorrow’s next step', { category: 'career' }),
            makeItem('purpose-review', '21:15', 15, 'Private purpose check-in · Codes 27 and 190', { category: 'private' }),
            makeItem('wind-down', '22:15', 45, 'Personal care, gratitude and screens away', { category: 'rest' }),
            makeItem('sleep', '23:00', 30, 'Sleep · protect your rest and tomorrow’s energy', { category: 'health' }),
        ],
        'free-day': [
            ...foundation,
            makeItem('study-focus', '08:00', 120, 'Software Engineering · focused learning and practice', { category: 'education' }),
            makeItem('short-break', '10:00', 15, 'Short break · water, stretch and rest your eyes', { category: 'health', leadMinutes: 0 }),
            makeItem('content-creation', '10:15', 120, 'Faceless YouTube · create one meaningful content deliverable', { category: 'career' }),
            makeItem('midday-chat', '12:15', 30, 'Planned WhatsApp and public-chat window · 12:15–12:45', { category: 'communication', slot: 'midday' }),
            makeItem('lunch', '12:45', 45, 'Prepare lunch and eat mindfully', { category: 'personal' }),
            makeItem('project-work', '13:30', 120, 'Build a skill or move one important project forward', { category: 'career' }),
            makeItem('afternoon-break', '15:30', 15, 'Short break · step away from the screen', { category: 'health', leadMinutes: 0 }),
            makeItem('skill-practice', '15:45', 90, 'Practice, research and improve your craft', { category: 'education' }),
            makeItem('self-care', '17:15', 45, 'Exercise recovery, personal care and refresh', { category: 'health' }),
            makeItem('evening-chat', '18:00', 30, 'Planned WhatsApp and public-chat window · 18:00–18:30', { category: 'communication', slot: 'evening' }),
            makeItem('rest', '18:30', 60, 'Rest and enjoy screen-free personal time', { notify: false, category: 'rest' }),
            makeItem('dinner', '19:30', 60, 'Prepare dinner, eat and tidy your space', { category: 'personal' }),
            makeItem('purpose-review', '21:00', 15, 'Private purpose check-in · Codes 27 and 190', { category: 'private' }),
            makeItem('wind-down', '22:15', 45, 'Personal care, gratitude and screens away', { category: 'rest' }),
            makeItem('sleep', '23:00', 30, 'Sleep · protect your rest and tomorrow’s energy', { category: 'health' }),
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
        focus: [
            ...foundation,
            makeItem('focus-deep-work-1', '08:00', 150, 'Priority project · deep work block 1', { category: 'deep-work' }),
            makeItem('focus-break', '10:30', 30, 'Walk, water and reset', { notify: false, category: 'health' }),
            makeItem('focus-deep-work-2', '11:00', 150, 'Priority project · deep work block 2', { category: 'deep-work' }),
            makeItem('focus-review', '14:00', 45, 'Review goals and finish the most important task', { category: 'review' }),
            makeItem('focus-movement', '17:00', 45, 'Movement and physical reset', { category: 'health' }),
            ...cooking,
        ],
        study: [
            ...foundation,
            makeItem('study-block-1', '08:00', 120, 'Study block 1 · active recall', { category: 'education' }),
            makeItem('study-break', '10:00', 30, 'Break and hydration', { notify: false, category: 'health' }),
            makeItem('study-block-2', '10:30', 120, 'Study block 2 · exercises and practice', { category: 'education' }),
            makeItem('study-review', '14:00', 90, 'Assignments, notes and revision', { category: 'education' }),
            makeItem('study-reset', '17:00', 45, 'Exercise and mental reset', { category: 'health' }),
            ...cooking,
        ],
        work: [
            ...foundation,
            makeItem('work-priority-1', '08:00', 180, 'Most important work deliverable', { category: 'career' }),
            makeItem('work-communication', '11:15', 45, 'Email, calls and communication window', { category: 'communication' }),
            makeItem('work-priority-2', '13:00', 180, 'Second work block · execution', { category: 'career' }),
            makeItem('work-close', '16:30', 30, 'Close open loops and plan tomorrow', { category: 'review' }),
            ...cooking,
        ],
        spiritual: [
            makeItem('spiritual-morning', '06:00', 60, 'Prayer, Scripture and quiet reflection', { category: 'spiritual', leadMinutes: 0 }),
            makeItem('spiritual-study', '07:00', 45, 'Bible study · Psalm and reflection notes', { category: 'spiritual' }),
            makeItem('spiritual-service', '09:00', 120, 'Worship, service or faith community', { category: 'spiritual' }),
            makeItem('spiritual-family', '13:00', 120, 'Family, gratitude and meaningful connection', { category: 'relationships' }),
            makeItem('spiritual-review', '18:00', 30, 'Evening reflection and prayer', { category: 'spiritual' }),
            ...cooking,
        ],
        rest: [
            makeItem('rest-wake', '07:00', 45, 'Gentle wake-up, prayer and hydration', { category: 'foundation', leadMinutes: 0 }),
            makeItem('rest-movement', '08:00', 30, 'Gentle walk or stretching', { category: 'health' }),
            makeItem('rest-priority', '10:00', 60, 'One light personal priority only', { category: 'personal' }),
            makeItem('rest-family', '13:00', 180, 'Rest, family and time away from screens', { notify: false, category: 'rest' }),
            makeItem('rest-reflection', '18:00', 20, 'Gratitude and prepare a gentle tomorrow', { category: 'review' }),
            ...cooking,
        ],
        special: [
            ...foundation,
            makeItem('special-main-event', '09:00', 240, 'Special-day main event · edit this schedule', { category: 'special' }),
            makeItem('special-buffer', '13:00', 60, 'Travel, meals or contingency buffer', { category: 'special' }),
            makeItem('special-follow-up', '15:00', 90, 'Follow-up tasks and personal commitments', { category: 'special' }),
            ...cooking,
        ],
    };
}

function defaultPillars() {
    return [
        { id: 'spiritual', name: 'Spiritual Growth', status: 'active', progress: 0, note: '' },
        { id: 'mental', name: 'Mental Growth', status: 'active', progress: 0, note: '' },
        { id: 'physical', name: 'Physical Health', status: 'active', progress: 0, note: '' },
        { id: 'education', name: 'Education', status: 'active', progress: 0, note: '' },
        { id: 'career', name: 'Career & Business', status: 'active', progress: 0, note: '' },
        { id: 'financial', name: 'Financial Discipline', status: 'active', progress: 0, note: '' },
        { id: 'relationships', name: 'Family & Relationships', status: 'active', progress: 0, note: '' },
        { id: 'character', name: 'Character & Personal Development', status: 'active', progress: 0, note: '' },
    ];
}

const SPECIAL_TEMPLATES = {
    exam: [
        ['06:00', 45, 'Prayer, breakfast and calm preparation', 'foundation'],
        ['07:00', 45, 'Review key notes · no last-minute overload', 'education'],
        ['08:00', 240, 'EXAM / assessment window · update the time', 'education'],
        ['12:30', 60, 'Meal and recovery break', 'health'],
        ['14:00', 90, 'Light review and record lessons learned', 'education'],
        ['17:00', 45, 'Walk, rest and reset', 'health'],
    ],
    assignment: [
        ['06:00', 60, 'Prayer and morning preparation', 'foundation'],
        ['07:30', 150, 'Assignment · research and outline', 'education'],
        ['10:30', 30, 'Break', 'health'],
        ['11:00', 150, 'Assignment · focused writing/building', 'education'],
        ['14:00', 90, 'Check requirements, references and quality', 'education'],
        ['16:00', 45, 'Submit or prepare final submission', 'education'],
    ],
    meeting: [
        ['06:00', 60, 'Prayer and preparation', 'foundation'],
        ['08:00', 60, 'Review agenda, objectives and documents', 'career'],
        ['09:00', 120, 'Meeting block · adjust to confirmed time', 'career'],
        ['11:30', 30, 'Capture decisions and action owners', 'career'],
        ['14:00', 120, 'Execute meeting follow-ups', 'career'],
    ],
    birthday: [
        ['06:00', 60, 'Wake up, prayer, sport and preparation', 'foundation'],
        ['08:00', 90, 'Personal preparation and birthday plans', 'personal'],
        ['10:00', 180, 'Celebrate and connect with people', 'relationships'],
        ['14:00', 120, 'Family, friends and meaningful time', 'relationships'],
        ['18:00', 30, 'Gratitude and memories reflection', 'review'],
    ],
    travel: [
        ['06:00', 60, 'Wake up, prayer, sport and final travel preparation', 'foundation'],
        ['06:15', 45, 'Documents, tickets, money and essentials', 'preparation'],
        ['07:00', 360, 'Travel window · update for your itinerary', 'special'],
        ['13:00', 60, 'Meal, hydration and check-in', 'health'],
        ['16:00', 45, 'Arrival, safety and settle in', 'special'],
    ],
    project: [
        ['06:00', 60, 'Prayer and preparation', 'foundation'],
        ['07:30', 120, 'Project launch · final readiness checks', 'career'],
        ['10:00', 120, 'Launch execution and communication', 'career'],
        ['13:00', 90, 'Monitor results and resolve blockers', 'career'],
        ['15:00', 60, 'Document outcomes and next steps', 'review'],
    ],
    reset: [
        ['06:00', 60, 'Wake up, prayer, gentle movement and preparation', 'spiritual'],
        ['07:30', 45, 'Walk, hydration and healthy breakfast', 'health'],
        ['09:00', 90, 'Clean space and organise essentials', 'personal'],
        ['11:00', 60, 'Review priorities without self-judgment', 'review'],
        ['14:00', 120, 'Rest, reading and meaningful connection', 'rest'],
        ['18:00', 30, 'Write one lesson and one next step', 'review'],
    ],
    worship: [
        ['06:00', 60, 'Prayer, Scripture and preparation', 'spiritual'],
        ['08:00', 240, 'Worship / church / faith community', 'spiritual'],
        ['12:30', 120, 'Meal and family connection', 'relationships'],
        ['15:00', 60, 'Rest and gratitude', 'rest'],
        ['17:00', 45, 'Weekly spiritual reflection and preparation', 'spiritual'],
    ],
    review: [
        ['06:00', 60, 'Prayer and morning preparation', 'foundation'],
        ['08:00', 60, 'Review the past period · wins and lessons', 'review'],
        ['09:15', 90, 'Review all life pillars and progress', 'review'],
        ['11:00', 60, 'Choose next priorities and milestones', 'review'],
        ['14:00', 60, 'Calendar, finances and weekly planning', 'financial'],
        ['17:00', 30, 'Close the review and commit to one next step', 'review'],
    ],
    achievement: [
        ['06:00', 60, 'Gratitude, prayer and reflection', 'spiritual'],
        ['08:00', 90, 'Record the achievement and evidence', 'review'],
        ['10:00', 120, 'Celebrate with people who supported you', 'relationships'],
        ['14:00', 60, 'Identify the next meaningful milestone', 'career'],
        ['17:00', 45, 'Rest and enjoy the progress', 'rest'],
    ],
};

function specialTemplateItems(name) {
    const definition = SPECIAL_TEMPLATES[String(name || '').toLowerCase()];
    if (!definition) throw new TypeError('Template must be exam, assignment, meeting, birthday, travel, project, reset, worship, review or achievement.');
    return definition.map((item, index) =>
        makeItem('special-' + name + '-' + index, item[0], item[1], item[2], { category: item[3], leadMinutes: index === 0 ? 0 : 10, notify: index !== 0 })
    );
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
        pillars: defaultPillars(),
        preventionPlans: [],
        dailyCheckins: {},
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
            aiCoach: false,
            autoBackup: false,
            autoBackupTime: '22:45',
            focusMode: false,
            dailyAgenda: true,
            dailyAgendaTime: '06:05',
            language: 'bilingual',
            dailyCheckin: true,
            dailyCheckinTime: '06:00',
            purposeReminders: true,
            purposeReminderTimes: { morning: '06:30', midday: '13:00', evening: '20:30' },
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
        settings: {
            ...base.settings,
            ...(parsed.settings || {}),
            purposeReminderTimes: {
                ...base.settings.purposeReminderTimes,
                ...((parsed.settings || {}).purposeReminderTimes || {}),
            },
            // Move only the former built-in defaults to the user's requested 06:00 start.
            dailyCheckinTime: (parsed.settings || {}).dailyCheckinTime === '05:45' ? '06:00' : ((parsed.settings || {}).dailyCheckinTime || base.settings.dailyCheckinTime),
            dailyAgendaTime: (parsed.settings || {}).dailyAgendaTime === '05:55' ? '06:05' : ((parsed.settings || {}).dailyAgendaTime || base.settings.dailyAgendaTime),
        },
        templates: { ...base.templates, ...(parsed.templates || {}) },
        weeklyClassTypes: parsed.weeklyClassTypes || {},
        dayOverrides: parsed.dayOverrides || {},
        routines: Array.isArray(parsed.routines) ? parsed.routines : [],
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
        records: Array.isArray(parsed.records) ? parsed.records : [],
        goals: Array.isArray(parsed.goals) ? parsed.goals : [],
        pillars: Array.isArray(parsed.pillars) ? parsed.pillars : defaultPillars(),
        preventionPlans: Array.isArray(parsed.preventionPlans) ? parsed.preventionPlans : [],
        dailyCheckins: parsed.dailyCheckins && typeof parsed.dailyCheckins === 'object' ? parsed.dailyCheckins : {},
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
        if (weekly === 'morning') return 'class-morning';
        if (weekly === 'evening') return 'class-afternoon';
        return weekday === 'sun' ? 'sunday' : 'free-day';
    }

    function getProgress(dateKey) {
        if (!state.dailyProgress[dateKey]) {
            state.dailyProgress[dateKey] = { statuses: {}, timeOverrides: {}, notes: {} };
        }
        const progress = state.dailyProgress[dateKey];
        if (!progress.statuses) progress.statuses = {};
        if (!progress.timeOverrides) progress.timeOverrides = {};
        if (!progress.notes) progress.notes = {};
        return progress;
    }

    function getAgenda(dateKey = dateKeyAt()) {
        if (!validateDate(dateKey)) throw new TypeError('Use date format YYYY-MM-DD.');
        const type = dayType(dateKey);
        const override = state.dayOverrides[dateKey];
        const progress = getProgress(dateKey);
        const sourceItems = override && Array.isArray(override.items) ? override.items : (state.templates[type] || []);
        const items = sourceItems.map(item => {
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
                note: progress.notes[item.id] || '',
            };
        });
        return items.sort((a, b) => a.startAt - b.startAt);
    }

    function getNextAction(timestamp = now()) {
        const dateKey = dateKeyAt(timestamp);
        const candidates = getAgenda(dateKey).filter(item => item.status === 'pending');
        const overdue = candidates.find(item => item.startAt <= timestamp && item.endAt <= timestamp);
        if (overdue) return { ...overdue, phase: 'overdue' };
        const current = candidates.find(item => item.startAt <= timestamp && item.endAt > timestamp);
        if (current) return { ...current, phase: 'current' };
        const next = candidates.find(item => item.startAt > timestamp);
        if (next) return { ...next, phase: 'upcoming' };
        return null;
    }

    function setDayType(type, dateKey = dateKeyAt(), note = '') {
        if (!TYPE_NAMES.has(type)) throw new TypeError('Choose a valid Life OS day type.');
        if (!validateDate(dateKey)) throw new TypeError('Use date format YYYY-MM-DD.');
        const existing = state.dayOverrides[dateKey] || {};
        if (type === 'special') {
            state.dayOverrides[dateKey] = { ...existing, type, note: String(note || '').slice(0, 300), items: Array.isArray(existing.items) ? existing.items : [
                makeItem('special-foundation', '06:00', 60, 'Wake up • prayer • sport • prepare for the day', { category: 'foundation', leadMinutes: 0, notify: false }),
                makeItem('special-dinner', '19:30', 60, 'Prepare dinner, eat and tidy your space', { category: 'personal' }),
                makeItem('special-purpose', '21:00', 15, 'Private purpose check-in · Codes 27 and 190', { category: 'private' }),
                makeItem('special-wind-down', '22:15', 45, 'Personal care, gratitude and screens away', { category: 'rest' }),
                makeItem('special-sleep', '23:00', 30, 'Sleep · protect your rest and tomorrow’s energy', { category: 'health' }),
            ] };
        } else {
            state.dayOverrides[dateKey] = { ...existing, type, note: String(note || '').slice(0, 300) };
        }
        persist();
        return type;
    }

    function setWeeklyClassType(day, type) {
        const key = String(day || '').toLowerCase().slice(0, 3);
        if (!(key in DAY_INDEX)) throw new TypeError('Use a weekday such as mon, tue or sun.');
        const normalizedType = type === 'afternoon' ? 'evening' : type;
        if (!['morning', 'evening', 'off'].includes(normalizedType)) throw new TypeError('Choose morning, afternoon or off.');
        if (normalizedType === 'off') delete state.weeklyClassTypes[key];
        else state.weeklyClassTypes[key] = normalizedType;
        persist();
        return { day: key, type: normalizedType === 'evening' ? 'afternoon' : normalizedType };
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

    function addDayAgendaItem(dateKey, time, duration, title) {
        if (!validateDate(dateKey)) throw new TypeError('Use date format YYYY-MM-DD.');
        if (dayType(dateKey) !== 'special') throw new TypeError('Choose special day first with .life choose special.');
        if (!validateTime(time)) throw new TypeError('Use 24-hour time HH:MM.');
        const mins = Number(duration);
        if (!Number.isInteger(mins) || mins < 5 || mins > 720) throw new TypeError('Duration must be 5–720 minutes.');
        const cleanTitle = String(title || '').trim().slice(0, 180);
        if (!cleanTitle) throw new TypeError('Enter an agenda task.');
        const [hour, minute] = time.split(':').map(Number);
        if (hour * 60 + minute + mins > 23 * 60) throw new TypeError('Protect your sleep: finish special-day tasks by 23:00; keep the final hour for winding down.');
        const override = state.dayOverrides[dateKey];
        if (!override || override.type !== 'special') throw new TypeError('Choose special day first.');
        if (!Array.isArray(override.items)) override.items = clone(state.templates.special || []);
        if (override.items.length >= 40) throw new RangeError('Maximum 40 tasks on a special day.');
        const id = 'sd' + crypto.randomBytes(3).toString('hex');
        override.items.push(makeItem(id, time, mins, cleanTitle, { category: 'special' }));
        persist();
        return id;
    }

    function removeDayAgendaItem(dateKey, id) {
        if (!validateDate(dateKey)) throw new TypeError('Use date format YYYY-MM-DD.');
        const override = state.dayOverrides[dateKey];
        if (!override || override.type !== 'special' || !Array.isArray(override.items)) return false;
        const next = override.items.filter(item => item.id !== id);
        if (next.length === override.items.length) return false;
        override.items = next;
        delete getProgress(dateKey).statuses[id];
        delete getProgress(dateKey).timeOverrides[id];
        delete getProgress(dateKey).notes[id];
        persist();
        return true;
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

    function markAgendaItem(dateKey, id, status, note = '') {
        if (!['done', 'skipped', 'pending'].includes(status)) throw new TypeError('Invalid agenda status.');
        const exists = getAgenda(dateKey).some(item => item.id === id);
        if (!exists) return false;
        const progress = getProgress(dateKey);
        progress.statuses[id] = status;
        const cleanNote = String(note || '').trim().slice(0, 240);
        if (cleanNote) progress.notes[id] = cleanNote;
        else if (status !== 'skipped') delete progress.notes[id];
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

    function setLanguage(language) {
        const value = String(language || '').trim().toLowerCase();
        if (!['bilingual', 'en', 'rw'].includes(value)) throw new TypeError('Language must be bilingual, en or rw.');
        state.settings.language = value;
        persist();
        return value;
    }

    function setPurposeReminders(enabled, times = {}) {
        const current = state.settings.purposeReminderTimes || { morning: '06:30', midday: '13:00', evening: '20:30' };
        const next = { ...current, ...(times || {}) };
        for (const slot of ['morning', 'midday', 'evening']) {
            if (!validateTime(next[slot])) throw new TypeError('Purpose reminder times must use HH:MM.');
        }
        const ordered = [next.morning, next.midday, next.evening];
        if (!(ordered[0] < ordered[1] && ordered[1] < ordered[2])) throw new TypeError('Purpose reminders must be in morning, midday, evening order.');
        state.settings.purposeReminders = Boolean(enabled);
        state.settings.purposeReminderTimes = next;
        persist();
        return { enabled: state.settings.purposeReminders, times: clone(next) };
    }

    function setDailyCheckin(enabled, time = state.settings.dailyCheckinTime || '06:00') {
        if (!validateTime(time)) throw new TypeError('Use HH:MM for the daily check-in time.');
        state.settings.dailyCheckin = Boolean(enabled);
        state.settings.dailyCheckinTime = time;
        persist();
        return { enabled: state.settings.dailyCheckin, time };
    }

    function recordDailyCheckin(dateKey, type, note = '') {
        if (!validateDate(dateKey)) throw new TypeError('Use date format YYYY-MM-DD.');
        if (!TYPE_NAMES.has(type)) throw new TypeError('Choose a valid day type.');
        const cleanNote = String(note || '').slice(0, 300);
        const existing = state.dayOverrides[dateKey] || {};
        if (type === 'special') {
            const items = Array.isArray(existing.items) ? existing.items : [
                makeItem('special-foundation', '06:00', 60, 'Wake up • prayer • sport • prepare for the day', { category: 'foundation', leadMinutes: 0, notify: false }),
                makeItem('special-dinner', '19:30', 60, 'Prepare dinner, eat and tidy your space', { category: 'personal' }),
                makeItem('special-purpose', '21:00', 15, 'Private purpose check-in · Codes 27 and 190', { category: 'private' }),
                makeItem('special-wind-down', '22:15', 45, 'Personal care, gratitude and screens away', { category: 'rest' }),
                makeItem('special-sleep', '23:00', 30, 'Sleep · protect your rest and tomorrow’s energy', { category: 'health' }),
            ];
            state.dayOverrides[dateKey] = { ...existing, type, note: cleanNote, items };
        } else {
            state.dayOverrides[dateKey] = { ...existing, type, note: cleanNote };
        }
        state.dailyCheckins[dateKey] = { dayType: type, note: cleanNote, selectedAt: now() };
        persist();
        return clone(state.dailyCheckins[dateKey]);
    }

    function getDailyCheckin(dateKey = dateKeyAt()) {
        return clone(state.dailyCheckins[dateKey] || null);
    }

    function applySpecialTemplate(dateKey, name) {
        if (!validateDate(dateKey)) throw new TypeError('Use date format YYYY-MM-DD.');
        const cleanName = String(name || '').trim().toLowerCase();
        const items = specialTemplateItems(cleanName);
        state.dayOverrides[dateKey] = {
            type: 'special',
            note: cleanName,
            templateName: cleanName,
            items,
        };
        state.dailyCheckins[dateKey] = { dayType: 'special', note: cleanName, selectedAt: now(), templateName: cleanName };
        persist();
        return { date: dateKey, templateName: cleanName, items: clone(items) };
    }

    function listPillars() {
        return clone(state.pillars);
    }

    function updatePillar(id, patch = {}) {
        const pillar = state.pillars.find(item => item.id === String(id || '').toLowerCase());
        if (!pillar) return false;
        if (patch.progress !== undefined) {
            const progress = Number(patch.progress);
            if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new TypeError('Pillar progress must be 0–100.');
            pillar.progress = progress;
        }
        if (patch.status !== undefined) {
            if (!['active', 'paused', 'complete'].includes(patch.status)) throw new TypeError('Pillar status must be active, paused or complete.');
            pillar.status = patch.status;
        }
        if (patch.note !== undefined) pillar.note = String(patch.note || '').trim().slice(0, 240);
        pillar.updatedAt = now();
        persist();
        return clone(pillar);
    }

    function addPreventionPlan(trigger, response, pillarId = '') {
        const cleanTrigger = String(trigger || '').trim().slice(0, 240);
        const cleanResponse = String(response || '').trim().slice(0, 500);
        const cleanPillar = String(pillarId || '').trim().toLowerCase().slice(0, 40);
        if (!cleanTrigger || !cleanResponse) throw new TypeError('Provide both a trigger and a prevention response.');
        if (cleanPillar && !state.pillars.some(item => item.id === cleanPillar)) throw new TypeError('Unknown pillar ID.');
        if (state.preventionPlans.length >= 100) throw new RangeError('Maximum 100 prevention plans.');
        const plan = {
            id: 'v' + crypto.randomBytes(3).toString('hex'),
            trigger: cleanTrigger,
            response: cleanResponse,
            pillarId: cleanPillar || null,
            active: true,
            createdAt: now(),
        };
        state.preventionPlans.push(plan);
        persist();
        return clone(plan);
    }

    function listPreventionPlans() {
        return clone(state.preventionPlans);
    }

    function deletePreventionPlan(id) {
        const index = state.preventionPlans.findIndex(item => item.id === id);
        if (index < 0) return false;
        state.preventionPlans.splice(index, 1);
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
            const advanceKey = 'agenda:' + dateKey + ':' + item.id;
            const startKey = 'agenda-start:' + dateKey + ':' + item.id;
            if (lead > 0 && timestamp >= notifyAt && timestamp < item.startAt && !state.sentEvents[advanceKey]) {
                const age = timestamp - notifyAt;
                if (age > 90 * 60 * 1000) stale.push(advanceKey);
                else events.push({ key: advanceKey, kind: 'agenda-advance', title: item.title, time: item.time, late: age > 60000, leadMinutes: lead });
            }
            if (timestamp >= item.startAt && !state.sentEvents[startKey]) {
                const age = timestamp - item.startAt;
                if (age > 90 * 60 * 1000) stale.push(startKey);
                else events.push({ key: startKey, kind: 'agenda-start', title: item.title, time: item.time, late: age > 60000 });
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

    function setAICoach(enabled) {
        state.settings.aiCoach = Boolean(enabled);
        persist();
        return state.settings.aiCoach;
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
        addDayAgendaItem,
        removeDayAgendaItem,
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
        setLanguage,
        setPurposeReminders,
        setDailyCheckin,
        recordDailyCheckin,
        getDailyCheckin,
        applySpecialTemplate,
        listPillars,
        updatePillar,
        addPreventionPlan,
        listPreventionPlans,
        deletePreventionPlan,
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
        setAICoach,
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
