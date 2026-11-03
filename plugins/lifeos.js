'use strict';
const { execFile } = require('node:child_process');
const { createLifeOS, localParts, localDateTimeToEpoch, validateDate } = require('../lib/life-os');
const life = createLifeOS();
let socket = null, timer = null, busy = false;
const retry = new Map();

function self(sock) {
    const jid = sock && sock.user && sock.user.id || global.botJid || '';
    return typeof jid === 'string' && /@(s\.whatsapp\.net|lid)$/.test(jid) ? jid : '';
}
async function send(sock, text) {
    const jid = self(sock);
    if (!jid) throw new Error('WhatsApp self chat unavailable');
    return sock.sendMessage(jid, { text: String(text).slice(0, 3500) });
}
function android(text) {
    return new Promise((resolve, reject) => execFile('termux-notification', [
        '--title', 'MUSHII Life OS', '--content', String(text).replace(/\*/g, '').replace(/\n+/g, ' ').slice(0, 220),
        '--id', 'mushii-life-os'
    ], { timeout: 5000 }, e => e ? reject(e) : resolve()));
}
function plus(date, n) {
    const d = date.split('-').map(Number);
    return new Date(Date.UTC(d[0], d[1]-1, d[2]+n)).toISOString().slice(0,10);
}
function agenda(date) {
    const tz=life.getTimezone(), day=new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'2-digit',month:'short',timeZone:tz})
        .format(new Date(localDateTimeToEpoch(date,'12:00',tz)));
    return '📅 *MUSHII AGENDA · '+day+' · '+life.getDayType(date)+'*\n\n'+life.getAgenda(date).map(x=>
        (x.status==='done'?'✅':x.status==='skipped'?'↪️':'▫️')+' *'+x.time+'* — '+x.title+' _['+x.id+']_'
    ).join('\n')+'\n\nUse .next for your next action.';
}
function nextText(x) {
    if(!x) return '✅ *No more pending agenda tasks today.*';
    const phase=x.phase==='current'?'NOW':x.phase==='overdue'?'PENDING — DECIDE':'UP NEXT';
    return '🎯 *NEXT ACTION · '+phase+'*\n\n*'+x.time+' — '+x.title+'*\n'+
        (x.phase==='overdue'?'Complete, skip or reschedule this task.':'Stay with this one task before switching.')+
        '\n\n.next done · .next skip · .next delay <minutes>';
}
async function deliver(sock,key,text) {
    if((retry.get(key)||0)>Date.now()) return;
    try {
        await send(sock,text); life.markNotificationSent(key); retry.delete(key);
        if(life.getSettings().androidNotifications) {
            try { await android(text); } catch { console.warn('[LifeOS] Android pop-up unavailable; WhatsApp reminder sent.'); }
        }
    } catch { retry.set(key,Date.now()+30000); console.warn('[LifeOS] Reminder delivery failed; retry scheduled.'); }
}
async function tick(sock) {
    if(busy||sock!==socket) return;
    busy=true;
    try {
        const now=Date.now(), s=life.getSettings(), local=localParts(now,s.timezone), sent=life._getState().sentEvents;
        const k='morning-agenda:'+local.date;
        if(s.dailyAgenda&&!sent[k]&&local.time>=s.dailyAgendaTime) {
            const due=localDateTimeToEpoch(local.date,s.dailyAgendaTime,s.timezone);
            if(now-due>90*60000) life.markNotificationMissed(k);
            else await deliver(sock,k,agenda(local.date)+'\n\n🌅 *Start with your next action.*');
        }
        const due=life.getDueNotifications(now);
        due.stale.forEach(x=>life.markNotificationMissed(x));
        for(const e of due.events.slice(0,4)) {
            const label=e.kind==='routine'?'🔁 *ROUTINE REMINDER*':e.kind==='agenda'?'⏰ *NEXT ACTION*':'🔔 *PERSONAL REMINDER*';
            await deliver(sock,e.key,label+'\n\n*'+e.time+' — '+e.title+'*\n\nUse .next or .life agenda.');
        }
    } catch(e) { console.warn('[LifeOS] Scheduler error: '+e.message); }
    finally { busy=false; }
}
function stop(sock) {
    if(sock&&socket&&sock!==socket) return;
    if(timer) clearInterval(timer);
    timer=null; socket=null; retry.clear();
}
async function onConnectionOpen(sock) {
    if(!sock||!sock.user||!sock.user.id) return;
    if(socket===sock&&timer) return;
    stop(); socket=sock; await tick(sock);
    timer=setInterval(()=>tick(sock).catch(()=>{}),15000);
}
function onConnectionClose(sock) { stop(sock); }

