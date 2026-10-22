from __future__ import annotations


CHAT_MIXED_NATIVE_GATE_IDS = frozenset(
    {
        "chat-lifecycle-call-resolution-e2e",
        "chat-lifecycle-mixed-client-cross-station-e2e",
        "chat-lifecycle-mixed-client-group-mls-e2e",
        "chat-lifecycle-mixed-client-multi-device-e2e",
        "chat-lifecycle-mixed-client-same-station-e2e",
        "station-access-session-class-suite-e2e",
    }
)
SOCIAL_CROSS_STATION_MIXED_GATE_IDS = frozenset(
    {
        "social-cross-station-mobile-desktop-e2e",
    }
)
STATION_ACCESS_NATIVE_GATE_IDS = frozenset(
    {
        "station-access-auth-e2e",
        "station-access-federation-boundary-e2e",
        "station-access-scope-isolation-e2e",
    }
)

STATION_LIFECYCLE_CHILD_HARNESS_ACTIONS = frozenset(
    {
        "cleanup",
        "lifecycle.restart",
        "lifecycle.resume",
        "lifecycle.scope.read",
        "lifecycle.snapshot",
        "lifecycle.suspend",
        "lifecycle.waitReady",
        "recovery.snapshot",
        "session.logout",
        "settings.device.read",
        "settings.device.update",
        "settings.notifications.read",
        "settings.notifications.update",
        "settings.profile.read",
        "settings.profile.update",
        "social.reconcile",
    }
)

CHAT_MIXED_NATIVE_CHILD_HARNESS_ACTIONS = frozenset(
    {
        "acceptCall",
        "callResolutionState",
        "cleanup",
        "getRealtimeDevice",
        "initiateCall",
        "lifecycle.restart",
        "lifecycle.resume",
        "lifecycle.scope.read",
        "lifecycle.suspend",
        "messaging.attachment.open",
        "messaging.attachment.stage",
        "messaging.command.read",
        "messaging.createDirect",
        "messaging.createGroup",
        "messaging.interact",
        "messaging.projection.read",
        "messaging.read",
        "messaging.reconcile",
        "messaging.search",
        "messaging.send",
        "messaging.typing",
        "navigation.apply",
        "navigation.snapshot",
        "recovery.snapshot",
        "rejectCall",
        "social.projection.read",
        "social.reconcile",
    }
)

SOCIAL_CROSS_STATION_MIXED_CHILD_HARNESS_ACTIONS = frozenset(
    {
        "cleanup",
        "getRealtimeDevice",
        "lifecycle.restart",
        "lifecycle.scope.read",
        "messaging.reconcile",
        "moments.private.acceptance.prepareKeys",
        "moments.private.comment.submit",
        "moments.private.comments.read",
        "moments.private.publishText",
        "moments.private.read",
        "moments.private.reconcile",
        "moments.private.snapshot",
        "navigation.apply",
        "navigation.snapshot",
        "recovery.snapshot",
        "social.reconcile",
    }
)

STATION_ACCESS_NATIVE_CHILD_HARNESS_ACTIONS = frozenset(
    {
        "cleanup",
        "federation.context.read",
        "getRealtimeDevice",
        "lifecycle.restart",
        "lifecycle.scope.read",
        "lifecycle.waitReady",
        "messaging.createDirect",
        "messaging.createGroup",
        "messaging.projection.read",
        "messaging.reconcile",
        "recovery.snapshot",
        "session.logout",
        "social.people.search",
        "social.reconcile",
    }
)


def child_callable_harness_actions(gate_id: str) -> frozenset[str]:
    if gate_id in CHAT_MIXED_NATIVE_GATE_IDS:
        return CHAT_MIXED_NATIVE_CHILD_HARNESS_ACTIONS
    if gate_id in SOCIAL_CROSS_STATION_MIXED_GATE_IDS:
        return SOCIAL_CROSS_STATION_MIXED_CHILD_HARNESS_ACTIONS
    if gate_id in STATION_ACCESS_NATIVE_GATE_IDS:
        return STATION_ACCESS_NATIVE_CHILD_HARNESS_ACTIONS
    return STATION_LIFECYCLE_CHILD_HARNESS_ACTIONS
