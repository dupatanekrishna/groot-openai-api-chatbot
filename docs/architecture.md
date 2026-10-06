# Architecture and request flow

## Design goals

The implementation was designed around five constraints:

1. Keep GitHub Pages as the frontend host.
2. Keep the OpenAI API key server-side.
3. Provide short answers grounded in official documentation.
4. Limit casual abuse and accidental spend.
5. Make the deployment reproducible without coupling the frontend and backend release processes.

## Component topology

~~~mermaid
flowchart TD
    V[Visitor browser] --> P[GitHub Pages portfolio]
    P -->|HTTPS POST /api/chat| W[Cloudflare Worker]
    W -->|Origin and input validation| Q[D1 quota reservation]
    W -->|Server-side API call| O[OpenAI Responses API]
    O --> S[Official documentation web search]
    W -->|answer, sources, quota| P
    W --> C[Scheduled D1 cleanup]
~~~

### Component responsibilities

| Component | Responsibility | Does not own |
| --- | --- | --- |
| Browser widget | Render the chat panel, collect a question, show an answer, display source links and quota status | API credentials, quota truth, generated HTML |
| GitHub Pages | Serve static frontend assets over HTTPS | Server-side code, secrets, persistent state |
| Cloudflare Worker | CORS/origin checks, request validation, quota reservation, OpenAI call, response normalization | Static portfolio publishing |
| Cloudflare D1 | Store salted IP hashes, question counts, and reset timestamps | Raw IP addresses, answer text, API keys |
| OpenAI Responses API | Generate a short answer and search approved documentation domains | Browser access, quota enforcement |
| Wrangler | Authenticate, create resources, apply migrations, upload secrets, and deploy the Worker | Runtime request processing |

## Trust boundaries

### Browser to Worker

The browser sends JSON to the Worker and includes the portfolio Origin header. The Worker compares the value byte-for-byte with the configured ALLOWED_ORIGIN variable. A missing or different origin receives HTTP 403. This is a browser-origin control, not user authentication.

The browser never receives OPENAI_API_KEY or RATE_LIMIT_SALT. The frontend contains only the public Worker URL and public UI code.

### Worker to D1

The Worker hashes the value from CF-Connecting-IP with RATE_LIMIT_SALT before reading or writing D1. The table key is the digest, not the address. The quota reservation is an atomic SQL operation so concurrent requests cannot both pass the final available slot.

### Worker to OpenAI

The Worker sends the validated message history and a server-side system instruction to the OpenAI Responses API. The request requires the web_search tool and restricts search to an allowlist of official documentation domains. The Worker removes URLs from answer text and extracts at most three validated HTTPS source links.

## Request sequence

~~~mermaid
sequenceDiagram
    participant B as Browser
    participant W as Worker
    participant D as D1
    participant A as OpenAI
    B->>W: POST /api/chat + Origin + messages
    W->>W: Validate route, method, origin, body, history
    W->>D: Atomic reserve for salted IP hash
    D-->>W: Count and reset timestamp, or reject
    alt quota rejected
        W-->>B: 429 + quota metadata
    else quota accepted
        W->>A: Responses API + official-domain web search
        A-->>W: Answer text and source annotations
        W->>W: Clean answer and validate source URLs
        W-->>B: 200 + answer + sources + quota
    end
~~~

## Runtime routes

### GET /api/health

Purpose: confirm that the Worker route and configuration are reachable.

Required request header:

~~~http
Origin: https://YOUR_PORTFOLIO_ORIGIN
~~~

Successful response:

~~~json
{
  "mode": "api",
  "model": "gpt-6-luna"
}
~~~

This endpoint does not call OpenAI and does not validate that the D1 binding or secret values are usable.

### GET /api/usage

Purpose: read the current quota state for the calling IP.

Successful response before any question:

~~~json
{
  "questionCount": 0,
  "questionsRemaining": 3,
  "resetAt": null,
  "limit": 3,
  "windowHours": 24
}
~~~

The response does not expose the IP or its hash.

### POST /api/chat

Request:

~~~json
{
  "messages": [
    {
      "role": "user",
      "content": "What is Kubernetes? Explain briefly."
    }
  ]
}
~~~

