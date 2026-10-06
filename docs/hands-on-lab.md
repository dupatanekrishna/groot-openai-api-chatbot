# Hands-on rebuild lab

This procedure rebuilds the Groot backend and connects it to a static portfolio. It is written for macOS or Linux and assumes the operator owns the Cloudflare account, the OpenAI API project, and the GitHub Pages repository.

The lab intentionally separates local testing from production deployment:

- Local mode proves the UI and request shape without publishing anything.
- Cloudflare mode proves the server-side key handling, D1 quota, CORS, and real upstream call.
- GitHub mode publishes only the reviewed frontend change.

## 1. Prerequisites

Install or prepare:

- macOS or Linux terminal
- Node.js 20 or newer
- npm
- OpenSSL
- Git
- A Cloudflare account
- An OpenAI API project with billing configured
- A GitHub repository that publishes a static site
- A verified site origin, such as https://krishna.dupatane.portfolio.dkalki.com

Check the local tools:

~~~sh
node --version
npm --version
openssl version
git --version
~~~

Do not use a ChatGPT subscription key for server API calls. Create or use an OpenAI API key from the API platform and configure a project-level spending limit.

## 2. Clone the documentation repository

~~~sh
git clone https://github.com/YOUR_GITHUB_USER/groot-openai-api-chatbot.git
cd groot-openai-api-chatbot
~~~

The repository contains a worker source directory, an example configuration, migration SQL, and this documentation. Start with the files under worker.

## 3. Understand the source layout

~~~text
groot-openai-api-chatbot/
├── README.md
├── worker/
│   ├── migrations/
│   │   └── 0001_create_question_limits.sql
│   ├── src/
│   │   └── index.js
│   ├── package.json
│   └── wrangler.jsonc.example
├── examples/
│   ├── frontend-integration.html
│   ├── frontend-contract.md
│   ├── groot-chat.css
│   └── groot-chat.js
└── docs/
    ├── architecture.md
    ├── hands-on-lab.md
    ├── implementation-notes.md
    ├── operations.md
    ├── troubleshooting.md
    ├── validation-checklist.md
    └── questions-and-additions.md
~~~

The Worker source has no account-specific secret value. The example Wrangler file has a database ID placeholder and must be copied to a local file before deployment.

## 4. Run the local prototype first

If you already have the portfolio prototype, work from its local project directory:

~~~sh
cd /path/to/portfolio_v2-groot-local
node server.mjs
~~~

Open http://127.0.0.1:4173/ and select Ask Groot.

The default local mode uses sample replies and does not call OpenAI. It is useful for verifying that the widget opens, messages render, buttons disable correctly, and quota notices appear.

To try a real local call:

1. Copy the environment template.
2. Set the key in the local environment file.
3. Set mock mode to false.
4. Restart the server.

~~~sh
cp .env.example .env
nano .env
node server.mjs
~~~

The environment file must remain local and must be ignored by Git. Never paste its contents into a repository, issue, screenshot, or chat message.

Stop the server with Control-C.

## 5. Create the Worker working copy

From the cloned documentation repository:

~~~sh
cd worker
cp wrangler.jsonc.example wrangler.jsonc
~~~

Edit only the account-specific values:

- name: use a unique Worker name.
- main: keep src/index.js.
- compatibility_date: use the date chosen for the deployment.
- ALLOWED_ORIGIN: set the exact public portfolio origin, including scheme and without a trailing slash.
- database_id: replace the placeholder after D1 creation.

The binding name must be GROOT_DB because the Worker source reads env.GROOT_DB. Do not add a second D1 entry with another binding name for the same database.

## 6. Authenticate Wrangler

The normal browser OAuth flow can fail when the localhost callback cookie is blocked or the browser session is stale. The device flow avoids that callback:

~~~sh
npx wrangler@latest login --device
~~~

Follow the displayed device URL and code. Approve only the Cloudflare permissions required for this Worker and D1 workflow. Return to the terminal and wait for the success message.

Confirm the active account:

~~~sh
npx wrangler@latest whoami
~~~

If the browser flow was attempted earlier and failed with a timeout or CSRF message, start a fresh terminal command using the device flow. Do not paste OAuth authorization codes into chat or into a file.

## 7. Create the D1 database

Create the remote database once:

~~~sh
npx wrangler@latest d1 create groot-usage
~~~

Wrangler prints a JSON snippet containing the database name and database ID. Copy only the database ID into the local wrangler.jsonc file.

Example configuration:

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
    "ALLOWED_ORIGIN": "https://YOUR_PORTFOLIO_ORIGIN"
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

Use the remote database for the first deployment. A local D1 binding is useful for isolated development, but it is not the same state as the production database.

## 8. Apply the migration remotely

~~~sh
npx wrangler@latest d1 migrations apply groot-usage --remote
~~~

Review the migration list before confirming. The expected first migration is 0001_create_question_limits.sql. The successful output reports that the migration was executed on the remote database.

The migration creates:

- ip_question_windows with ip_hash, question_count, and reset_at.
- An index on reset_at for cleanup.

Do not manually edit a production table to fix a schema change. Add a numbered migration and apply it through Wrangler.

## 9. Upload secrets

Upload the OpenAI key through Wrangler. The terminal input is hidden:

~~~sh
npx wrangler@latest secret put OPENAI_API_KEY --name groot-api
~~~

Generate a separate random salt and pipe it directly into Wrangler:

~~~sh
openssl rand -hex 32 | npx wrangler@latest secret put RATE_LIMIT_SALT --name groot-api
~~~

The salt must be kept stable during normal operation. Rotating it resets the effective quota identity for every visitor because old hashes no longer match. Rotate only deliberately:

~~~sh
openssl rand -hex 32 | npx wrangler@latest secret put RATE_LIMIT_SALT --name groot-api
~~~

