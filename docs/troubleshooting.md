# Troubleshooting guide

Use this page in order: identify which layer failed, run a read-only check, then change the smallest relevant setting.

## First identify the layer

| Symptom | Most likely layer |
| --- | --- |
| The widget is missing | GitHub Pages HTML, CSS, or JavaScript |
| The widget says it cannot connect | Worker URL, CORS, or deployment |
| Health returns 403 | Origin value mismatch |
| Health returns 200 but chat returns 503 | D1 or secret configuration |
| Chat returns 502 | OpenAI request, model, web search, or timeout |
| Chat returns 429 | The calling IP used all three slots |
| The page is old after merging | GitHub Pages build or browser cache |
| Wrangler asks for a Worker name | Wrong directory or missing configuration |
| Login opens a browser but times out | OAuth callback issue |

## Wrangler command is running from the wrong directory

The Worker configuration must be available in the current directory. Check:

~~~sh
pwd
find .. -maxdepth 3 -name wrangler.jsonc -print
~~~

Move into the directory containing wrangler.jsonc, or pass the Worker name explicitly:

~~~sh
npx wrangler@latest deploy --name groot-api
~~~

Do not assume the Worker directory is nested inside the frontend directory. In the first local project, the correct path was a sibling folder selected from the actual project layout, not a path invented from the repository name.

## OAuth timeout or CSRF error

Observed symptoms:

- Attempting to login via OAuth.
- Waiting for localhost:8976 callback.
- Timed out waiting for authorization code.
- Request forbidden: no CSRF value available in the session cookie.

Recovery:

~~~sh
npx wrangler@latest login --device
~~~

Complete the device approval in the browser and return to the same terminal. The device flow avoids the localhost callback cookie path.

Do not retry by pasting a callback URL or authorization code into a script.

## Wrangler says the Worker name is missing

This usually means the command is not running beside the intended configuration file or the file is named differently.

Checks:

~~~sh
pwd
ls -la
npx wrangler@latest deploy --dry-run
~~~

Fix the directory or use:

~~~sh
npx wrangler@latest secret put OPENAI_API_KEY --name groot-api
~~~

The explicit name is helpful for secret commands, but it does not replace a valid source and binding configuration for deploy.

## Duplicate D1 binding

Symptoms:

- The configuration contains two entries for the same database.
- One uses GROOT_DB and another uses groot_usage.
- Wrangler shows duplicate resources or the source reads a missing binding.

Fix:

1. Keep one d1_databases entry.
2. Set binding to GROOT_DB.
3. Keep database_name as groot-usage.
4. Keep the correct database ID.
5. Keep migrations_dir as migrations.
6. Run a dry-run and deploy again.

The binding name is a code contract. The source uses env.GROOT_DB, so a different name is not interchangeable.

## Migration prompt or wrong database

Before applying:

~~~sh
npx wrangler@latest d1 migrations list groot-usage --remote
~~~

Apply only after checking the database name and ID:

~~~sh
npx wrangler@latest d1 migrations apply groot-usage --remote
~~~

If the command says the resource is local, add --remote. If it shows a different database, stop and correct wrangler.jsonc before confirming.

## Health returns HTTP 403

The Worker requires an exact Origin match.

Compare:

- The browser site origin.
- ALLOWED_ORIGIN in wrangler.jsonc.
- The Origin header used by curl.

These are different:

~~~text
https://example.com
https://example.com/
http://example.com
https://www.example.com
~~~

Set the value to the actual origin including scheme, without a trailing slash. Redeploy after changing a vars value.

## Health returns 200 but the browser cannot connect

Check:

1. The index.html data-groot-api-base value points to the current Worker URL.
2. The page is using HTTPS.
3. The browser request contains the expected Origin header.
4. The published page includes the new JavaScript and CSS files.
5. The Worker endpoint opens with curl.
6. The browser is not serving a stale cached page.

Use browser developer tools Network and Console panels. A direct address-bar visit may not include an Origin header and can be rejected by design; that does not mean the browser site is broken.

