from __future__ import annotations


CHAT_MIXED_NATIVE_GATE_IDS = frozenset(
    {
        "chat-lifecycle-call-resolution-e2e",
        "chat-lifecycle-mixed-client-cross-station-e2e",
        "chat-lifecycle-mixed-client-group-mls-e2e",
        "chat-lifecycle-mixed-client-multi-device-e2e",
        "chat-lifecycle-mixed-client-same-station-e2e",
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
        "session.logout",
        "settings.device.read",
        "settings.device.update",
        "settings.notifications.read",
        "settings.notifications.update",
        "settings.profile.read",
        "settings.profile.update",
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
        "recovery.snapshot",
        "rejectCall",
        "social.projection.read",
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
    if gate_id in STATION_ACCESS_NATIVE_GATE_IDS:
        return STATION_ACCESS_NATIVE_CHILD_HARNESS_ACTIONS
    return STATION_LIFECYCLE_CHILD_HARNESS_ACTIONS
