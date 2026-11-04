# MUSHII

**WhatsApp Entertainment Bot**

MUSHII brings games, music search, and public-media downloads to WhatsApp chats. It is built with Node.js and Baileys.

## Features

| Command | Description |
|---|---|
| `.menu` | MUSHII Entertainment menu |
| `.joke` | Random joke |
| `.truth` / `.dare` | Truth or dare prompt |
| `.riddle` / `.answer` | Riddle and answer |
| `.8ball <question>` | Random 8-ball answer |
| `.ship <name> and <name>` | Playful compatibility score |
| `.rps <rock\|paper\|scissors>` | Rock, paper, scissors |
| `.dice [sides]` | Roll dice |
| `.trivia` | Trivia question |
| `.compliment` | Random compliment |
| `.play <song or YouTube link>` | Search and send a track as audio |
| `.ytmp3 <YouTube link>` | Download YouTube audio |
| `.ytmp4 <YouTube link>` | Download YouTube video (subject to provider limits) |
| `.download <public link> [mp3\|mp4]` | Download supported public media |

Use `.help <command>` for command details.

## AI auto-reply (owner controlled)

- Automatic replies are ON by default on a fresh install; use `.away` to inspect the current setting.
- `.away on`: enable greeting-only AI replies in private one-to-one chats.
- `.away off`: disable automatic replies.
- MUSHII answers short greetings in English or Kinyarwanda (for example, "Hello", "Good morning", "Muraho", or "Mwaramutse"). It deliberately ignores ordinary statements, questions and commands. Existing commands such as `.menu` continue through the normal command handler.
- Each contact receives at most two automatic greeting replies in a rolling 24-hour period, with a 15-second minimum cooldown. The limit is persisted across bot restarts.
- If AI providers are unavailable, MUSHII uses a short, safe greeting fallback. Optional Gemini and Groq keys can be configured; the existing ch.at and Pollinations routes are public fallbacks and may be unavailable or rate-limited. This is not unlimited guaranteed hosting.
- AI replies are identified as MUSHII AI. Incoming message text and limited recent private-chat context may be sent to the external AI provider used for the reply.
## Documentary research (owner only)

- `.kern scan` / `.kern scan <topic>`: KERN opportunity research.
- `.kern ideas`: repeat the latest KERN scan.
- `.kern analyze <topic>`: focused KERN research.
- `.kern export`: send the latest KERN results as CSV.
- `.mushii scan` / `.mushii scan <topic>`: MUSHII African-story research.
- `.mushii ideas`: repeat the latest MUSHII scan.
- `.mushii script <topic>`: research and draft a Kinyarwanda narration.

KERN covers cybercrime, Logistics of Luxury, Luxury Industry & Business, Luxury Lifestyle & Wealth, strange science/technology, forgotten history, and human extremes. The three luxury pillars are separate research clusters. MUSHII covers African kingdoms, people, mysteries/heritage, culture/entertainment, and innovation/science.

Research commands are owner-only and private-chat-only. Reports and exports are sent to `OWNER_NUMBER` in a private WhatsApp message, not to the originating group. Keep owner number and API keys in private host configuration, never Git. Research data is saved under ignored `data/`.

Optional free research providers:
- YouTube Data API with `YOUTUBE_API_KEY` (or `GOOGLE_API_KEY`); local safety limit defaults to 20 search calls per Pacific Time day. Without a key, the existing `yt-search` dependency is used as a fallback.
- Wikipedia and GDELT for supporting reference discovery. Search results are leads, not proof; verify facts independently.
- Kinyarwanda narration uses the bot's existing Agent v2 no-key `ch.at` route when no `AGENT_API_KEY` is configured. No new API key is required for this path; it depends on the external no-key service being reachable and available.

Scores are editorial heuristics. This initial release uses each cluster's median view count as its comparison baseline and marks confidence low; it does not yet calculate true channel-specific medians.

## Setup

1. Use Node.js 24.x.
2. Install the exact locked dependencies with `npm ci`.
3. Copy `config.env.example` to the ignored local `config.env` and set your private WhatsApp credentials there.
4. Start with `npm start`.

Never commit `config.env`, session data, authentication files, passwords, or tokens. The repository ignore rules exclude the local environment and WhatsApp auth directories.

## Privacy

MUSHII does not open, forward, or otherwise bypass WhatsApp View Once messages. When a contact deletes a message in a one-to-one chat, MUSHII privately alerts the owner with the sender and deletion time, then forwards the original message when it is available. The in-memory cache is limited to 500 private incoming messages and expires after 24 hours; group messages are not cached or monitored. Messages sent by the owner, disappearing messages, and View Once messages are never forwarded. AI auto-replies are private-chat only, greeting-only, ignore commands and the owner, and are limited to two replies per contact per rolling 24 hours. No automatic greeting, welcome, goodbye, or other passive bot response is sent into groups; group commands remain available.

## Configuration

`config.env.example` contains non-secret defaults. Set `BOT_NAME=MUSHII` to customize the display name. The owner number is intentionally blank and must be configured by the operator. Optional provider keys and database credentials belong only in the host's private secret settings.

Pair-code commands remain unavailable until the operator supplies their own `PAIR_CODE_API_URL` in private configuration; MUSHII does not provide or promote a pairing service.

## Project

Repository: https://github.com/contactyourkern-byte/mushii-bot

See [LICENSE](LICENSE) for the existing license and attribution.

## MUSHII Life OS (owner only)

MUSHII Life OS adds private daily agendas, next actions, recurring routines, reminders, goals, journal entries, personal records, a categorized MUSHII Book knowledge library, and daily/weekly reviews. It uses Africa/Kigali by default and sends reminders through WhatsApp, with optional Android pop-ups and Gmail delivery. Encrypted Life OS backups can be saved locally and uploaded to Google Drive.

AI Auto Reply is greeting-only: it answers short greetings and ignores ordinary incoming messages, with a maximum of two automatic replies per contact in a rolling 24-hour period. Existing command replies such as `.menu` continue to work normally. See [docs/life-os.md](docs/life-os.md) for Life OS and MUSHII Book commands, Google OAuth setup, notification requirements, privacy details and encrypted backup instructions. Life OS commands are owner-only and private-chat-only. Google authorization and the backup passphrase are configured privately on the device; never commit tokens, passphrases, WhatsApp session files or config.env.
