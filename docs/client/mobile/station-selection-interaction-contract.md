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
  - protocol, address, and add action read as one composite field

visual_invariants:
  - the protocol prefix has a calm inset and never touches the field boundary
  - the address input keeps useful width on the narrow supported viewport
  - the HTTP warning stays on one line below the field
  - the logo edge is legible through a soft shadow without a visible border
  - the card and its controls do not wrap, clip, overlap, or leave a large gap below

forbidden:
  - persisted online state rendered as current availability
  - a selected but unchecked Station enabling Continue
  - a multiline warning squeezing the address field
  - independent outer borders around protocol and address
  - a heavy outline around the logo

evidence:
  - focused unit assertions
  - foreground iOS Simulator interaction trace
  - before and after screenshots
```

Prototype sync classification: `Product decision`. The prior prototype shares
the same density and status defects as production, so both surfaces must be
updated to this contract.
