# Intervue notetaker bot

Node 22 + TypeScript + Playwright. One process/container per meeting: joins a Google Meet as a guest, records the
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
active-speaker heuristic, in `selectors.ts`), `teams/` and `zoom/` stubs (M7/M8), `session.ts` (state machine + leave
conditions), `recorder.ts` (ffmpeg + chunk watcher), `backend-client.ts`, `speaker-tracker.ts`, `config.ts`, `browser.ts`.

## Develop
```
npm ci
npm run build        # tsc
npm run lint         # tsc --noEmit incl. tests
npm test             # vitest unit tests
npx playwright install chromium-headless-shell
npm run test:e2e     # adapter tests against tests/fixtures/google-meet/*.html
```
Local run (needs Linux with Xvfb/PulseAudio/ffmpeg, or use the Docker image):
```
docker build -t intervue-notetaker services/notetaker-bot
docker run --rm -e BOT_SESSION_ID=... -e MEETING_URL=https://meet.google.com/xxx-xxxx-xxx -e CONSENT_MESSAGE="..." \
  -e CALLBACK_URL=http://host.docker.internal:8000 -e CALLBACK_SECRET=... -e UPLOAD_PREFIX=recordings/<id>/ intervue-notetaker
```
Keep the Dockerfile base tag (`v1.64.0-noble`) in lockstep with the `playwright` version in `package.json`.

## Caveat
Selectors and the speaker heuristic are verified only against the HTML fixtures, not a live Meet. Fix UI drift in `selectors.ts`.
