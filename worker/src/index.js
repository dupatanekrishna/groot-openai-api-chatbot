const QUESTION_LIMIT = 3;
const WINDOW_MS = 24 * 60 * 60 * 1_000;
const RETAIN_AFTER_RESET_MS = 30 * WINDOW_MS;
const MAX_BODY_BYTES = 8_192;
const MAX_MESSAGE_CHARS = 500;
const MAX_HISTORY_MESSAGES = 8;

const OFFICIAL_DOMAINS = [
  "docs.aws.amazon.com",
  "kubernetes.io",
  "developer.hashicorp.com",
  "docs.docker.com",
  "docs.gitlab.com",
  "grafana.com",
  "prometheus.io",
  "opentelemetry.io",
  "learn.microsoft.com",
  "docs.github.com",
  "datatracker.ietf.org",
  "rfc-editor.org",
  "help.zoho.com",
];

const SYSTEM_PROMPT = `You are Groot, Krishna's friendly DevOps guide. Speak with the gentle curiosity and simple warmth of a young tree learning about technology, while keeping technical explanations accurate and useful. Keep each answer short: at most 3 bullets or 3 brief sentences. Answer cloud, DNS, DevOps, SRE, Kubernetes, infrastructure, observability, and security questions. Ground factual claims only in the official documentation returned by web search. If the official sources do not support a clear answer, say that you could not verify it. Do not invent links or claim you read a GitHub repository. Do not include URLs in your answer text; the website will show official source links separately. A tiny playful touch is welcome, but clarity comes first.`;

function corsHeaders(request, env) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  });
  const origin = request.headers.get("Origin");
  if (origin && origin === env.ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return headers;
}

function json(request, env, status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders(request, env) });
}

function hasAllowedOrigin(request, env) {
  return request.headers.get("Origin") === env.ALLOWED_ORIGIN;
}

