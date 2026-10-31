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

- `.away on`: enable AI-generated replies to incoming private WhatsApp messages.
- `.away off`: disable automatic replies.
- `.away`: check the current setting and usage.

Replies use the message language where possible, are generated from the actual incoming text, and use the existing no-key AI service first. An optional `OPENROUTER_API_KEY` can enable OpenRouter's free-model router (`OPENROUTER_MODEL=openrouter/free`) as the first provider. OpenRouter free models have availability and rate limits; this is not unlimited guaranteed hosting. If all free providers are unavailable, the bot does not send a canned reply. Auto-reply ignores groups, the owner, commands, and protocol messages, and applies a per-contact 60-second cooldown. Conversations use the existing Agent v2 chat history; keep in mind messages are sent to whichever external AI provider handles the request.

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

MUSHII does not open, forward, or otherwise bypass WhatsApp View Once messages. When a contact deletes a message in a one-to-one chat, MUSHII privately alerts the owner with the sender and deletion time, then forwards the original message when it is available. The in-memory cache is limited to 500 private incoming messages and expires after 24 hours; group messages are not cached or monitored. Messages sent by the owner, disappearing messages, and View Once messages are never forwarded. AI auto-replies are private-chat only, ignore commands and the owner, and are limited by a 60-second per-contact cooldown. No automatic greeting, welcome, goodbye, or other passive bot response is sent into groups; group commands remain available.

## Configuration

`config.env.example` contains non-secret defaults. Set `BOT_NAME=MUSHII` to customize the display name. The owner number is intentionally blank and must be configured by the operator. Optional provider keys and database credentials belong only in the host's private secret settings.

Pair-code commands remain unavailable until the operator supplies their own `PAIR_CODE_API_URL` in private configuration; MUSHII does not provide or promote a pairing service.

## Project

Repository: https://github.com/contactyourkern-byte/mushii-bot

See [LICENSE](LICENSE) for the existing license and attribution.
