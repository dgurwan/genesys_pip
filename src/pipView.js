// Rendu de la fenetre Picture-in-Picture: fonctions pures qui transforment
// `state` en HTML. Aucun appel reseau, aucun listener ici (voir app.js).
//
// Tous les textes passent par t() (src/i18n).

import { Icons } from "./icons.js";
import { APP_VERSION } from "./constants.js";
import { escapeHtml, formatDuration } from "./utils.js";
import {
  formatPresenceLabel,
  getDisplayAgentStatus,
  getPresenceDotClass,
  getSelectedPresenceForPrimary,
} from "./presence.js";
import { filterParticipantData, findParticipantDataHighlightColor } from "./participantData.js";
import { isWrapupPending } from "./interactions.js";
import { t } from "./i18n/index.js";
import { normalizeKey } from "./utils.js";

export function copyStylesToPip(pipWindow) {
  if (!pipWindow) return;

  [...document.styleSheets].forEach((styleSheet) => {
    try {
      const cssText = [...styleSheet.cssRules]
        .map((rule) => rule.cssText)
        .join("\n");
      const style = pipWindow.document.createElement("style");
      style.textContent = cssText;
      pipWindow.document.head.appendChild(style);
    } catch {
      if (styleSheet.href) {
        const link = pipWindow.document.createElement("link");
        link.rel = "stylesheet";
        link.href = styleSheet.href;
        pipWindow.document.head.appendChild(link);
      }
    }
  });
}

export function renderPipHtml(state, resolvedTheme) {
  const status = getDisplayAgentStatus(state);
  const isOnQueue = state.presence.queueState === "on";
  const hasPresence = state.presence.grouped.length > 0;
  const participantHighlightColor = findParticipantDataHighlightColor(
    state.interaction?.participantData || [],
    state.settings.participantDataHighlightRules || []
  );

  // Tant que Genesys n'a rien renvoye, on ne devine pas: afficher "Off Queue"
  // et "Inconnu" par defaut donnait un statut faux a l'ouverture de la PiP.
  const statusKnown = state.presence.loaded || Boolean(state.agentStatus?.id);
  const presenceReady = statusKnown && hasPresence;

  // Quand l'agent est On Queue, la pastille suit toujours l'etat de la file,
  // meme si Genesys n'a pas renseigne systemPresence sur le statut courant.
  const dotClass = !statusKnown
    ? "default"
    : isOnQueue
      ? "onqueue"
      : getPresenceDotClass(
          status.systemPresence,
          status.label,
          status.id,
          state.presence.selectedPrimary,
        );

  const statusLabel = !presenceReady
    ? t("presence.loading")
    : formatPresenceLabel(
        isOnQueue
          ? state.presence.queue.onQueue?.label || status.label || t("queue.on")
          : status.label || t("presence.unknown"),
      ) || t("presence.unknown");

  return `
    <div class="pip-shell theme-${escapeHtml(resolvedTheme)}">
      <section class="pip-card hero-card">
        <div class="presence-topbar">
          <button id="presenceMenuToggle" type="button" class="presence-current" ${hasPresence ? "" : "disabled"} title="${escapeHtml(t("presence.change"))}">
            <span class="presence-dot ${dotClass}"></span>
            <span class="presence-current-label">${escapeHtml(statusLabel)}</span>
            <span class="presence-current-chevron">${state.presence.menuOpen ? "⌃" : "⌄"}</span>
          </button>

          <button id="queueToggle" type="button" class="queue-toggle ${isOnQueue ? "on" : "off"}" title="${escapeHtml(t("queue.toggle"))}" ${statusKnown ? "" : "disabled"}>
            <span class="queue-toggle-track"><span class="queue-toggle-thumb"></span></span>
            <span class="queue-toggle-label">${statusKnown ? escapeHtml(isOnQueue ? t("queue.on") : t("queue.off")) : "..."}</span>
          </button>
        </div>

        ${state.presence.updating ? `<div class="status-note">${escapeHtml(t("presence.updating"))}</div>` : ""}
        ${state.presence.menuOpen && hasPresence ? renderPresenceMenu(state) : ""}
        ${state.presence.error ? `<div class="error-banner">${escapeHtml(state.presence.error)}</div>` : ""}
        ${state.routing.error ? `<div class="error-banner">${escapeHtml(state.routing.error)}</div>` : ""}
        ${state.notifications.error ? `<div class="error-banner">${escapeHtml(state.notifications.error)}</div>` : ""}
      </section>

      ${state.routing.noAnswer ? renderNoAnswerCard(state) : ""}
      ${state.interaction ? renderInteractionCard(state, participantHighlightColor) : ""}
      ${!state.routing.noAnswer && !state.interaction ? `<div class="empty-state">${escapeHtml(t("call.none"))}</div>` : ""}

      <div class="pip-footer">
        <button id="backToTab" type="button" class="back-to-tab" title="${escapeHtml(t("app.backToTab"))}">
          <span class="back-to-tab-icon" aria-hidden="true">↩</span>
          <span>${escapeHtml(t("app.backToTab"))}</span>
        </button>
        <div class="pip-version" aria-label="PiP version">v${escapeHtml(APP_VERSION)}</div>
      </div>
    </div>
  `;
}