Never use echo to print a secret, never put the key in vars, and never add it to frontend JavaScript.

## 10. Deploy the Worker

~~~sh
npx wrangler@latest deploy
~~~

Wrangler prints the Worker URL, bindings, triggers, upload size, and version ID. Record the URL in the deployment notes, but do not record secret values.

The first deployment used:

~~~text
https://groot-api.support-dupatane.workers.dev
~~~

For a different account, use the URL printed by Wrangler rather than copying this value.

## 11. Verify the backend before touching the website

Set shell variables to the actual Worker URL and portfolio origin:

~~~sh
WORKER_URL="https://YOUR_WORKER_SUBDOMAIN.workers.dev"
PORTFOLIO_ORIGIN="https://YOUR_PORTFOLIO_ORIGIN"
~~~

Health check:

~~~sh
curl -i \
  -H "Origin: $PORTFOLIO_ORIGIN" \
  "$WORKER_URL/api/health"
~~~

Expected result:

- HTTP 200
- Access-Control-Allow-Origin equal to the portfolio origin
- JSON containing mode api and the configured model

Usage check:

~~~sh
curl -sS \
  -H "Origin: $PORTFOLIO_ORIGIN" \
  "$WORKER_URL/api/usage"
~~~

Real chat check:

~~~sh
curl -sS --max-time 90 \
  "$WORKER_URL/api/chat" \
  -H "Origin: $PORTFOLIO_ORIGIN" \
  -H "Content-Type: application/json" \
  --data '{"messages":[{"role":"user","content":"What is Kubernetes? Explain briefly with an official documentation link."}]}'
~~~

Expected result:

- JSON answer text
- One or more HTTPS sources from the official allowlist
- mode api
- quota questionCount, questionsRemaining, resetAt, limit, windowHours, finalQuestion, and limitReached

The first deployment returned a Kubernetes answer, official kubernetes.io links, and questionCount 1 with questionsRemaining 2.

## 12. Negative backend checks

Wrong origin must be rejected:

~~~sh
curl -i \
  -H "Origin: https://example.invalid" \
  "$WORKER_URL/api/health"
~~~

Expected result: HTTP 403 with Origin not allowed.

Wrong method must be rejected:

~~~sh
curl -i \
  -X POST \
  -H "Origin: $PORTFOLIO_ORIGIN" \
  "$WORKER_URL/api/health"
~~~

Expected result: HTTP 405.

Do not use repeated real questions just to test the 429 path unless you accept the quota slots being consumed. Use a second test IP or a controlled D1 test environment when available.

## 13. Connect the static frontend

In the portfolio index.html file, set the root attribute to the deployed Worker URL:

~~~html
<html lang="en" data-groot-api-base="https://YOUR_WORKER_SUBDOMAIN.workers.dev">
~~~

The widget JavaScript reads this attribute. It should not contain an API key.

Add the widget assets:

~~~html
<link rel="stylesheet" href="groot-chat.css">
<script src="groot-chat.js" defer></script>
~~~

Place the widget markup before the closing body tag. Use the checked example in examples/frontend-integration.html as a starting point, then adapt the surrounding portfolio styles.

The frontend must:

- Use textContent for generated answer text.
- Create source links only from the validated source objects returned by the Worker.
- Disable the input when the quota is exhausted.
- Show the final-question notice when quota.finalQuestion is true.
- Keep the credit reminder under answers.
- Preserve the existing portfolio layout on desktop and mobile.

## 14. Publish the frontend through a pull request

From the portfolio repository:

~~~sh
git switch -c feat/groot-chat-widget
git status
git diff --check
git add index.html groot-chat.css groot-chat.js assets/groot-avatar.webp
git commit -m "Add Groot chat widget connected to Cloudflare backend"
git push -u origin feat/groot-chat-widget
~~~

Open a pull request into the publishing branch. Review the changed files, the Worker URL, the asset paths, and the absence of secrets. Wait for the site checks to pass, then merge according to the repository's review policy.

After GitHub Pages publishes:

~~~sh
curl -I https://YOUR_PORTFOLIO_ORIGIN/
~~~

Open the site in a private browser window, open Ask Groot, and submit one short question. Browser developer tools should show a request to the Worker URL and no request containing an OpenAI key.

## 15. Reproduce the deployment for another site

For another portfolio, change only:

1. ALLOWED_ORIGIN in the Worker configuration.
2. The data-groot-api-base attribute in the frontend.
3. The Worker name if the same Cloudflare account needs a separate deployment.
4. The official-domain allowlist and prompt if the product scope is different.
5. The image and visual styles.

Keep the same request contract, migration, secret names, and validation checklist unless the new product has a documented reason to change them.

## 16. Safe cleanup

Do not delete live resources as part of ordinary testing. If the deployment is a disposable experiment, first record the Worker name and database ID, then verify that no other site uses them. Use the Cloudflare dashboard or Wrangler's delete commands only after confirming the exact resource names.

Before deleting:

- Remove the frontend Worker URL or publish a rollback.
- Export any needed D1 data.
- Revoke the OpenAI key if it is no longer needed.
- Remove the Worker secrets.
- Confirm that no DNS record or production workflow points at the resource.

## 17. Reproduction checklist

The rebuild is complete only when:

- The Worker deploys without a key in source control.
- The remote D1 migration is applied.
- Health returns 200 with correct CORS.
- Usage returns a quota object.
- One real chat call returns official sources.
- Wrong origins return 403.
- The third accepted question sets finalQuestion to true.
- Further requests return 429 without an OpenAI call.
- The frontend renders source links safely.
- GitHub Pages publishes the frontend change.
- The operator can explain how to rotate the key, rotate the salt, inspect logs, and roll back.
