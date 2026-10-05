# Module 5: Provider & Model Infrastructure — Acceptance Scenarios

> Companion to `peers-design.md`. Defines verifiable acceptance criteria for P0 delivery.

---

## 1. Provider List & Toggle

### AC-1.1: Provider list loads on settings page mount

**Given** the user navigates to Settings > Model Providers
**When** the page mounts
**Then** `useProviderStore.loadProviders()` is called and the provider list renders with:
- Provider name and logo/icon
- Enabled/disabled toggle switch per row
- Current connection status indicator (if previously tested)

### AC-1.2: Toggle provider enabled/disabled

**Given** the provider list is displayed with provider "OpenAI" enabled
**When** the user clicks the toggle switch for "OpenAI"
**Then**
1. The toggle immediately reflects the new state (optimistic)
2. `toggleProvider("openai", false)` is called
3. On success, `useAgentStore.loadModels()` is called
4. OpenAI models no longer appear in `ModelProviderSelect`
5. If the currently selected chat model was an OpenAI model, the UI indicates the model is unavailable

### AC-1.3: Toggle failure reverts

**Given** provider "OpenAI" is enabled
**When** the toggle is clicked but the server returns an error
**Then** the toggle reverts to enabled state and an error notification is shown

---

## 2. Provider CRUD

### AC-2.1: Create new provider

**Given** the user clicks "Add Provider"
**When** the create modal opens and the user fills:
- Name: "Custom LLM"
- Base URL: "https://llm.example.com/v1"
- API Key: "sk-custom-key"
**And** clicks Submit
**Then**
1. `createProvider(data)` is called
2. The provider list refreshes and shows "Custom LLM"
3. The new provider is auto-selected in the detail panel
4. `useAgentStore.loadModels()` is called

### AC-2.2: Update provider credentials

**Given** provider "OpenAI" is selected in the detail panel
**When** the user changes the API key and clicks Save
**Then**
1. `updateProvider(id, newKey, baseUrl, enabled)` is called
2. The detail refreshes with the updated (masked) key
3. Provider list re-renders (version may change)

### AC-2.3: Delete provider

**Given** provider "Custom LLM" (custom, no builtin models) is selected
**When** the user clicks Delete and confirms
**Then**
1. `deleteProvider(id)` is called
2. The provider disappears from the list
3. Detail panel clears or selects the first remaining provider
4. `useAgentStore.loadModels()` is called — custom models are gone

### AC-2.4: Test connection

**Given** provider "OpenAI" is selected with valid credentials
**When** the user clicks "Test Connection"
**Then**
1. `checkProvider(id, apiKey, baseUrl)` is called
2. On success: green "Connected" indicator shown
3. On failure: red error message with detail (e.g., "401 Unauthorized")

---

## 3. Model Management

### AC-3.1: Toggle individual model

**Given** provider "OpenAI" detail is shown with model "gpt-4-turbo" disabled
**When** the user checks the checkbox for "gpt-4-turbo"
**Then**
1. `toggleModel("openai", "gpt-4-turbo", true)` is called
2. The model checkbox reflects enabled state
3. "gpt-4-turbo" now appears in `ModelProviderSelect`

### AC-3.2: Toggle all models

**Given** provider "OpenAI" has 5 models, 3 enabled
**When** the user clicks "Enable All"
**Then**
1. `toggleAllModels("openai", true)` is called
2. All 5 model checkboxes show enabled
3. All 5 models appear in `ModelProviderSelect`

### AC-3.3: Add custom model

**Given** provider "OpenAI" detail is shown
**When** the user clicks "+ Add Model" and fills:
- ID: "gpt-4o-custom-fine-tune"
- Display name: "GPT-4o Fine-tuned"
- Context window: 128000
- Capabilities: function_call, vision
**Then**
1. `addModel("openai", data)` is called
2. The model appears in the provider's model list
3. If enabled, it appears in `ModelProviderSelect`

### AC-3.4: Delete custom model

**Given** a custom model "gpt-4o-custom-fine-tune" exists
**When** the user clicks the delete icon and confirms
**Then**
1. `deleteModel("openai", "gpt-4o-custom-fine-tune")` is called
2. The model disappears from the list
3. If it was selected for chat, the chat model reverts to default

---

## 4. Model Switch Panel (Chat Input)

### AC-4.1: Panel opens with current selection highlighted

