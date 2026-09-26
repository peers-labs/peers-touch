#!/usr/bin/env python3
"""Run the CHAT-J04 lifecycle variant of the shared interactions journey."""

from __future__ import annotations

import os


GATE_ID = "chat-lifecycle-interactions-group-e2e"


def main() -> int:
    os.environ["PT_CHAT_INTERACTIONS_GATE_ID"] = GATE_ID
    from tooling.acceptance.gates.chat.native_interactions_runner import main

    return main()


if __name__ == "__main__":
    raise SystemExit(main())
