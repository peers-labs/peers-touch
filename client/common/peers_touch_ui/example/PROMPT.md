# PeersTouch UI Example – Wellness Dashboard Demo

## Objective
Build a small desktop demo app (example/) showcasing peers_touch_ui components in a coherent, realistic scenario: a wellness dashboard that aggregates signals from mock sources, visualizes progress, and supports quick assistant prompts. The demo must follow the desktop PROMPTs: views are stateless, controllers hold state; UI library stays framework‑agnostic.

## Modules
- Top Brand Bar: logo/title and actions (search, alert, help)
- Left Icon Sidebar: home, calendar, settings, favorites (icon only)
- Dashboard Grid (center):
  - Wellness Progress card: tabs Daily/Monthly/Weekly/Yearly + heatmap placeholder
  - Stress/Recovery card: line chart + HRV/Glucose mini metrics
  - Assistant card: chips + prompt bar
  - Integrations card: source list with connection status
  - Sleep card: donut chart + duration + deep sleep and recovery indices

## Components Coverage
- Layout: BrandBar, IconSidebar, PTCard
- Inputs: TextBox, PasswordBox, PromptBar, CheckBox, Dropdown, SliderField, NumberInput, PrimaryButton, SecondaryButton
- Display: PTChip, Tabs, ImageView, Gallery
- Charts: LineChart, DonutChart

## State & Pattern
- DemoController (ChangeNotifier) exposes ValueNotifiers:
  - sidebarIndex (int)
  - progressTab (int)
  - linePoints (List<double>)
  - sources (List<Source>)
  - sleep (SleepSummary)
  - assistantSuggestions (List<String>)
- Views: Stateless; subscribe via ValueListenableBuilder; invoke controller methods for actions.

## Mock Data
- Sources (JSON): id, name, status("connected"|"syncing"|"offline"), lastSeen (ISO8601)
- SleepSummary: durationMinutes, deepSleepPercent, recoveryIndex
- Progress: daily cells (7x5 intensity 0–3)
- Line Series: 7 points normalized [0.8..2.5]
- Assistant chips: 3 canned prompts

## Interactions
- Tabs switch updates Progress heatmap dataset.
- Sidebar selection updates current view (stay on dashboard for demo, but reflect selection state).
- “Connect app” button toggles a source to syncing→connected.
- Prompt chip inserts text into PromptBar; send logs the text and appends a mock answer line.
- SliderField in settings adjusts chart accent color alpha (demo setting).
- CheckBox toggles showing gallery card (uses ImageView/Gallery).

## Acceptance Criteria
- All listed components appear at least once in the demo.
- Views contain no mutable state; only controller updates.
- peers_touch_ui imports only Flutter; no GetX.
- Charts render with mock data; tabs and actions update UI reactively.
- Code structure is readable and matches PROMPTs: controllers, value notifiers, listenners.

## File Layout
- example/lib/main.dart – app entry; assembles BrandBar/IconSidebar and grid cards
- example/lib/demo_controller.dart – DemoController + DemoScope(InheritedWidget)
- example/assets/mock.json – optional mock payloads (future step)

## Next Steps
- Replace heatmap placeholder with a simple painted grid.
- Add ImageCard/GradientLayer components for photo cards.
- Provide a per‑card README note linking components used and rationale.
