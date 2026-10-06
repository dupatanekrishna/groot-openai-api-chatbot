(() => {
  const root = document.documentElement;
  const apiBase = (root.dataset.grootApiBase || "").replace(/\/+$/, "");
  const status = document.getElementById("groot-chat-status");
  const messages = document.getElementById("groot-chat-messages");
  const input = document.getElementById("groot-chat-input");
  const send = document.getElementById("groot-chat-send");
  const quota = document.getElementById("groot-chat-quota");
  const history = [];
  const allowedHosts = [
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
    "help.zoho.com"
  ];
  let busy = false;

  function safeSource(source) {
    try {
      const url = new URL(source.url);
      const host = url.hostname.toLowerCase();
      const allowed = url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        allowedHosts.some((item) => host === item || host.endsWith("." + item));
      return allowed
        ? { url: url.href, title: String(source.title || host).slice(0, 120) }
        : null;
    } catch {
      return null;
    }
  }

  function addMessage(text, role, sources) {
    const item = document.createElement("p");
    item.className = "groot-example-message " + role;
    item.textContent = text;
    messages.append(item);

    const safeSources = (Array.isArray(sources) ? sources : [])
      .map(safeSource)
      .filter(Boolean)
      .slice(0, 3);
    for (const source of safeSources) {
      const link = document.createElement("a");
      link.className = "groot-example-source";
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = source.title;
      messages.append(link);
    }
    messages.scrollTop = messages.scrollHeight;
  }

  function applyQuota(value) {
    if (!value) return;
    const left = Number(value.questionsRemaining);
    if (Number.isFinite(left)) {
      quota.textContent = left + " questions remaining in the 24-hour window.";
      input.disabled = left === 0 || busy;
      send.disabled = left === 0 || busy;
    }
    if (value.limitReached) {
      quota.textContent = "The question limit has been reached. Try again after the reset time.";
    }
  }

  async function loadHealth() {
    try {
      const response = await fetch(apiBase + "/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error("Health request failed");
      const data = await response.json();
      status.textContent = data.mode === "api"
        ? "Live answers from official documentation"
        : "Demo mode";
      const usage = await fetch(apiBase + "/api/usage", { cache: "no-store" });
      if (usage.ok) applyQuota(await usage.json());
    } catch {
      status.textContent = "Groot is unavailable";
      quota.textContent = "Check the Worker URL and allowed origin.";
    }
  }

  async function submit(event) {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || busy) return;

    busy = true;
    input.disabled = true;
    send.disabled = true;
    addMessage(question, "user", []);
    history.push({ role: "user", content: question });
    input.value = "";

    try {
      const response = await fetch(apiBase + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-8) })
      });
      const data = await response.json();
      applyQuota(data.quota);
      if (!response.ok) {
        addMessage(data.error || "Groot could not answer right now.", "assistant", []);
        return;
      }
      addMessage(data.answer || "No verified answer was returned.", "assistant", data.sources);
      history.push({ role: "assistant", content: String(data.answer || "") });
    } catch {
      addMessage("Groot could not connect to the answer service.", "assistant", []);
    } finally {
      busy = false;
      if (!input.disabled) send.disabled = false;
      input.focus();
    }
  }

  send.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) submit(event);
  });
  loadHealth();
})();
