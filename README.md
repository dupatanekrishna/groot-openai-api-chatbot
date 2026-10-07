# Groot OpenAI API Chatbot

Reproducible documentation for a small production-style AI chatbot connected to a static portfolio.

Groot is a friendly DevOps assistant embedded in a GitHub Pages website. The browser renders the chat widget, a Cloudflare Worker owns the API boundary, Cloudflare D1 stores quota state, and the OpenAI Responses API supplies short answers grounded in official documentation.

This repository is the long-term runbook for rebuilding the system. It records the decisions, commands, configuration, checks, failure modes, and rollback steps used to create the working deployment.

## What was built

The system has two separately deployed parts:

1. A static frontend in the portfolio repository. GitHub Pages serves the HTML, CSS, JavaScript, and Groot image.
2. A server-side API in Cloudflare Workers. The Worker keeps the OpenAI key out of the browser, validates the requesting origin, enforces a three-question rolling limit per IP, calls the OpenAI Responses API with official-domain web search, and returns an answer plus up to three validated source links.

The current live resources used during the first deployment were:

| Resource | Value |
| --- | --- |
| Portfolio origin | <https://krishna.dupatane.portfolio.dkalki.com> |
| Worker endpoint | <https://groot-api.support-dupatane.workers.dev> |
| Worker name | **groot-api** |
| D1 database | **groot-usage** |
| D1 binding | **GROOT_DB** |
| D1 database ID | **b5442bd1-c7aa-4345-b961-d005bf652fd5** |
| Model variable | **gpt-6-luna** |
| Quota | 3 accepted questions per IP in a rolling 24-hour window |
| Cleanup schedule | **0 3 * * *** |

Account-specific values belong in the operator's Cloudflare dashboard and secret store. Do not copy API keys, salt values, cookies, OAuth codes, or local environment files into this repository.

## Architecture

The full design and request flow are in [docs/architecture.md](docs/architecture.md).

At a high level:

~~~text
Browser
  -> GitHub Pages static portfolio
  -> POST /api/chat with Origin validation
  -> Cloudflare Worker
       -> D1 atomic quota reservation
       -> OpenAI Responses API + web search
  <- short answer, official source links, quota metadata
~~~

## Why the documentation is longer than the architecture

The runbook is intentionally detailed so that the deployment can be reproduced safely later. It records setup commands, account boundaries, secret handling, quotas, migrations, validation checks, troubleshooting, rollback, and future extension options.

The running system itself is small:

~~~text
Static portfolio
  -> Cloudflare Worker
       -> D1 quota check
       -> OpenAI API
  <- answer and official links
~~~

There is no Lambda, API Gateway, VM, container, or database server to maintain. Day-to-day maintenance normally means updating Worker code when needed, running Wrangler deploy, testing health and chat, and using a pull request for frontend changes.

The design becomes more involved only if future versions add private GitHub repository access, user authentication, repository indexing, or advanced analytics. Those are optional extensions, not requirements for the current chatbot.

## Documentation map

| Document | Purpose |
| --- | --- |
| [Architecture](docs/architecture.md) | Components, trust boundaries, request sequence, data model, and API contract |
| [Hands-on lab](docs/hands-on-lab.md) | Start-to-finish rebuild from an empty folder and Cloudflare account |
| [Implementation notes](docs/implementation-notes.md) | Exact Worker settings, frontend contract, validation rules, and deployment records |
| [Operations](docs/operations.md) | Secrets, usage limits, observability, cost guardrails, maintenance, and rollback |
| [Troubleshooting](docs/troubleshooting.md) | Known errors and the checks that resolved them |
| [Validation checklist](docs/validation-checklist.md) | Local, API, security, and production acceptance checks |
| [Questions and answers](docs/questions-and-answers.md) | Why Cloudflare, answer customization, access, costs, GitHub integration, and Lambda comparison |
| [Frontend examples](examples/frontend-integration.html) | Minimal markup plus companion CSS and JavaScript |
| [Questions and additions](docs/questions-and-additions.md) | Living page for future questions and decisions |

## Quick reproduction path

The complete instructions are intentionally detailed in the hands-on lab. The shortest reliable path is:

1. Prepare Node.js, npm, OpenSSL, a Cloudflare account, an OpenAI API project, and a GitHub Pages site.
2. Create a Cloudflare Worker project with Wrangler.
3. Create a remote D1 database and apply the migration.
4. Configure the Worker name, frontend origin, model, database binding, and cleanup cron.
5. Upload OPENAI_API_KEY and a random RATE_LIMIT_SALT as Wrangler secrets.
6. Deploy the Worker.
7. Test health, CORS, quota, and one real chat request with curl.
8. Add the Worker URL to the portfolio's data-groot-api-base attribute.
9. Publish the frontend through a reviewed GitHub pull request.
10. Run the production acceptance checklist.

