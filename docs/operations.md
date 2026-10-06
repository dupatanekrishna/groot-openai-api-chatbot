# Operations, security, cost, and rollback

This page is the operating runbook after the first successful deployment.

## Daily operating model

There are two independent release surfaces:

| Surface | Tool | Typical change |
| --- | --- | --- |
| Worker backend | Wrangler | Source, model variable, allowlist, migration, secret |
| Static frontend | GitHub pull request and Pages | HTML, CSS, JavaScript, image, Worker URL |

Make one change at a time when possible. Record the Worker version ID and frontend commit in the change description so a later rollback has a clear target.

## Secrets

The Worker uses two secrets:

| Secret | Purpose | Rotation effect |
| --- | --- | --- |
| OPENAI_API_KEY | Authenticates server-side OpenAI calls | New requests use the new key |
| RATE_LIMIT_SALT | Prevents raw IP storage and makes hashes difficult to precompute | Existing quota identities no longer match |

Upload or rotate a key:

~~~sh
npx wrangler@latest secret put OPENAI_API_KEY --name groot-api
~~~

Rotate the salt only when necessary:

~~~sh
openssl rand -hex 32 | npx wrangler@latest secret put RATE_LIMIT_SALT --name groot-api
~~~

After either operation, send a health request and one controlled chat request. A secret change does not require a source-code commit, but it should be recorded in the deployment log without recording the value.

If a key is suspected to be exposed:

1. Revoke it in the OpenAI platform immediately.
2. Create a replacement key.
3. Upload the replacement to the Worker.
4. Confirm a controlled chat call.
5. Search the Git history, shell history, screenshots, and issue comments for the exposed value.
6. Remove the value from any accidental commit and rotate again if it was ever pushed.

Changing a GitHub file alone does not revoke a provider key.

## Wrangler authentication

The device flow is the recovery path when the browser OAuth callback fails:

~~~sh
npx wrangler@latest login --device
npx wrangler@latest whoami
~~~

The login authorization belongs to the local Wrangler profile, not to the repository. Logging out or removing the local profile does not delete the Worker or D1 database.

## Logs and observability

The configuration enables Worker observability. For a short live diagnostic session:

~~~sh
npx wrangler@latest tail groot-api
~~~

Stop tailing with Control-C. Avoid sharing logs publicly if they contain request details or operational metadata.

The source logs only high-level failure categories:

- Quota lookup failed
- Quota reservation failed
- Quota cleanup failed
- OpenAI returned a non-success status
- Chat request failed

The Worker does not log the API key, raw IP address, prompt contents, or generated answer.

## Health checks

Run the following after each backend deployment:

~~~sh
WORKER_URL="https://YOUR_WORKER_SUBDOMAIN.workers.dev"
PORTFOLIO_ORIGIN="https://YOUR_PORTFOLIO_ORIGIN"

curl -i \
  -H "Origin: $PORTFOLIO_ORIGIN" \
  "$WORKER_URL/api/health"

curl -sS \
  -H "Origin: $PORTFOLIO_ORIGIN" \
  "$WORKER_URL/api/usage"
~~~

The health endpoint proves route reachability and returns the model variable. The usage endpoint proves that the rate-limit salt and D1 binding can be used for the calling IP. Only a real chat request proves the OpenAI key and web-search call.

## Spend controls

Use multiple layers:

1. OpenAI project budget or spend limit.
2. Worker per-IP quota.
3. Short prompt and history limits.
4. Required official-domain web search.
5. Low search context size.
6. Short output token limit.
7. Monitoring and alerts in provider dashboards.

The three-question rule is not an exact cost ceiling. Different IPs, VPNs, shared networks, automated clients, and provider-side retries can change total usage. If the bot becomes public or receives meaningful traffic, add stronger controls such as authenticated sessions, a global budget counter, or a separate gateway.

Cloudflare and OpenAI have separate billing accounts. A free Cloudflare plan does not make OpenAI API calls free, and an OpenAI subscription does not pay for Cloudflare resources.

## Quota semantics

- The slot is reserved before calling OpenAI.
- A 502 or 503 after reservation still consumes the slot.
- A malformed request is rejected before reservation.
- A 403 origin failure is rejected before reservation.
- A request after the third accepted slot returns 429 and does not call OpenAI.
- Shared NAT addresses share one quota.
- A changed salt makes every visitor appear new.
- A row is deleted after the 30-day retention threshold, not exactly at the 24-hour reset.

This behaviour protects spend during upstream failures but should be explained to users as a simple rolling limit.

## D1 maintenance

List migrations:

~~~sh
npx wrangler@latest d1 migrations list groot-usage --remote
~~~

Apply pending migrations:

~~~sh
npx wrangler@latest d1 migrations apply groot-usage --remote
~~~

Never edit production rows just to make a demo pass. If the schema must change, add a new migration with a new number, test it against a disposable database, then apply it remotely.

## Frontend release procedure

1. Create a feature branch in the portfolio repository.
2. Make the smallest change that connects or updates the widget.
3. Run git diff --check and local browser tests.
4. Confirm the Worker URL and origin values match.
5. Search the diff for OPENAI_API_KEY, RATE_LIMIT_SALT, .env, and authorization headers.
6. Open a pull request into the publishing branch.
7. Review the changed files and checks.
8. Merge only after the repository review policy is satisfied.
9. Wait for GitHub Pages to publish.
10. Run the public-site acceptance checklist.

## Backend release procedure

1. Create a Worker feature branch or a local reviewed change.
2. Run node --check src/index.js.
3. Review the configuration diff and migration list.
4. Apply a migration only when the migration is required.
5. Deploy with Wrangler.
6. Record the version ID.
7. Run health, CORS, usage, and one controlled chat check.
8. Watch a short tail session if the change affects failure handling.
9. Update the documentation with the reason and observed result.

## Rollback

### Frontend rollback

Use the GitHub pull request page to revert the merged frontend PR, or restore the previous commit through a new reviewed PR. This changes only GitHub Pages assets. The Worker remains deployed.

### Worker rollback

Keep the last known-good source commit and configuration. Redeploy that source with Wrangler after checking that:

- The database schema is compatible.
- The secret names are unchanged.
- The allowed origin remains correct.
- The rollback does not remove a required security fix.

Do not roll back a migration by deleting a table. Write a forward migration if the schema needs correction.

### Emergency stop

If the bot must stop immediately:

1. Remove or disable the frontend chat entry point through a reviewed site change.
2. Remove the Worker route from the frontend configuration.
3. Revoke the OpenAI key if spend or exposure is suspected.
4. Inspect Worker logs and provider usage.
5. Preserve the D1 database for analysis until the incident is understood.

## Privacy and data minimization

The intended persistent data is limited to:

- A salted SHA-256 IP hash.
- A question count.
- A reset timestamp.

The Worker does not intentionally persist question text, answers, or source links. Provider logs and platform observability may have their own retention policies; review those settings before treating the system as suitable for sensitive questions.

Do not present this public bot as a confidential channel. Add a visible notice if users might submit personal, financial, health, or proprietary data.
