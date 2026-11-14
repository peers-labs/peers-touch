---
kind: pitfall
title: Call media elements must rebind after mount transitions
status: active
owns:
  - apps/mobile/src/components/call/MobileCallSurface.tsx
  - apps/desktop/src/components/chat/CallSurface.tsx
  - packages/client-chat-core/src/callMediaStats.ts
  - tooling/acceptance/gates/chat/lifecycle_call_resolution.py
related:
  - docs/architecture/domains/chat/calling/voice-video.md
referenced-by: []
detected: 2026-11-14
---

# Call media elements must rebind after mount transitions

## Symptom

Source inspection found two audible outlets for the same remote MediaStream
on both single-call surfaces. Desktop camera off/on replaced its local video
element while retaining the stream identity; its binding effect did not rerun.
Mobile's incoming-to-active transition could likewise mount an unbound video.
RTP counters alone could not detect these presentation defects.

## Root cause

Stream identity and rendered element lifetime are independent. Binding only
when a stream changes misses replacement elements. An unmuted video also plays
the audio tracks of the same stream attached to the dedicated audio element.

## Mitigation

The existing presentation owners bind after media visibility, camera and
display-mode transitions. Both video elements stay muted, with one dedicated
remote audio outlet. Media session lifetime remains with the call manager.

The original mixed call-resolution Gate now reads exact stream binding,
advancing playback time, positive visible/decoded video dimensions and one
audible remote outlet on both native clients. Desktop camera off/on uses its
visible control, then must restore progressing video. Existing arbitration,
RTP, Mobile controls, ICE restart and teardown assertions remain required.

## How to detect a recurrence

Run the original `chat-lifecycle-call-resolution-e2e` through the approved
Desktop/iOS runtime. It must complete incoming/outgoing audio/video and camera
reactivation with real media. Run its proof rejection regression:

```bash
python3 -m unittest tooling.acceptance.gates.chat.lifecycle_mixed_client_test
```

The regression rejects duplicate or paused audio, missing binding, stalled
video playback and zero video dimensions even when RTP counters progress.