Start here: [docs/hands-on-lab.md](docs/hands-on-lab.md).

## Behaviour and safety properties

- Only the configured portfolio origin is allowed to call the API from a browser.
- The Worker never sends the OpenAI secret to the browser.
- Incoming JSON is size-limited to 8 KiB.
- Each message is trimmed to 500 characters.
- At most the latest eight user/assistant messages are forwarded.
- A quota slot is reserved before the upstream model call. A failed upstream call still consumes that slot.
- The third accepted question receives a final-question flag in the response.
- Further requests from the same salted IP hash return HTTP 429 until the rolling window ends.
- IP addresses are not stored directly. The Worker stores a SHA-256 hash of the IP plus a secret salt.
- Source links are accepted only when they use HTTPS and an allowlisted official documentation domain.
- Answers are cleaned so URLs are rendered as source cards by the frontend rather than copied into generated text.
- Old quota rows are removed asynchronously after 30 days and by the scheduled cleanup trigger.

The IP rule is an abuse-reduction control, not a complete spending guarantee. Different networks, VPNs, and shared networks can change the observed IP. Configure an OpenAI project spend limit separately.

## Cost boundaries

Cloudflare hosting and OpenAI API usage are separate services and separate billing surfaces. Cloudflare's free quotas and OpenAI pricing can change, so verify the current account pages before relying on a limit. The Worker quota reduces casual repeated usage but does not replace a provider-side budget limit.

The local demo server can run without any paid API call in mock mode. Live local mode and the deployed Worker can call the OpenAI API and may consume credits.

## Repository and deployment separation

The documentation repository is [dupatanekrishna/groot-openai-api-chatbot](https://github.com/dupatanekrishna/groot-openai-api-chatbot).

The portfolio frontend remains in [dupatanekrishna/portfolio_v2](https://github.com/dupatanekrishna/portfolio_v2). The frontend integration was prepared as a separate pull request so the static site can be reviewed, merged, or reverted without changing the Worker deployment. GitHub Pages publishes the frontend after the portfolio change reaches its publishing branch.

The Worker is deployed independently with Wrangler. A frontend rollback does not automatically roll back the Worker, and a Worker rollback does not alter GitHub Pages. Treat these as two release surfaces.

## Reproduction principles

Use placeholders for account-specific values when rebuilding:

~~~text
YOUR_WORKER_NAME
YOUR_ACCOUNT_SUFFIX
YOUR_DATABASE_ID
YOUR_PORTFOLIO_ORIGIN
YOUR_OPENAI_MODEL
~~~

Never commit:

~~~text
.env
.env.*
*.key
wrangler.toml
wrangler.json
.wrangler/
~~~

The example configuration intentionally contains a placeholder database ID. Replace it only in your local working copy or in the Cloudflare dashboard workflow; do not commit secrets.

## Current status

The first deployment was validated from the command line:

- Health returned HTTP 200 and the configured model.
- CORS returned the exact allowed origin.
- A real chat request returned an answer, official Kubernetes documentation links, and quota metadata.
- The remote D1 migration completed successfully.
- The Worker deployed at the workers.dev endpoint.
- The portfolio frontend change was prepared separately for review.

Use [docs/validation-checklist.md](docs/validation-checklist.md) to repeat those checks after any change.

## Official references

- Cloudflare Workers: <https://developers.cloudflare.com/workers/>
- Wrangler: <https://developers.cloudflare.com/workers/wrangler/>
- Cloudflare D1: <https://developers.cloudflare.com/d1/>
- Cloudflare Worker secrets: <https://developers.cloudflare.com/workers/configuration/secrets/>
- OpenAI Responses API: <https://platform.openai.com/docs/api-reference/responses>
- OpenAI web search tool: <https://platform.openai.com/docs/guides/tools-web-search>
- GitHub Pages: <https://docs.github.com/pages>
- GitHub pull requests: <https://docs.github.com/pull-requests>

## Next additions

Future questions, improvements, screenshots, and operational decisions should be added to [docs/questions-and-additions.md](docs/questions-and-additions.md). Keep the documentation executable: every new procedure should state its prerequisites, exact command, expected result, safety note, and rollback or cleanup action.
