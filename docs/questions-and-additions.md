# Questions and additions

This is the living change log for questions that arise while rebuilding or operating Groot. Add the question, the answer, the evidence or command used, and the documentation page that changed.

## How to add an entry

Use this format:

~~~markdown
## YYYY-MM-DD — Short question

Question:

Answer:

Evidence or command:

Documentation updated:

Follow-up:
~~~

## Initial recorded decisions

### Why is the API separate from GitHub Pages?

GitHub Pages serves static files and cannot safely hold a server API key. The Cloudflare Worker provides a server-side boundary while keeping the existing portfolio host and domain.

### Why use D1?

The quota must survive Worker restarts and multiple edge instances. D1 stores one compact row per salted client identity and supports the atomic reservation statement used by the Worker.

### Why hash the IP?

The quota needs a repeatable client identity, but storing raw addresses is unnecessary for this feature. The Worker hashes the address with a secret salt before persistence. This reduces direct exposure but should not be described as complete anonymity.

### Why is the salt not stored in the repository?

The salt protects the stored digest from easy precomputation. It is a Worker secret and must be uploaded through Wrangler. Rotating it changes the effective quota identity for all clients.

### Why does the third question show a warning?

The third accepted slot is still valid, but the frontend tells the visitor it is the last question in the current 24-hour window. The next request is rejected with HTTP 429.

### Why can a failed answer consume a slot?

The quota is reserved before the paid upstream call. This prevents repeated retries from multiplying provider usage during an outage. The trade-off is that a failed upstream request still uses the slot.

### Why are source links restricted?

The product promise is short answers grounded in official documentation. Both the search request and the returned source list are restricted to approved domains.

### Why was the frontend delivered through a pull request?

The static site is production-facing. A feature branch and pull request keep the changed files reviewable and make the published site reversible without changing the Worker deployment.

## Open questions to resolve later

- Should the site use a custom Worker route instead of the workers.dev hostname?
- Should the quota become authenticated per visitor rather than per IP?
- Should a global daily budget counter be added in addition to the per-IP limit?
- Should the official-domain allowlist be configured from a versioned data file?
- Should a separate staging Worker and D1 database be created?
- Should the local mock mode be packaged as a documented test fixture?
- What retention and privacy notice should appear beside the public chat?
- Which dashboard alerts should be enabled for provider spend and Worker errors?

Add decisions here as they are made. Do not silently change a command or a security property in another page without recording the reason.
