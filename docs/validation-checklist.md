# Validation checklist

Use this checklist before merging a frontend change, after deploying a Worker, and after changing secrets or configuration. Record the date, commit, Worker version ID, and observed result in the change note.

## Static checks

- [ ] The Worker source passes Node syntax validation.

~~~sh
node --check worker/src/index.js
~~~

- [ ] The configuration is valid JSON with comments allowed only where Wrangler accepts them.
- [ ] There is exactly one D1 binding for the database.
- [ ] The binding is GROOT_DB.
- [ ] The migration directory exists.
- [ ] No secret, .env file, authorization header, or provider token appears in the diff.
- [ ] The frontend has one data-groot-api-base attribute.
- [ ] The frontend script and stylesheet paths resolve.
- [ ] Widget element IDs are unique.
- [ ] Generated answer text uses textContent rather than HTML injection.

## Local UI checks

- [ ] The local server starts on 127.0.0.1:4173.
- [ ] The page loads without a console error.
- [ ] The chat panel opens and closes.
- [ ] The welcome state renders.
- [ ] A mock question returns a visible answer.
- [ ] A source card can be opened.
- [ ] The paid-credit reminder appears under an answer.
- [ ] The final-question notice appears at the third accepted request.
- [ ] The input disables after the quota is reached.
- [ ] The layout remains usable on a narrow mobile viewport.
- [ ] Control-C stops the local server cleanly.

## Cloudflare checks

- [ ] Wrangler is authenticated to the intended account.

~~~sh
npx wrangler@latest whoami
~~~

- [ ] The Worker name is correct.
- [ ] The D1 database name and ID are correct.
- [ ] The remote migration is applied.

~~~sh
npx wrangler@latest d1 migrations list groot-usage --remote
~~~

- [ ] OPENAI_API_KEY is uploaded as a secret.
- [ ] RATE_LIMIT_SALT is uploaded as a secret.
- [ ] The Worker deploy completes.
- [ ] The output lists GROOT_DB, OPENAI_MODEL, and ALLOWED_ORIGIN.
- [ ] The cleanup cron appears in the output.

## API checks

Set the actual values:

~~~sh
WORKER_URL="https://YOUR_WORKER_SUBDOMAIN.workers.dev"
PORTFOLIO_ORIGIN="https://YOUR_PORTFOLIO_ORIGIN"
~~~

- [ ] Health returns HTTP 200.

~~~sh
curl -i -H "Origin: $PORTFOLIO_ORIGIN" "$WORKER_URL/api/health"
~~~

- [ ] Health returns the expected model.
- [ ] Access-Control-Allow-Origin is the exact portfolio origin.
- [ ] Usage returns a quota object.

~~~sh
curl -sS -H "Origin: $PORTFOLIO_ORIGIN" "$WORKER_URL/api/usage"
~~~

- [ ] One real chat call returns answer, sources, mode, and quota.

~~~sh
curl -sS --max-time 90 \
  "$WORKER_URL/api/chat" \
  -H "Origin: $PORTFOLIO_ORIGIN" \
  -H "Content-Type: application/json" \
  --data '{"messages":[{"role":"user","content":"What is Kubernetes? Explain briefly with an official documentation link."}]}'
~~~

- [ ] Source URLs are HTTPS and belong to the official allowlist.
- [ ] Answer text does not include raw URLs.
- [ ] questionCount increments by one.
- [ ] questionsRemaining decrements by one.
- [ ] The third accepted response sets finalQuestion to true.
- [ ] A fourth request from the same IP returns HTTP 429.
- [ ] The fourth request does not call OpenAI.

## Negative API checks

- [ ] A different Origin returns HTTP 403.
- [ ] Missing Origin returns HTTP 403.
- [ ] A wrong method returns HTTP 405.
- [ ] Invalid JSON returns HTTP 400.
- [ ] A body larger than 8 KiB returns HTTP 413.
- [ ] A history ending with an assistant message returns HTTP 400.
- [ ] A URL outside the official allowlist is not returned.
- [ ] A missing D1 binding produces a safe 503 rather than a provider call.

## Browser production checks

- [ ] GitHub Pages is serving the new commit.
- [ ] The browser page loads over HTTPS.
- [ ] The widget calls the current Worker URL.
- [ ] The browser Network panel contains no API key.
- [ ] The browser Console has no CORS or script errors.
- [ ] The answer and sources render correctly.
- [ ] The quota notice appears.
- [ ] The frontend still works after a hard refresh.
- [ ] The mobile layout does not cover the portfolio navigation.

## Operational checks

- [ ] The Worker version ID is recorded.
- [ ] The GitHub frontend commit or PR is recorded.
- [ ] Provider spend limits are configured.
- [ ] A short Worker tail session shows no unexpected error.
- [ ] The rollback path is known for both frontend and backend.
- [ ] Secret rotation steps are documented.
- [ ] No raw IP address is present in the D1 table.
- [ ] The migration list has no unexpected pending item.