function renderPresenceMenu(state) {
  return `
    <div class="presence-menu" role="menu">
      ${state.presence.grouped.map((primary) => renderPrimaryPresenceRow(primary, state)).join("")}
    </div>
  `;
}

function renderPrimaryPresenceRow(primary, state) {
  const selectedPresence = getSelectedPresenceForPrimary(
    primary,
    state.agentStatus,
  );
  const isSelected = Boolean(selectedPresence);
  const hasChildren = (primary.children || []).length > 0;
  const isExpanded =
    normalizeKey(state.presence.expandedPrimary) ===
    normalizeKey(primary.systemPresence);
  const activeDot = selectedPresence
    ? getPresenceDotClass(
        selectedPresence.systemPresence || selectedPresence.label,
      )
    : "";
  const hoverDot = getPresenceDotClass(primary.systemPresence);

  return `
    <div class="presence-primary-group">
      <button
        type="button"
        class="presence-row primary-row ${isSelected ? "selected" : ""} hover-${hoverDot}"
        data-presence-primary="${escapeHtml(primary.systemPresence)}">
        <span class="presence-row-left">
          <span class="presence-radio ${isSelected ? `checked ${activeDot}` : ""}"><span class="presence-radio-dot"></span></span>
          <span class="presence-row-label">${escapeHtml(primary.label)}</span>
        </span>
        ${hasChildren ? `<span class="presence-row-chevron">${isExpanded ? "⌄" : "›"}</span>` : ""}
      </button>
      ${hasChildren && isExpanded ? renderSecondaryPresenceRows(primary, state) : ""}
    </div>
  `;
}

function renderSecondaryPresenceRows(primary, state) {
  return `
    <div class="presence-secondary-list">
      ${primary.children
        .map((secondary) => {
          const isSelected = state.agentStatus?.id === secondary.id;
          const dotClass = getPresenceDotClass(secondary.systemPresence);
          return `
          <button
            type="button"
            class="presence-row secondary-row ${isSelected ? "selected" : ""} hover-${dotClass}"
            data-presence-id="${escapeHtml(secondary.id)}"
            data-presence-primary-key="${escapeHtml(secondary.systemPresence)}"
            data-presence-label="${escapeHtml(secondary.label)}">
            <span class="presence-row-left">
              <span class="presence-radio ${isSelected ? `checked ${dotClass}` : ""}"><span class="presence-radio-dot"></span></span>
              <span class="presence-row-label">${escapeHtml(secondary.label)}</span>
            </span>
          </button>
        `;
        })
        .join("")}
    </div>
  `;
}

