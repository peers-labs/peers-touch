#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHAT_AREA = ROOT / "src" / "components" / "ChatArea.tsx"
STATE = ROOT / "src" / "state.ts"


def require(source: str, values: tuple[str, ...], label: str) -> None:
    missing = [value for value in values if value not in source]
    if missing:
        raise SystemExit(f"{label} missing canonical projection boundary: {missing}")


def forbid(source: str, values: tuple[str, ...], label: str) -> None:
    present = [value for value in values if value in source]
    if present:
        raise SystemExit(f"{label} owns terminal chat truth locally: {present}")


def main() -> None:
    chat_area = CHAT_AREA.read_text(encoding="utf-8")
    state = STATE.read_text(encoding="utf-8")

    forbid(
        chat_area,
        (
            "setReactionsByMessage",
            "setRetractedMessageIds",
            "setHiddenMessageIds",
            "setPinnedMessageIds",
            "setThreadRepliesByRoot",
            "setPeerTyping",
            "typingTimer",
        ),
        "ChatArea",
    )
    require(
        chat_area,
        (
            "onSendMessage",
            "onRetryMessage",
            "onReactMessage",
            "onTogglePinMessage",
            "onRetractMessage",
            "onHideMessage",
            "onSendThreadReply",
            "onForwardMessage",
            "retractedMessageIds",
            "hiddenMessageIds",
            "pinnedMessageIds",
            "threadRepliesByRoot",
            "peerTyping",
        ),
        "ChatArea",
    )
    require(
        state,
        (
            "scheduleDeliveredProjection",
            "reactToMessage",
            "toggleMessagePin",
            "retractMessage",
            "hideMessageForActor",
            "sendThreadReply",
            "forwardMessage",
        ),
        "prototype runtime adapter",
    )

    print("social-chat interaction projection contract: PASS")


if __name__ == "__main__":
    main()
