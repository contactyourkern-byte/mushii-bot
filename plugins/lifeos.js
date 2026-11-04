'use strict';
const { execFile } = require('node:child_process');
const { createLifeOS, localParts, localDateTimeToEpoch, validateDate } = require('../lib/life-os');
const { createEncryptedBackup, decryptBackup } = require('../lib/life-os-backup');
const google = require('../lib/life-os-google');
const life = createLifeOS();
let socket = null, timer = null, busy = false;
const retry = new Map();
const BACKUP_DIRECTORY = require('node:path').join(__dirname, '..', 'data', 'life-os-backups');
const aiCoach = require('../lib/agent-v2');

function self(sock) {
    const jid = sock && sock.user && sock.user.id || global.botJid || '';
    return typeof jid === 'string' && /@(s\.whatsapp\.net|lid)$/.test(jid) ? jid : '';
}
async function send(sock, text) {
    const jid = self(sock);
    if (!jid) throw new Error('WhatsApp self chat unavailable');
    return sock.sendMessage(jid, { text: String(text).slice(0, 3500) });
}
const LANG = {
 bilingual:{morning:'Good morning · Mwaramutse',choose:'What kind of day are you planning? / Ni uwuhe munsi uteganya kugira?',psalm:'DAILY PSALM · IJAMBO RY’UMUNSI'},
 en:{morning:'Good morning',choose:'What kind of day are you planning?',psalm:'DAILY PSALM'},
 rw:{morning:'Mwaramutse',choose:'Ni uwuhe munsi uteganya kugira?',psalm:'IJAMBO RY’UMUNSI'}
};
const PSALMS=[
 ['Psalm 23:1','You do not carry the whole day alone. Take one faithful step at a time.','Ntugomba kwikorera umunsi wose wenyine. Tera intambwe imwe y’indahemuka icyarimwe.'],
 ['Psalm 27:1','Let courage be louder than fear. Choose the next right action.','Ubutwari burushe ubwoba. Hitamo igikorwa cyiza gikurikiraho.'],
 ['Psalm 46:10','Make room for stillness before the noise of the day.','Fata akanya ko gutuza mbere y’urusaku rw’umunsi.'],
 ['Psalm 90:17','Give your work care and purpose; small faithful efforts matter.','Kora witonze kandi ufite intego; imbaraga nto z’indahemuka zifite agaciro.'],
 ['Psalm 121:1–2','When the path feels uncertain, pause, seek help and take the next step.','Iyo inzira itagaragara neza, humura, saba ubufasha maze ukomeze.'],
 ['Psalm 34:8','Notice one good thing today and let gratitude shape your response.','Reba ikintu kimwe cyiza uyu munsi, maze gushimira bikuyobore.'],
 ['Psalm 37:5','Commit your plans, then do your part with patience and integrity.','Shyira imigambi yawe mu maboko y’Imana, ukore uruhare rwawe wihanganye.']
];
function lang(){return life.getSettings().language||'bilingual';}
function say(en,rw){return lang()==='en'?en:lang()==='rw'?rw:en+'\n'+rw;}
function header(title,sub=''){return '🌱 *MUSHII LIFE OS*\n━━━━━━━━━━━━━━━━━━━━\n*'+title+'*'+(sub?'\n'+sub:'')+'\n━━━━━━━━━━━━━━━━━━━━';}
function dailyPsalm(date=life.getDateKey()){
 const p=PSALMS[Number(date.replace(/-/g,''))%PSALMS.length],l=lang();
 return header((LANG[l]||LANG.bilingual).psalm,'📖 '+p[0])+'\n'+(l==='en'?p[1]:l==='rw'?p[2]:p[1]+'\n'+p[2]);
}
function dayPrompt(date){
 const l=lang(),t=LANG[l]||LANG.bilingual;
 const types=['focus','study','work','home','travel','spiritual','rest','free','sunday'];
 const rw={focus:'Kwibanda',study:'Kwiga',work:'Akazi',home:'Murugo',travel:'Urugendo',spiritual:'Iby’umwuka',rest:'Kuruhuka',free:'Bisanzwe',sunday:'Ku cyumweru'};
 return header(t.morning+' ☀️',date)+'\n'+t.choose+'\n\n'+types.map((x,i)=>(i+1)+'. *'+x.toUpperCase()+'*'+(l==='en'?'':l==='rw'?' — '+rw[x]:' — '+rw[x])).join('\n')+'\n\nReply: *.life choose <type>*\nExample: .life choose study\nSpecial day: *.life templates*'+growthBrief();
}
function growthBrief(){
 const goals=life.listGoals().filter(x=>x.status==='active').slice(0,5);
 const pillars=life.listPillars().filter(x=>x.status==='active');
 const plans=life.listPreventionPlans().filter(x=>x.active).slice(0,3);
 const out=['\n🌿 *LIFE PILLARS · INKINGI Z’UBUZIMA*',
   ...pillars.map(x=>'• '+x.name+': '+x.progress+'%'),
   '\n🎯 *ACTIVE GOALS · INTEGO ZIKORA*',
   ...(goals.length?goals.map(x=>'• '+x.title):[say('No active goals added yet.','Nta ntego ikora urashyiramo.')]),
   '\n🛡️ *PREVENTION · KWIYITAHO NO KWIHANGANA*',
   ...(plans.length?plans.map(x=>'• If '+x.trigger+' → '+x.response):[say('Add a prevention plan for a situation that may derail your day.','Shyiraho gahunda yo kwirinda ikintu gishobora kukubuza kugera ku ntego.')])];
 return out.join('\n');
}
async function sendLifeSticker(sock,kind='morning'){
 const jid=self(sock);if(!jid)throw new Error('WhatsApp self chat unavailable');
 const labels={morning:['NEW DAY','GROW WITH PURPOSE'],goal:['GOAL ACHIEVED','ONE STEP AT A TIME'],discipline:['STAY THE COURSE','CHOOSE WHAT HELPS YOU'],evening:['REFLECT & RESET','REST WITH GRATITUDE']};
 const [title,sub]=labels[kind]||labels.morning;
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect x="18" y="18" width="476" height="476" rx="96" fill="#102a2a" stroke="#d6b56d" stroke-width="12"/><circle cx="256" cy="170" r="78" fill="#d6b56d"/><path d="M256 105L272 153L323 155L283 186L297 237L256 207L215 237L229 186L189 155L240 153Z" fill="#102a2a"/><text x="256" y="325" text-anchor="middle" font-family="Arial" font-size="34" font-weight="bold" fill="white">'+title+'</text><text x="256" y="374" text-anchor="middle" font-family="Arial" font-size="19" fill="#d6b56d">'+sub+'</text></svg>';
 try{const sharp=require('sharp');const webp=await sharp(Buffer.from(svg)).resize(512,512).webp().toBuffer();return sock.sendMessage(jid,{sticker:webp});}
 catch(e){return sock.sendMessage(jid,{text:'🌱 *'+title+'* — '+sub});}
}
function android(title, text, notificationId) {
    return new Promise((resolve, reject) => execFile('termux-notification', [
        '--title', String(title || 'MUSHII Life OS').slice(0, 80),
        '--content', String(text || '').replace(/\*/g, '').replace(/\n+/g, ' ').slice(0, 220),
        '--id', String(notificationId || 'mushii-life-os').slice(0, 60),
        '--priority', 'high',
        '--sound',
        '--vibrate', '200,300,200',
    ], { timeout: 7000 }, e => e ? reject(e) : resolve()));
}
function notificationContent(event) {
    if (event.category === 'private' || /private.*check-in/i.test(event.title || '')) {
        return { title: 'MUSHII · Private reminder', text: 'Private check-in · 27 / 190' };
    }
    return {
        title: event.kind === 'reminder' ? 'MUSHII · Personal reminder' : 'MUSHII · Next action',
        text: [event.time, event.title].filter(Boolean).join(' · '),
    };
}
function notificationTargets(settings) {
    return [
        settings.whatsappNotifications ? 'whatsapp' : null,
        settings.androidNotifications ? 'android' : null,
        settings.emailNotifications ? 'email' : null,
    ].filter(Boolean);
}
async function deliver(sock, key, text, event = {}) {
    const settings = life.getSettings();
    const targets = notificationTargets(settings);
    if (!targets.length) {
        life.markNotificationSent(key);
        return;
    }
    const delivery = life.getNotificationDelivery(key);
    const waitKey = key + ':channels';
    if ((retry.get(waitKey) || 0) > Date.now()) return;
    const results = { ...delivery };
    let failed = false;
    for (const channel of targets) {
        if (results[channel]) continue;
        try {
            if (channel === 'whatsapp') {
                if (!sock || !self(sock)) continue;
                await send(sock, text);
            } else if (channel === 'android') {
                const content = notificationContent(event);
                await android(content.title, content.text, key.slice(-50));
            } else if (channel === 'email') {
                const to = String(process.env.LIFE_OS_EMAIL_TO || '').trim();
                if (!to) throw new Error('LIFE_OS_EMAIL_TO is not configured.');
                const content = notificationContent(event);
                await google.sendEmail({
                    to,
                    subject: content.title,
                    text: content.text + '\n\nOpen MUSHII Life OS in WhatsApp for details.',
                });
            }
            life.markNotificationChannelSent(key, channel);
            results[channel] = Date.now();
        } catch (error) {
            failed = true;
            console.warn('[LifeOS] ' + channel + ' notification failed: ' + String(error.message || error).slice(0, 180));
        }
    }
    const complete = targets.every(channel => results[channel]);
    if (complete) {
        life.markNotificationSent(key);
        retry.delete(waitKey);
    } else if (failed) {
        retry.set(waitKey, Date.now() + 60000);
    }
}
function createBackup() {
    const passphrase = String(process.env.LIFE_OS_BACKUP_PASSPHRASE || '');
    if (!passphrase) throw new Error('Set LIFE_OS_BACKUP_PASSPHRASE in private config.env before creating or restoring encrypted backups.');
    return createEncryptedBackup(life.exportState(), passphrase);
}
async function recoverBackup(fileId) {
    const backup = await google.downloadBackup(fileId);
    const state = decryptBackup(backup, String(process.env.LIFE_OS_BACKUP_PASSPHRASE || ''));
    // Save a second encrypted snapshot of the current data before replacing anything.
    const safetySnapshot = createBackup();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safetyFile = saveLocalBackup(safetySnapshot, 'mushii-life-os-pre-restore-' + stamp + '.json.enc');
    const result = life.importState(state);
    return { ...result, safetyFile };
}
async function uploadData() {
    const bytes = createBackup();
    const date = life.getDateKey();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const result = await google.uploadBackup(bytes, 'mushii-life-os-' + date + '-' + stamp + '.json.enc');
    return { ...result, bytes: bytes.length };
}
function saveLocalBackup(bytes, filename) {
    const fs = require('node:fs');
    fs.mkdirSync(BACKUP_DIRECTORY, { recursive: true, mode: 0o700 });
    const file = require('node:path').join(BACKUP_DIRECTORY, filename);
    fs.writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' });
    return file;
}
async function runAutoBackup(now) {
    const settings = life.getSettings();
    if (!settings.autoBackup || !process.env.LIFE_OS_BACKUP_PASSPHRASE || !google.getStatus().connected) return;
    const local = localParts(now, settings.timezone);
    if (local.time < settings.autoBackupTime) return;
    const key = 'drive-backup:' + local.date;
    if (life._getState().sentEvents[key]) return;
    if ((retry.get(key) || 0) > now) return;
    try {
        const result = await uploadData();
        life.markNotificationSent(key);
        retry.delete(key);
        console.log('[LifeOS] Encrypted automatic Drive backup uploaded: ' + result.name);
    } catch (error) {
        retry.set(key, now + 30 * 60 * 1000);
        console.warn('[LifeOS] Automatic backup pending: ' + String(error.message || error).slice(0, 180));
    }
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
async function tick(sock = socket) {
    if (busy) return;
    busy=true;
    try {
        const now = Date.now(), settings = life.getSettings(), local = localParts(now, settings.timezone);
        const sent = life._getState().sentEvents;
        const agendaKey = 'morning-agenda:' + local.date;
        const checkinKey='daily-checkin:'+local.date;
        if(settings.dailyCheckin&&!sent[checkinKey]&&local.time>=settings.dailyCheckinTime){
            const dueAt=localDateTimeToEpoch(local.date,settings.dailyCheckinTime,settings.timezone);
            if(now-dueAt>90*60000) life.markNotificationMissed(checkinKey);
            else await deliver(sock,checkinKey,dayPrompt(local.date)+'\n\n'+dailyPsalm(local.date),{kind:'reminder',title:'MUSHII daily check-in'});
        }
        if (settings.dailyAgenda && !sent[agendaKey] && local.time >= settings.dailyAgendaTime) {
            const dueAt = localDateTimeToEpoch(local.date, settings.dailyAgendaTime, settings.timezone);
            if (now - dueAt > 90 * 60000) life.markNotificationMissed(agendaKey);
            else if(!settings.dailyCheckin||life.getDailyCheckin(local.date)) await deliver(sock, agendaKey, agenda(local.date) + '\n\n🌅 *Start with your next action.*', {kind:'agenda',title:'Your daily agenda is ready'});
            else await deliver(sock,agendaKey,dayPrompt(local.date),{kind:'agenda',title:'Choose your day'});
        }
        const due = life.getDueNotifications(now);
        due.stale.forEach(key => life.markNotificationMissed(key));
        for (const event of due.events.slice(0, 4)) {
            const label = event.kind === 'routine' ? '🔁 *ROUTINE REMINDER*'
                : event.kind === 'agenda' ? '⏰ *NEXT ACTION*' : '🔔 *PERSONAL REMINDER*';
            const details = event.category === 'private' ? 'Private check-in · 27 / 190' : event.title;
            await deliver(sock, event.key,
                label + '\n\n*' + event.time + ' — ' + details + '*\n\nUse .next or .life agenda.', event);
        }
        await runAutoBackup(now);
    } catch(e) { console.warn('[LifeOS] Scheduler error: '+e.message); }
    finally { busy=false; }
}
function stopScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
    socket = null;
    retry.clear();
}
function ensureScheduler() {
    if (timer) return;
    timer = setInterval(() => tick(socket).catch(() => {}), 15000);
    if (typeof timer.unref === 'function') timer.unref();
}
async function onConnectionOpen(sock) {
    if (!sock || !sock.user || !sock.user.id) return;
    socket = sock;
    ensureScheduler();
    await tick(sock);
}
function onConnectionClose(sock) {
    if (sock && socket && sock !== socket) return;
    socket = null;
    // Local Android reminders and automatic backups continue while WhatsApp is disconnected.
    ensureScheduler();
}
ensureScheduler();

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
        '.life day <morning|evening|free|travel|home|sunday|focus|study|work|spiritual|rest> [date]',
        '.life choose <type> · .life templates · .life template <name> [date]',
        '.life pillars · .life pillar <id> <0-100> [note]',
        '.life prevention add <trigger> | <response> [| pillar-id] · list · delete <id>',
        '.life psalm · .life language bilingual|en|rw · .life sticker [morning|goal|discipline|evening]',
        '.life checkin on|off [HH:MM]',
        '.life class <mon|tue|...> <morning|evening|off>',
        '.life agenda add|edit|move|remove ...',
        '.next [done|skip|delay <minutes>]',
        '.life routine add <HH:MM> <daily|weekdays|weekends|mon,wed,fri> <task>',
        '.life routine list|edit|pause|resume|delete|done <id>',
        '.life remind add <YYYY-MM-DD> <HH:MM> <task> · .life remind list|delete <id>',
        '.life goal add <goal> · .life goals · .life goal done|pause|resume|edit|delete <id>',
        '.life journal add|read|search|edit|delete ...',
        '.life code <27|190> <kept|urge|slipped> [note] · .life codes',
        '.life record add <category> | <title> | <value> · list|show|edit|delete',
        '.life report day [YYYY-MM-DD] · .life report week',
        '.life google connect|status|disconnect · .life upload data · .life backups',
        '.life restore <Drive-file-id> yes · .life export data',
        '.life email test|daily|status · .life coach on|off|<question> · .life doctor',
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
        if(sec==='choose'){
            const type=act,allowed=['focus','study','work','home','travel','spiritual','rest','free','sunday'];
            if(!allowed.includes(type))return reply(dayPrompt(today));
            life.recordDailyCheckin(today,type,p.join(' '));
            const agendaKey='morning-agenda:'+today;
            const result=await reply(header('YOUR DAY IS SET · UMUNSI URATEGUYE',today)+'\n'+agenda(today)+'\n\n'+dailyPsalm(today));
            life.markNotificationSent(agendaKey);
            return result;
        }
        if(sec==='templates')return reply(header('SPECIAL DAY TEMPLATES')+'\nexam · assignment · meeting · birthday · travel · project · reset · worship · review · achievement\n\n.life template exam [YYYY-MM-DD]');
        if(sec==='template'){
            const date=validateDate(p[p.length-1])?p.pop():today;
            life.applySpecialTemplate(date,act);
            const result=await reply('✨ *'+act.toUpperCase()+' TEMPLATE APPLIED*\n'+date+'\n\n'+agenda(date)+'\n'+say('Adjust times to your real commitments.','Hindura amasaha ajyane n’inshingano zawe nyazo.'));
            if(date===today) life.markNotificationSent('morning-agenda:'+date);
            return result;
        }
        if(sec==='psalm')return reply(dailyPsalm(today));
        if(sec==='language'){
            if(!['bilingual','en','rw'].includes(act))return reply('Use .life language bilingual|en|rw.');
            life.setLanguage(act);return reply('🌐 Language preference saved: *'+act+'*.');
        }
        if(sec==='sticker'){await sendLifeSticker(sock,['morning','goal','discipline','evening'].includes(act)?act:'morning');return reply(say('Sticker sent.','Sticker yoherejwe.'));}
        if(sec==='checkin'){
            if(!['on','off'].includes(act))return reply('Daily check-in: '+(life.getSettings().dailyCheckin?'ON':'OFF')+' at '+life.getSettings().dailyCheckinTime);
            const x=life.setDailyCheckin(act==='on',p[0]||life.getSettings().dailyCheckinTime);return reply('Daily check-in '+(x.enabled?'ON':'OFF')+' at '+x.time);
        }
        if(sec==='pillars'){
            return reply(header('LIFE PILLARS · INKINGI Z’UBUZIMA')+'\n'+life.listPillars().map(x=>'🌿 *'+x.id+'* · '+x.name+' — '+x.progress+'%').join('\n')+'\n\n.life pillar <id> <0-100> [note]');
        }
        if(sec==='pillar'){
            const id=act,progress=Number(p.shift());
            if(!Number.isInteger(progress)||progress<0||progress>100)return reply('Use .life pillar <id> <0-100> [note].');
            const x=life.updatePillar(id,{progress,note:p.join(' ')});return reply(x?'🌿 *'+x.name+'* progress: '+x.progress+'%.':'Pillar not found. Use .life pillars.');
        }
        if(sec==='prevention'){
            if(act==='add'){
                const f=p.join(' ').split('|').map(x=>x.trim());if(f.length<2)return reply('Use .life prevention add <trigger> | <response> [| pillar-id].');
                const x=life.addPreventionPlan(f[0],f[1],f[2]||'');return reply('🛡️ Plan *'+x.id+'* saved.\nTrigger: '+x.trigger+'\nResponse: '+x.response);
            }
            if(act==='delete')return reply(life.deletePreventionPlan(p[0])?'Plan deleted.':'Plan not found.');
            const a=life.listPreventionPlans();return reply(a.length?'🛡️ *PREVENTION PLANS*\n'+a.map(x=>'*'+x.id+'* · '+(x.pillarId||'general')+'\nIF: '+x.trigger+'\nTHEN: '+x.response).join('\n\n'):'No plans yet.');
        }
        if(sec==='doctor') {
            const fs = require('node:fs');
            const path = require('node:path');
            const binDir = process.env.PREFIX || '/data/data/com.termux/files/usr';
            const apiAvailable = fs.existsSync(path.join(binDir, 'bin', 'termux-notification'));
            const settings = life.getSettings();
            const checks = [
                'Local data: ' + (fs.existsSync(path.join(__dirname, '..', 'data', 'life-os.json')) ? 'ready' : 'will be created on first save'),
                'Termux:API command: ' + (apiAvailable ? 'available' : 'not installed'),
                'Android pop-ups: ' + (settings.androidNotifications ? 'enabled' : 'disabled'),
                'Google OAuth client: ' + (process.env.LIFE_OS_GOOGLE_CLIENT_ID && process.env.LIFE_OS_GOOGLE_CLIENT_SECRET ? 'configured' : 'not configured'),
                'Google account: ' + (google.getStatus().connected ? 'connected' : 'not connected'),
                'Backup passphrase: ' + (process.env.LIFE_OS_BACKUP_PASSPHRASE ? 'configured' : 'not configured'),
                'Email destination: ' + (process.env.LIFE_OS_EMAIL_TO ? 'configured' : 'not configured'),
                'Email reminders: ' + (settings.emailNotifications ? 'enabled' : 'disabled'),
                'AI Life Coach: ' + (settings.aiCoach ? 'enabled' : 'disabled'),
                'Reminder scheduler: ' + (timer ? 'running' : 'stopped'),
            ];
            return reply('LIFE OS DIAGNOSTICS\n' + checks.join('\n'));
        }
        if(sec==='status') {
            const s=life.getSettings(), classes=Object.entries(life._getState().weeklyClassTypes).map(([d,t])=>d+':'+t).join(', ')||'not set';
            return reply('🌱 *LIFE OS STATUS*\nTimezone: '+s.timezone+'\nDay: '+life.getDayType(today)+'\nClasses: '+classes+
                '\nAdvance reminder: '+s.advanceMinutes+' min\nDaily agenda: '+(s.dailyAgenda?'ON':'OFF')+' at '+s.dailyAgendaTime+
                '\nWhatsApp: '+(s.whatsappNotifications?'ON':'OFF')+'\nAndroid pop-up: '+(s.androidNotifications?'ON':'OFF')+
                '\nEmail: '+(s.emailNotifications?'ON':'OFF')+'\nAuto Drive backup: '+(s.autoBackup?'ON':'OFF')+' at '+s.autoBackupTime+
                '\nAI Life Coach: '+(s.aiCoach?'ON':'OFF')+'\nFocus: '+(s.focusMode?'ON':'OFF')+
                '\nGoogle: '+(google.getStatus().connected?'connected':'not connected')+'\n\n'+nextText(life.getNextAction()));
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
        if(sec==='record'||sec==='records') {
            if(act==='add') {
                const fields=p.join(' ').split('|').map(x=>x.trim());
                if(fields.length<3) return reply('Use .life record add <category> | <title> | <value>.');
                const x=life.addRecord(fields[0],fields[1],fields.slice(2).join(' | '));
                return reply('📌 Record saved: *'+x.id+'* · '+x.category+' · '+x.title);
            }
            if(act==='list'||!act) {
                const a=life.listRecords(p.join(' '));
                return reply(a.length?'📚 *PERSONAL RECORDS*\n'+a.map(x=>'*'+x.id+'* · '+x.category+'\n'+x.title).join('\n\n'):'No matching personal records.');
            }
            if(act==='show') {
                const x=life.listRecords().find(item=>item.id===p[0]);
                return reply(x?'📌 *'+x.title+'*\nCategory: '+x.category+'\n'+x.value:'Record not found.');
            }
            if(act==='edit') {
                const fields=p.join(' ').split('|').map(x=>x.trim()), id=fields.shift();
                if(fields.length<3) return reply('Use .life record edit <id> | <category> | <title> | <value>.');
                return reply(life.updateRecord(id,{category:fields[0],title:fields[1],value:fields.slice(2).join(' | ')})?'✅ Record updated.':'Record not found.');
            }
            if(act==='delete') return reply(life.deleteRecord(p[0])?'✅ Record deleted.':'Record not found.');
            return reply('.life record add|list|show|edit|delete ...');
        }
        if(sec==='report') {
            if(act==='week'||act==='weekly') {
                const r=life.getWeeklyReport(validateDate(p[0])?p[0]:today);
                return reply('📊 *WEEKLY LIFE OS REPORT*\n'+r.startDate+' → '+r.endDate+
                    '\nAgenda: '+r.totals.agendaDone+'/'+r.totals.agendaTotal+' completed'+
                    '\nRoutines: '+r.totals.routinesDone+'/'+r.totals.routinesTotal+' completed'+
                    '\n\n'+r.days.map(d=>d.date+' · agenda '+d.agenda.done+'/'+d.agenda.total+' · routines '+d.routines.done+'/'+d.routines.total).join('\n'));
            }
            const r=life.getDailyReport(validateDate(act)?act:today);
            return reply('📊 *DAILY LIFE OS REPORT*\n'+r.date+' · '+r.dayType+
                '\nAgenda: '+r.agenda.done+'/'+r.agenda.total+' done · '+r.agenda.skipped+' skipped · '+r.agenda.pending+' pending'+
                '\nRoutines: '+r.routines.done+'/'+r.routines.total+' done · '+r.routines.skipped+' skipped · '+r.routines.pending+' pending'+
                '\nGoals: '+r.goals.done+' done · '+r.goals.active+' active'+
                '\nJournal entries: '+r.journalEntries);
        }
        if(sec==='google') {
            if(act==='connect') {
                const auth=google.beginOAuth();
                return reply('🔐 *GOOGLE CONNECTION*\nOpen this authorization link on this phone and approve Drive file upload + Gmail sending permissions:\n'+auth.authorizationUrl+
                    '\n\nCallback: '+auth.redirectUri+'\nAfter approval, use .life google status.');
            }
            if(act==='status') {
                const g=google.getStatus();
                return reply('☁️ Google: '+(g.connected?'CONNECTED':'NOT CONNECTED')+
                    '\nOAuth: '+g.status+'\n'+g.message+
                    '\nCallback waiting: '+(g.callbackPending?'yes':'no'));
            }
            if(act==='disconnect') {
                google.disconnect();
                life.setEmailNotifications(false);
                life.setAutoBackup(false);
                return reply('✅ Google disconnected on this device. Existing encrypted backups in Drive are not deleted.');
            }
            return reply('.life google connect|status|disconnect');
        }
        if(sec==='upload'&&act==='data'||sec==='backup'&&(act===''||act==='data')) {
            const bytes=createBackup();
            const date=life.getDateKey(), stamp=new Date().toISOString().replace(/[:.]/g,'-');
            const localFile=saveLocalBackup(bytes,'mushii-life-os-'+date+'-'+stamp+'.json.enc');
            if(!google.getStatus().connected) return reply('🔒 Encrypted local backup saved. Google is not connected yet.\nFile: '+localFile+'\nConnect with .life google connect, then run .life upload data.');
            const result=await google.uploadBackup(bytes,'mushii-life-os-'+date+'-'+stamp+'.json.enc');
            return reply('✅ *LIFE OS DATA UPLOADED TO GOOGLE DRIVE*\nFile: '+result.name+'\nDrive ID: '+result.id+'\nEncrypted size: '+bytes.length+' bytes\nLocal backup: '+localFile);
        }
        if(sec==='export'&&act==='data') {
            const bytes=createBackup(), stamp=new Date().toISOString().replace(/[:.]/g,'-');
            const file=saveLocalBackup(bytes,'mushii-life-os-manual-'+stamp+'.json.enc');
            return reply('✅ Encrypted Life OS export saved locally:\n'+file+'\nKeep LIFE_OS_BACKUP_PASSPHRASE safe; it is required for restore.');
        }
        if(sec==='backups'||sec==='download'&&act==='data') {
            const files=await google.listBackups();
            return reply(files.length?'☁️ *GOOGLE DRIVE BACKUPS*\n'+files.map(x=>x.id+' · '+x.name+' · '+x.createdTime).join('\n'):'No MUSHII Life OS backups were found in Drive.');
        }
        if(sec==='restore') {
            if (!act || act === 'latest') {
                const files = await google.listBackups();
                if (!files.length) return reply('No Google Drive backups found.');
                return reply('Latest backup: ' + files[0].name + ' · ' + files[0].id +
                    '\nTo replace current Life OS data, run .life restore ' + files[0].id + ' yes.');
            }
            if (p[0] !== 'yes') {
                return reply('This will replace the current Life OS data. Confirm with .life restore ' + act + ' yes.');
            }
            const result = await recoverBackup(act);
            return reply('Life OS data restored after integrity and passphrase validation. Schema v' + result.version + ', records: ' + result.records + '.');
        }
        if(sec==='email') {
            if(act==='status') return reply('Email reminders: '+(life.getSettings().emailNotifications?'ON':'OFF')+
                '\nRecipient configured: '+(Boolean(process.env.LIFE_OS_EMAIL_TO)?'yes':'no')+
                '\nGoogle connected: '+(google.getStatus().connected?'yes':'no'));
            if(act==='test') {
                await google.sendEmail({to:process.env.LIFE_OS_EMAIL_TO,subject:'MUSHII Life OS | Email connection test',text:'Hello,\n\nYour MUSHII Life OS email connection is working.\n\nKind regards,\nMUSHII Life OS'});
                return reply('Test email sent. Check the configured inbox.');
            }
            if(act==='daily'||act==='agenda') {
                const report=life.getDailyReport(today),next=life.getNextAction();
                const goals=life.listGoals().filter(x=>x.status==='active');
                const pillars=life.listPillars();
                const plans=life.listPreventionPlans().filter(x=>x.active);
                const body=[
                    'Hello,',
                    '',
                    'Here is your MUSHII Life OS daily briefing.',
                    '',
                    'DATE: '+today+' | DAY TYPE: '+life.getDayType(today),
                    '',
                    'TODAY’S AGENDA',
                    ...life.getAgenda(today).map(x=>x.time+'  '+x.title+' ['+x.status+']'),
                    '',
                    'NEXT ACTION',
                    next?next.time+' — '+next.title:'No pending agenda item.',
                    '',
                    'PRIORITY GOALS',
                    ...(goals.length?goals.map(x=>'• '+x.title):['No active goals recorded.']),
                    '',
                    'LIFE PILLARS',
                    ...pillars.map(x=>'• '+x.name+': '+x.progress+'%'),
                    '',
                    'PREVENTION PLAN COUNT: '+plans.length,
                    'PROGRESS: Agenda '+report.agenda.done+'/'+report.agenda.total+' complete; routines '+report.routines.done+'/'+report.routines.total+' complete.',
                    '',
                    'Take the day one priority at a time. Review or adjust your schedule in WhatsApp with MUSHII Life OS.',
                    '',
                    'Kind regards,',
                    'MUSHII Life OS'
                ].join('\n');
                await google.sendEmail({to:process.env.LIFE_OS_EMAIL_TO,subject:'MUSHII Life OS | Daily plan · '+today,text:body});
                return reply('📧 Professional daily briefing sent to your configured inbox.');
            }
            return reply('.life email status|test. Set LIFE_OS_EMAIL_TO privately, then enable .life settings email on.');
        }
        if(sec==='coach') {
            if(act==='on'||act==='enable') {
                life.setAICoach(true);
                return reply('AI Life Coach enabled. A small progress summary and your question may be processed by the configured AI provider. Journal entries, private codes and raw personal records are not sent automatically.');
            }
            if(act==='off'||act==='disable') {
                life.setAICoach(false);
                return reply('AI Life Coach disabled.');
            }
            if(!life.getSettings().aiCoach) return reply('AI Life Coach is off. Use .life coach on to opt in first.');
            const question=[act,...p].join(' ').trim();
            if(!question) return reply('Use .life coach <question>.');
            const report=life.getDailyReport(today), next=life.getNextAction();
            const goals=life.listGoals().filter(x=>x.status==='active').slice(0,10).map(x=>x.title);
            const summary='Today: '+JSON.stringify(report)+'\nNext action: '+(next?next.time+' '+next.title:'none')+
                '\nActive goals: '+JSON.stringify(goals);
            const result=await aiCoach.runAgent('Act as a practical, honest planning coach. Do not shame or overpromise. Help with this question: '+question+'\nLife OS progress summary (no journal or raw private records): '+summary,ctx);
            return reply('LIFE COACH\n'+(result.text||'No coaching response returned.'));
        }
        if(sec==='focus') { if(!['on','off'].includes(act)) return reply('Focus reminders: '+(life.getSettings().focusMode?'ON':'OFF')); life.setFocusMode(act==='on'); return reply(act==='on'?'🎯 Focus reminders ON. This does not block phone apps.':'✅ Focus reminders OFF.'); }
        if(sec==='settings') {
            const v=(p[0]||'').toLowerCase();
            if(act==='advance') return reply('✅ Advance reminders: '+life.setAdvanceMinutes(v)+' min.');
            if(act==='timezone') return reply('✅ Timezone: '+life.setTimezone(p.join(' ')));
            if(act==='android') { if(!['on','off'].includes(v)) return reply('Use .life settings android on|off.'); life.setAndroidNotifications(v==='on'); return reply(v==='on'?'✅ Android pop-ups enabled; Termux:API app/package and permission required.':'✅ Android pop-ups disabled.'); }
            if(act==='dailyagenda') { if(!['on','off'].includes(v)) return reply('Use .life settings dailyagenda on|off [HH:MM].'); const x=life.setDailyAgenda(v==='on',p[1]||life.getSettings().dailyAgendaTime); return reply('✅ Daily agenda '+(x.enabled?'ON':'OFF')+' at '+x.time+'.'); }
            if(act==='whatsapp') {
                if(!['on','off'].includes(v)) return reply('Use .life settings whatsapp on|off.');
                life.setWhatsAppNotifications(v==='on');
                return reply('WhatsApp Life OS reminders '+v+'.');
            }
            if(act==='email') {
                if(!['on','off'].includes(v)) return reply('Use .life settings email on|off.');
                if(v==='on'&&!process.env.LIFE_OS_EMAIL_TO) return reply('Set LIFE_OS_EMAIL_TO in private config.env first.');
                if(v==='on'&&!google.getStatus().connected) return reply('Connect Google first with .life google connect.');
                life.setEmailNotifications(v==='on');
                return reply('Email reminders '+v+'.');
            }
            if(act==='backup') {
                if(!['on','off'].includes(v)) return reply('Use .life settings backup on|off [HH:MM].');
                if(v==='on'&&!process.env.LIFE_OS_BACKUP_PASSPHRASE) return reply('Set LIFE_OS_BACKUP_PASSPHRASE in private config.env first.');
                if(v==='on'&&!google.getStatus().connected) return reply('Connect Google first with .life google connect.');
                const x=life.setAutoBackup(v==='on',p[1]||life.getSettings().autoBackupTime);
                return reply('Automatic encrypted Drive backup '+(x.enabled?'ON':'OFF')+' at '+x.time+'.');
            }
            if(act==='coach') {
                if(!['on','off'].includes(v)) return reply('Use .life settings coach on|off.');
                life.setAICoach(v==='on');
                return reply('AI Life Coach '+v+'.');
            }
            return reply('Settings: advance <min>, timezone <IANA>, dailyagenda on|off [HH:MM], android on|off, whatsapp on|off, email on|off, backup on|off [HH:MM], coach on|off.');
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
    __test:{life,agenda,nextText,tick,stop:stopScheduler,android}
};
