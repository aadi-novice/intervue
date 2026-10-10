# Intervue transcriber

FastAPI service that transcribes recordings (faster-whisper locally, or a hosted STT API) and calls the
backend back with word-level segments. Spec: `docs/SPEC.md` section 6.6 / M4.4.

## HTTP contract

All `/jobs` endpoints need `Authorization: Bearer <TRANSCRIBER_API_KEY>` (401 otherwise).

- `POST /jobs` body `{ "job_id", "audio_url" (presigned GET), "language": "auto"|"en"|..., "callback_url" }`
  returns `202 { "job_id", "status": "queued" }`.
  Idempotent by `job_id`: re-posting an existing id returns 202 with its current status and does not re-run it,
  unless the previous run `failed` (then it is re-queued).
- `GET /jobs/{job_id}` returns `{ job_id, status: queued|running|completed|failed, error }` (404 if unknown).
  Status flips to `completed`/`failed` only after the callback has been attempted.
- `GET /healthz` always 200. `GET /readyz` is 200 once the model is loaded (always 200 in `api` mode), else 503.
- Errors: `{ "detail": str, "code": str }`.

### Callback

`POST callback_url`, JSON body, one of:

```json
{ "job_id": "...", "status": "completed", "language": "en", "duration_ms": 123000,
  "segments": [ { "start_ms": 0, "end_ms": 1500, "text": "Hello there.", "avg_logprob": -0.21,
                  "words": [ { "start_ms": 0, "end_ms": 600, "word": " Hello", "probability": 0.98 } ] } ] }
{ "job_id": "...", "status": "failed", "error": "..." }
```

Headers: `X-Timestamp: <unix seconds>` and
`X-Signature: hex(hmac_sha256(TRANSCRIBER_CALLBACK_SECRET, "<timestamp>." + raw_body))`.
Verify against the raw request bytes, and reject stale timestamps. The timestamp is regenerated on each retry.

Retries: 5 attempts, exponential backoff (1, 2, 4, 8 s) on 5xx / 408 / 425 / 429 / network errors; other 4xx are
not retried. The body is always sent inline: the service has no storage credentials, so there is no blob
fallback. `CALLBACK_INLINE_MAX_BYTES` (default 5 MB) only triggers a warning log; the backend must accept large bodies
(a 2 h call is roughly 1-3 MB of JSON with word timings).

Jobs are held in memory only: after a restart they are forgotten (GET returns 404), so the backend should resubmit.

## Environment

| Var | Default | Notes |
|---|---|---|
| `TRANSCRIBER_API_KEY` | required | bearer token for `/jobs` |
| `TRANSCRIBER_CALLBACK_SECRET` | required | HMAC key for callbacks |
| `TRANSCRIBER_MODE` | `local` | `local` (faster-whisper) or `api` (hosted STT) |
| `WHISPER_MODEL` | `large-v3` | |
| `WHISPER_DEVICE` | `auto` | `auto` picks cuda if available |
| `WHISPER_COMPUTE_TYPE` | per device | `int8_float16` on cuda, `int8` on cpu |
| `WHISPER_CPU_FALLBACK_MODEL` | `medium` | used when device is cpu and `WHISPER_MODEL` was not set |
| `MAX_CONCURRENT_JOBS` | `1` | parallel transcriptions per process |
| `DOWNLOAD_MAX_BYTES` | 2 GB | larger audio fails the job |
| `STT_API_PROVIDER` / `STT_API_MODEL` | `openai` / `whisper-1` | api mode; `gpt-4o-transcribe` returns text only (single segment, no words) |
| `OPENAI_API_KEY` | | api mode. the `api` extra (openai SDK) is installed in the Docker images |
| `CALLBACK_INLINE_MAX_BYTES` | 5 MB | see above |
| `HF_HOME` / `WHISPER_DOWNLOAD_ROOT` | | model cache location |
| `PORT` | 8080 | |

## Modes

- **GPU (AWS g4dn / g6)**: `Dockerfile`, CUDA 12.4 + cuDNN 9 (what ctranslate2 4.x requires), `large-v3`,
  `int8_float16`. A T4/L4 does roughly 20-40x real time. Run with `--gpus all`. Scale on queue depth.
- **CPU (Render, small servers)**: `Dockerfile.cpu`, `medium` int8, about 1-3x real time; fine at low volume.
  Render has no GPUs.
- **api**: `TRANSCRIBER_MODE=api`, no model is loaded; audio goes to OpenAI (25 MB upload limit; the bot's
  16 kHz mono Opus is far below that). No word probabilities are available from the API.

Build: `docker build -t transcriber-gpu .` / `docker build -f Dockerfile.cpu -t transcriber-cpu .`
(`--build-arg PRELOAD_MODEL=medium` bakes the model into the image).

## Development

```
uv sync
uv run pytest
TRANSCRIBER_API_KEY=k TRANSCRIBER_CALLBACK_SECRET=s uv run python -m app
```
Tests use a fake engine and mocked HTTP; no network or model is needed.
