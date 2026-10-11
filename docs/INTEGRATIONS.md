# Intervue Integrations: Webhooks, Public API and Slack

Admins manage everything below in **Settings → Integrations** (or through the admin endpoints under
`/orgs/{org_id}/...`). All of it is scoped to one organization.

> **Privacy by design:** events, API responses and Slack messages carry **ids, scores and role names, never candidate
> names, emails or transcript text**. In organizations with blind review enabled, the public API additionally masks
> names and emails and a key can never "reveal" a candidate.

---

## 1. Outbound webhooks

Intervue sends an HTTPS `POST` to your endpoint when something finishes.

### Events

| Event | Sent when | `data` fields |
|---|---|---|
| `interview.completed` | a transcript is ready (bot recording processed, or a transcript was uploaded) | `interview_id, candidate_id, role_id, platform, status, has_transcript` |
| `analysis.completed` | an interview analysis finished | `analysis_id, interview_id, candidate_id, role_id, technical_score, communication_score, confidence_score, hiring_recommendation` |
| `ranking.completed` | a role's resume ranking finished | `role_id, scored, failed, shortlisted, cost_usd` |
| `ping` | you press **Send test** | `message, endpoint_id` |

`hiring_recommendation` is an **AI suggestion** (`Strong Hire / Hire / Lean No Hire / No Hire`); the decision belongs to your team.

### Envelope

```json
{
  "id": "evt_3f1c0a9e5b7d4c2e8a61b0d9",
  "type": "analysis.completed",
  "created_at": "2026-10-11T10:15:30.123456+00:00",
  "org_id": 12,
  "data": { "analysis_id": 88, "interview_id": 41, "candidate_id": 7, "role_id": 3,
            "technical_score": 81, "communication_score": 72, "confidence_score": 66,
            "hiring_recommendation": "Hire" }
}
```

`id` is stable across retries and identical for every endpoint that receives the event: **use it to de-duplicate**.

### Headers

| Header | Meaning |
|---|---|
| `X-Intervue-Event` | event type |
| `X-Intervue-Delivery` | delivery id (changes per endpoint) |
| `X-Intervue-Signature` | `t=<unix seconds>,v1=<hex>`, see below |
| `User-Agent` | `Intervue-Webhooks/1` |

### Verifying the signature (do this!)

`v1 = HMAC_SHA256(secret, "<t>." + raw_request_body)` using the endpoint's `whsec_...` secret. Reject requests whose
timestamp is more than 5 minutes old. **Use the raw body bytes, not re-serialised JSON.**

Python:

```python
import hashlib, hmac, time

def verify(secret: str, header: str, body: bytes, tolerance: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    ts = int(parts["t"])
    if abs(time.time() - ts) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])
```

Node:

```js
import crypto from "node:crypto";

export function verify(secret, header, rawBody, tolerance = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)));
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > tolerance) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.`).update(rawBody).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(parts.v1 ?? "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

### Delivery, retries and disabling

- Respond with any `2xx` within 10 seconds. Anything else (or a timeout) is retried: after **30 s, 2 min, 10 min, 1 h, 6 h** (6 attempts in total), then the delivery is marked `failed`.
- **Redirects are not followed** (a 3xx counts as a failure).
- `410 Gone` disables the endpoint immediately. After **20 consecutive failures** it is disabled and the org's admins get an in-app notification. Re-enable it in Settings after fixing the receiver.
- Delivery history (status, attempts, response code, error) is visible per endpoint.
- Ordering is not guaranteed; deliver idempotently.

### Endpoint requirements (SSRF protection)

Targets must be **public https URLs**. These are rejected: `http://`, `localhost`, private/loopback/link-local/metadata
addresses (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, IPv6 equivalents), hosts ending in `.local`/`.internal`,
URLs containing credentials, and hostnames that resolve to any non-public address. The address is re-checked immediately
before each delivery. For local development set `WEBHOOK_ALLOW_PRIVATE=true` and `WEBHOOK_ALLOW_INSECURE=true`.

### Management API (admin)

```
GET    /orgs/{org}/webhooks                      list
POST   /orgs/{org}/webhooks                      {url, events?, description?}  -> includes "secret" ONCE
PATCH  /orgs/{org}/webhooks/{id}                 {url?, events?, description?, active?}
POST   /orgs/{org}/webhooks/{id}/rotate-secret   -> new "secret" ONCE
POST   /orgs/{org}/webhooks/{id}/test            send a ping
GET    /orgs/{org}/webhooks/{id}/deliveries      recent deliveries
DELETE /orgs/{org}/webhooks/{id}
```

`events` is a list of event names or `["*"]` (default). Up to 10 endpoints per organization.

---

## 2. Public API (read-only)

Create a key in **Settings → Integrations → API keys**. The full key (`ik_<prefix>_<secret>`) is **shown once**; Intervue
stores only a hash. Keys are read-only, tied to your organization, can expire, and stop working when revoked or when the
admin who created them leaves the organization.

```bash
curl https://api.example.com/public/v1/roles -H "Authorization: Bearer ik_1a2b3c4d_xxxxxxxx"
# or: -H "X-API-Key: ik_1a2b3c4d_xxxxxxxx"
```

| Endpoint | Returns |
|---|---|
| `GET /public/v1/me` | organization id/name |
| `GET /public/v1/roles` | roles |
| `GET /public/v1/roles/{id}/rankings?must_haves_met&min_score&offset&limit` | ranked summary cards with evidence quotes |
| `GET /public/v1/candidates` | candidates with stage, score, best-matching role |
| `GET /public/v1/interviews?from&to&role_id&candidate_id` | interviews (free-text titles are not exposed) |
| `GET /public/v1/interviews/{id}/analysis` | latest analysis with citations |

Limits: **600 requests/hour per key** by default (`429` beyond that). Errors use `{ "detail": "...", "code": "..." }`
(`invalid_api_key` for any missing, malformed, revoked or expired key).

Admin endpoints: `GET/POST /orgs/{org}/api-keys`, `DELETE /orgs/{org}/api-keys/{id}`.

---

## 3. Slack

Create an **Incoming Webhook** in Slack for the channel you want, paste the URL (`https://hooks.slack.com/services/...`)
in **Settings → Integrations → Slack**, choose events, and press **Send test**.

- Events: `interview.completed`, `analysis.completed`, `ranking.completed`, `bot.failed`.
- The URL is a secret: stored encrypted, never returned by any API (only its last 4 characters are shown), excluded from
  data exports, and restricted to `hooks.slack.com`.
- Messages contain ids, scores, role names and links, never candidate names.
- If Slack starts rejecting messages, the error is shown in Settings.

Admin endpoints: `GET/PUT/DELETE /orgs/{org}/slack`, `POST /orgs/{org}/slack/test`.

---

## 4. Related compliance features

- **Retention:** recordings, transcripts and speaker data are deleted `data_retention_days` (default 365) after the
  interview, nightly at 03:00 UTC. Notes and analyses are kept; the interview is flagged `transcript_purged`. Cached AI
  results expire after `AI_CACHE_RETENTION_DAYS` (30).
- **Erase a candidate:** `POST /candidates/{id}/erase {"confirm": true}` removes the candidate and everything derived from
  them (files, recordings, transcripts, analyses, scores, calendar copies, cached AI text) and returns a counts-only receipt.
- **Export everything:** `POST /orgs/{org}/exports` (admin) builds a ZIP (JSON per table + original files; recordings
  optional) and `GET /orgs/{org}/exports/latest?download=true` returns a 15-minute link. Secrets are never included.