## Chat returns HTTP 503

There are two common 503 paths:

### Quota state unavailable

The Worker could not read or reserve D1, or RATE_LIMIT_SALT is missing.

Check:

~~~sh
npx wrangler@latest d1 migrations list groot-usage --remote
npx wrangler@latest tail groot-api
~~~

Confirm the secret exists through the Cloudflare dashboard or by re-running the secret command without displaying its value. Confirm the Worker has a GROOT_DB binding.

### Answer service not configured

The quota slot was reserved but OPENAI_API_KEY was not available to the Worker.

Upload the secret again:

~~~sh
npx wrangler@latest secret put OPENAI_API_KEY --name groot-api
~~~

Then run one controlled chat test. The consumed slot remains consumed by design.

## Chat returns HTTP 502

Possible causes:

- Invalid or revoked OpenAI key.
- Model unavailable to the account.
- OpenAI API error.
- Web search tool error.
- Upstream response exceeded the 45-second timeout.
- Upstream response contained no usable answer or allowed source.

Check the tail output and the provider usage page. Do not print the API key while debugging.

The Worker returns a generic message to the browser so provider details are not exposed to visitors.

## Chat returns HTTP 429

This means the salted identity already used three accepted slots in the current 24-hour window. It is expected after the third accepted request.

The response includes:

- limit
- questionCount
- questionsRemaining
- resetAt
- finalQuestion
- limitReached

Do not delete D1 rows just to bypass a test. Use a separate test environment or wait for the reset timestamp.

## Answers have no links

The Worker intentionally returns a safe verification message when it cannot collect an allowed official source. Check:

1. The official-domain allowlist.
2. The OpenAI web-search tool configuration.
3. The response annotations in the tail output.
4. The requested topic has an official documentation site.

Do not weaken source validation by accepting arbitrary domains without documenting the reason.

## The widget renders unsafe or broken text

The frontend should use textContent for answer text and create source anchors through DOM properties. Do not turn generated answer text into innerHTML.

Check:

- The current groot-chat.js is loaded.
- There is one unique element ID for each widget control.
- The response parser handles an empty sources array.
- Source URLs are set only from Worker sources.
- Error responses are shown as plain text.

## Site still shows the old version

Check the release path:

1. The PR merged into the branch that GitHub Pages publishes.
2. The Pages workflow completed successfully.
3. The new commit is visible on the publishing branch.
4. The browser cache is cleared or a private window is used.
5. Asset paths are relative to the published site.

The Worker deployment does not publish frontend files. A successful Wrangler deploy cannot update GitHub Pages by itself.

## GitHub PR says a review is required

If the repository requires an approval from another user with write access, the PR author cannot self-approve it. Options:

- Ask a trusted collaborator with write access to review and approve.
- Change the repository rule intentionally if this is a solo repository and the risk is understood.
- Keep the PR open until a reviewer is available.

Do not bypass a protection rule accidentally. The purpose of the PR is to preserve review and rollback.

## Secret accidentally appeared in a commit

Treat it as compromised:

1. Revoke the OpenAI key immediately.
2. Rotate the key and upload a replacement.
3. Rotate RATE_LIMIT_SALT if it was exposed.
4. Remove the secret from the latest branch and history as appropriate.
5. Check shell history, issue comments, screenshots, logs, and copied snippets.
6. Add the filename and pattern to ignore rules.

Removing a secret from the current file does not make an already-pushed key safe.

## Local shell variable confusion

These commands print a variable name, not its value:

~~~sh
echo OPENAI_API_KEY
~~~

This prints the value only if the variable is set:

~~~sh
echo "$OPENAI_API_KEY"
~~~

Avoid both for real secrets. Use Wrangler's hidden prompt or a pipe from OpenSSL for the salt.

## When a resource looks missing

Verify the exact account and region in the Cloudflare dashboard. A Worker or D1 database may exist in one account while Wrangler is authenticated to another. Run whoami and check the resource name before recreating anything. Recreating a database can create a second state and confuse the deployment.
