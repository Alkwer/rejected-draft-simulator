// ==UserScript==
// @name         Rejected Draft Simulator Companion
// @namespace    local.rejected-draft-simulator
// @version      0.1.8
// @description  Read-only bridge from Rejected Draft to the local strategy simulator.
// @match        https://kuzzigames.com/rejected_draft
// @match        https://kuzzigames.com/rejected_draft/*
// @match        https://www.kuzzigames.com/rejected_draft
// @match        https://www.kuzzigames.com/rejected_draft/*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
  "use strict";

  const VERSION = "0.1.8";
  const HOST_ID = "rd-simulator-companion-host";
  const SAVE_KEY = "unnamed-battler-save";
  const PORTS = Array.from({ length: 21 }, function (_, index) { return 5173 + index; });
  const ANALYZE_ENDPOINTS = PORTS.map(function (port) {
    return "http://127.0.0.1:" + port + "/api/companion/analyze";
  });
  const FIXTURE_ENDPOINTS = PORTS.map(function (port) {
    return "http://127.0.0.1:" + port + "/api/companion/fight-fixture";
  });
  const OPEN_URLS = PORTS.map(function (port) {
    return "http://127.0.0.1:" + port + "/";
  });

  const state = {
    lastBaseUrl: OPEN_URLS[0],
    busy: false,
    mounted: false,
    guardStarted: false,
    historyStarted: false,
    saveObserverStarted: false,
    panel: null,
    saveHistory: [],
    lastSaveText: null,
    lastSaveChangedAt: null,
  };

  bootWhenReady();

  function bootWhenReady() {
    if (document.body || document.documentElement) boot();
    else document.addEventListener("DOMContentLoaded", boot, { once: true });
    window.setTimeout(boot, 1000);
  }

  function boot() {
    try {
      mountCompanion(true);
      installMountGuard();
      installDiagnostics();
      installSaveHistorySampler();
      recordSaveSnapshot();
      console.info("[RDSC] Rejected Draft companion " + VERSION + " mounted.");
    } catch (error) {
      console.error("[RDSC] Companion failed to mount:", error);
    }
  }

  function mountCompanion(force) {
    const host = getOrCreateHost();
    applyHostStyle(host);

    const target = getMountTarget();
    if (host.parentNode !== target) target.appendChild(host);

    const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    if (force || !state.panel || shadow.childNodes.length === 0) {
      shadow.innerHTML = "";
      const style = document.createElement("style");
      style.textContent = panelCss();
      state.panel = createPanel();
      shadow.append(style, state.panel.root);
      wirePanelActions(state.panel);
      updateBody({
        status: "Ready",
        message: "Start the local simulator, then analyze the current run.",
      });
    }

    state.mounted = true;
    return host;
  }

  function getOrCreateHost() {
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
    }
    return host;
  }

  function getMountTarget() {
    return document.fullscreenElement || document.body || document.documentElement;
  }

  function applyHostStyle(host) {
    host.style.cssText = [
      "all: initial !important",
      "position: fixed !important",
      "right: 16px !important",
      "bottom: 16px !important",
      "z-index: 2147483647 !important",
      "display: block !important",
      "visibility: visible !important",
      "opacity: 1 !important",
      "pointer-events: auto !important",
      "width: min(360px, calc(100vw - 32px)) !important",
      "max-height: calc(100vh - 32px) !important",
    ].join("; ");
  }

  function installMountGuard() {
    if (state.guardStarted) return;
    state.guardStarted = true;

    if (typeof MutationObserver === "function" && document.documentElement) {
      const observer = new MutationObserver(function () {
        ensurePanelMounted();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    document.addEventListener("fullscreenchange", function () {
      mountCompanion(true);
    });
    window.setInterval(ensurePanelMounted, 2000);
  }

  function ensurePanelMounted() {
    const host = document.getElementById(HOST_ID);
    const target = getMountTarget();
    if (!host || host.parentNode !== target || !host.shadowRoot) {
      mountCompanion(true);
      return;
    }
    applyHostStyle(host);
  }

  function installDiagnostics() {
    const diagnostics = {
      version: VERSION,
      hostId: HOST_ID,
      inspect: inspectCompanion,
      remount: function () { return mountCompanion(true); },
      analyze: analyzeCurrentRun,
      captureFixture: captureFightFixture,
    };
    window.__rdSimulatorCompanion = diagnostics;
    if (typeof unsafeWindow !== "undefined") unsafeWindow.__rdSimulatorCompanion = diagnostics;
  }

  function inspectCompanion() {
    const host = document.getElementById(HOST_ID);
    return {
      version: VERSION,
      hasHost: Boolean(host),
      isConnected: Boolean(host && host.isConnected),
      mountTarget: getMountTarget() ? getMountTarget().tagName : null,
      hasShadowRoot: Boolean(host && host.shadowRoot),
      savePresent: Boolean(readSaveText()),
      saveHistoryCount: state.saveHistory.length,
      visibleCombatLogPresent: Boolean(captureVisibleCombatLog()),
      lastBaseUrl: state.lastBaseUrl,
    };
  }

  function wirePanelActions(panel) {
    panel.analyzeButton.addEventListener("click", analyzeCurrentRun);
    panel.captureButton.addEventListener("click", captureFightFixture);
    panel.openButton.addEventListener("click", function () {
      window.open(state.lastBaseUrl, "_blank", "noopener,noreferrer");
    });
    panel.remountButton.addEventListener("click", function () {
      mountCompanion(true);
    });
  }

  function analyzeCurrentRun() {
    if (state.busy) return;
    recordSaveSnapshot();
    const saveText = readSaveText();
    if (!saveText) {
      updateBody({
        status: "No save",
        message: "Could not find localStorage[\"" + SAVE_KEY + "\"].",
        kind: "error",
      });
      return;
    }

    state.busy = true;
    setBusy(true);
    updateBody({ status: "Analyzing", message: "Reading current save and asking the local simulator..." });

    postToFirstAvailableEndpoint(ANALYZE_ENDPOINTS, {
      saveText: saveText,
      trials: 100,
      maxSeconds: 120,
      seed: "companion-" + Date.now(),
    }).then(function (payload) {
      if (!payload.ok) throw new Error(payload.error || "Local simulator returned an error.");
      renderCompanion(payload.companion);
      finishAnalysis();
    }, function (error) {
      updateBody({
        status: "Offline",
        message: error.message + " Keep the simulator server running with npm.cmd run dev.",
        kind: "error",
      });
      finishAnalysis();
    });
  }

  function finishAnalysis() {
    setBusy(false);
  }

  function captureFightFixture() {
    if (state.busy) return;
    recordSaveSnapshot();
    const saveText = readSaveText();
    if (!saveText) {
      updateBody({
        status: "No save",
        message: "Could not find localStorage[\"" + SAVE_KEY + "\"].",
        kind: "error",
      });
      return;
    }

    state.busy = true;
    setBusy(true);
    updateBody({ status: "Capturing", message: "Collecting current save and recent fight logs..." });

    postToFirstAvailableEndpoint(FIXTURE_ENDPOINTS, {
      saveText: saveText,
      browserSnapshot: captureBrowserSnapshot(),
      maxSeconds: 300,
      traceSeconds: 60,
      seed: "companion-fixture-" + Date.now(),
    }).then(function (payload) {
      if (!payload.ok) throw new Error(payload.error || "Local simulator returned an error.");
      renderFightFixture(payload.fixtureCapture);
      finishAnalysis();
    }, function (error) {
      updateBody({
        status: "Offline",
        message: error.message + " Keep the simulator server running with npm.cmd run dev.",
        kind: "error",
      });
      finishAnalysis();
    });
  }

  function setBusy(isBusy) {
    state.busy = isBusy;
    if (!state.panel) return;
    state.panel.analyzeButton.disabled = isBusy;
    state.panel.captureButton.disabled = isBusy;
  }

  function readSaveText() {
    try {
      return localStorage.getItem(SAVE_KEY);
    } catch (error) {
      return null;
    }
  }

  function installSaveHistorySampler() {
    if (state.historyStarted) return;
    state.historyStarted = true;
    installSaveWriteObserver();
    window.setInterval(recordSaveSnapshot, 250);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") recordSaveSnapshot();
    });
  }

  function installSaveWriteObserver() {
    if (state.saveObserverStarted) return;
    state.saveObserverStarted = true;
    wrapStorageSetItem(typeof Storage !== "undefined" ? Storage.prototype : null);
    if (typeof unsafeWindow !== "undefined" && unsafeWindow.Storage) {
      wrapStorageSetItem(unsafeWindow.Storage.prototype);
    }
  }

  function wrapStorageSetItem(prototype) {
    try {
      if (!prototype || !prototype.setItem || prototype.setItem.__rdscWrapped) return;
      const nativeSetItem = prototype.setItem;
      const wrappedSetItem = function (key, value) {
        const result = nativeSetItem.apply(this, arguments);
        try {
          if (String(key) === SAVE_KEY) recordSaveSnapshot(String(value || ""));
        } catch (error) {}
        return result;
      };
      wrappedSetItem.__rdscWrapped = true;
      wrappedSetItem.__rdscNative = nativeSetItem;
      prototype.setItem = wrappedSetItem;
    } catch (error) {}
  }

  function recordSaveSnapshot(saveTextOverride) {
    const saveText = typeof saveTextOverride === "string" ? saveTextOverride : readSaveText();
    if (!saveText || state.lastSaveText === saveText) return null;
    const entry = {
      capturedAt: new Date().toISOString(),
      saveText: saveText,
    };
    state.saveHistory.push(entry);
    state.lastSaveText = saveText;
    state.lastSaveChangedAt = entry.capturedAt;
    if (state.saveHistory.length > 12) state.saveHistory = state.saveHistory.slice(state.saveHistory.length - 12);
    return entry;
  }

  function postToFirstAvailableEndpoint(endpoints, body) {
    return postToEndpointIndex(endpoints, 0, body, null);
  }

  function postToEndpointIndex(endpoints, index, body, lastError) {
    if (index >= endpoints.length) {
      return Promise.reject(lastError || new Error("Could not reach the local simulator."));
    }
    return gmRequest({
      method: "POST",
      url: endpoints[index],
      headers: { "content-type": "application/json" },
      data: JSON.stringify(body),
      timeout: 12000,
    }).then(function (response) {
      state.lastBaseUrl = OPEN_URLS[index];
      return JSON.parse(response.responseText || "{}");
    }, function (error) {
      return postToEndpointIndex(endpoints, index + 1, body, error);
    });
  }

  function gmRequest(options) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest(Object.assign({}, options, {
        onload: function (response) {
          if (response.status >= 200 && response.status < 300) resolve(response);
          else reject(new Error("HTTP " + response.status));
        },
        onerror: function () { reject(new Error("Network error")); },
        ontimeout: function () { reject(new Error("Local simulator timeout")); },
      }));
    });
  }

  function renderCompanion(companion) {
    const summary = companion && companion.summary ? companion.summary : {};
    const next = summary.nextAction || {};
    const active = companion && companion.activeSketches ? companion.activeSketches : [];
    const warnings = companion && companion.warnings ? companion.warnings : [];
    updateBody({
      status: formatPercent(summary.winRate) + " vs " + (summary.targetName || "target"),
      message: next.title || "No recommendation",
      detail: next.detail || "Decision: " + (summary.decision || "unknown"),
      active: active,
      warnings: warnings,
    });
  }

  function renderFightFixture(capture) {
    const parity = capture && capture.parity ? capture.parity : null;
    const fixture = capture && capture.fixture ? capture.fixture : null;
    const warnings = capture && capture.warnings ? capture.warnings : [];
    const status = parity ? (parity.ok ? "Fixture PASS" : "Fixture mismatch") : "Fixture captured";
    const message = capture && capture.source === "no_observed_fight"
      ? "No observed fight log was found"
      : "Captured " + ((capture && capture.targetName) || "target") + " fixture";
    const detail = parity
      ? "Observed " + parity.observed.outcome + ", simulated " + parity.simulated.outcome + "."
      : "Download the fixture and capture again right after a fight if logs are missing.";

    updateBody({
      status: status,
      message: message,
      detail: detail,
      warnings: warnings,
      kind: parity && !parity.ok ? "error" : "ok",
    });

    if (fixture) {
      const list = document.createElement("div");
      const heading = document.createElement("b");
      const link = document.createElement("a");
      const command = document.createElement("span");
      list.className = "rdsc-list";
      heading.textContent = "Fight fixture";
      link.textContent = "Download fixture JSON";
      link.download = (capture && capture.filename) || "rejected-draft-fight-fixture.json";
      link.href = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(fixture, null, 2));
      command.textContent = (capture && capture.cliEquivalent) || "";
      list.append(heading, link);
      if (command.textContent) list.append(command);
      state.panel.body.append(list);
    }
  }

  function captureBrowserSnapshot() {
    recordSaveSnapshot();
    const visibleCombatLog = captureVisibleCombatLog();
    return {
      companionVersion: VERSION,
      url: String(location.href || ""),
      title: String(document.title || ""),
      capturedAt: new Date().toISOString(),
      localStorageCandidates: readFightStorageCandidates(),
      saveHistory: state.saveHistory.slice(0),
      visibleCombatLog: visibleCombatLog,
      captureDiagnostics: {
        saveHistoryCount: state.saveHistory.length,
        lastSaveChangedAt: state.lastSaveChangedAt,
        visibleCombatLogPresent: Boolean(visibleCombatLog && visibleCombatLog.text),
        visibleCombatLogCharacters: visibleCombatLog && visibleCombatLog.text ? visibleCombatLog.text.length : 0,
      },
    };
  }

  function captureVisibleCombatLog() {
    try {
      const nodes = Array.prototype.slice.call(document.querySelectorAll("dialog, [role='dialog'], section, article, aside, div"));
      let best = null;
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        if (!isVisibleElement(node)) continue;
        const text = normalizeUiText(String(node.innerText || node.textContent || ""));
        if (!looksLikeCombatLog(text)) continue;
        const candidate = {
          text: text.length > 60000 ? text.slice(0, 60000) : text,
          characterCount: text.length,
          tagName: String(node.tagName || ""),
          role: node.getAttribute ? node.getAttribute("role") : null,
        };
        if (!best || candidate.text.length < best.text.length) best = candidate;
      }
      return best;
    } catch (error) {
      return { error: String(error && error.message || error) };
    }
  }

  function looksLikeCombatLog(text) {
    if (!/combat\s+log/i.test(text)) return false;
    if (!/live\s+combat|history/i.test(text)) return false;
    return /enemy|events|time|victory|defeat|loss/i.test(text);
  }

  function normalizeUiText(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function isVisibleElement(node) {
    if (!node || !node.getBoundingClientRect) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (!window.getComputedStyle) return true;
    const style = window.getComputedStyle(node);
    if (!style) return true;
    if (style.display === "none" || style.visibility === "hidden") return false;
    return Number(style.opacity || "1") > 0;
  }

  function readFightStorageCandidates() {
    const candidates = [];
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!/combat|battle|fight|log/i.test(String(key || ""))) continue;
        const value = localStorage.getItem(key);
        if (!value) continue;
        candidates.push({
          key: key,
          value: value.length > 200000 ? value.slice(0, 200000) : value,
          truncated: value.length > 200000,
        });
      }
    } catch (error) {
      candidates.push({ key: "localStorage-error", value: String(error && error.message || error) });
    }
    return candidates;
  }

  function updateBody(options) {
    const panel = state.panel;
    if (!panel) return;
    const status = options.status;
    const message = options.message;
    const detail = options.detail || "";
    const active = options.active || [];
    const warnings = options.warnings || [];
    const kind = options.kind || "ok";

    panel.status.textContent = status;
    panel.root.dataset.kind = kind;
    panel.body.innerHTML = "";

    const main = document.createElement("div");
    main.className = "rdsc-callout";
    const messageNode = document.createElement("strong");
    messageNode.textContent = message;
    main.append(messageNode);
    if (detail) {
      const detailNode = document.createElement("span");
      detailNode.textContent = detail;
      main.append(detailNode);
    }
    panel.body.append(main);

    if (active.length > 0) {
      const list = document.createElement("div");
      list.className = "rdsc-list";
      const heading = document.createElement("b");
      heading.textContent = "Best visible fights";
      list.append(heading);
      active.slice(0, 4).forEach(function (item) {
        const row = document.createElement("span");
        const metric = document.createElement("em");
        row.append(document.createTextNode(String(item.name || "")));
        row.append(document.createTextNode(" "));
        metric.textContent = formatPercent(item.winRate) + " | p90 " + formatSeconds(item.p90Seconds);
        row.append(metric);
        list.append(row);
      });
      panel.body.append(list);
    }

    if (warnings.length > 0) {
      const list = document.createElement("div");
      list.className = "rdsc-list rdsc-warnings";
      const heading = document.createElement("b");
      heading.textContent = "Warnings";
      list.append(heading);
      warnings.slice(0, 3).forEach(function (item) {
        const row = document.createElement("span");
        const detailNode = document.createElement("em");
        row.append(document.createTextNode(String(item.title || "")));
        row.append(document.createTextNode(" "));
        detailNode.textContent = item.detail || "";
        row.append(detailNode);
        list.append(row);
      });
      panel.body.append(list);
    }
  }

  function createPanel() {
    const root = document.createElement("div");
    const head = document.createElement("div");
    const title = document.createElement("span");
    const status = document.createElement("strong");
    const actions = document.createElement("div");
    const analyzeButton = document.createElement("button");
    const captureButton = document.createElement("button");
    const openButton = document.createElement("button");
    const remountButton = document.createElement("button");
    const body = document.createElement("div");

    root.className = "rdsc-panel";
    head.className = "rdsc-head";
    title.textContent = "Simulator";
    status.dataset.rdscStatus = "";
    status.textContent = "Ready";
    head.append(title, status);

    actions.className = "rdsc-actions";
    analyzeButton.type = "button";
    analyzeButton.dataset.rdscAnalyze = "";
    analyzeButton.textContent = "Analyze current run";
    captureButton.type = "button";
    captureButton.dataset.rdscCapture = "";
    captureButton.textContent = "Capture fight fixture";
    openButton.type = "button";
    openButton.dataset.rdscOpen = "";
    openButton.textContent = "Open simulator";
    remountButton.type = "button";
    remountButton.title = "Remount the overlay if the game layout changed.";
    remountButton.textContent = "Fix panel";
    actions.append(analyzeButton, captureButton, openButton, remountButton);

    body.className = "rdsc-body";
    body.dataset.rdscBody = "";

    root.append(head, actions, body);
    return {
      root: root,
      status: status,
      body: body,
      analyzeButton: analyzeButton,
      captureButton: captureButton,
      openButton: openButton,
      remountButton: remountButton,
    };
  }

  function panelCss() {
    return [
      ":host {",
      "all: initial;",
      "display: block;",
      "font: 13px/1.35 Inter, Segoe UI, Arial, sans-serif;",
      "}",
      ".rdsc-panel {",
      "display: block;",
      "width: min(360px, calc(100vw - 32px));",
      "max-height: calc(100vh - 32px);",
      "overflow: auto;",
      "color: #f8f5ef;",
      "border: 2px solid #f8f5ef;",
      "background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,0)), #111311;",
      "box-shadow: 5px 5px 0 rgba(0,0,0,.55);",
      "font: 13px/1.35 Inter, Segoe UI, Arial, sans-serif;",
      "}",
      "* { box-sizing: border-box; }",
      ".rdsc-head {",
      "display: flex;",
      "justify-content: space-between;",
      "gap: 10px;",
      "padding: 10px 12px;",
      "border-bottom: 1px solid rgba(248,245,239,.25);",
      "text-transform: uppercase;",
      "font-weight: 900;",
      "}",
      ".rdsc-head span { color: #20d0ff; }",
      ".rdsc-panel[data-kind=\"error\"] .rdsc-head span,",
      ".rdsc-panel[data-kind=\"error\"] .rdsc-head strong { color: #ff4343; }",
      ".rdsc-actions {",
      "display: grid;",
      "grid-template-columns: 1fr 1fr;",
      "gap: 8px;",
      "padding: 10px 12px;",
      "}",
      "button {",
      "min-height: 32px;",
      "color: #f8f5ef;",
      "border: 1px solid rgba(248,245,239,.35);",
      "background: #1c1d1c;",
      "font: inherit;",
      "font-weight: 900;",
      "text-transform: uppercase;",
      "cursor: pointer;",
      "}",
      "button:disabled { opacity: .55; cursor: wait; }",
      ".rdsc-body {",
      "display: grid;",
      "gap: 8px;",
      "padding: 0 12px 12px;",
      "}",
      ".rdsc-callout,",
      ".rdsc-list {",
      "display: grid;",
      "gap: 4px;",
      "padding: 9px;",
      "border: 1px solid rgba(248,245,239,.18);",
      "background: rgba(255,255,255,.035);",
      "}",
      "strong,",
      "b {",
      "color: #22e59a;",
      "}",
      "span {",
      "color: #aaa49a;",
      "}",
      "em {",
      "color: #f8f5ef;",
      "font-style: normal;",
      "float: right;",
      "}",
      "a {",
      "color: #20d0ff;",
      "font-weight: 900;",
      "text-decoration: underline;",
      "}",
      ".rdsc-warnings b { color: #ff9e2e; }",
    ].join("\n");
  }

  function formatPercent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? (number * 100).toFixed(1) + "%" : "--";
  }

  function formatSeconds(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(1) + "s" : "--";
  }
}());
