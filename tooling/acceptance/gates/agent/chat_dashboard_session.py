"""Suite-owned Dashboard browser; scenarios attach to its authenticated session."""

from __future__ import annotations

import json
import selectors
import subprocess
from typing import Any

from tooling.acceptance.gates.agent.native_agent_runner import REPO_ROOT, require


class ChatDashboardSession:
    def __init__(self, runner: Any) -> None:
        self.runner = runner
        self.process: subprocess.Popen[str] | None = None

    def start(self) -> None:
        self.process = subprocess.Popen(
            ["node", str(REPO_ROOT / "tooling/acceptance/gates/agent/chat_dashboard_session.mjs")],
            cwd=REPO_ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True,
        )
        self.call("start", {
            "stationUrl": self.runner.station_url,
            "sourceCommit": self.runner.runtime_manifest["source"]["commit"],
            # Committed disposable Dashboard operator, not vendor credentials.
            "username": "peers", "password": "peers",
        })

    def call(self, action: str, payload: dict[str, Any] | None = None) -> Any:
        require(self.process is not None, "Dashboard Suite session is absent")
        require(self.process.stdin is not None and self.process.stdout is not None,
                "Dashboard Suite transport is absent")
        self.process.stdin.write(json.dumps({"action": action, "payload": payload or {}}) + "\n")
        self.process.stdin.flush()
        with selectors.DefaultSelector() as selector:
            selector.register(self.process.stdout, selectors.EVENT_READ)
            require(bool(selector.select(90)), f"Dashboard {action} timed out")
        response = json.loads(self.process.stdout.readline())
        require(response.get("ok") is True,
                response.get("error") or f"Dashboard {action} failed")
        return response.get("value")

    def api(self, route: str, body: dict[str, Any] | None = None) -> Any:
        """Fixture setup/readback only; UI obligations use named browser actions."""
        return self.call("api", {"route": route, "body": body or {}})

    def create_fixture(self, provider_id: str, name: str, endpoint: str,
                       key: str, model: dict[str, Any]) -> dict[str, Any]:
        self.api("provider/create", {
            "provider_id": provider_id, "display_name": name,
            "base_url": endpoint, "protocol": "openai",
        })
        self.runner.chat_provider_fixture_ids.append(provider_id)
        self.api("credential/set", {"provider_id": provider_id, "api_key": key})
        self.api("model/create", {"provider_id": provider_id, **model})
        access = self.api("access/get", {"provider_id": provider_id})["access"]
        self.api("access/set", {**access, "grants": [{
            "actor_ptid": self.runner.actor_ptid, "all_actors": False,
            "model_id": model["model_id"], "all_models": False,
        }]})
        return self.api("provider/get", {"provider_id": provider_id})["provider"]

    def delete_fixture(self, provider_id: str) -> None:
        provider = self.api("provider/get", {"provider_id": provider_id})["provider"]
        self.api("provider/delete", {"provider_id": provider_id, "version": provider["version"]})

    def stop(self) -> None:
        if self.process is None:
            return
        try:
            if self.process.poll() is None:
                self.call("stop")
                self.process.wait(timeout=15)
        finally:
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
            if self.process.stdin:
                self.process.stdin.close()
            if self.process.stdout:
                self.process.stdout.close()
            self.process = None