function renderNoAnswerCard(state) {
  return `
    <section class="pip-card no-answer-card">
      <div class="card-eyebrow">${escapeHtml(t("noAnswer.eyebrow"))}</div>
      <div class="card-title">${escapeHtml(t("noAnswer.title"))}</div>
      <p class="card-copy">${escapeHtml(t("noAnswer.copy"))}</p>
      <div class="action-grid">
        <button id="goBackOnQueue" type="button" class="icon-action success" ${state.routing.updatePending ? "disabled" : ""}>
          ${Icons.queue}<span>${escapeHtml(state.routing.updatePending ? t("noAnswer.backPending") : t("noAnswer.back"))}</span>
        </button>
        <button id="goOffQueue" type="button" class="icon-action neutral">
          ${Icons.moon}<span>${escapeHtml(t("noAnswer.offQueue"))}</span>
        </button>
      </div>
    </section>
  `;
}

function renderInteractionCard(state, participantHighlightColor = "") {
  const interaction = state.interaction;
  const action = state.interactionAction;
  const phase = interaction.phase || "unknown";
  const elapsed = interaction.startTime
    ? formatDuration(Date.now() - interaction.startTime)
    : "--:--";
  const isFinished = phase === "wrapup";

const highlightClass = participantHighlightColor ? " has-participant-highlight" : "";
  const highlightStyle = participantHighlightColor
    ? ` style="--participant-highlight-bg: ${escapeHtml(participantHighlightColor)};"`
    : "";

  return `
    <section class="pip-card interaction-card ${escapeHtml(phase)}">
      <div class="call-band${highlightClass}"${highlightStyle}>
        <span class="call-rail"></span>
        <div class="call-band-body">
          <div class="call-band-top">
            <span class="call-caller">${escapeHtml(interaction.caller || t("phase.unknown"))}</span>
            <span id="callTimer" class="call-timer ${isFinished ? "muted" : ""}">${escapeHtml(elapsed)}</span>
          </div>
          <div class="call-band-meta">
            <span class="call-state-pill">${escapeHtml(t(`phase.${phase}`))}</span>
            <span class="call-queue">${escapeHtml(isFinished ? t("call.finished") : interaction.queueName || "")}</span>
          </div>
          ${renderCallData(state)}
          ${isWrapupPending(interaction) ? renderWrapupBlock(state) : ""}
           ${action?.id === interaction.id ? `<div class="action-processing">${escapeHtml(action.label)}</div>` : renderCallActions(state)}
        </div>
      </div>      
  </section>
  `;
}

// Le wrap-up est saisissable pendant l'appel: pas de panneau qui s'interpose
// entre le clic sur Raccrocher et le raccrochage reel.
function renderWrapupBlock(state) {
  const { wrapup } = state;
  const codes = wrapup.codes || [];
  const isFinished = state.interaction.phase === "wrapup";
  const canReload = Boolean(wrapup.error) && !wrapup.loading && !codes.length;

  return `
    <div class="wrapup-inline">
      <div class="wrapup-inline-head">
        <span class="wrapup-inline-title">${escapeHtml(t("wrapup.title"))}</span>
        <span class="wrapup-inline-flag">${escapeHtml(t("wrapup.required"))}</span>
      </div>

      <select id="wrapupCodeSelect" class="form-control" ${wrapup.loading || !codes.length ? "disabled" : ""}>
        <option value="">${escapeHtml(wrapup.loading ? t("wrapup.loading") : t("wrapup.select"))}</option>
        ${codes.map((code) => `<option value="${escapeHtml(code.id)}" ${code.id === wrapup.selectedCodeId ? "selected" : ""}>${escapeHtml(code.name || code.id)}</option>`).join("")}
      </select>

      ${isFinished ? `<textarea id="wrapupNotes" class="form-control wrapup-notes" rows="2" placeholder="${escapeHtml(t("wrapup.notes"))}">${escapeHtml(wrapup.notes || "")}</textarea>` : ""}
      ${!isFinished && wrapup.selectedCodeId ? `<div class="wrapup-inline-hint">${escapeHtml(t("wrapup.willBeSentOnHangup"))}</div>` : ""}
      ${wrapup.error ? `<div class="error-banner">${escapeHtml(wrapup.error)}</div>` : ""}
      ${canReload ? `<button id="retryWrapupCodes" type="button" class="wrapup-inline-reload">${escapeHtml(t("wrapup.reload"))}</button>` : ""}
    </div>
  `;
}

