#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.transports.ssh import SshTarget, SshTransport


_stop_requested = False


def _write_state(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def _request_stop(_signum: int, _frame: object) -> None:
    global _stop_requested
    _stop_requested = True


def _parse_forward(value: str) -> tuple[str, int]:
    name, separator, raw_port = value.partition(":")
    if not separator or not name:
        raise ValueError("forward must use NAME:REMOTE_PORT")
    port = int(raw_port)
    if port < 1 or port > 65535:
        raise ValueError("forward port must be between 1 and 65535")
    return name, port


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Own bounded local SSH forwards for one runtime cell"
    )
    parser.add_argument("--state-path", type=Path, required=True)
    parser.add_argument("--host", required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--port", type=int, default=22)
    parser.add_argument("--known-hosts-file", default="")
    parser.add_argument("--expires-at", type=int, required=True)
    parser.add_argument("--forward", action="append", required=True)
    args = parser.parse_args()

    signal.signal(signal.SIGINT, _request_stop)
    signal.signal(signal.SIGTERM, _request_stop)
    state = {
        "status": "STARTING",
        "supervisorPid": os.getpid(),
        "expiresAtEpoch": args.expires_at,
        "tunnels": [],
    }
    _write_state(args.state_path, state)

    tunnels = []
    final_status = "STOPPED"
    final_error = ""
    try:
        transport = SshTransport(
            SshTarget(
                host=args.host,
                user=args.user,
                port=args.port,
                known_hosts_file=args.known_hosts_file,
            )
        )
        for value in args.forward:
            name, remote_port = _parse_forward(value)
            tunnel = transport.start_local_forward(remote_port=remote_port)
            tunnels.append(tunnel)
            state["tunnels"] = [
                {
                    "name": current_name,
                    "pid": current.process_id,
                    "localPort": current.local_port,
                    "remotePort": current_remote_port,
                }
                for (current_name, current_remote_port), current in zip(
                    map(_parse_forward, args.forward),
                    tunnels,
                )
            ]
            _write_state(args.state_path, state)

        state["status"] = "READY"
        _write_state(args.state_path, state)
        while not _stop_requested and int(time.time()) < args.expires_at:
            if not all(tunnel.is_alive() for tunnel in tunnels):
                raise RuntimeError("a managed SSH tunnel exited unexpectedly")
            time.sleep(0.25)
    except Exception as error:
        final_status = "FAILED"
        final_error = str(error)
    finally:
        cleanup_errors: list[str] = []
        for tunnel in reversed(tunnels):
            try:
                tunnel.stop()
            except Exception as error:
                cleanup_errors.append(str(error))
        if cleanup_errors:
            final_status = "CLEANUP_FAILED"
            final_error = "; ".join(cleanup_errors)
        state["status"] = final_status
        state["error"] = final_error
        state["cleanupComplete"] = not cleanup_errors
        _write_state(args.state_path, state)
    return 0 if final_status == "STOPPED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
