# Questions and answers about Groot

This chapter explains why the deployment uses Cloudflare, how an answer is shaped, what the API key and access boundaries are, how the static website is connected, what the chatbot is useful for, and how the design compares with AWS Lambda.

The answers describe the current implementation. They also mark which ideas are future extensions rather than features already enabled.

## 1. Why use Cloudflare?

Cloudflare is the server-side execution and edge platform in this design. The portfolio remains a static GitHub Pages site, but the browser needs a safe backend to hold the OpenAI key and enforce the quota. Cloudflare Workers provides that small backend without provisioning a VM or creating a full application server.

In this project Cloudflare supplies:

| Cloudflare capability | Use in Groot |
| --- | --- |
| Workers | Runs the API handler at the public Worker URL |
| D1 | Stores the salted IP hash, question count, and reset time |
| Secrets | Holds OPENAI_API_KEY and RATE_LIMIT_SALT outside source code |
| Cron Trigger | Runs daily stale-quota cleanup |
| Wrangler | Authenticates, creates resources, applies migrations, uploads secrets, and deploys |
| Edge network | Accepts the request at Cloudflare's network and starts the Worker close to the visitor by default |

Cloudflare is not the language model. It does not write the answer. The Worker validates the request, checks the quota, calls OpenAI, and safely returns the result.

Cloudflare Workers run JavaScript in V8 isolates on Cloudflare's global network. The platform documentation describes isolates as lightweight contexts designed for quick startup and warns that mutable global state should not be used as durable storage. That is why quota state is in D1 rather than a JavaScript global variable.

References:

