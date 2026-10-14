# Genesys Cloud PiP Companion

Chrome extension that provides a lightweight, always-on-top companion for Genesys Cloud agents.

The goal is deliberately narrow: keep the essential interaction controls visible while the agent works in CRM, browser tabs, back-office tools, email, or other business applications.

> **Genesys Cloud remains the source of truth. PiP brings the essential interaction controls to the agent.**

---

## 1. Project goals

Genesys PiP Companion was born from a field observation on an customer contact-center floor: agents were working across many applications and could lose the Genesys Cloud window when an interaction arrived.

The Companion does not replace the Genesys Cloud Agent UI and does not implement a second routing or telephony engine. It exposes a small interaction layer for the agent:

- Agent presence and On Queue / Off Queue.
- Incoming, connected, held, and wrap-up interaction states.
- Answer, reject, hold, resume, and hang-up actions.
- Customer / caller context and participant data.
- Mandatory wrap-up selection when required.
- A persistent **Back to tab** action that focuses the original Genesys tab without closing PiP.
- A lightweight visual highlight driven by Participant Data business rules.

---

## 2. Architecture

The implementation is intentionally split into a PiP core and a Genesys integration boundary.

```text
                         GENESYS CLOUD
                    Events + Platform APIs
                              |
                              v
                 +--------------------------+
                 | Genesys Cloud Integration|
                 |                          |
                 |      framework.js        |
                 |  Runs inside the EF iframe|
                 +-------------+------------+
                               |
                         postMessage
                               |
                               v
                 +--------------------------+
                 |      INTEGRATION LAYER    |
                 |                          |
                 | EmbeddableFrameworkAdapter|
                 | Future: Composable Adapter|
                 +-------------+------------+
                               |
                               v
                 +--------------------------+
                 |          PIP CORE         |
                 |                            |
                 | app.js                    |
                 | state.js                  |
                 | interactions.js            |
                 | presence.js                |
                 | participantData.js         |
                 | pipView.js                 |
                 +-------------+--------------+
                               |
                               v
                            AGENT
```

### Architectural rules

1. **Genesys Cloud is the source of truth.**
2. **`framework.js` is the Genesys-side bridge** and is uploaded to the private Embeddable Framework integration.
3. **The PiP core does not depend directly on the concrete Genesys integration.** It talks to an adapter contract.
4. **`pipView.js` is presentation-oriented.** It renders state into HTML and does not perform network calls.
5. The current implementation uses the **Embeddable Framework adapter**. A Composable Desktop adapter is an explicit extension point, not a claim that Composable Desktop is already implemented.

---

## 3. Integration adapter model

The core uses the adapter contract defined in `src/adapters/integrationAdapter.js`.

Current implementations:

```text
PiP core
   |
   +--> EmbeddableFrameworkAdapter
   |       |
   |       +--> GenesysBridge
   |       +--> framework.js
   |
   +--> ComposableDesktopAdapter (extension point / not enabled)
```

`app.html` selects the current adapter through:

```html
data-integration-adapter="embeddable-framework"
```

This keeps the agent experience reusable if the underlying integration mechanism changes.

---

## 4. Embeddable Framework integration

`framework.js` is uploaded to the private Genesys Cloud Embeddable Framework integration and runs inside the Genesys iframe.

It is the only project component that directly uses the Genesys Framework SDK and the Genesys Platform APIs.

The current integration uses:

- Notifications API / WebSocket topics.
- Conversations APIs.
- Users / Presence APIs.
- Routing / Queue APIs.
- Wrap-up code APIs.

### Authentication

The Embedded Framework uses the dedicated login-window flow:

```text
https://apps.mypurecloud.ie/crm/embeddableFramework.html
    ?dedicatedLoginWindow=true
    &enableFrameworkClientId=true
```

`framework.js` also enables:

```javascript
settings: {
  dedicatedLoginWindow: true,
  ...
}
```

The OAuth client used by the integration must authorize the regional framework authentication redirect, for example:

```text
https://apps.mypurecloud.ie/crm/authWindow.html
```

Use the appropriate regional domain for the target Genesys Cloud organization.

---

## 5. End-to-end incoming-call flow

A concrete incoming-call flow is:

```text
1. Customer call reaches Genesys Cloud
              |
              v
2. Notifications API / WebSocket event
              |
              v
3. framework.js receives the event
              |
              | postMessage
              v
4. app.js routes the message
              |
              v
5. interactions.js normalizes the interaction
              |
              v
6. state.js stores the current interaction state
              |
              v
7. pipView.js renders the PiP
              |
              v
8. Agent clicks Answer
              |
              v
9. Adapter -> GenesysBridge -> framework.js
              |
              v
10. Genesys Cloud executes the action
              |
              v
11. New Genesys state is received and rendered again
```

This is the central runtime pattern:

> **Event -> Normalize -> State -> Render -> Action -> Genesys -> New State**

---

## 6. Agent experience

The PiP deliberately exposes only the interaction essentials.

### Agent status

- Current presence.
- Primary / secondary presence menu.
- On Queue / Off Queue.
- Not Responding recovery.

### Interaction

- Incoming interaction.
- Connected call.
- Held call.
- Wrap-up state.
- Caller information.
- Queue name.
- Call timer.

### Participant Data

Participant data from the customer leg can be displayed using a configurable prefix filter.

The display filter controls **what the agent sees**. It does not control highlighting rules.

### Actions

- Answer.
- Reject.
- Hold.
- Resume.
- Hang up.
- Wrap-up code selection / submission.

---

## 7. Participant Data display filtering

The setting `participantDataPrefixes` controls which participant-data rows are displayed in the PiP.

Example:

```text
customer|
prefix1_|
crm.
```

The prefixes are separated by `|`.

An empty filter means all participant data is eligible for display.

This mechanism is intentionally independent from Participant Data highlighting.

---

## 8. Participant Data highlighting

Up to **three** exact name/value highlighting rules can be configured.

Each rule contains:

- Participant Data name.
- Exact value.
- Background color.
- Enabled / disabled state.

Example:

```text
Rule 1
  Name:  customerType
  Value: VIP
  Color: #E8F4FF

Rule 2
  Name:  priority
  Value: URGENT
  Color: #FFE3E3
```

### Exact matching

Matching is strict and case-sensitive:

```text
VIP       -> match
vip       -> no match
VIP_PLUS  -> no match
```

### Priority

Rules are evaluated from top to bottom.

> **The first matching enabled rule wins.**

The configuration UI supports drag-and-drop reordering. The order of the rules is the priority; no separate numeric priority is stored.

### Independence from display filtering

Highlighting is evaluated against the **complete raw Participant Data set**, not the filtered rows displayed in the call-data panel.

For example, the following is valid:

```text
Display filter: customer_

Highlight rule:
  Name:  priority
  Value: URGENT
  Color: #FFE3E3
```

Even if `priority` is hidden by the display filter, it can still highlight the conversation panel.

### Scope of the highlight

The configured color is applied only to the **inner conversation panel**. The outer interaction card, agent status area, PiP footer, and **Back to tab** button keep their normal appearance.

---

## 9. Wrap-up lifecycle

Wrap-up is treated as an interaction requirement, not as a generic interaction phase.

At interaction start, the project can resolve the queue ACW configuration and load the queue's wrap-up codes.

When ACW is mandatory, the agent can select the wrap-up code while the call is still active.

After disconnect:

```text
Call connected
    |
    | ACW required
    v
Wrap-up code can be selected
    |
    | Agent hangs up
    v
Conversation moves to wrap-up
    |
    | Code is submitted
    v
Interaction is removed from PiP
```

Partial terminal notifications must not remove an interaction prematurely when the current state still requires wrap-up.

---

## 10. Back to tab

The PiP contains its own full-width **Back to tab** button at the bottom.

Clicking it:

1. Focuses the original `app.html` tab/window.
2. Leaves the PiP companion open.
3. Keeps the companion available and always on top.

The native Chrome return-to-opener control is disabled for this window so there is one clear navigation action inside the companion.

---

## 11. Settings

The extension popup provides:

### General

- Theme: light / dark / system.
- Language: English / French / system.

### Participant Data

- Display prefix filter.
- Three independent highlighting rules.
- Rule enable / disable.
- Rule expand / collapse.
- Drag-and-drop priority.

The Save action persists the configuration to `chrome.storage.local`.

---

## 12. File map