function renderCallActions(state) {
  const interaction = state.interaction;
  if (!interaction) return "";

  // L'appel est deja coupe: il ne reste que la qualification.
  if (interaction.phase === "wrapup") {
    if (!isWrapupPending(interaction))
      return `<div class="status-note">${escapeHtml(t("call.syncing"))}</div>`;

    return `
      <div class="action-grid single">
        <button id="submitWrapup" type="button" class="icon-action success" ${!state.wrapup.selectedCodeId || state.wrapup.submitting ? "disabled" : ""}>
          ${Icons.check}<span>${escapeHtml(state.wrapup.submitting ? t("wrapup.submitting") : t("wrapup.submit"))}</span>
        </button>
      </div>
    `;
  }

  if (interaction.phase === "alerting") {
    return `
      <div class="action-grid">
        <button id="answerCall" type="button" class="icon-action success">${Icons.answer}<span>${escapeHtml(t("action.answer"))}</span></button>
        <button id="rejectCall" type="button" class="icon-action danger">${Icons.reject}<span>${escapeHtml(t("action.reject"))}</span></button>
      </div>
    `;
  }

  if (interaction.phase === "connected") {
    return `
      <div class="action-grid">
        <button id="holdCall" type="button" class="icon-action warning">${Icons.pause}<span>${escapeHtml(t("action.hold"))}</span></button>
        <button id="hangupCall" type="button" class="icon-action danger">${Icons.hangup}<span>${escapeHtml(t("action.hangup"))}</span></button>
      </div>
    `;
  }

  if (interaction.phase === "held") {
    return `
      <div class="action-grid">
        <button id="resumeCall" type="button" class="icon-action success">${Icons.resume}<span>${escapeHtml(t("action.resume"))}</span></button>
        <button id="hangupCall" type="button" class="icon-action danger">${Icons.hangup}<span>${escapeHtml(t("action.hangup"))}</span></button>
      </div>
    `;
  }

  return `<div class="status-note">${escapeHtml(t("call.syncing"))}</div>`;
}

// Replie par defaut: sur un widget toujours au premier plan, les participant
// data ne doivent jamais pousser les boutons hors de l'ecran.
function renderCallData(state) {
  const interaction = state.interaction;
  const filteredRows = filterParticipantData(
    interaction.participantData || [],
    state.settings.participantDataPrefixes,
  );
  const isOpen = state.callDataOpen;

  return `
    <div class="call-data-card">
      <button id="toggleCallData" type="button" class="call-data-toggle" aria-expanded="${isOpen ? "true" : "false"}">
        <span class="call-data-chevron">${isOpen ? "⌄" : "›"}</span>
        <span class="call-data-title">${escapeHtml(t("callData.title"))}</span>
        <span class="call-data-count">${filteredRows.length}</span>
      </button>

      ${
        isOpen
          ? `
        <div class="call-data-body">
          <div class="call-data-row"><span>${escapeHtml(t("callData.caller"))}</span><strong>${escapeHtml(interaction.caller || "")}</strong></div>
          <div class="call-data-subtitle">${escapeHtml(t("callData.participants"))}</div>
          ${
            filteredRows.length
              ? filteredRows
                  .map(
                    (row) => `
            <div class="call-data-row participant-row">
              <span title="${escapeHtml(row.rawKey || row.key)}">${escapeHtml(row.key)}</span>
              <strong>${escapeHtml(row.value)}</strong>
            </div>
          `,
                  )
                  .join("")
              : `<div class="call-data-empty">${escapeHtml(t("callData.empty"))}</div>`
          }
        </div>
      `
          : ""
      }
    </div>
  `;
}
