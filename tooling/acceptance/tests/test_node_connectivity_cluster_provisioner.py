from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.errors import ProvisioningError
from tooling.acceptance.gates.station_access.node_connectivity_cluster_native_e2e import (
    RUNTIME_REUSE,
    SCENARIOS,
    _durable_readback_matches,
)
from tooling.acceptance.provisioners.node_connectivity_cluster import (
    NodeConnectivityClusterProvisioner,
    _wait_for_registry,
    cluster_message_readback,
    stop_cluster_node,
)


class NodeConnectivityClusterProvisionerTest(unittest.TestCase):
    def test_compose_environment_binds_two_distinct_nodes(self) -> None:
        environment = (
            NodeConnectivityClusterProvisioner._compose_environment(
                project="pt-ncp-0123456789abcdef",
                host="192.0.2.10",
                source_commit="a" * 40,
                node_a_http=38121,
                node_a_libp2p=38122,
                node_b_http=38123,
                node_b_libp2p=38124,
            )
        )
        self.assertEqual(
            environment["PT_NCP_NODE_A_URL"],
            "http://192.0.2.10:38121",
        )
        self.assertEqual(
            environment["PT_NCP_NODE_B_URL"],
            "http://192.0.2.10:38123",
        )
        self.assertNotEqual(
            environment["PT_NCP_NODE_A_LIBP2P_PORT"],
            environment["PT_NCP_NODE_B_LIBP2P_PORT"],
        )
        self.assertFalse(
            any("SECRET" in key or "PASSWORD" in key for key in environment)
        )

    def test_source_archive_is_exact_head_without_git_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            archive = Path(raw) / "source.tar.gz"
            NodeConnectivityClusterProvisioner._source_archive(archive)
            self.assertTrue(archive.is_file())
            self.assertGreater(archive.stat().st_size, 0)

    def test_control_functions_fail_closed_before_transport(self) -> None:
        invalid = {
            "artifactKind": "acceptance-runtime-manifest",
            "environmentId": "node-connectivity-cluster",
            "gateId": "NCP-G06",
            "runId": "not-a-run",
        }
        with self.assertRaises(ProvisioningError):
            stop_cluster_node(invalid, "station-node-a")
        with self.assertRaises(ProvisioningError):
            stop_cluster_node(
                {**invalid, "runId": "0123456789abcdef"},
                "station-node-c",
            )
        with self.assertRaises(ProvisioningError):
            cluster_message_readback(invalid, "message-1")
        with self.assertRaises(ProvisioningError):
            cluster_message_readback(
                {**invalid, "runId": "0123456789abcdef"},
                "message with spaces",
            )

    def test_durable_readback_uses_validated_message_literal(self) -> None:
        transport = Mock()
        transport.run_argv.side_effect = [
            subprocess.CompletedProcess(
                args=(),
                returncode=0,
                stdout=(
                    '{"eventCount":1,"eventId":"event-1",'
                    '"commitmentCount":1,"receiptCount":1}\n'
                ),
                stderr="",
            ),
            subprocess.CompletedProcess(
                args=(),
                returncode=0,
                stdout="[]\n",
                stderr="",
            ),
        ]
        manifest = {
            "artifactKind": "acceptance-runtime-manifest",
            "environmentId": "node-connectivity-cluster",
            "gateId": "NCP-G06",
            "runId": "0123456789abcdef",
        }
        module = (
            "tooling.acceptance.provisioners.node_connectivity_cluster"
        )
        with patch(
            f"{module}.resolve_deployment_environment_path",
            return_value=Path("/tmp/station-1.env"),
        ), patch(
            f"{module}.load_env_file",
            return_value={
                "PT_DEPLOY_HOST": "station.example",
                "PT_DEPLOY_USER": "acceptance",
            },
        ), patch(
            f"{module}.SshTransport",
            return_value=transport,
        ):
            readback = cluster_message_readback(
                manifest,
                "message-1",
            )

        command = transport.run_argv.call_args_list[0].args[0]
        sql = command[-1]
        self.assertIn("WHERE message_id = 'message-1'", sql)
        self.assertNotIn("-v message_id", sql)
        self.assertNotIn(":'message_id'", sql)
        self.assertEqual(readback["eventCount"], 1)
        self.assertEqual(readback["liveNodes"], [])

    def test_durable_readback_counts_exact_direct_endpoints(self) -> None:
        live_node = {
            "node_peer_id": "node-b",
            "lifecycle_state": "READY",
        }
        observed = {
            "eventCount": 1,
            "commitmentCount": 2,
            "receiptCount": 2,
            "liveNodes": [live_node],
        }

        self.assertTrue(
            _durable_readback_matches(
                observed,
                expected_endpoint_count=2,
                expected_node_peer_id="node-b",
            )
        )
        self.assertFalse(
            _durable_readback_matches(
                {
                    **observed,
                    "commitmentCount": 1,
                    "receiptCount": 1,
                },
                expected_endpoint_count=2,
                expected_node_peer_id="node-b",
            )
        )
        self.assertFalse(
            _durable_readback_matches(
                {
                    **observed,
                    "eventCount": 2,
                },
                expected_endpoint_count=2,
                expected_node_peer_id="node-b",
            )
        )

    def test_cleanup_removes_run_scoped_station_image(self) -> None:
        provisioner = object.__new__(
            NodeConnectivityClusterProvisioner
        )
        provisioner._project = "pt-ncp-0123456789abcdef"
        provisioner._remote_root = (
            "/home/acceptance/peers-touch/acceptance/"
            "ncp-0123456789abcdef"
        )
        provisioner._transport = Mock()
        provisioner._transport.run_argv.side_effect = [
            Mock(),
            subprocess.CompletedProcess(
                args=(),
                returncode=0,
                stdout="",
                stderr="",
            ),
            Mock(),
        ]

        provisioner._cleanup_remote(
            {
                "PT_NCP_STATION_IMAGE": (
                    "pt-ncp-0123456789abcdef-station"
                ),
            },
            "/home/acceptance/peers-touch/station.env",
        )

        commands = [
            call.args[0]
            for call in provisioner._transport.run_argv.call_args_list
        ]
        self.assertIn(
            (
                "docker",
                "image",
                "rm",
                "pt-ncp-0123456789abcdef-station",
            ),
            commands,
        )

    def test_native_suite_reuses_one_runtime(self) -> None:
        self.assertEqual(RUNTIME_REUSE.scope, "suite")
        self.assertEqual(RUNTIME_REUSE.scenario_ids, SCENARIOS)
        self.assertEqual(RUNTIME_REUSE.max_provisioning_runs, 1)
        self.assertEqual(RUNTIME_REUSE.max_client_launches, 2)
        self.assertTrue(RUNTIME_REUSE.require_attach_only_scenarios)
        self.assertTrue(RUNTIME_REUSE.require_receiver_visible_proof)
        self.assertFalse(RUNTIME_REUSE.allow_client_replacement)

    def test_registry_waits_for_two_live_nodes_and_shared_digests(self) -> None:
        expected = [
            {
                "station_peer_id": "station",
                "node_peer_id": "node-a",
                "mode": "cluster",
                "cluster_ready": True,
                "lifecycle_state": "READY",
                "shared_backing_digest": "backing",
                "enabled_owners_digest": "owners",
            },
            {
                "station_peer_id": "station",
                "node_peer_id": "node-b",
                "mode": "cluster",
                "cluster_ready": True,
                "lifecycle_state": "READY",
                "shared_backing_digest": "backing",
                "enabled_owners_digest": "owners",
            },
        ]
        with patch(
            "tooling.acceptance.provisioners.node_connectivity_cluster."
            "_registry_rows",
            side_effect=[expected[:1], expected],
        ), patch(
            "tooling.acceptance.provisioners.node_connectivity_cluster."
            "time.sleep"
        ):
            rows = _wait_for_registry(
                Mock(),
                "postgres",
                station_ids={"station"},
                node_ids={"node-a", "node-b"},
                timeout=1,
            )
        self.assertEqual(rows, expected)

    def test_entrypoint_projects_explicit_shared_oss_backend(self) -> None:
        source = (
            REPO_ROOT / "tooling" / "docker" / "entrypoint.sh"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "OVERLAYS=\"${OVERLAYS}, oss_backend.docker.yml\"",
            source,
        )
        patch_loop = source.split(
            "# ── Patch peers.yml `includes:` once, idempotently",
            maxsplit=1,
        )[1]
        self.assertIn("oss_backend.docker.yml", patch_loop)

    def test_failover_probe_uses_real_conversation_read(self) -> None:
        source = (
            REPO_ROOT
            / "tooling"
            / "acceptance"
            / "gates"
            / "station_access"
            / "node_connectivity_cluster_native_e2e.py"
        ).read_text(encoding="utf-8")
        failover = source.split(
            "def _failover_scenario",
            maxsplit=1,
        )[1].split(
            "def _durable_scenario",
            maxsplit=1,
        )[0]
        self.assertIn('"conversation_sync_from_station"', failover)
        self.assertIn('"conversation_id": conversation_id', failover)
        self.assertIn("call_async_harness(", failover)
        self.assertIn('namespace="stationAccess"', failover)
        self.assertIn('"cluster.route-b.refresh"', failover)
        self.assertLess(
            failover.index('"cluster.route-b.refresh"'),
            failover.index('"cluster.node-a.stop"'),
        )
        self.assertNotIn('"hydrateActiveActor"', failover)
        self.assertNotIn('"syncFriendSession"', failover)


if __name__ == "__main__":
    unittest.main()
