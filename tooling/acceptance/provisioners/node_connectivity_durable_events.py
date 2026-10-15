from __future__ import annotations

from .node_connectivity_postgres import (
    NodeConnectivityPostgresProcessProvisioner,
)


class NodeConnectivityDurableEventsProvisioner(
    NodeConnectivityPostgresProcessProvisioner
):
    environment_id = "node-connectivity-durable-events"
    gate_id = "NCP-G04"
    service_id = "events-postgres"
    client_ids = ("events-node-a", "events-node-b")
    attestation_producer = (
        "node-connectivity-durable-events-provisioner"
    )
    failure_label = "Durable Events"