| File                                         | Responsibility                                                       | Runtime                    |
| -------------------------------------------- | -------------------------------------------------------------------- | -------------------------- |
| `manifest.json`                              | MV3 extension declaration                                            | Chrome                     |
| `popup.html` / `popup.js`                    | Extension settings and launch action                                 | Chrome extension popup     |
| `app.html`                                   | Host page, Embedded Framework iframe and PiP launcher                | Chrome tab                 |
| `framework.js`                               | Genesys bridge, notifications, presence, conversations, wrap-up APIs | Genesys integration iframe |
| `styles.css`                                 | Shared PiP / popup styling                                           | Chrome                     |
| `src/app.js`                                 | Application orchestration and event handling                         | Extension page             |
| `src/state.js`                               | Central runtime state                                                | Extension page             |
| `src/interactions.js`                        | Interaction extraction, phase logic and wrap-up state                | Extension page             |
| `src/presence.js`                            | Agent presence and queue state                                       | Extension page             |
| `src/participantData.js`                     | Participant Data extraction, display filtering and highlighting      | Extension page             |
| `src/pipView.js`                             | PiP rendering and presentation                                       | PiP window                 |
| `src/settings.js`                            | Settings persistence and normalization                               | Extension                  |
| `src/genesysBridge.js`                       | Message transport used by the EF adapter                             | Extension page             |
| `src/messageUtils.js`                        | Generic window-message parsing                                       | Extension page             |
| `src/adapters/integrationAdapter.js`         | Integration contract                                                 | Extension page             |
| `src/adapters/embeddableFrameworkAdapter.js` | Current EF implementation                                            | Extension page             |
| `src/adapters/composableDesktopAdapter.js`   | Future integration extension point                                   | Extension page             |
| `src/adapters/index.js`                      | Adapter factory                                                      | Extension page             |
| `src/constants.js`                           | Defaults, timers, interaction actions, version                       | Extension                  |
| `src/utils.js`                               | Shared utility functions                                             | Extension                  |
| `src/icons.js`                               | Inline SVG icons                                                     | Extension                  |
| `src/i18n/*`                                 | English and French translations                                      | Extension                  |

---

## 13. Installation

### Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the extension folder.
4. Click the extension icon and open the Genesys client.
5. Sign in to Genesys Cloud.
6. Click **Open Picture-in-Picture**.

### Genesys Cloud

1. Open the private Embeddable Framework integration used by the project.
2. Upload the current `framework.js`.
3. Keep the integration active.
4. Verify the OAuth client used by the integration has the scopes required by the API calls in `framework.js`.
5. Verify the regional `/crm/authWindow.html` redirect is configured when using dedicated login.

---

## 14. Regional configuration

The Genesys region must be kept consistent in both places:

### `app.html`

The Embedded Framework iframe URL, for example:

```text
https://apps.mypurecloud.ie/crm/embeddableFramework.html
```

### `framework.js`

The API host and framework OAuth client mapping for the target region.

Do not mix a regional API host, integration URL, and OAuth client from different Genesys Cloud regions.

---

## 15. Troubleshooting

| Symptom                                | Check                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| PiP is empty                           | Check the `app.html` console at Verbose level and look for `[PiP] message` entries.                              |
| Framework does not respond             | Verify `framework.js` is uploaded and the integration is active.                                                 |
| Notifications are unavailable          | Verify Notifications / Conversations scopes and the WebSocket channel.                                           |
| Call exists in EF but not in PiP       | Inspect `genesys:conversation:notification` messages and the phase detected in `src/interactions.js`.            |
| Queue name disappears                  | Check interaction merge / queue fallbacks in `src/interactions.js`.                                              |
| Wrap-up is missing                     | Check queue ACW resolution, `wrapupRequired`, and `loadWrapupCodes()` flow.                                      |
| Participant highlight does not trigger | Check the raw Participant Data name/value, exact case-sensitive matching, enabled rule state, and rule priority. |
| Highlight is too broad                 | The highlight should apply to `.call-band`, not the outer `.interaction-card`.                                   |
| Settings do not persist                | Check Chrome extension local storage and the browser console for popup errors.                                   |

After changing extension files, reload the extension from `chrome://extensions` and reload `app.html`.

After changing `framework.js`, upload the file again to the Genesys Cloud integration.

---

## 17. Current version

**1.0.0**

See `CHANGELOG.md` for the release history.

### Context Rules
Participant Data rules can now combine the existing conversation highlight with a badge, a displayed Participant Data field, an optional copy button, and an HTTPS action. URLs support `{{ParticipantDataName}}` placeholders, for example `https://crm.example/customer/{{CustomerId}}`. Existing highlight-only rules remain compatible.
