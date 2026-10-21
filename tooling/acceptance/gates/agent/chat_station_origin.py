"""Suite-owned canonical origin for a loopback Native Station transport."""

from __future__ import annotations

from urllib.parse import urlsplit

from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.provisioners.posix_service_runtime import PosixServiceRuntimeConfig
from tooling.acceptance.provisioners.remote_source_identity import reviewed_remote_transport
from tooling.acceptance.provisioners.station_access_relay_role import (
    StationAccessRelayRoleProvisioner,
)


class ChatStationOrigin:
    """Reuse the governed Compose origin override and restore before lease release."""

    def __init__(self, profile: dict[str, str], station_url: str) -> None:
        deployment = profile.get("PT_STATION_DEPLOY_ENV", "").strip()
        transport, values = reviewed_remote_transport(deployment)
        parsed = urlsplit(station_url)
        if (
            values.get("PT_ACCEPTANCE_DISPOSABLE") != "1"
            or values.get("PT_DEPLOY_ROLE") != "station"
            or deployment.lower().endswith("stable")
            or parsed.scheme != "http"
            or parsed.hostname != transport.target.host
            or not parsed.port
        ):
            raise BlockedError(
                reason="Native Chat origin override requires its reviewed disposable Station",
                resource=f"station:{deployment}",
            )
        self.config = PosixServiceRuntimeConfig(
            environment_name=deployment,
            role="station",
            host=transport.target.host,
            user=transport.target.user,
            ssh_port=transport.target.port,
            known_hosts_file=transport.target.known_hosts_file,
            deploy_path=values["PT_DEPLOY_PATH"],
            runtime_path=values["PT_DEPLOY_PATH"],
            http_port=parsed.port,
            public_port=parsed.port,
            libp2p_port=None,
            public_base_url=station_url,
            compose_project=values["PT_ACCEPTANCE_COMPOSE_PROJECT"],
            compose_service="station",
            data_volume="",
            tls_ca_path="",
            operator_key_path="",
        )
        self.station_url = station_url
        self.active = False

    def activate(self, origin: str) -> None:
        parsed = urlsplit(origin)
        if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port:
            raise ValueError("Native Chat canonical transport must be loopback HTTP")
        # Mark before restart so a failed readiness wait still restores the owner.
        self.active = True
        StationAccessRelayRoleProvisioner._restart_station_origin(self.config, origin)
        StationAccessRelayRoleProvisioner._wait_station_origin(self.station_url)

    def restore(self) -> None:
        if not self.active:
            return
        StationAccessRelayRoleProvisioner._restart_station_origin(
            self.config, self.station_url,
        )
        StationAccessRelayRoleProvisioner._wait_station_origin(self.station_url)
        self.active = False
