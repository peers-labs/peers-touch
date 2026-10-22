from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from tooling.acceptance.station_registry_native_support import (
    station_registry_snapshot,
)


def is_relay_transport(locator: str, transport: object) -> bool:
    locator_url = urlsplit(locator)
    transport_url = urlsplit(str(transport or ""))
    return (
        transport_url.scheme == "https"
        and bool(transport_url.hostname)
        and transport_url.hostname == locator_url.hostname
        and transport_url.port is not None
    )
