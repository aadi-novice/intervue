# Intervue notetaker bot

Node 22 + TypeScript + Playwright. One process/container per meeting: joins a Google Meet or Microsoft Teams meeting as a guest, records the
meeting audio (PulseAudio null sink -> ffmpeg -> 16 kHz mono Opus, 30 s chunks), observes the active speaker and
reports to the backend. Spec: `docs/SPEC.md` section 6.

## Modes
- `dist/main.js` (`npm start`): single session from env; exit 0 = completed, 1 = failed.
- `dist/pool.js` (`npm run start:pool`): PoolLauncher worker. `BLPOP` on `BOT_QUEUE_NAME` (default `intervue:bot_sessions`)
  at `REDIS_URL`; each item is a JSON object with the keys below in lowercase snake_case. One meeting at a time.
- Docker: `BOT_MODE=single|pool` picks the entry point (`entrypoint.sh` starts PulseAudio + the `intervue_sink` null sink, then Xvfb + node).

## Env vars (single mode; same keys, lowercase, for pool jobs)
| Var | Default | |
|---|---|---|
| `BOT_SESSION_ID`, `MEETING_URL`, `CALLBACK_URL`, `CALLBACK_SECRET`, `UPLOAD_PREFIX` | required | `UPLOAD_PREFIX` e.g. `recordings/<session>/` |
| `CONSENT_MESSAGE` | required, non-empty | consent cannot be disabled |
| `BOT_NAME` | `Intervue Notetaker` | |
| `MAX_DURATION_MIN` / `ADMISSION_TIMEOUT_MIN` / `ALONE_TIMEOUT_SEC` | 180 / 10 / 120 | |
| `CHUNK_SECONDS` | 30 | worker-level in pool mode |
| `PULSE_SINK` | `intervue_sink` | worker-level in pool mode |
| `HEADLESS` | `false` | Xvfb is used in Docker; worker-level in pool mode |
| `FFMPEG_PATH`, `LOG_LEVEL` | `ffmpeg`, `info` | |

## Backend contract
All requests carry `X-Timestamp` (unix seconds) and `X-Signature = hex(hmac_sha256(CALLBACK_SECRET, "<ts>." + rawBody))`
(empty body for GET). Callbacks retry with exponential backoff (5 attempts) and never crash the session.

- `POST {CALLBACK_URL}/internal/bots/{id}/events`: `status` (`joining|waiting_admission|in_call|leaving`), `consent_sent`,
  `speaker_events` (batched every 5 s / 200 events), `chunk_uploaded {index, blob, start_ms, duration_ms}`,
  `completed {manifest_blob, duration_ms}`, `failed {reason, detail, screenshot_blob|null}`.
  Blob names are relative (prefixed with `UPLOAD_PREFIX`).
- `POST .../upload-url` `{blob, content_type}` -> `{url, headers}`, then the bot `PUT`s the bytes. The bot holds no cloud credentials.
- `GET .../control` every 5 s -> `{action: "none"|"stop"}`.
- Manifest (`<prefix>manifest.json`): `{session_id, recording_started_at, duration_ms, chunks[], mime_type: "audio/ogg"}`.

## Layout
`src/adapters/types.ts` (MeetingAdapter), `src/adapters/google-meet/{index,selectors}.ts` (all selectors, incl. the
active-speaker heuristic, in `selectors.ts`), `teams/{index,selectors}.ts` (M7, same layout as Meet; the active-speaker heuristic is `scanParticipants` in `teams/selectors.ts`), `zoom/` stub (M8), `session.ts` (state machine + leave
conditions), `recorder.ts` (ffmpeg + chunk watcher), `backend-client.ts`, `speaker-tracker.ts`, `config.ts`, `browser.ts`.

## Develop
```
npm ci
npm run build        # tsc
npm run lint         # tsc --noEmit incl. tests
npm test             # vitest unit tests
npx playwright install chromium-headless-shell
npm run test:e2e     # adapter tests against tests/fixtures/{google-meet,teams}/*.html
```
Local run (needs Linux with Xvfb/PulseAudio/ffmpeg, or use the Docker image):
```
docker build -t intervue-notetaker services/notetaker-bot
docker run --rm -e BOT_SESSION_ID=... -e MEETING_URL=https://meet.google.com/xxx-xxxx-xxx -e CONSENT_MESSAGE="..." \
  -e CALLBACK_URL=http://host.docker.internal:8000 -e CALLBACK_SECRET=... -e UPLOAD_PREFIX=recordings/<id>/ intervue-notetaker
```
Keep the Dockerfile base tag (`v1.64.0-noble`) in lockstep with the `playwright` version in `package.json`.

## Microsoft Teams (M7)
Adapter: `src/adapters/teams/`. Joins **Teams on the web as a guest, without signing in**.
- Supported URLs (https, exact host match): `teams.microsoft.com/l/meetup-join/...`, `teams.microsoft.com/meet/...`,
  `teams.live.com/meet/...`. Look-alike hosts (`teams.microsoft.com.evil.io`) are rejected.
- Flow: launcher interstitial -> "Continue on this browser" -> pre-join: name field = `BOT_NAME`, camera and mic forced OFF,
  "Join now" -> lobby ("Someone in the meeting should let you in soon") -> in call. Consent message is posted via the
  Chat pane (Enter, falling back to the Send button).
- Speaker detection reads participant tiles / roster rows (explicit speaking markers, animated voice-level outline, or a
  "speaking" aria-label). "(Guest)", "(You)", "(External)" etc. are stripped from names.
- Failure reasons: `guests_not_allowed` (anonymous join blocked / sign-in required), `meeting_not_found`,
  `blocked_by_host` (denied/removed while waiting), `ui_changed` (+ screenshot) when an expected control is missing.

Known limitations:
- Tenants whose policy blocks anonymous/guest join, or meetings that require sign-in, **cannot be joined** (the bot never
  signs in). Meeting options "Who can bypass the lobby" decide whether the bot waits in the lobby (organizer/presenter must
  admit it) or enters directly; with "Only me" or "People in my org" the bot always waits or is refused.
- Teams is joined through the browser only; the desktop-app prompt is ignored. Chromium on Linux is used, so tenants that
  block unsupported browsers are not supported.
- **Selectors are UNVERIFIED against real Teams.** The UI differs between tenants, rollout rings and A/B tests, and changes
  often. Everything was only exercised against our own HTML fixtures in `tests/fixtures/teams/`. Every guess is marked
  `UNVERIFIED against real Teams` in `selectors.ts`. A synthetic monitor against a real test meeting is required before
  relying on it.

## Caveat
Selectors and the speaker heuristic (Meet and Teams) are verified only against the HTML fixtures, not a live meeting. Fix UI drift in each platform's `selectors.ts`.
