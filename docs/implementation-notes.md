# Implementation notes

This page records the concrete implementation choices made during the first working deployment. It is intentionally more specific than the architecture overview so that another operator can compare a rebuild with the known-good shape.

## Worker configuration

The deployed Worker used this configuration, with the database ID filled after D1 creation:

~~~json
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "groot-api",
  "main": "src/index.js",
  "compatibility_date": "2026-10-06",
  "workers_dev": true,
  "observability": {
    "enabled": true
  },
  "vars": {
    "OPENAI_MODEL": "gpt-6-luna",
    "ALLOWED_ORIGIN": "https://krishna.dupatane.portfolio.dkalki.com"
  },
  "d1_databases": [
    {
      "binding": "GROOT_DB",
      "database_name": "groot-usage",
      "database_id": "YOUR_DATABASE_ID",
      "migrations_dir": "migrations"
    }
  ],
  "triggers": {
    "crons": ["0 3 * * *"]
  }
}
~~~

The live D1 ID in the first account was b5442bd1-c7aa-4345-b961-d005bf652fd5. Treat that as a deployment record, not as a value to copy into a different account.

The binding is uppercase GROOT_DB because the source code uses env.GROOT_DB. An earlier configuration attempt added a second binding with a different name for the same database. The final configuration kept one binding only.

## Worker constants

The Worker source defines:

| Constant | Value | Reason |
| --- | --- | --- |
| QUESTION_LIMIT | 3 | Small public quota |
| WINDOW_MS | 24 hours | Rolling client window |
| RETAIN_AFTER_RESET_MS | 30 days | Cleanup retention |
| MAX_BODY_BYTES | 8,192 | Request size guard |
| MAX_MESSAGE_CHARS | 500 | Prompt size and UI guard |
| MAX_HISTORY_MESSAGES | 8 | Bound forwarded context |
| OpenAI timeout | 45 seconds | Avoid hanging requests |
| Answer cap | 2,000 characters | Keep browser response compact |

The system instruction asks for a friendly, short DevOps explanation, at most three bullets or three brief sentences, with factual claims supported by official documentation search. It instructs the model not to invent links and not to put URLs in answer text because the frontend renders source links separately.

## OpenAI request shape

The Worker calls:

~~~text
POST https://api.openai.com/v1/responses
Authorization: Bearer value-from-secret
Content-Type: application/json
~~~

The JSON includes:

~~~json
{
  "model": "gpt-6-luna",
  "instructions": "server-side Groot system instruction",
  "input": "validated user and assistant message array",
  "tools": [
    {
      "type": "web_search",
      "search_context_size": "low",
      "filters": {
        "allowed_domains": ["official domains"]
      }
    }
  ],
  "tool_choice": "required",
  "max_output_tokens": 260,
  "include": ["web_search_call.action.sources"]
}
~~~

The key is read only from the Worker secret named OPENAI_API_KEY. The model name is a non-secret variable so it can be changed without touching the key.

## Response normalization

The Worker extracts output_text items from message output. It collects source annotations and web-search source results, then:

1. Removes Markdown links from answer text.
2. Removes remaining URL-looking text.
3. Trims whitespace and limits the answer to 2,000 characters.
4. Validates each source as an HTTPS URL.
5. Rejects credentials embedded in the URL.
6. Checks the hostname against the official-domain allowlist.
7. Removes duplicates.
8. Returns at most three source objects.

If the upstream response has no usable answer or no validated source, the Worker returns a safe verification message with an empty source list. It does not invent a citation.

## Frontend contract

The portfolio root element contains:

~~~html
<html
  lang="en"
  data-groot-api-base="https://groot-api.support-dupatane.workers.dev">
~~~

The browser sends:

~~~http
POST /api/chat
Origin: https://krishna.dupatane.portfolio.dkalki.com
Content-Type: application/json
~~~

~~~json
{
  "messages": [
    {
      "role": "user",
      "content": "What is a Kubernetes Service?"
    }
  ]
}
~~~

The frontend reads:

- answer
- sources[].url
- sources[].title
- mode
- quota.questionCount
- quota.questionsRemaining
- quota.finalQuestion
- quota.limitReached
- quota.resetAt

The frontend creates answer text with textContent. Source links use safe DOM properties and the source URLs already validated by the Worker. It does not inject generated HTML.

## User experience details

- The widget label reports a live answer mode backed by official documentation.
- The panel shows Groot's avatar, a short welcome message, a text area, and a submit button.
- A connecting state is shown while the health request runs.
- A credit reminder is rendered beneath assistant responses.
- The third accepted request displays a last-question notice.
- When the limit is reached, the input and send button are disabled.
- The widget reports a simple retry message for 502 or 503 responses without exposing implementation details.
- Mobile rules keep the panel within the viewport and preserve the existing portfolio styles.

## Local versus live behaviour

| Concern | Local Node prototype | Cloudflare deployment |
| --- | --- | --- |
| Host | 127.0.0.1:4173 | workers.dev URL |
| Quota storage | In-memory map | D1 |
| Restart effect | Quota resets | Quota persists |
| OpenAI key | Local .env file | Wrangler Worker secret |
| Search mode | Mock by default, optional live API mode | Live Responses API |
| Publishing | None | Wrangler and GitHub Pages |
| Main purpose | UI and contract checks | Public service |

The local server binds to 127.0.0.1 and is not a production backend.

## Deployment record

The first deployment followed this order:

1. Wrangler device login completed after the browser OAuth callback failed.
2. D1 database groot-usage was created in the APAC region.
3. The schema migration 0001_create_question_limits.sql was applied remotely.
4. The duplicate D1 configuration entry was removed and the binding was standardized as GROOT_DB.
5. OPENAI_API_KEY was uploaded as a Worker secret.
6. RATE_LIMIT_SALT was generated with OpenSSL and uploaded as a Worker secret.
7. Worker groot-api deployed at the workers.dev endpoint.
8. Health and CORS were tested with curl.
9. A real Kubernetes question returned an answer, official sources, and quota metadata.
10. The portfolio frontend integration was prepared in a separate PR.

## Files that belong in a reusable implementation

The reusable source package should contain:

- worker/src/index.js
- worker/migrations/0001_create_question_limits.sql
- worker/wrangler.jsonc.example
- worker/package.json
- examples/frontend-integration.html
- examples/frontend-contract.md

Do not copy the live wrangler.jsonc file into a public repository if it contains account-specific identifiers that should remain private. Do not copy .env, Worker secret output, or local Wrangler authentication files.