Successful response shape:

~~~json
{
  "answer": "Short answer grounded in official documentation.",
  "sources": [
    {
      "url": "https://kubernetes.io/docs/concepts/overview/",
      "title": "Overview | Kubernetes"
    }
  ],
  "mode": "api",
  "quota": {
    "questionCount": 1,
    "questionsRemaining": 2,
    "resetAt": 1791381892001,
    "limit": 3,
    "windowHours": 24,
    "finalQuestion": false,
    "limitReached": false
  }
}
~~~

Important status codes:

| Status | Meaning |
| --- | --- |
| 200 | Health, usage, or chat completed |
| 204 | Allowed CORS preflight |
| 400 | Invalid JSON or invalid message history |
| 403 | Origin is not allowed |
| 405 | Wrong HTTP method |
| 413 | Body is larger than 8 KiB |
| 429 | The IP has used all three slots |
| 502 | OpenAI failed or returned an unusable answer |
| 503 | D1 quota state or Worker secret configuration is unavailable |

## Input controls

The Worker applies these limits before making a paid upstream request:

| Control | Value |
| --- | --- |
| Maximum body | 8,192 bytes |
| Maximum characters per message | 500 |
| Maximum history forwarded | 8 messages |
| Accepted roles | user and assistant |
| Required final message | user |
| Quota reservation | before OpenAI |
| OpenAI timeout | 45 seconds |
| Returned answer cap | 2,000 characters |
| Returned sources | maximum 3 |

The local browser also limits the text area and shows a paid-credit reminder. Server validation remains authoritative.

## Official source validation

The current allowlist includes:

- docs.aws.amazon.com
- kubernetes.io
- developer.hashicorp.com
- docs.docker.com
- docs.gitlab.com
- grafana.com
- prometheus.io
- opentelemetry.io
- learn.microsoft.com
- docs.github.com
- datatracker.ietf.org
- rfc-editor.org
- help.zoho.com

The Worker accepts only HTTPS URLs without username or password components. A hostname must exactly match an allowed domain or be a subdomain of one. Duplicate URLs are removed and only the first three are returned.

The search allowlist and the response-source allowlist are separate checks. The first constrains the OpenAI search request; the second protects the browser response even if upstream output changes.

## D1 data model

Migration file: migrations/0001_create_question_limits.sql

~~~sql
CREATE TABLE IF NOT EXISTS ip_question_windows (
  ip_hash TEXT PRIMARY KEY NOT NULL,
  question_count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ip_question_windows_reset_at
  ON ip_question_windows (reset_at);
~~~

The reset_at value is stored as a Unix timestamp in milliseconds. A row remains useful for one active 24-hour window and is retained for up to 30 days so scheduled cleanup can remove stale rows.

## Quota algorithm

1. Read CF-Connecting-IP, or use the literal fallback value unknown when the header is absent.
2. Hash RATE_LIMIT_SALT + colon + IP with SHA-256.
3. Execute one INSERT ... ON CONFLICT ... RETURNING statement.
4. If no row is returned, the existing row has already reached three questions in its active window.
5. If the stored reset time has passed, replace the count with one and start a new window.
6. Otherwise increment the count.
7. Return questionCount, questionsRemaining, resetAt, finalQuestion, and limitReached.

This is a rolling window per stored client identity. It is not a global application-wide quota.

## Scheduled cleanup

The Worker has a daily trigger at 03:00 UTC. Each scheduled run deletes rows whose reset_at is older than 30 days. Chat requests also call the cleanup asynchronously with waitUntil, so a missed scheduled invocation does not stop normal traffic.

Cleanup errors are logged but do not change the answer sent to the visitor.

## Deployment topology

The backend and frontend are released separately:

~~~mermaid
flowchart LR
    G[GitHub PR] -->|merge| H[GitHub Pages]
    H --> F[Static portfolio]
    C[Wrangler deploy] --> W[Cloudflare Worker]
    W --> D[D1 database]
    W --> O[OpenAI API]
    F -->|public HTTPS call| W
~~~

A frontend PR can be reverted without deleting the Worker. A Worker deployment can be rolled back or redeployed without changing the static site. Keep the two release histories linked in change notes.
