(function () {
  "use strict";

  var sessions = Object.create(null);
  var pending = Object.create(null);
  var configPromise = null;
  var scriptPromise = null;
  var allowedScopes = ["agent", "zombie", "elite"];

  function apiError(response, fallback) {
    return response.json().catch(function () { return {}; }).then(function (payload) {
      throw new Error(payload.error || fallback);
    });
  }

  function loadConfig() {
    if (!configPromise) {
      configPromise = fetch("/api/health", {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      }).then(function (response) {
        if (!response.ok) return apiError(response, "AI security service is unavailable.");
        return response.json();
      }).then(function (payload) {
        if (!payload.aiEnabled || !payload.turnstileSiteKey) {
          throw new Error("AI access is securely disabled until Cloudflare protection is configured.");
        }
        return { siteKey: payload.turnstileSiteKey };
      });
    }
    return configPromise;
  }

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise(function (resolve, reject) {
      var existing = document.getElementById("turnstile-api");
      if (existing) {
        existing.addEventListener("load", function () { resolve(window.turnstile); }, { once: true });
        existing.addEventListener("error", function () { reject(new Error("Human verification failed to load.")); }, { once: true });
        return;
      }
      var script = document.createElement("script");
      script.id = "turnstile-api";
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = function () { resolve(window.turnstile); };
      script.onerror = function () { reject(new Error("Human verification failed to load.")); };
      document.head.appendChild(script);
    });
    return scriptPromise;
  }

  function removeDialog(dialog) {
    if (dialog && dialog.parentNode) dialog.parentNode.removeChild(dialog);
  }

  function requestSession(scope, siteKey, turnstileApi) {
    return new Promise(function (resolve, reject) {
      var dialog = document.createElement("div");
      dialog.className = "ai-gate-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "ai-gate-title");

      var card = document.createElement("div");
      card.className = "ai-gate-card";
      var title = document.createElement("h2");
      title.id = "ai-gate-title";
      title.textContent = "Verify this AI session";
      var note = document.createElement("p");
      note.textContent = "Cloudflare verification prevents this public research site from being reused as a model proxy.";
      var widget = document.createElement("div");
      widget.className = "ai-gate-widget";
      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Use local fallback";
      cancel.addEventListener("click", function () {
        removeDialog(dialog);
        reject(new Error("AI verification was cancelled."));
      });

      card.append(title, note, widget, cancel);
      dialog.appendChild(card);
      document.body.appendChild(dialog);
      cancel.focus();

      turnstileApi.render(widget, {
        sitekey: siteKey,
        action: "ai_session",
        theme: "auto",
        size: "flexible",
        callback: function (turnstileToken) {
          cancel.disabled = true;
          note.textContent = "Creating a short-lived, endpoint-scoped session…";
          fetch("/api/ai-session", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ scope: scope, turnstileToken: turnstileToken })
          }).then(function (response) {
            if (!response.ok) return apiError(response, "AI session could not be created.");
            return response.json();
          }).then(function (payload) {
            if (!payload.token || !payload.expiresIn) throw new Error("AI session response was invalid.");
            removeDialog(dialog);
            resolve({ token: payload.token, expiresAt: Date.now() + Number(payload.expiresIn) * 1000 });
          }).catch(function (error) {
            removeDialog(dialog);
            reject(error);
          });
        },
        "error-callback": function () {
          removeDialog(dialog);
          reject(new Error("Human verification failed."));
        },
        "expired-callback": function () {
          note.textContent = "Verification expired. Please retry.";
        }
      });
    });
  }

  function getSession(scope) {
    if (allowedScopes.indexOf(scope) < 0) return Promise.reject(new Error("Unknown AI session scope."));
    var current = sessions[scope];
    if (current && current.expiresAt > Date.now() + 30_000) return Promise.resolve(current.token);
    if (pending[scope]) return pending[scope];

    pending[scope] = Promise.all([loadConfig(), loadTurnstile()])
      .then(function (values) { return requestSession(scope, values[0].siteKey, values[1]); })
      .then(function (session) {
        sessions[scope] = session;
        return session.token;
      }).finally(function () {
        delete pending[scope];
      });
    return pending[scope];
  }

  function securedFetch(scope, input, init) {
    return getSession(scope).then(function (token) {
      var options = Object.assign({}, init || {});
      var headers = new Headers(options.headers || {});
      headers.set("Authorization", "Bearer " + token);
      options.headers = headers;
      options.credentials = "same-origin";
      return fetch(input, options).then(function (response) {
        if (response.status === 401 || response.status === 403) delete sessions[scope];
        return response;
      });
    });
  }

  window.HaoqiAiGate = {
    getSession: getSession,
    fetch: securedFetch,
    clear: function (scope) { delete sessions[scope]; }
  };
})();
