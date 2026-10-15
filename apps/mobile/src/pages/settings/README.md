# Mobile Settings

`SettingsPage` is the Me summary and selected-detail host. It renders existing
identity/count projections. The summary never mounts a settings form controller.

`SettingsDetail` selects existing Profile, notifications, device preferences,
permissions and native-version dependencies. `SettingsExitBoundary` is the
single save/discard/stay boundary for detail Back, navigation and editor changes.
`SettingsSections` contains the normalized controls and Chat Storage projection.

`GeneralDetail` composes the existing device, language, Profile and notification
owners with a selected Agent defaults controller. Each owner commits and reads
back independently; a later failure retains its draft without rolling back an
earlier successful domain. `SettingsChoiceField` owns the shared Mobile choice
surface and 44px trigger. Agent defaults preserve the other Agent fields and
use its authoritative version for updates. They are Station turn-admission
inputs, not client preference copies.

`MobileThemeProvider` subscribes only to the app-scoped device preference owner.
LobeUI/antd tokens and the CSS surface, text, header and control tokens follow
the same committed light/dark/system preference. Settings detail content owns
its scroll container below the fixed header and safe area.

Storage has an independent selected detail backed by the existing Chat Storage
runtime. Opening it does not mount Chat appearance, Agent or Profile editors.

`FederationDetail` composes the existing revision-fenced Profile owner with a
selected Station governance projection. Discoverability uses one canonical
hidden/by-handle/indexed value; message admission and follower approval retain
their separate Profile fields. Federation joins carry the explicit endpoint and
ID. Governance actions apply to the Station, use its generated capability
projection, distinguish pending approval from active membership, and read back
after each mutation. Owners delete; authorized members leave. Native fixed
paths derive the dynamic Federation ID from the protobuf request. List reads
cancel on section exit and never become a polling loop.

Public identity and diagnostic copying use the official Tauri clipboard plugin
with write-text permission. The shared clipboard service reports an actual
platform failure; browser diagnostics retain their explicit browser fallback.
Recovery phrase copying remains in its native secret-input owner.

`SecurityDetail` owns transient PIN fields and a selected device list. Native
PIN commands persist only a verification hash and failed-attempt state; the
app-scoped Security Runtime gates Auth and foreground restoration. Actor Device
listing/revocation uses the existing generated Actor contracts and native fixed
paths, with version-fenced readback. Current-device revocation remains an
explicit logout operation rather than an accidental device-row action.

`RecoverySection` reads metadata and dispatches backup/restore intents to the
native Recovery service. It does not hold recovery phrases or archive bytes.
The native plugin displays and collects phrases, the shared Messaging Core
exports/imports encrypted history, and Station stores opaque revision bytes.
Successful restoration refreshes projections through the Lifecycle Kernel.

`AgentSettingsDetails` renders one provider editor or the available-model list.
`MemoryDetail`, `SkillsDetail` and `McpDetail` are independent lazy sections.
Memory and Skills select an account-visible Agent and use its durable IDs.
Memory preferences use the generated `MemoryPreferences` contract within that
Agent's existing configuration envelope. Enable, automatic updates and retrieval
weights are version-fenced Agent mutations with authoritative readback. Unowned
configuration fields and existing entries survive edits, disable and reset.
The selected preferences and entry editor share one save/discard/stay boundary;
opening an entry cannot abandon unsaved preferences.
MCP manages actor-scoped remote Server revisions, connection status and tools.
Its secrets remain transient input; configuration, manifests and execution
remain on Station. Writes use native fixed RPCs and authoritative readback.
Section controllers own request cancellation and selected drafts; generated
protobuf encoding/decoding belongs to domain gateways and `agentSettingsRpc`. The native
`station_transport/agent_settings` whitelist owns fixed Station paths and
authentication. Station remains the provider, model and credential truth.
Provider API keys stay in transient input state and are never read through
credential resolution or persisted in the Mobile preference/draft store.

The accepted product catalog is the eight-group, nineteen-section prototype
contract. Current source work adds bindings incrementally; listing model
admission metadata does not prove connection testing, model routing or inference.
Those capabilities still require their own implementation and native Journey.

The current iOS product scope defers Agent settings. Providers, Models, Memory,
Skills and MCP remain visible as disabled pending entries so completed source is
retained without advertising an unfinished capability.
