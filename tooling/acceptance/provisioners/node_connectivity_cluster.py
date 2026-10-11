from __future__ import annotations

from .node_connectivity_oss_fencing import (
    NodeConnectivityOSSFencingProvisioner,
)


class NodeConnectivityClusterProvisioner(
    NodeConnectivityOSSFencingProvisioner
):
    environment_id = "node-connectivity-cluster"
    gate_id = "NCP-G06"
    service_id = "cluster-postgres"
    object_service_id = "cluster-object-backend"
    client_ids = ("cluster-node-a", "cluster-node-b")
    attestation_producer = "node-connectivity-cluster-provisioner"
    failure_label = "Station Cluster"
