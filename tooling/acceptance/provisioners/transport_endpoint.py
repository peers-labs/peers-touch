from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

from tooling.acceptance.core.errors import ProvisioningError


@dataclass(frozen=True)
class OrchestratorEndpoint:
    local_port: int
    scheme: str | None = None
    path: str = ""
    query: str = ""
    fragment: str = ""
    peer_id: str | None = None

    def render(self, remote_port: int) -> str:
        if self.peer_id is not None:
            return (
                f"/ip4/127.0.0.1/tcp/{remote_port}/p2p/{self.peer_id}"
            )
        return urlunsplit(
            (
                self.scheme or "",
                f"127.0.0.1:{remote_port}",
                self.path,
                self.query,
                self.fragment,
            )
        )


def parse_orchestrator_endpoint(value: str) -> OrchestratorEndpoint:
    if value.startswith("/"):
        parts = value.split("/")
        if (
            len(parts) != 7
            or parts[0] != ""
            or parts[1] not in {"ip4", "ip6"}
            or parts[2] not in {"127.0.0.1", "::1"}
            or parts[3] != "tcp"
            or parts[5] != "p2p"
            or not parts[6]
        ):
            raise ProvisioningError(
                "orchestrator Direct endpoint must be a loopback TCP "
                "multiaddr with an exact Node PeerID"
            )
        return OrchestratorEndpoint(
            local_port=_parse_port(parts[4]),
            peer_id=parts[6],
        )

    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise ProvisioningError(
            "orchestrator endpoint must be an HTTP(S) loopback URL "
            "without credentials or a loopback Direct multiaddr"
        )
    try:
        port = parsed.port
    except ValueError as error:
        raise ProvisioningError(
            "orchestrator endpoint port is invalid"
        ) from error
    if port is None:
        raise ProvisioningError(
            "orchestrator endpoint must declare an explicit port"
        )
    return OrchestratorEndpoint(
        local_port=port,
        scheme=parsed.scheme,
        path=parsed.path,
        query=parsed.query,
        fragment=parsed.fragment,
    )


def _parse_port(value: str) -> int:
    try:
        port = int(value)
    except ValueError as error:
        raise ProvisioningError(
            "orchestrator endpoint port is invalid"
        ) from error
    if port < 1 or port > 65535:
        raise ProvisioningError(
            "orchestrator endpoint port is invalid"
        )
    return port