function listGoals() {
    const a=life.listGoals();
    return a.length?'🎯 *GOALS*\n'+a.map(x=>(x.status==='done'?'✅':x.status==='paused'?'⏸️':'▫️')+' *'+x.id+'* — '+x.title).join('\n'):'No goals. Use .life goal add <goal>.';
}
function listRoutines() {
    const a=life.listRoutines();
    return a.length?'🔁 *ROUTINES*\n'+a.map(x=>(x.active?'✅':'⏸️')+' *'+x.id+'* — '+x.time+' — '+x.title+' ['+x.days.join(',')+']').join('\n'):'No routines. Use .life routine add 06:00 daily Prayer and sport.';
}
function help() {
    return [
        '🌱 *MUSHII LIFE OS*',
        '.life agenda [tomorrow|YYYY-MM-DD]',
        '.life day <morning|evening|free|travel|home|sunday> [date]',
        '.life class <mon|tue|...> <morning|evening|off>',
        '.life agenda add|edit|move|remove ...',
        '.next [done|skip|delay <minutes>]',
        '.life routine add <HH:MM> <daily|weekdays|weekends|mon,wed,fri> <task>',
        '.life routine list|edit|pause|resume|delete|done <id>',
        '.life remind add <YYYY-MM-DD> <HH:MM> <task> · .life remind list|delete <id>',
        '.life goal add <goal> · .life goals · .life goal done|pause|resume|edit|delete <id>',
        '.life journal add|read|search|edit|delete ...',
        '.life code <27|190> <kept|urge|slipped> [note] · .life codes',
        '.life focus on|off · .life settings ... · .life status',
        '_Owner-only and private-chat-only._'
    ].join('\n');
}
async function runLife(sock,msg,args,ctx) {
    if(ctx.isGroup) return ctx.reply('🔒 Life OS works only in your private chat.');
    if(!ctx.isOwner) return ctx.reply('⛔ Life OS is owner-only.');
    const p=(args||[]).map(String), sec=(p.shift()||'help').toLowerCase(), act=(p.shift()||'').toLowerCase();
    const today=life.getDateKey(), reply=x=>ctx.reply(String(x));
    try {
        if(sec==='help'||sec==='menu') return reply(help());
        if(sec==='status') {
            const s=life.getSettings(), classes=Object.entries(life._getState().weeklyClassTypes).map(([d,t])=>d+':'+t).join(', ')||'not set';
            return reply('🌱 *LIFE OS STATUS*\nTimezone: '+s.timezone+'\nDay: '+life.getDayType(today)+'\nClasses: '+classes+
                '\nAdvance reminder: '+s.advanceMinutes+' min\nDaily agenda: '+(s.dailyAgenda?'ON':'OFF')+' at '+s.dailyAgendaTime+
                '\nAndroid: '+(s.androidNotifications?'ON':'OFF')+'\nFocus: '+(s.focusMode?'ON':'OFF')+'\n\n'+nextText(life.getNextAction()));
        }
        if(sec==='agenda') {
            if(!act||act==='today'||act==='show') return reply(agenda(today));
            if(act==='tomorrow') return reply(agenda(plus(today,1)));
            if(validateDate(act)) return reply(agenda(act));
            if(act==='add') { const [type,time,duration,...title]=p; return reply('✅ Added agenda item *'+life.addAgendaItem(type,time,duration,title.join(' '))+'*.'); }
            if(act==='edit') { const [type,id,time,duration,...title]=p; return reply(life.updateAgendaItem(type,id,{time,duration,title:title.join(' ')})?'✅ Agenda updated.':'Item not found.'); }
            if(act==='remove') return reply(life.removeAgendaItem(p[0],p[1])?'✅ Agenda item removed.':'Item not found.');
            if(act==='move') return reply(life.moveAgendaItem(today,p[0],p[1])?'✅ Today’s item moved.':'Item not found.');
            if(act==='done'||act==='skip') return reply(life.markAgendaItem(today,p[0],act==='done'?'done':'skipped')?'✅ Status saved.':'Item not found.');
            return reply('Use .life agenda [tomorrow|YYYY-MM-DD], add, edit, move or remove.');
        }
        if(sec==='day') { const date=validateDate(p[0])?p.shift():today; life.setDayType(act,date,p.join(' ')); return reply('✅ '+date+' is now a *'+act+'* day.'); }
        if(sec==='class') {
            if(act==='list') return reply('🎓 *WEEKLY CLASSES*\n'+(Object.entries(life._getState().weeklyClassTypes).map(([d,t])=>d+': '+t).join('\n')||'Not configured. Example: .life class mon morning.'));
            life.setWeeklyClassType(act,p[0]); return reply('✅ Class pattern saved: '+act+' — '+p[0]);
        }
        if(sec==='routine') {
            if(act==='add') { const [time,repeat,...title]=p, x=life.addRoutine(time,repeat,title.join(' ')); return reply('✅ Routine *'+x.id+'* saved: '+x.time+' · '+repeat+' · '+x.title); }
            if(!act||act==='list') return reply(listRoutines());
            if(act==='edit') { const [id,time,repeat,...title]=p; return reply(life.updateRoutine(id,{time,days:repeat,title:title.join(' ')})?'✅ Routine updated.':'Routine not found.'); }
            const id=p[0];
            if(act==='delete') return reply(life.deleteRoutine(id)?'✅ Routine deleted.':'Routine not found.');
            if(act==='pause'||act==='resume') return reply(life.updateRoutine(id,{active:act==='resume'})?'✅ Routine '+act+'d.':'Routine not found.');
            if(act==='done'||act==='skip') return reply(life.markRoutine(today,id,act==='done'?'done':'skipped')?'✅ Routine check-in saved.':'Routine not found.');
            return reply('Use .life routine add|list|edit|pause|resume|delete|done ....');
        }
        if(sec==='remind') {
            if(act==='add') { const [date,time,...title]=p, x=life.addReminder(date,time,title.join(' ')); return reply('✅ Reminder *'+x.id+'* saved for '+x.date+' '+x.time+': '+x.title); }
            if(!act||act==='list') { const a=life.listReminders().filter(x=>x.status==='pending'); return reply(a.length?'🔔 *REMINDERS*\n'+a.map(x=>x.id+' — '+x.date+' '+x.time+'\n'+x.title).join('\n\n'):'No pending Life OS reminders.'); }
            if(act==='delete') return reply(life.deleteReminder(p[0])?'✅ Reminder deleted.':'Reminder not found.');
            return reply('.life remind add <YYYY-MM-DD> <HH:MM> <task> · list · delete <id>');
        }
        if(sec==='goal'||sec==='goals') {
            if(act==='add') { const x=life.addGoal(p.join(' ')); return reply('🎯 Goal *'+x.id+'* saved: '+x.title); }
            if(!act||act==='list') return reply(listGoals());
            if(act==='edit') return reply(life.updateGoal(p[0],{title:p.slice(1).join(' ')})?'✅ Goal updated.':'Goal not found.');
            if(act==='delete') return reply(life.deleteGoal(p[0])?'✅ Goal deleted.':'Goal not found.');
            const status=act==='done'?'done':act==='pause'?'paused':act==='resume'?'active':null;
            return status?reply(life.updateGoal(p[0],{status})?'✅ Goal status: '+status:'Goal not found.'):reply('Use .life goal add|done|pause|resume|edit|delete ....');
        }
        if(sec==='journal') {
            if(act==='add') return reply('📝 Journal saved: *'+life.addJournalEntry(p.join(' ')).id+'*');
            if(act==='read'||act==='search'||!act) { const a=life.searchJournal(act==='search'?p.join(' '):''); return reply(a.length?'📔 *PRIVATE JOURNAL*\n\n'+a.map(x=>'*'+x.id+'* · '+new Date(x.createdAt).toLocaleString('en-GB',{timeZone:life.getTimezone()})+'\n'+x.text).join('\n\n'):'No matching entries.'); }
            if(act==='edit') return reply(life.updateJournalEntry(p[0],p.slice(1).join(' '))?'✅ Journal updated.':'Entry not found.');
            if(act==='delete') return reply(life.deleteJournalEntry(p[0])?'✅ Entry deleted.':'Entry not found.');
            return reply('.life journal add|read|search|edit|delete ...');
        }
        if(sec==='code') { const status=(p.shift()||'').toLowerCase(), x=life.recordCheckin(act,status,p.join(' ')); return reply('✅ Private code *'+x.code+'* check-in saved: *'+x.status+'*.'); }
        if(sec==='codes') { const a=life.getCheckins(14); return reply(a.length?'🔐 *PRIVATE CHECK-INS*\n'+a.map(x=>x.date+' · '+x.code+' · '+x.status).join('\n'):'No check-ins yet.'); }
        if(sec==='focus') { if(!['on','off'].includes(act)) return reply('Focus reminders: '+(life.getSettings().focusMode?'ON':'OFF')); life.setFocusMode(act==='on'); return reply(act==='on'?'🎯 Focus reminders ON. This does not block phone apps.':'✅ Focus reminders OFF.'); }
        if(sec==='settings') {
            const v=(p[0]||'').toLowerCase();
            if(act==='advance') return reply('✅ Advance reminders: '+life.setAdvanceMinutes(v)+' min.');
            if(act==='timezone') return reply('✅ Timezone: '+life.setTimezone(p.join(' ')));
            if(act==='android') { if(!['on','off'].includes(v)) return reply('Use .life settings android on|off.'); life.setAndroidNotifications(v==='on'); return reply(v==='on'?'✅ Android pop-ups enabled; Termux:API app/package and permission required.':'✅ Android pop-ups disabled.'); }
            if(act==='dailyagenda') { if(!['on','off'].includes(v)) return reply('Use .life settings dailyagenda on|off [HH:MM].'); const x=life.setDailyAgenda(v==='on',p[1]||life.getSettings().dailyAgendaTime); return reply('✅ Daily agenda '+(x.enabled?'ON':'OFF')+' at '+x.time+'.'); }
            return reply('Settings: advance <min>, timezone <IANA>, dailyagenda on|off [HH:MM], android on|off.');
        }
        if(sec==='overview') return reply('🌱 *LIFE OS OVERVIEW*\nActive goals: '+life.listGoals().filter(x=>x.status==='active').length+
            '\nActive routines: '+life.listRoutines().filter(x=>x.active).length+
            '\nPending reminders: '+life.listReminders().filter(x=>x.status==='pending').length+'\n\n'+nextText(life.getNextAction()));
        return reply(help());
    } catch(e) { return reply('⚠️ Life OS: '+e.message); }
}
async function runNext(sock,msg,args,ctx) {
    if(ctx.isGroup) return ctx.reply('🔒 Next Action is private-chat-only.');
    if(!ctx.isOwner) return ctx.reply('⛔ Next Action is owner-only.');
    const act=String(args&&args[0]||'').toLowerCase(), x=life.getNextAction();
    if(act==='done'||act==='skip') { if(!x) return ctx.reply('No pending agenda item.'); life.markAgendaItem(x.date,x.id,act==='done'?'done':'skipped'); return ctx.reply('✅ *'+x.title+'* marked '+act+'.\n\n'+nextText(life.getNextAction())); }
    if(act==='delay') {
        const n=Number(args&&args[1]);
        if(!x) return ctx.reply('No pending agenda item.');
        if(!Number.isInteger(n)||n<1||n>180) return ctx.reply('Use .next delay <1–180 minutes>.');
        const t=localParts(Date.now()+n*60000,life.getTimezone());
        if(t.date!==x.date) return ctx.reply('That delay crosses into tomorrow. Use .life agenda move <id> <HH:MM>.');
        life.moveAgendaItem(x.date,x.id,t.time);
        return ctx.reply('⏱️ *'+x.title+'* moved to *'+t.time+'*.\n\n'+nextText(life.getNextAction()));
    }
    return ctx.reply(nextText(x));
}
module.exports = {
    commands:['life','agenda','next'],
    description:'Owner-only private Life OS: agenda, routines, reminders, goals, journal and next action',
    permission:'owner', group:false, private:true, onConnectionOpen, onConnectionClose,
    run:async(sock,msg,args,ctx)=>{ const command=String(ctx.command||'').toLowerCase(); if(command==='next') return runNext(sock,msg,args,ctx); if(command==='agenda') return runLife(sock,msg,['agenda',...(args||[])],ctx); return runLife(sock,msg,args,ctx); },
    __test:{life,agenda,nextText,tick,stop,android}
};