- [How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/)
- [Deploy APIs at the edge](https://developers.cloudflare.com/use-cases/apis/deploy-apis/)
- [Worker placement](https://developers.cloudflare.com/workers/configuration/placement/)

## 2. What are Cloudflare's advantages here?

For this small public widget, the practical advantages are:

1. Fewer moving parts. The Worker URL is immediately available after deploy; no API Gateway, load balancer, VM, or container is required.
2. Low operational overhead. There is no operating-system patching, server process, or capacity planning for a small traffic volume.
3. Fast startup. V8 isolates are lightweight and are designed to start quickly.
4. Edge reachability. The request enters Cloudflare's global network instead of first reaching one manually selected server region.
5. Built-in companion services. D1, encrypted Worker secrets, cron triggers, and Wrangler fit the same deployment workflow.
6. Clear separation. GitHub Pages can remain static while the Worker owns secrets and server-side logic.
7. Simple rollback boundaries. Frontend commits and Worker deployments can be rolled back independently.

These advantages matter because Groot has a short request path, a small data model, and no long-running compute.

## 3. What are Cloudflare's limitations?

The free limits are useful for a portfolio, but they are not unlimited production capacity. Current documented values can change; verify the linked pages before planning a larger system.

### Workers Free limits

According to the current Workers limits documentation:

| Limit | Workers Free |
| --- | --- |
| HTTP requests | 100,000 per day |
| CPU time | 10 ms per request |
| Subrequests | 50 per invocation |
| Memory | 128 MB |
| Worker script size | 64 MiB |
| Cron triggers | 5 per account |

Waiting for network calls does not count as CPU time in the same way as JavaScript execution, but the request still has a runtime and upstream timeout. Groot performs only a few subrequests, so this design is comfortably smaller than the free limits.

### D1 Free limits

Current D1 pricing and limits documentation lists:

| Limit | Workers Free |
| --- | --- |
| Rows read | 5 million per day |
| Rows written | 100,000 per day |
| Account storage | 5 GB |
| Maximum database size | 500 MB |
| D1 queries per Worker invocation | 50 |

The quota table contains one small row per active client identity, so the current workload is tiny compared with those limits. If an account reaches a daily D1 limit, queries fail until the limit resets or the account changes plan.

### Product and platform limitations

- The Worker runtime is not a full Linux server. Native binaries, arbitrary background processes, and long-running jobs are not a fit for this function.
- D1 is relational SQL, not a large document store or a vector database.
- The free Worker CPU budget is small for CPU-heavy parsing, compilation, large file processing, or complex data transformations.
- Cloudflare-specific bindings create some platform coupling. Moving to another provider requires replacing Wrangler configuration, D1 calls, secret bindings, and cron wiring.
- The public endpoint is not automatically authenticated. The current Origin check is a browser-sharing control, not a login system.
- The IP quota is not a perfect identity system. A VPN can change identity, while a shared office or home network can share one quota.
- OpenAI remains an external dependency. A healthy Worker does not guarantee that the model, web search, or billing account is available.

References:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

## 4. What exactly customizes the answers?

The model is not fine-tuned for this website. The answer is customized at request time by several layers:

### A. Server-side instruction

The Worker sends a system instruction that tells Groot to:

- Act as a friendly DevOps guide.
- Keep answers to at most three bullets or three brief sentences.
- Cover cloud, DNS, DevOps, SRE, Kubernetes, infrastructure, observability, and security topics.
- Ground factual claims in the official documentation returned by web search.
- Say when the sources do not support a verified answer.
- Avoid invented links.
- Avoid placing URLs directly in answer text because the frontend shows sources separately.

### B. Search tool and domain filtering

The Worker calls the OpenAI Responses API with the web_search tool set to required. It provides an allowlist such as:

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

OpenAI's Responses web search supports allowed domain filters, including subdomains. The current implementation uses a small allowlist rather than permitting the whole internet.

### C. Small context and output limits

The Worker forwards at most eight recent messages, trims each message to 500 characters, rejects a body over 8 KiB, sets a 45-second upstream timeout, and limits output tokens to 260. These controls keep the response focused and reduce accidental spend.

### D. Source validation after the model call

The Worker does not blindly trust links returned by the upstream service. It:

1. Extracts citation annotations and web-search source entries.
2. Requires HTTPS.
3. Rejects URLs with a username or password.
4. Checks the hostname against the official-domain allowlist.
5. Removes duplicate URLs.
6. Returns no more than three sources.

It also removes URLs from answer text. The browser creates separate source links from the validated source objects.

### E. Frontend behaviour

The static widget adds the childlike Groot presentation, a paid-credit reminder, a final-question warning, and a disabled state after the quota is exhausted. This changes the user experience, not the model's knowledge.

So the short version is:

**Prompt + web-search rules + history limits + source validation + frontend presentation = customized Groot behaviour.**

References:

- [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [Responses API reference](https://developers.openai.com/api/reference/overview)

## 5. What is Cloudflare's role in the answer path?

Cloudflare sits between the browser and OpenAI:

~~~mermaid
sequenceDiagram
    participant B as Browser
    participant P as GitHub Pages
    participant C as Cloudflare Worker
    participant D as D1
    participant O as OpenAI
    B->>P: Load static HTML, CSS, and JavaScript
    B->>C: POST question
    C->>C: Validate origin and input
    C->>D: Reserve quota slot
    C->>O: Send server-side Responses API call
    O-->>C: Answer and sources
    C-->>B: JSON answer, sources, and quota
~~~

Cloudflare performs the safety and integration work:

- It receives the HTTP request.
- It checks the exact configured Origin.
- It validates JSON, message roles, body size, and message length.
- It hashes the client IP with the secret salt.
- It atomically reserves one D1 quota slot.
- It refuses the request after three accepted questions.
- It reads OPENAI_API_KEY from the Worker secret binding.
- It calls the OpenAI API.
- It validates source links.
- It returns a compact JSON response.
- It schedules stale-row cleanup.

Cloudflare does not expose D1 or the OpenAI key to the browser.

## 6. How is the chatbot embedded into a static website?

A static website can still call an API. Static means the HTML, CSS, and JavaScript are served as files; it does not mean the browser cannot make an HTTPS request.

The integration has four pieces:

1. The root html element carries the public Worker URL:

~~~html
<html lang="en" data-groot-api-base="https://YOUR_WORKER_SUBDOMAIN.workers.dev">
~~~

2. The page loads the widget stylesheet.

~~~html
<link rel="stylesheet" href="groot-chat.css">
~~~

3. The page loads the widget JavaScript with defer.

~~~html
<script src="groot-chat.js" defer></script>
~~~

4. The page contains the chat controls and message container.

When the browser loads the page, the JavaScript:

- Reads the Worker URL from data-groot-api-base.
- Calls GET /api/health to show API or unavailable state.
- Calls GET /api/usage to show remaining questions.
- Sends POST /api/chat when the visitor submits a question.
- Renders answer text with textContent.
- Creates source anchors from the validated sources.
- Disables controls while a request is running or when quota is exhausted.

The static site never needs Node.js, Python, Lambda, or a server process at runtime. It only needs a browser and the publicly reachable Worker URL.

## 7. Can it read all GitHub repositories and answer questions about them?

Yes, it can be extended, but the current Groot deployment does not read GitHub repositories. The current search allowlist contains docs.github.com for GitHub documentation, not arbitrary repository contents.

There are three possible levels:

### Level 1: Public repository links

For a small set of public repositories, the Worker can fetch selected README or source files through the GitHub Contents API or raw file URLs. It can then pass a bounded amount of text to the model and return stable GitHub links.

This is suitable for:

- A portfolio repository.
- A small lab repository.
- A curated documentation directory.

### Level 2: Private repositories with controlled access

Private content requires authorization. The recommended design is:

1. Create a private GitHub App.
2. Grant only read-only repository Contents permission.
3. Install it only on selected repositories.
4. Generate short-lived installation tokens in the backend.
5. Store the App private key or token material as a Worker secret.
6. Never send the token to the browser.
7. Validate repository owner, repository name, branch, and path against an allowlist.

An alternative is a fine-grained personal access token restricted to selected repositories with read-only Contents permission. A GitHub App is usually the better long-term design because installation tokens expire after one hour and can be restricted to selected repositories and permissions.

### Level 3: Search many repositories

Reading every repository on every question is not a good request-time design. It is slow, expensive, difficult to rate-limit, and may expose code the visitor should not see.

A stronger design is an indexing pipeline:

~~~mermaid
flowchart TD
    G[GitHub App webhook or scheduled sync] --> R[Read selected repository files]
    R --> C[Chunk and label content]
    C --> E[Create embeddings]
    E --> V[Vector search index]
    Q[Visitor question] --> V
    V --> X[Relevant chunks and stable GitHub links]
    X --> A[OpenAI answer]
~~~

The index stores repository, branch, commit SHA, path, line range, and access label with each chunk. The answer service retrieves only the chunks the visitor is authorized to see. Each source can link to a permalink such as:

~~~text
https://github.com/OWNER/REPO/blob/COMMIT_SHA/path/to/file#L10-L35
~~~

For a Cloudflare-native version, Vectorize can store embeddings while R2 or another store holds larger source material and D1 stores metadata and permissions. D1 alone is suitable for the current quota row, not for a large code-search corpus.

The main security rule is: **do not implement “read all repositories” by accepting an arbitrary repository name and a broad token from the browser.**

References:

- [GitHub repository contents API](https://docs.github.com/en/rest/repos/contents)
- [Choosing GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [GitHub App installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- [Fine-grained personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Cloudflare Vectorize](https://developers.cloudflare.com/vectorize/)

## 8. Can it link to the exact file or line related to a question?

Yes. The current implementation returns up to three official documentation links. A repository-aware version can return stable GitHub permalinks instead.

The indexer should record:

- Repository owner and name.
- Commit SHA.
- File path.
- Start and end line.
- A short title.
- The access scope.

When a chunk is selected, the backend builds a URL using the immutable commit SHA. A branch URL can change later; a commit URL remains tied to the content that produced the answer.

The response could then contain:

~~~json
{
  "url": "https://github.com/OWNER/REPO/blob/COMMIT_SHA/docs/runbook.md#L42-L68",
  "title": "Runbook section: deployment rollback"
}
~~~

The backend must validate that the URL belongs to an allowed repository and that the path and commit came from the authenticated GitHub response. The model should not be allowed to invent repository links.

## 9. What is the chatbot useful for?

The current chatbot has four practical purposes:

1. Demonstrate a real end-to-end AI integration on a portfolio site.
2. Give visitors a quick DevOps explanation with links to primary documentation.
3. Demonstrate secure secret handling, edge API design, D1 persistence, validation, CORS, rate limiting, and release workflow.
4. Provide a friendly discovery surface that directs users to authoritative documentation.

It is not intended to:

- Replace official documentation.
- Act as a confidential channel.
- Answer from private repositories in its current form.
- Guarantee that every generated statement is correct.
- Provide unrestricted research or unlimited API usage.
- Replace a human review of production changes.

The bot is valuable because it shows the engineering around the model: routing, access boundaries, cost controls, data handling, source validation, and rollback.

## 10. What does the OpenAI API key authorize?

The key is a bearer credential used only by the Worker to call the OpenAI API:

~~~http
Authorization: Bearer OPENAI_API_KEY
~~~

The current request path is:

~~~text
Browser -> Cloudflare Worker -> OpenAI
~~~

The browser never sees the key. The Worker reads it from an encrypted Cloudflare secret binding.

Use a project-scoped key with the smallest supported permissions. OpenAI project keys support All, Restricted, and Read Only permissions. This Worker needs inference access, not organization administration access. Do not put an Admin API key in a public application.

Recommended controls:

- Create a dedicated project for the portfolio bot.
- Use a separate key for this Worker.
- Prefer Restricted permissions when the required endpoint permissions are available.
- Set a project spend limit and spend alert.
- Set a model usage or rate limit where appropriate.
- Rotate the key on a schedule or after any suspected exposure.
- Revoke the old key after the replacement is verified.
- Never commit the key or place it in browser JavaScript.

OpenAI's API key safety guidance explicitly recommends server-side storage, key rotation, access controls, usage monitoring, and never exposing keys in client-side code.

References:

- [OpenAI API authentication overview](https://developers.openai.com/api/reference/overview)
- [OpenAI API key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)
- [OpenAI project keys and permissions](https://help.openai.com/en/articles/9186755-managing-your-work-in-platform-with-projects)

## 11. Who is authorized to do what?

There are separate identities and boundaries:

| Actor | Access | Current implementation |
| --- | --- | --- |
| Visitor browser | Public chat endpoint | No user login; exact Origin check and IP quota |
| Cloudflare Worker | D1 and OpenAI | Internal bindings and Worker secrets |
| Cloudflare operator | Deploy and manage Worker/D1 | Wrangler login or dashboard account |
| OpenAI project | Model and web-search usage | Project API key and project limits |
| GitHub maintainer | Frontend source and PRs | GitHub repository permissions |
| Future GitHub App | Selected repository contents | Read-only permissions and installation token |

The current Origin check is not authentication. A non-browser client can send an Origin header manually. If stronger access control is needed, add one or more of:

- User authentication.
- Signed session tokens.
- Cloudflare Turnstile.
- Cloudflare Access.
- A global server-side budget counter.
- A GitHub App with repository and user authorization.

## 12. How do API credits and limits work?

There are three different limit families:

### Cloudflare limits

Workers and D1 have plan quotas. The free limits protect the account from unlimited platform usage. If a daily free quota is exceeded, the corresponding service can return an error until the reset or plan change.

### OpenAI billing and rate limits

OpenAI usage is separate from Cloudflare. Each accepted chat request can consume model tokens and web-search usage. A positive credit balance does not remove request, token, model, project, or spend limits. A hard spend limit can cause provider errors when reached.

### Groot application quota

The Worker allows three accepted questions per salted IP in a rolling 24-hour window. This is an application control intended to reduce casual repeated usage. It is not a billing guarantee.

The request accounting is:

| Request | OpenAI call? | Uses Groot slot? |
| --- | --- | --- |
| Health | No | No |
| Usage | No | No |
| Invalid JSON | No | No |
| Wrong origin | No | No |
| First valid chat | Yes | Yes |
| Second valid chat | Yes | Yes |
| Third valid chat | Yes | Yes; final-question flag |
| Fourth chat in same window | No | Rejected with 429 |
| Upstream failure after reservation | Attempted | Yes |

OpenAI prepaid credits, automatic recharges, rate limits, and hard spend limits are separate settings. Review the provider dashboard before enabling automatic recharge.

References:

- [OpenAI prepaid billing](https://help.openai.com/en/articles/8264644-setting-up-and-managing-prepaid-api-billing)
- [OpenAI rate limits and spend limits](https://developers.openai.com/api/docs/guides/rate-limits)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)

## 13. Why does the design not need Lambda?

Because Cloudflare Worker is already the server-side function. The browser cannot safely call OpenAI directly, so it needs any backend function. In this design, that function is a Worker rather than an AWS Lambda function.

The simplified current architecture is:

~~~text
GitHub Pages -> Cloudflare Worker -> D1 + OpenAI
~~~

An AWS design with comparable behaviour could be:

~~~text
GitHub Pages or S3/CloudFront -> Lambda Function URL -> DynamoDB + OpenAI
~~~

Or a more feature-rich AWS design could be:

~~~text
CloudFront/S3 -> API Gateway -> Lambda -> DynamoDB or Aurora
                                      -> Secrets Manager
                                      -> OpenAI
                                      -> CloudWatch
~~~

AWS Lambda does not always require API Gateway. AWS documents Lambda Function URLs as a direct HTTPS option for simple applications. API Gateway adds richer routing, authentication, throttling, caching, request transformation, and API management.

So the real comparison is not “serverless versus serverless.” It is:

| Concern | Cloudflare design used here | AWS equivalent |
| --- | --- | --- |
| Function | Workers | Lambda |
| HTTP endpoint | workers.dev URL | Function URL or API Gateway |
| Small SQL state | D1 | DynamoDB, Aurora, or RDS |
| Secret | Worker secret binding | Secrets Manager or environment configuration |
| Scheduled cleanup | Cron Trigger | EventBridge schedule |
| Logs | Worker observability and tail | CloudWatch |
| Global edge | Cloudflare global network | Regional Lambda plus CloudFront or other edge services |
| Access model | Worker secrets and account permissions | IAM roles, resource policies, and service permissions |
| Deployment | Wrangler | AWS CLI, SAM, CDK, Terraform, or CI/CD |

### Cloudflare is simpler for this use case because:

- One Worker endpoint handles the request.
- D1 is directly bound to the Worker.
- Secrets and cron configuration live beside the Worker.
- There is no separate API Gateway, IAM execution role, or VPC decision for the first version.

### AWS is stronger when:

- The system needs VPC-private resources.
- There are many AWS-native integrations.
- IAM policies, private networking, enterprise controls, or regional data placement are central.
- The application requires advanced API Gateway features.
- The team already operates an AWS platform and observability standard.

### Important trade-off

Cloudflare's smaller surface is a strength for this portfolio bot, but AWS's larger service ecosystem may be a better fit for an enterprise workload. The best choice follows requirements, not provider popularity.

References:

- [Cloudflare Workers how it works](https://developers.cloudflare.com/workers/reference/how-workers-works/)
- [AWS Lambda Function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html)
- [AWS API Gateway with Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-apigateway.html)
- [Choosing a Lambda invocation method](https://docs.aws.amazon.com/lambda/latest/dg/furls-http-invoke-decision.html)
- [AWS Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)

## 14. What should be added next?

The safest next step is not to grant the bot access to every repository. Use a staged approach:

1. Keep the current official-documentation bot stable.
2. Add a curated public repository allowlist.
3. Fetch only selected README or documentation paths.
4. Return commit-pinned GitHub links.
5. Add a GitHub App with read-only Contents permission for private repositories.
6. Add an indexing and retrieval pipeline for larger repository sets.
7. Add user authorization before returning private content.
8. Add a global budget counter and repository-specific quotas.

This preserves the current simple deployment while leaving a clear path toward repository-aware answers.

## Sources checked for this chapter

The limits and access guidance in this chapter was checked against official documentation on 2026-10-06. Provider limits, pricing, permissions, and model behaviour can change; re-check the linked sources before a new deployment.
