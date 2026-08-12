# Module 4: Agent Config & Profile — Acceptance Scenarios

> Verification contract for the P0 implementation.
> Each scenario is independently testable via manual interaction.
> Last updated: 2026-08-12

---

## Scenario 1: System Prompt Editing

**Precondition**: User is on AgentProfilePage, Soul tab, for any agent.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Locate "System Prompt" section below SOUL.md/AGENTS.md cards | Section visible with monospace textarea |
| 2 | Type system prompt text | Text appears in textarea |
| 3 | Wait 1.5s (debounce) or blur the textarea | Agent is saved — no error toast |
| 4 | Navigate away and return to profile | System prompt text is persisted and displayed |
| 5 | Clear the textarea and blur | System prompt is saved as empty string |

**Verification**: `api.updateAgent(id, { systemPrompt })` is called with correct value.

---

## Scenario 2: System Prompt Used at Chat Runtime

**Precondition**: Agent has a non-empty `systemPrompt` field.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Switch to chat with this agent | Chat session opens |
| 2 | Send a message | Agent responds using the system prompt instructions |
| 3 | Check the runtime config passed to LLM | `systemPrompt` is included as the system message |

**Verification**: The agent turn request includes the system prompt in the system context.

---

## Scenario 3: Opening Message Configuration

**Precondition**: User opens AgentSettingsModal (via gear icon on AgentProfilePage).

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Switch to "Opening" tab | Opening message textarea + questions list visible |
| 2 | Edit opening message text | Text updates in textarea |
| 3 | Add a new opening question via input + Enter/Plus | Question appears in list |
| 4 | Remove a question via X button | Question removed from list |
| 5 | Click Save | Modal closes, success toast shown |
| 6 | Create a new chat session with this agent | Opening message displayed; questions shown as suggestion chips |

**Verification**: `Agent.openingMessage` and `Agent.openingQuestions` persisted correctly.

---

## Scenario 4: Knowledge Resources — Add Document

**Precondition**: User is on AgentProfilePage, Capabilities tab.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Locate "Knowledge Resources" section | Section visible (may show empty state) |
| 2 | Click "+ Add Resource" | Popover/dropdown shows resource type options |
| 3 | Select "Document" | Native file picker opens |
| 4 | Select a file | Resource added to list with filename as title, type=document, enabled=true |
| 5 | Resource appears in list | Shows icon, title, type badge, enabled toggle, remove button |

**Verification**: `Agent.knowledgeResources` JSON updated with new entry.

---

## Scenario 5: Knowledge Resources — Add URL

**Precondition**: User is on AgentProfilePage, Capabilities tab.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "+ Add Resource" | Popover appears |
| 2 | Select "URL" | Text input for URL shown |
| 3 | Enter `https://docs.example.com` and confirm | Resource added with URL as title, type=url, enabled=true |

---

## Scenario 6: Knowledge Resources — Toggle and Remove

**Precondition**: Agent has at least one knowledge resource.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the enabled toggle on a resource | Resource toggles to disabled (visually dimmed) |
| 2 | Save persists | Reload shows resource still disabled |
| 3 | Click remove (X) on a resource | Resource removed from list |
| 4 | Save persists | Reload shows resource gone |

**Verification**: Toggle updates `enabled` field; remove deletes entry from array.

---

## Scenario 7: Model/Provider Binding

**Precondition**: User is on AgentProfilePage with available models loaded.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Select a provider from the provider dropdown | Model dropdown filters to show only that provider's models |
| 2 | Select a model | Model is saved to `Agent.model`, provider to `Agent.provider` |
| 3 | Create a new chat session | Chat uses the bound model for inference |
| 4 | Clear the model selection | Agent falls back to global default model |

**Verification**: `api.setModelConfig('agent:<name>', { provider, model })` called; chat runtime reads the binding.

---

## Scenario 8: Effort Level Configuration

**Precondition**: User is on AgentProfilePage routing bar.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Change effort from "medium" to "high" | Selection updates |
| 2 | Save persists | `Agent.effort` = "high" |
| 3 | Agent uses effort in next turn | Runtime passes effort to the agent turn execution |

---

## Scenario 9: Settings Modal and Profile Page Consistency

**Precondition**: User has edited agent via AgentSettingsModal.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open AgentSettingsModal, change title to "New Title", save | Modal closes, success shown |
| 2 | AgentProfilePage header reflects "New Title" immediately | Hero section shows updated title |
| 3 | Agent roster sidebar shows "New Title" | List item label updated |

**Verification**: `loadAgents()` is called after modal save, store updates propagate.

---

## Scenario 10: Validation Boundaries

| Input | Action | Expected Result |
|-------|--------|-----------------|
| System prompt > 100,000 chars | Paste very long text | Truncated or warning shown; save proceeds with valid portion |
| Opening questions > 10 items | Try to add 11th question | UI prevents addition with warning message |
| Knowledge resources > 50 | Try to add 51st resource | UI prevents addition with capacity warning |
| Empty model (cleared) | Clear model selection | Agent uses global default; no error |

---

## Scenario 11: Optimistic Update and Error Recovery

**Precondition**: Network is unreliable (or Station is stopped).

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Edit system prompt and blur | UI shows saved state optimistically |
| 2 | If API fails | Error toast shown; field reverts to previous value |
| 3 | `pendingMutations` clears | No stuck loading states |

**Verification**: Error path exercises rollback logic in store.

---

## Acceptance Gate

All 11 scenarios must pass for P0 to be considered complete. Scenarios 1-9 are functional requirements. Scenarios 10-11 are robustness requirements.

**Automated verification** (where applicable):
- `pnpm run check` — type-check passes with new fields/actions
- `pnpm run build` — production build succeeds
- Manual smoke test of each scenario in `make desktop` runtime
