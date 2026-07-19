---
layout: single
permalink: /agent/
title: "Research Agent"
author_profile: true
research_agent: true
---

An evidence-grounded interface over my publications, projects, and research notes. It retrieves citable local evidence first — external pages are treated as untrusted context and never silently promoted into facts about me.

<style>
/* Fit the console header to the theme's single-column page width */
#research-agent .research-workspace__header h2 { font-size: clamp(1.5rem, 2.6vw, 2.1rem); }
</style>

<section class="research-workspace" id="research-agent" data-agent-endpoint="/api/agent" aria-labelledby="agent-title">
  <header class="research-workspace__header">
    <div>
      <p class="research-section__index">RESEARCH INTERFACE</p>
      <h2 id="agent-title">Interrogate the work, not a persona.</h2>
      <p>This interface retrieves citable local evidence first. External pages are treated as untrusted context and never silently promoted into facts about me.</p>
    </div>
    <p class="agent-status" id="agent-service-status"><span aria-hidden="true"></span>Cloudflare Worker</p>
  </header>

  <div class="agent-mode-tabs" role="tablist" aria-label="Research agent mode">
    <button type="button" role="tab" aria-selected="true" data-agent-mode="qa">Research Q&amp;A<span>Evidence-grounded answers</span></button>
    <button type="button" role="tab" aria-selected="false" data-agent-mode="challenge">Challenge My Research<span>Claims, bounds, falsification</span></button>
    <button type="button" role="tab" aria-selected="false" data-agent-mode="fit">Collaboration Fit<span>Overlap, gaps, next question</span></button>
  </div>

  <div class="agent-console">
    <aside class="agent-console__examples" aria-labelledby="examples-title">
      <p id="examples-title">Example investigations</p>
      <button type="button" data-agent-example="What is the strongest supported claim behind Q-Detection, and what is only theoretical?">Q-Detection: measured vs. theoretical</button>
      <button type="button" data-agent-example="Challenge the current FrontierRiskWorld framing. Separate verified evidence, inference, and the next falsifying experiment.">Challenge FrontierRiskWorld</button>
      <button type="button" data-agent-example="How does my work connect agentic post-training with harness and evaluator design?">Post-training ↔ harness design</button>
      <button type="button" data-agent-example="Assess collaboration fit for a project on verifier-aware RL agents under tool failures.">Verifier-aware RL collaboration</button>
    </aside>

    <form class="agent-console__form" id="research-agent-form">
      <label for="agent-question">Research question or collaboration context</label>
      <textarea id="agent-question" name="question" rows="5" maxlength="8000" required placeholder="Ask for a comparison, challenge a claim, or paste a research problem…"></textarea>

      <div class="agent-context-row">
        <label for="agent-context-url">Public URL <span>optional</span>
          <input id="agent-context-url" name="contextUrl" type="url" inputmode="url" maxlength="2048" placeholder="https://paper-or-project.example">
        </label>
        <label class="agent-search-toggle" for="agent-use-search">
          <input id="agent-use-search" name="useSearch" type="checkbox">
          <span>Use external search</span>
        </label>
      </div>

      <div class="agent-submit-row">
        <p>Answers label evidence type and cite retrieved sources. No hidden chain-of-thought is requested or shown.</p>
        <button class="research-button research-button--primary" id="agent-submit" type="submit">Run investigation <span aria-hidden="true">↗</span></button>
      </div>
    </form>
  </div>

  <section class="agent-result" id="agent-result" aria-live="polite" hidden>
    <header>
      <div id="agent-result-meta"></div>
      <button type="button" id="agent-result-copy">Copy answer</button>
    </header>
    <div class="agent-result__answer" id="agent-answer"></div>
    <div class="agent-result__sources" id="agent-sources"></div>
  </section>

  <noscript><p class="agent-offline">JavaScript is required for the research interface. The publications and project evidence above remain fully accessible without it.</p></noscript>
</section>