**Given** the user has "gpt-4o" selected as chat model
**When** the user clicks the model trigger in the chat input area
**Then**
1. `ModelProviderSelect` popover opens
2. "gpt-4o" row has highlighted background and check icon
3. Models are grouped by provider name

### AC-4.2: Search filters models

**Given** the panel is open with 15 models across 3 providers
**When** the user types "claude" in the search input
**Then**
1. Only models matching "claude" (name, id, or provider) are shown
2. Provider groups with no matching models are hidden
3. Clearing the search restores all models

### AC-4.3: Select model updates chat

**Given** the panel is open, current model is "gpt-4o"
**When** the user clicks "Claude 3.5 Sonnet"
**Then**
1. `onSelect("claude-3-5-sonnet-20241022", "anthropic")` fires
2. Panel closes
3. Chat input model trigger shows "Claude 3.5 Sonnet"
4. Next message uses the new model

### AC-4.4: Capability badges display correctly

**Given** model "gpt-4o" has `vision=true`, `function_call=true`, `reasoning=false`
**When** the panel displays this model row
**Then**
1. Vision icon (Eye) is shown
2. Tool use icon (Wrench) is shown
3. Reasoning icon (Sparkles) is NOT shown
4. Context window "128K" is shown

### AC-4.5: Empty state with CTA

**Given** no providers are enabled (or all models disabled)
**When** the panel opens
**Then**
1. "No models available" message is shown
2. "Configure providers" link/button is shown
3. Clicking it navigates to Provider Settings page

### AC-4.6: Navigate to settings

**Given** the panel is open
**When** the user clicks "Manage Providers" footer link
**Then**
1. Panel closes
2. Navigation to Settings > Model Providers occurs

---

## 5. Cross-Store Consistency

### AC-5.1: Boot sequence populates runtime projection

**Given** the app starts fresh
**When** the agent store initializes
**Then**
1. `loadModels()` is called during boot
2. `availableModels` is populated from Station (via Rust BFF)
3. `defaultModel` is resolved from agent config
4. Model trigger in chat input shows the default model name

### AC-5.2: Provider mutation cascades to model picker

**Given** provider "DeepSeek" is enabled with 2 models
**When** the user disables "DeepSeek" in Provider Settings
**Then**
1. Provider list shows DeepSeek as disabled
2. Within ~100ms, `useAgentStore.loadModels()` fires
3. DeepSeek models disappear from `ModelProviderSelect`
4. If the user had a DeepSeek model selected, the chat input indicates model unavailable

### AC-5.3: Model addition cascades to model picker

**Given** the user adds a new model to an enabled provider
**When** the add completes
**Then** the new model (if enabled) appears in `ModelProviderSelect` without page refresh

---

## 6. Error Handling

### AC-6.1: Network failure during provider load

**Given** the Station is unreachable
**When** `loadProviders()` is called
**Then**
1. Error is logged via `log.error('provider', ...)`
2. Previously cached provider list remains visible (if any)
3. User-facing error notification is shown

### AC-6.2: Invalid credentials on save

**Given** the user enters an invalid API key
**When** they click "Test Connection"
**Then**
1. The test returns `{ ok: false, error: "..." }`
2. Error message is displayed inline (not just logged)
3. The save button remains enabled for correction

### AC-6.3: Concurrent modification (version conflict)

**Given** the provider was modified elsewhere (version mismatch)
**When** the user attempts to save
**Then**
1. The server rejects with a version conflict error
2. The detail is reloaded from server
3. User is notified: "Provider was modified. Please review and try again."

---

## 7. Non-Functional Requirements

| Requirement | Criteria |
|-------------|----------|
| Provider list load time | < 200ms (local Tauri IPC + Station) |
| Model picker open time | < 50ms (data pre-loaded in store) |
| Search responsiveness | < 16ms per keystroke (client-side filter) |
| No UI flash on toggle | Optimistic update prevents loading flicker |
| Credential security | API keys never appear in logs, never stored in Desktop local state |
| i18n | All user-facing strings use locale keys from `packages/locales/` |

---

## 8. Out of Scope (P2)

These scenarios are explicitly NOT acceptance criteria for P0:

- Benchmark comparison between models
- Per-model reasoning effort / temperature sliders in model picker
- Auto-discover models from Ollama / external providers
- Model deprecation redirect (old model → successor)
- Category tabs (chat / image / embedding) in model picker
- Drag-and-drop reorder of providers or models
- Multi-user model visibility policy
