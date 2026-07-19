(function () {
  "use strict";

  var workspace = document.getElementById("research-agent");
  if (!workspace) return;

  var endpoint = workspace.getAttribute("data-agent-endpoint") || "/api/agent";
  var form = document.getElementById("research-agent-form");
  var question = document.getElementById("agent-question");
  var contextUrl = document.getElementById("agent-context-url");
  var useSearch = document.getElementById("agent-use-search");
  var submit = document.getElementById("agent-submit");
  var result = document.getElementById("agent-result");
  var answer = document.getElementById("agent-answer");
  var sources = document.getElementById("agent-sources");
  var meta = document.getElementById("agent-result-meta");
  var copy = document.getElementById("agent-result-copy");
  var status = document.getElementById("agent-service-status");
  var tabs = Array.prototype.slice.call(workspace.querySelectorAll("[data-agent-mode]"));
  var examples = Array.prototype.slice.call(workspace.querySelectorAll("[data-agent-example]"));
  var currentMode = "qa";
  var answerText = "";
  var activeController = null;

  function setStatus(kind, label) {
    status.classList.remove("is-online", "is-error");
    if (kind) status.classList.add(kind);
    status.lastChild.textContent = label;
  }

  function selectMode(mode, focus) {
    currentMode = mode;
    tabs.forEach(function (tab) {
      var active = tab.getAttribute("data-agent-mode") === mode;
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.setAttribute("tabindex", active ? "0" : "-1");
      if (active && focus) tab.focus();
    });

    var placeholders = {
      qa: "Ask for a comparison, mechanism, evidence summary, or source…",
      challenge: "Name a claim to stress-test. The answer will separate evidence, bounds, falsification, and the next experiment…",
      fit: "Paste a topic, paper URL, role description, or research problem to assess collaboration fit…",
    };
    question.setAttribute("placeholder", placeholders[mode]);
  }

  tabs.forEach(function (tab, index) {
    tab.setAttribute("tabindex", index === 0 ? "0" : "-1");
    tab.addEventListener("click", function () {
      selectMode(tab.getAttribute("data-agent-mode"), false);
    });
    tab.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      var next = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
      selectMode(tabs[next].getAttribute("data-agent-mode"), true);
    });
  });

  examples.forEach(function (button) {
    button.addEventListener("click", function () {
      var value = button.getAttribute("data-agent-example") || "";
      question.value = value;
      if (/^Challenge/i.test(value)) selectMode("challenge", false);
      else if (/collaboration/i.test(value)) selectMode("fit", false);
      else selectMode("qa", false);
      question.focus();
    });
  });

  function appendInline(parent, value) {
    var pattern = /(\[[SU]\d+\]|\*\*[^*]+\*\*|`[^`]+`)/g;
    var cursor = 0;
    var match;
    while ((match = pattern.exec(value))) {
      if (match.index > cursor) parent.appendChild(document.createTextNode(value.slice(cursor, match.index)));
      var token = match[0];
      var element;
      if (token.slice(0, 2) === "**") {
        element = document.createElement("strong");
        element.textContent = token.slice(2, -2);
      } else if (token.charAt(0) === "`") {
        element = document.createElement("code");
        element.textContent = token.slice(1, -1);
      } else {
        element = document.createElement("span");
        element.className = "agent-citation";
        element.textContent = token;
      }
      parent.appendChild(element);
      cursor = match.index + token.length;
    }
    if (cursor < value.length) parent.appendChild(document.createTextNode(value.slice(cursor)));
  }

  function renderAnswer(value) {
    var fragment = document.createDocumentFragment();
    var list = null;
    value.split(/\r?\n/).forEach(function (rawLine) {
      var line = rawLine.trim();
      if (!line) {
        list = null;
        return;
      }
      var heading = line.match(/^#{2,3}\s+(.+)$/);
      var bullet = line.match(/^[-*]\s+(.+)$/);
      var numbered = line.match(/^\d+[.)]\s+(.+)$/);
      if (heading) {
        list = null;
        var h = document.createElement("h3");
        appendInline(h, heading[1]);
        fragment.appendChild(h);
      } else if (bullet || numbered) {
        var listType = numbered ? "ol" : "ul";
        if (!list || list.tagName.toLowerCase() !== listType) {
          list = document.createElement(listType);
          fragment.appendChild(list);
        }
        var item = document.createElement("li");
        appendInline(item, (bullet || numbered)[1]);
        list.appendChild(item);
      } else {
        list = null;
        var paragraph = document.createElement("p");
        appendInline(paragraph, line);
        fragment.appendChild(paragraph);
      }
    });
    answer.replaceChildren(fragment);
  }

  function safeSourceUrl(value) {
    if (!value) return null;
    try {
      var url = new URL(value, window.location.origin);
      if (url.protocol !== "https:" && url.origin !== window.location.origin) return null;
      return url.href;
    } catch (_error) {
      return null;
    }
  }

  function renderSources(items) {
    sources.replaceChildren();
    if (!Array.isArray(items) || !items.length) return;
    items.forEach(function (source) {
      var card = document.createElement("article");
      card.className = "agent-source-card";
      var provenance = document.createElement("p");
      provenance.textContent = source.id + " · " + String(source.evidenceType || "source").replace(/_/g, " ");
      card.appendChild(provenance);

      var href = safeSourceUrl(source.sourceUrl);
      if (href) {
        var link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = source.title || "Source";
        card.appendChild(link);
      } else {
        var title = document.createElement("strong");
        title.textContent = source.title || "Source";
        card.appendChild(title);
      }

      var detail = document.createElement("small");
      detail.textContent = source.trust === "untrusted_external"
        ? "Runtime external context · untrusted"
        : source.sourcePath || source.status || "Local knowledge source";
      card.appendChild(detail);
      sources.appendChild(card);
    });
  }

  function renderMeta(payload) {
    meta.replaceChildren();
    [payload.mode, payload.evidenceType, payload.warning].filter(Boolean).forEach(function (value) {
      var badge = document.createElement("span");
      badge.textContent = String(value).replace(/_/g, " ");
      meta.appendChild(badge);
    });
  }

  function setError(message) {
    answerText = message;
    answer.replaceChildren();
    var heading = document.createElement("h3");
    heading.textContent = "Service status";
    var paragraph = document.createElement("p");
    paragraph.textContent = message;
    answer.append(heading, paragraph);
  }

  function dispatchEvent(name, payload) {
    if (name === "meta") renderMeta(payload || {});
    else if (name === "sources") renderSources(payload);
    else if (name === "delta" && payload && typeof payload.text === "string") {
      answerText += payload.text;
      renderAnswer(answerText);
    } else if (name === "error") {
      setError(payload && payload.message ? payload.message : "The research service returned an error.");
    }
  }

  async function readEventStream(response) {
    if (!response.body || !response.headers.get("Content-Type")?.includes("text/event-stream")) {
      var payload = await response.json().catch(function () { return {}; });
      throw new Error(payload.error || "The research service returned an invalid response.");
    }
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || "";
      frames.forEach(function (frame) {
        var eventName = "message";
        var data = [];
        frame.split(/\r?\n/).forEach(function (line) {
          if (line.indexOf("event:") === 0) eventName = line.slice(6).trim();
          if (line.indexOf("data:") === 0) data.push(line.slice(5).trim());
        });
        if (!data.length) return;
        try {
          dispatchEvent(eventName, JSON.parse(data.join("\n")));
        } catch (_error) {
          // Ignore malformed transport frames without exposing provider data.
        }
      });
    }
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var prompt = question.value.trim();
    if (prompt.length < 3) {
      question.focus();
      return;
    }

    if (activeController) activeController.abort();
    activeController = new AbortController();
    answerText = "";
    answer.replaceChildren();
    sources.replaceChildren();
    meta.replaceChildren();
    result.hidden = false;
    submit.disabled = true;
    submit.firstChild.textContent = "Investigating… ";
    setStatus("is-online", "Retrieving evidence");
    result.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });

    try {
      if (!window.HaoqiAiGate) throw new Error("AI security gate is unavailable.");
      var response = await window.HaoqiAiGate.fetch("agent", endpoint, {
        method: "POST",
        signal: activeController.signal,
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          mode: currentMode,
          question: prompt,
          contextUrl: contextUrl.value.trim() || undefined,
          useSearch: useSearch.checked,
          history: [],
        }),
      });
      await readEventStream(response);
      setStatus("is-online", response.ok ? "Evidence service online" : "Service returned an error");
    } catch (error) {
      if (error.name === "AbortError") return;
      setError(error.message || "The research service is unavailable. Run the Cloudflare Worker preview for local AI requests.");
      setStatus("is-error", "Service unavailable");
    } finally {
      submit.disabled = false;
      submit.firstChild.textContent = "Run investigation ";
      activeController = null;
    }
  });

  copy.addEventListener("click", async function () {
    if (!answerText) return;
    try {
      await navigator.clipboard.writeText(answerText);
      copy.textContent = "Copied";
      window.setTimeout(function () { copy.textContent = "Copy answer"; }, 1_500);
    } catch (_error) {
      copy.textContent = "Copy unavailable";
    }
  });

  fetch("/api/health", { headers: { Accept: "application/json" }, credentials: "same-origin" })
    .then(function (response) { return response.ok ? response.json() : Promise.reject(new Error("offline")); })
    .then(function (payload) {
      setStatus(payload.aiEnabled ? "is-online" : "", payload.aiEnabled ? "Evidence service protected" : "AI securely disabled · protection not configured");
    })
    .catch(function () {
      setStatus("", "Static preview · Worker offline");
    });
})();
