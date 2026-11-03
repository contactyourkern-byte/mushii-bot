# MUSHII Life OS

MUSHII Life OS is a private, owner-only personal planning system inside the WhatsApp bot. It stores its data locally in data/life-os.json and uses the Africa/Kigali timezone by default.

## Current capabilities

- Daily agenda templates for morning class, evening class, free days, travel, family/home days and Sunday.
- Weekly class patterns, date overrides, editable agenda items and a single next-action view.
- Persistent routines, one-time reminders, goals, private journal entries, coded commitment check-ins and personal records.
- Daily and weekly progress reports.
- WhatsApp reminders, optional Android notifications through Termux:API, and optional email notifications.
- Encrypted manual backup and Google Drive upload; optional daily scheduled Drive backup.
- Optional AI Life Coach. It is disabled by default and only receives a compact progress summary plus the question asked; journal entries and private records are not added automatically.

All Life OS commands are owner-only and private-chat-only. Do not use Life OS commands in groups.

## Commands

| Command | Purpose |
|---|---|
| .life | Show command help |
| .life status | Show current settings and next action |
| .agenda [tomorrow or YYYY-MM-DD] | Show an agenda |
| .life day <morning/evening/free/travel/home/sunday> [date] | Choose a day template |
| .life class <mon/tue/...> <morning/evening/off> | Set a weekly university class pattern |
| .life agenda add <type> <HH:MM> <duration> <title> | Add an agenda template item |
| .life agenda edit <type> <id> <HH:MM> <duration> <title> | Edit an agenda template item |
| .life agenda move <id> <HH:MM> | Move an item for today |
| .life agenda done <id> / .life agenda skip <id> | Mark today's task |
| .next / .next done / .next skip | Show or complete the next action |
| .next delay <minutes> | Move the next action |
| .life routine add <HH:MM> <daily/weekdays/weekends/mon,wed,fri> <task> | Create a recurring routine |
| .life routine list | List routines |
| .life routine edit <id> <HH:MM> <recurrence> <task> | Edit a routine |
| .life routine pause/resume/delete/done/skip <id> | Manage routine state |
| .life remind add <YYYY-MM-DD> <HH:MM> <task> | Schedule a one-time reminder |
| .life remind list / .life remind delete <id> | Manage reminders |
| .life goal add <goal> / .life goals | Manage goals |
| .life journal add <entry> / .life journal read | Save or read private journal entries |
| .life journal search <words> | Search journal entries |
| .life code <27/190> <kept/urge/slipped> [note] | Save a private coded daily check-in |
| .life record add <category> | <title> | <value> | Add a personal record |
| .life record list [query] / .life record show <id> | Read personal records |
| .life record edit <id> | <category> | <title> | <value> | Update a personal record |
| .life record delete <id> | Delete a personal record |
| .life report day [date] / .life report week [date] | Review progress |
| .life google connect/status/disconnect | Connect or inspect Google services |
| .life upload data | Save an encrypted local copy and upload it to Drive |
| .life export data | Save an encrypted local backup only |
| .life backups | List available Drive backups |
| .life restore <Drive-file-id> yes | Replace current Life OS data from a validated encrypted backup after explicit confirmation |
| .life email status/test | Check and test email delivery |
| .life settings whatsapp on/off | Enable or disable WhatsApp reminders |
| .life settings email on/off | Enable or disable email reminders |
| .life settings backup on/off [HH:MM] | Enable or disable scheduled encrypted Drive backups |
| .life settings coach on/off | Enable or disable the AI Life Coach |
| .life coach on/off / .life coach <question> | Enable or use the optional AI coach |

For local notifications, enable .life settings android on. For WhatsApp reminders, use .life settings whatsapp on/off. Email reminders require .life settings email on after Google is connected and the recipient is configured. Automatic Drive backups use .life settings backup on [HH:MM]; the default time is 22:45 Kigali time.

## Android notifications

Install the Termux:API Android app from a trusted source and install the matching Termux package using pkg install termux-api. Grant notification permission to Termux:API and enable notifications in Android settings. Then run .life settings android on.

The scheduler is started with the Life OS plugin and continues local Android notification checks while WhatsApp is disconnected, provided the Node process is still running. Android may stop background processes under battery optimization. For reminders after a reboot, use Termux:Boot and configure a safe startup script. A stopped Termux process cannot deliver a popup.

Private code reminders use only the generic text "Private check-in · 27 / 190" on the Android notification surface; private notes are not included.

## Google Drive and Gmail setup

1. Create a Google Cloud project and enable Google Drive API and Gmail API.
2. Configure the OAuth consent screen and add the Google account used by MUSHII as a test user while the app is in Testing.
3. Create an OAuth client whose application type is Desktop app.
4. Copy the client ID and client secret into the local, ignored config.env file. Never commit those values or paste them into chats.
5. Add a long, unique LIFE_OS_BACKUP_PASSPHRASE (at least 12 characters; a password-manager generated value is recommended). Also configure LIFE_OS_EMAIL_TO if email notifications are wanted.
6. Restart MUSHII after the local configuration is saved, then run .life google connect and approve the requested scopes in Google's consent screen.
7. Run .life google status, then .life upload data.

Required local settings:

LIFE_OS_GOOGLE_CLIENT_ID=
LIFE_OS_GOOGLE_CLIENT_SECRET=
LIFE_OS_BACKUP_PASSPHRASE=
LIFE_OS_EMAIL_TO=

Google scopes requested:
- drive.file — create and manage files created or opened by MUSHII, not unrestricted Drive contents.
- gmail.send — send reminder and report emails.

The OAuth implementation uses PKCE, a short-lived state value, a loopback callback on 127.0.0.1:8765, and stores the refresh token in the ignored local data directory with restrictive file permissions. Desktop-app loopback OAuth is documented by Google; Google also notes loopback redirects are deprecated for Android OAuth client types. The client used here must therefore be a Desktop app client. Verify the callback on the actual Termux/Android device before relying on it.

Important: OAuth apps left in Google's Testing publishing status have test-user authorizations that expire seven days from consent for non-basic scopes. A refresh token from that test setup also expires with the authorization. For uninterrupted long-term backups and mail, follow Google's publishing and verification requirements for the chosen scopes rather than assuming a test token will last forever.

## Backup and data safety

- Backups are compressed and encrypted with AES-256-GCM using a key derived with scrypt and a random salt.
- Drive receives the encrypted file; it does not receive plaintext Life OS JSON.
- The local encrypted backup directory is data/life-os-backups/. Files use restrictive local permissions.
- Keep the passphrase outside the phone and outside Git. Losing it means the encrypted backup cannot be unlocked.
- .life upload data writes a local encrypted copy first. If Google is not connected, it keeps the local copy and tells the owner to connect Google before retrying the upload.
- Never upload WhatsApp session files, config.env, or other bot credentials as Life OS backups.

## AI Coach privacy

The AI coach is opt-in and off by default. Enabling it allows the configured Agent v2 provider to process the question plus a small daily summary containing counts, the next task and active goal titles. Journal text, code check-ins and personal record values are not automatically included. A user should avoid asking the coach to process sensitive details unless they are comfortable sending that text to the configured AI provider.

## Testing

Run the Life OS-focused tests with node --test tests/life-os.test.js tests/life-os-backup.test.js. Run the full project suite with npm test. GitHub Actions is configured to run the project test suite on Node.js 24 for pushes to the main and Life OS feature branches and for pull requests to main.