async function hashClientIp(request, env) {
  if (!env.RATE_LIMIT_SALT) throw new Error("rate limit salt is not configured");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const bytes = new TextEncoder().encode(`${env.RATE_LIMIT_SALT}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatUsage(questionCount, resetAt) {
  return {
    questionCount,
    questionsRemaining: Math.max(0, QUESTION_LIMIT - questionCount),
    resetAt,
    limit: QUESTION_LIMIT,
    windowHours: 24,
  };
}

async function getUsage(db, ipHash, now = Date.now()) {
  const row = await db.prepare(
    "SELECT question_count, reset_at FROM ip_question_windows WHERE ip_hash = ?1",
  ).bind(ipHash).first();
  if (!row || Number(row.reset_at) <= now) return formatUsage(0, null);
  return formatUsage(Number(row.question_count), Number(row.reset_at));
}

async function reserveQuestion(db, ipHash, now = Date.now()) {
  const row = await db.prepare(`
    INSERT INTO ip_question_windows (ip_hash, question_count, reset_at)
    VALUES (?1, 1, ?3)
    ON CONFLICT(ip_hash) DO UPDATE SET
      question_count = CASE
        WHEN ip_question_windows.reset_at <= ?2 THEN 1
        ELSE ip_question_windows.question_count + 1
      END,
      reset_at = CASE
        WHEN ip_question_windows.reset_at <= ?2 THEN ?3
        ELSE ip_question_windows.reset_at
      END
    WHERE ip_question_windows.reset_at <= ?2
      OR ip_question_windows.question_count < ?4
    RETURNING question_count, reset_at
  `).bind(ipHash, now, now + WINDOW_MS, QUESTION_LIMIT).first();

  if (!row) return { allowed: false, ...await getUsage(db, ipHash, now), finalQuestion: false };
  const questionCount = Number(row.question_count);
  return {
    allowed: true,
    ...formatUsage(questionCount, Number(row.reset_at)),
    finalQuestion: questionCount === QUESTION_LIMIT,
  };
}

function quotaForClient(reservation) {
  return {
    questionCount: reservation.questionCount,
    questionsRemaining: reservation.questionsRemaining,
    resetAt: reservation.resetAt,
    limit: reservation.limit,
    windowHours: reservation.windowHours,
    finalQuestion: Boolean(reservation.finalQuestion),
    limitReached: reservation.questionsRemaining === 0,
  };
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) return null;
  const messages = value.slice(-MAX_HISTORY_MESSAGES).map((item) => {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") return null;
    const content = item.content.trim().slice(0, MAX_MESSAGE_CHARS);
    return content ? { role: item.role, content } : null;
  }).filter(Boolean);
  if (!messages.length || messages[messages.length - 1].role !== "user") return null;
  return messages;
}

async function readMessages(request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return { error: "Keep the message short, please.", status: 413 };
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: "The request was not valid JSON.", status: 400 };
  }
  const messages = normalizeHistory(body?.messages);
  if (!messages) return { error: "Send one short question to Groot.", status: 400 };
  return { messages };
}

function safeOfficialUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!OFFICIAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return null;
    return url.href;
  } catch {
    return null;
  }
}

function cleanAnswer(rawText) {
  return rawText
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, 2_000);
}

function uniqueOfficialSources(candidates) {
  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    const url = safeOfficialUrl(candidate?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push({ url, title: String(candidate.title || new URL(url).hostname).slice(0, 120) });
    if (result.length === 3) break;
  }
  return result;
}

async function createApiReply(messages, env) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-6-luna",
      instructions: SYSTEM_PROMPT,
      input: messages,
      tools: [{
        type: "web_search",
        search_context_size: "low",
        filters: { allowed_domains: OFFICIAL_DOMAINS },
      }],
      tool_choice: "required",
      max_output_tokens: 260,
      include: ["web_search_call.action.sources"],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    console.error(`OpenAI API returned status ${response.status}.`);
    return {
      status: 502,
      payload: { error: "Groot could not reach the answer service. Please try again later." },
    };
  }

  const data = await response.json();
  const output = Array.isArray(data.output) ? data.output : [];
  const messageItems = output.filter((item) => item.type === "message");
  const rawText = messageItems.flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text || "")
    .join("\n");
  const citationSources = messageItems.flatMap((item) => item.content || [])
    .flatMap((item) => item.annotations || [])
    .filter((item) => item.type === "url_citation")
    .map((item) => ({ url: item.url, title: item.title }));
  const searchedSources = output.filter((item) => item.type === "web_search_call")
    .flatMap((item) => item.action?.sources || [])
    .map((item) => ({ url: item.url, title: item.title }));
  const sources = uniqueOfficialSources([...citationSources, ...searchedSources]);
  const answer = cleanAnswer(rawText);

  if (!answer || sources.length === 0) {
    return {
      status: 200,
      payload: {
        answer: "I couldn’t verify a short answer in the official documentation this time. Try asking with a product or service name.",
        sources: [],
        mode: "api",
      },
    };
  }
  return { status: 200, payload: { answer, sources, mode: "api" } };
}

async function removeOldRows(env, olderThan) {
  await env.GROOT_DB.prepare(
    "DELETE FROM ip_question_windows WHERE reset_at < ?1",
  ).bind(olderThan).run();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const apiPath = ["/api/health", "/api/usage", "/api/chat"].includes(url.pathname);

    if (request.method === "OPTIONS") {
      if (!hasAllowedOrigin(request, env)) return json(request, env, 403, { error: "Origin not allowed." });
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (!apiPath) return json(request, env, 404, { error: "API route not found." });
    if (!hasAllowedOrigin(request, env)) return json(request, env, 403, { error: "Origin not allowed." });

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json(request, env, 200, { mode: "api", model: env.OPENAI_MODEL || "gpt-6-luna" });
    }

    if (url.pathname === "/api/usage" && request.method === "GET") {
      try {
        const ipHash = await hashClientIp(request, env);
        return json(request, env, 200, await getUsage(env.GROOT_DB, ipHash));
      } catch (error) {
        console.error(`Quota lookup failed (${error.name || "Error"}).`);
        return json(request, env, 503, { error: "Groot’s question limit is temporarily unavailable. Please try again later." });
      }
    }

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") return json(request, env, 405, { error: "Use POST to send a question." });
      const parsed = await readMessages(request);
      if (parsed.error) return json(request, env, parsed.status, { error: parsed.error });

      let reservation;
      try {
        const ipHash = await hashClientIp(request, env);
        reservation = await reserveQuestion(env.GROOT_DB, ipHash);
      } catch (error) {
        console.error(`Quota reservation failed (${error.name || "Error"}).`);
        return json(request, env, 503, { error: "Groot’s question limit is temporarily unavailable. No AI request was sent; please try again later." });
      }

      if (!reservation.allowed) {
        return json(request, env, 429, {
          error: "You’ve reached Groot’s limit of 3 questions per IP in 24 hours. Please come back after the limit resets.",
          quota: { ...quotaForClient(reservation), limitReached: true },
        });
      }

      ctx.waitUntil(removeOldRows(env, Date.now() - RETAIN_AFTER_RESET_MS).catch((error) => {
        console.error(`Quota cleanup failed (${error.name || "Error"}).`);
      }));

      if (!env.OPENAI_API_KEY) {
        return json(request, env, 503, {
          error: "Groot’s answer service is not configured yet.",
          quota: quotaForClient(reservation),
        });
      }

      try {
        const result = await createApiReply(parsed.messages, env);
        return json(request, env, result.status, { ...result.payload, quota: quotaForClient(reservation) });
      } catch (error) {
        console.error(`Chat request failed (${error.name || "Error"}).`);
        return json(request, env, 502, {
          error: "Groot couldn’t complete that lookup. Please try again later.",
          quota: quotaForClient(reservation),
        });
      }
    }

    return json(request, env, 405, { error: "Method not allowed." });
  },

  async scheduled(_controller, env) {
    await removeOldRows(env, Date.now() - RETAIN_AFTER_RESET_MS);
  },
};
