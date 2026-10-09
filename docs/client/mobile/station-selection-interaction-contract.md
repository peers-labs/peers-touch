# Mobile Station Selection Interaction Contract

```yaml
surface: mobile.entry.station-selection
scenario: select-or-add-a-reachable-station

given:
  - the app is on a phone-width Station selection screen
  - saved reachability may come from an earlier process
  - the selected Station may be reachable, unavailable, or unchecked

when:
  - the screen appears
  - the user enters or retries a Station address

then:
  - the task surface is anchored above the bottom safe area
  - saved reachability is shown as unchecked until this process verifies it
  - Available is shown only after a current signed Station identity check
  - an unavailable selected Station exposes Retry instead of implying readiness
  - the full Station URL and add action read as one quiet field on the page background

visual_invariants:
  - the placeholder shows a complete HTTP(S) URL example
  - the URL input keeps useful width on the narrow supported viewport
  - the HTTP warning stays on one line below the field
  - the logo edge is legible through a soft shadow without a visible border
  - the Station and Sign In surfaces share one page background and spacing rhythm
  - the controls do not wrap, clip, overlap, or leave a large gap below
  - focusing the field changes the outer border only; no inner focus frame

forbidden:
  - persisted online state rendered as current availability
  - a selected but unchecked Station enabling Continue
  - a multiline warning squeezing the address field
  - splitting the URL into protocol and address controls
  - a dropdown, modal, or card solely for choosing HTTPS or HTTP
  - an inner focus outline/box around the input inside the outer control
  - a heavy floating card or outline around the logo

evidence:
  - focused unit assertions
  - foreground iOS Simulator interaction trace
  - before and after screenshots
```

Prototype sync classification: `Product decision`. The prior prototype shares
the same density and status defects as production, so both surfaces must be
updated to this contract.
