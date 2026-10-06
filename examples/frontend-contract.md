# Frontend integration contract

The backend and frontend communicate through a small JSON contract. Keep the contract stable when adapting the widget to another static site.

## Configuration

Set data-groot-api-base on the html root element:

~~~html
<html lang="en" data-groot-api-base="https://YOUR_WORKER_SUBDOMAIN.workers.dev">
~~~

The value is public. It is not a secret.

## Health request

~~~http
GET /api/health
Origin: https://YOUR_PORTFOLIO_ORIGIN
~~~

## Chat request

~~~json
{
  "messages": [
    {
      "role": "user",
      "content": "Explain a Kubernetes Service briefly."
    }
  ]
}
~~~

## Chat response

~~~json
{
  "answer": "A short explanation.",
  "sources": [
    {
      "url": "https://kubernetes.io/docs/concepts/services-networking/service/",
      "title": "Service | Kubernetes"
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

## Rendering rules

- Render answer as plain text.
- Render source titles as plain text.
- Set source href from the URL returned by the Worker.
- Use target blank and rel noopener noreferrer for external source links.
- Treat sources as optional; an empty array is a valid response.
- Show a helpful error when the response is not JSON.
- Disable submission while a request is in flight.
- Disable submission when quota.limitReached is true.
- Do not expose response headers, server errors, keys, or raw request details to visitors.
