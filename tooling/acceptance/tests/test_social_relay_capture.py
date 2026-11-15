"""Synthetic framing and failure checks; actual product proof stays at Suite."""
from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
import os
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import dpkt

from tooling.acceptance.core import EphemeralCapabilityBlocked
from tooling.acceptance.core import evidence_store
from tooling.acceptance.fixtures import social_relay_capture as capture
from tooling.acceptance.fixtures import social_relay_packet as packet
from tooling.acceptance.fixtures import social_relay_capture_worker as worker

ROOT = Path(__file__).resolve().parents[3]
LEGS = [
    {"relayAddress": "192.0.2.3", "relayPort": 4112,
     "stationAddress": "192.0.2.1", "stationPort": port}
    for port in (39000, 39001)
]
MARKER = b"exact-public-fixture-marker-0123456789"


def wire(*, link=dpkt.pcap.DLT_EN10MB, segments=None, legs=LEGS, fragment=None):
    output = io.BytesIO()
    writer = dpkt.pcap.Writer(output, snaplen=65535, linktype=link)
    records = segments if segments is not None else [
        (index, direction, 100, b"opaque")
        for index in (0, 1) for direction in (0, 1)
    ]
    for index, direction, sequence, body in records:
        leg = legs[index]
        src, dst = leg["stationAddress"], leg["relayAddress"]
        sport, dport = leg["stationPort"], leg["relayPort"]
        if direction:
            src, dst, sport, dport = dst, src, dport, sport
        tcp = dpkt.tcp.TCP(sport=sport, dport=dport, seq=sequence,
                           off=5, flags=dpkt.tcp.TH_ACK, data=body)
        ipv6 = ":" in src
        if ipv6:
            network = dpkt.ip6.IP6(
                src=socket.inet_pton(socket.AF_INET6, src),
                dst=socket.inet_pton(socket.AF_INET6, dst),
                nxt=dpkt.ip.IP_PROTO_TCP, data=tcp,
            )
            if fragment is not None:
                network.nxt = dpkt.ip.IP_PROTO_FRAGMENT
                network.extension_hdrs = {
                    dpkt.ip.IP_PROTO_FRAGMENT: dpkt.ip6.IP6FragmentHeader(
                        nxt=dpkt.ip.IP_PROTO_TCP, frag_off=fragment[0], m_flag=fragment[1], id=1),
                }
            network.plen = len(network) - 40
        else:
            network = dpkt.ip.IP(src=socket.inet_aton(src), dst=socket.inet_aton(dst),
                                p=dpkt.ip.IP_PROTO_TCP, data=tcp)
            network.len = len(network)
        ethertype = dpkt.ethernet.ETH_TYPE_IP6 if ipv6 else dpkt.ethernet.ETH_TYPE_IP
        frame = (dpkt.ethernet.Ethernet(type=ethertype, data=network)
                 if link == dpkt.pcap.DLT_EN10MB else
                 dpkt.sll2.SLL2(ethtype=ethertype, data=network))
        writer.writepkt(bytes(frame))
    return output.getvalue()


class PacketTests(unittest.TestCase):
    def observe(self, data, **options):
        return packet.observe(data, legs=options.pop("legs", LEGS),
                              markers=(MARKER,), station_legs=options.pop("station_legs", [[0], [1]]),
                              **options)

    def test_same_nat_nodes_are_bound_by_actual_ports_in_both_directions(self):
        for link in (dpkt.pcap.DLT_EN10MB, dpkt.pcap.DLT_LINUX_SLL2):
            result = self.observe(wire(link=link))
            self.assertEqual(result["directionBytes"], [[6, 6], [6, 6]])
            self.assertFalse(result["plaintextObserved"])
            self.assertNotIn("opaque", repr(result))

    def test_split_out_of_order_retransmitted_plaintext_is_detected(self):
        segments = [(0, 0, 110, MARKER[10:]), (0, 0, 100, MARKER[:10]),
                    (0, 0, 100, MARKER[:10])]
        segments += [(index, direction, 100, b"opaque") for index, direction in ((0, 1), (1, 0), (1, 1))]
        self.assertTrue(self.observe(wire(segments=segments))["plaintextObserved"])

    def test_empty_truncated_one_leg_and_one_direction_cannot_pass(self):
        original = wire()
        for invalid in (b"", original[:24], original[:-1], original + b"partial",
                        wire(segments=[(0, 0, 100, b"one")]),
                        wire(segments=[(i, 0, 100, b"one") for i in (0, 1)])):
            with self.assertRaises(ValueError):
                self.observe(invalid)

    def test_unbound_port_and_conflicting_overlap_are_rejected(self):
        foreign = copy.deepcopy(LEGS)
        foreign[0]["stationPort"] = 39999
        with self.assertRaisesRegex(ValueError, "unbound"):
            self.observe(wire(legs=foreign))
        with self.assertRaisesRegex(ValueError, "overlap"):
            self.observe(wire(segments=[(0, 0, 100, b"ab"), (0, 0, 101, b"x")]))
        self.assertEqual(packet.contiguous_streams([(10, b"ab"), (20, b"cd")]), [b"ab", b"cd"])
        self.assertEqual(packet.contiguous_streams([((1 << 32) - 2, b"ab"), (0, b"cd")]), [b"abcd"])

    def test_complete_ipv6_is_accepted_and_all_fragment_forms_are_rejected(self):
        legs = [{**leg, "relayAddress": "2001:db8::3", "stationAddress": "2001:db8::1"}
                for leg in LEGS]
        self.assertEqual(self.observe(wire(legs=legs), legs=legs)["directionBytes"], [[6, 6], [6, 6]])
        for fragment in ((0, 0), (0, 1), (1, 0), (1, 1)):
            with self.assertRaisesRegex(ValueError, "fragmented"):
                self.observe(wire(legs=legs, fragment=fragment), legs=legs)

    def test_parallel_connections_require_one_actual_bidirectional_leg_per_station(self):
        legs = [LEGS[0], {**LEGS[0], "stationPort": 39999}, LEGS[1]]
        groups = [[0, 1], [2]]
        segments = [(index, direction, 100, b"opaque")
                    for index in (1, 2) for direction in (0, 1)]
        result = self.observe(wire(legs=legs, segments=segments),
                              legs=legs, station_legs=groups)
        self.assertEqual(result["directionBytes"], [[0, 0], [6, 6], [6, 6]])
        # Opposite one-way flows on different parallel connections cannot
        # manufacture the original bidirectional-leg condition.
        one_way = [(0, 0, 100, b"one"), (1, 1, 100, b"one"),
                   (2, 0, 100, b"two"), (2, 1, 100, b"two")]
        with self.assertRaisesRegex(ValueError, "bidirectional"):
            self.observe(wire(legs=legs, segments=one_way), legs=legs, station_legs=groups)
        for invalid in ([[0], [1]], [[0, 1], [1, 2]], [[0, 1, 2], []],
                        [[False, 1], [2]], [[0, 1, 2]]):
            with self.subTest(groups=invalid), self.assertRaises(ValueError):
                self.observe(wire(legs=legs, segments=segments), legs=legs, station_legs=invalid)
        # Every candidate is decoded and scanned, including a sibling that
        # carried only one direction while the other leg carried the Journey.
        leaked = segments + [(0, 0, 100, MARKER[:10]), (0, 0, 110, MARKER[10:])]
        self.assertTrue(self.observe(wire(legs=legs, segments=leaked),
                                    legs=legs, station_legs=groups)["plaintextObserved"])


class CaptureHandlerTests(unittest.TestCase):
    def setUp(self):
        self.handler = capture.SocialRelayCaptureHandler(
            config=SimpleNamespace(role="relay", environment_name="relay-fixture"),
            inventory={"artifactKind": "social-relay-preparation", "sourceCommit": "a" * 40,
                       "runId": "b" * 16, "stations": {"first": {}, "second": {}}},
            trust_anchor=b"public-ca", probe=ROOT, probe_digest="c" * 64, repo_root=ROOT,
            evidence_environment={},
        )
        self.snapshot = {"namespace": {"pid": 12, "startTicks": "34"},
                         "legs": LEGS, "connections": [], "stationLegs": [[0], [1]]}
        self.handler._snapshot = Mock(side_effect=lambda **_: copy.deepcopy(self.snapshot))
        self.data = wire()
        self.control = self.handler._control = Mock(side_effect=lambda operation, **_: {
            "arm": {"armed": True, "owner": {"pid": 13, "startTicks": "35"}},
            "finish": {"stopped": True, "exitCode": 0, "reason": "requested",
                       "kernelDrops": 0, "pcap": base64.b64encode(self.data).decode()},
            "clear": {"cleared": True},
        }[operation])
        self.files = {}
        self.enterContext(patch.object(capture, "write_current_artifact",
            side_effect=lambda name, value, **_: self.files.update({name: value})))
        self.enterContext(patch.object(capture, "current_artifact_ref",
            side_effect=lambda name, **_: Mock(to_dict=lambda: {
                "path": name, "sha256": hashlib.sha256(self.files[name]).hexdigest(),
            })))

    def invoke(self, operation, payload=None):
        return self.handler.invoke(operation, payload or {},
            deadline_monotonic=time.monotonic() + 30, cancellation=threading.Event())

    def arm(self):
        return self.invoke("arm", {"markers": [MARKER.decode(), "second-" + MARKER.decode()]})

    def test_one_parent_persists_original_capture_and_owns_clear(self):
        self.assertEqual(self.arm(), {"armed": True})
        result = self.invoke("finish")
        self.assertFalse(result["plaintextObserved"])
        self.assertEqual(result["directionBytes"], [[6, 6], [6, 6]])
        self.assertEqual(len(self.files), 2)
        evidence = json.loads(next(value for name, value in self.files.items() if name.endswith(".json")))
        self.assertEqual(evidence["captureArtifact"]["sha256"], hashlib.sha256(self.data).hexdigest())
        self.assertNotIn(MARKER.decode(), repr(evidence))
        self.assertEqual(self.invoke("clear"), {"cleared": True})
        self.assertTrue(self.handler.close().closed)

    def test_original_parent_writes_capture_to_bound_run_without_ambient_context(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            store = evidence_store.EvidenceStore(Path(directory) / "artifacts", worktree=ROOT)
            with store.begin_run("social-public-feed-native-e2e", source={"commit": "a" * 40}) as run:
                from tooling.acceptance.provisioners import social_relay

                fixture = social_relay.SocialRelayFixture(
                    profile="fedlab-a", repo_root=ROOT, register_cleanup=Mock(),
                    acquire_profile_lease=Mock(), acquire_source_lease=Mock(),
                )
                fixture.config = self.handler.config
                fixture.inventory = self.handler.inventory
                fixture.capture_probe = ROOT
                fixture.capture_probe_digest = "c" * 64
                environment = run.subprocess_environment({})
                with patch.object(social_relay, "resolve_posix_relay_trust_anchor",
                                  return_value=(b"public-ca", "fixture")):
                    handler = fixture.capture_handler(evidence_environment=environment)
                handler._snapshot, handler._control = self.handler._snapshot, self.control
                # These old mocks concealed the missing parent run context.
                with patch.object(capture, "write_current_artifact",
                                  evidence_store.write_current_artifact), \
                     patch.object(capture, "current_artifact_ref",
                                  evidence_store.current_artifact_ref):
                    environment.clear()
                    handler.invoke("arm", {"markers": [MARKER.decode(), "second-" + MARKER.decode()]},
                                   deadline_monotonic=time.monotonic() + 30, cancellation=threading.Event())
                    try:
                        result = handler.invoke("finish", {}, deadline_monotonic=time.monotonic() + 30,
                                                cancellation=threading.Event())
                        evidence_ref = result["evidence"]
                        self.assertEqual(evidence_ref["runId"], run.run_id)
                        self.assertEqual(evidence_ref["gateId"], run.gate_id)
                        evidence = json.loads(store.resolve(
                            evidence_store.ArtifactRef.from_dict(evidence_ref),
                        ).read_bytes())
                        capture_ref = evidence["captureArtifact"]
                        self.assertEqual(store.resolve(
                            evidence_store.ArtifactRef.from_dict(capture_ref),
                        ).read_bytes(), self.data)
                        self.assertEqual(capture_ref["sha256"], hashlib.sha256(self.data).hexdigest())
                        self.assertEqual(result["directionBytes"], [[6, 6], [6, 6]])
                        self.assertFalse(result["plaintextObserved"])
                        self.assertNotIn(MARKER.decode(), repr(evidence))
                        self.assertNotIn("PT_ACCEPTANCE_RUN_ID", os.environ)
                    finally:
                        self.assertTrue(handler.close().closed)
                        self.assertEqual(handler._evidence_environment, {})

    def test_missing_explicit_capture_binding_cannot_borrow_an_ambient_run(self):
        with tempfile.TemporaryDirectory() as directory:
            store = evidence_store.EvidenceStore(Path(directory) / "artifacts", worktree=ROOT)
            with store.begin_run("other-gate", source={"commit": "a" * 40}) as ambient:
                with patch.dict(os.environ, ambient.subprocess_environment({}), clear=True), \
                     patch.object(capture, "write_current_artifact", evidence_store.write_current_artifact):
                    self.arm()
                    with self.assertRaises(EphemeralCapabilityBlocked) as caught:
                        self.invoke("finish")
                    self.assertIsInstance(caught.exception.__cause__, evidence_store.EvidenceRootInvalid)
                    self.assertEqual(list(ambient.run_dir.glob("runtime/**/*.pcap")), [])
                    self.assertTrue(self.handler.close().closed)

    def test_changed_namespace_and_dropped_capture_cannot_pass_but_remain_owned(self):
        self.arm()
        self.snapshot["namespace"]["startTicks"] = "replacement"
        with self.assertRaises(EphemeralCapabilityBlocked):
            self.invoke("finish")
        self.assertTrue(self.handler._may_exist)
        self.assertTrue(self.handler.close().closed)
        self.control.assert_called_with("clear", deadline=unittest.mock.ANY,
                                        cancellation=unittest.mock.ANY)

    def test_unknown_arm_outcome_is_quarantined_and_failed_cleanup_stays_failed(self):
        environment = {"PT_ACCEPTANCE_REDACTION_VALUES": '["private-fixture-value"]'}
        self.handler._evidence_environment = dict(environment)
        self.control.side_effect = RuntimeError("lost acknowledgement")
        with self.assertRaises(EphemeralCapabilityBlocked):
            self.arm()
        self.assertTrue(self.handler._may_exist)
        failed = self.handler.close()
        self.assertFalse(failed.closed)
        self.assertFalse(failed.secrets_zeroized)
        self.assertEqual(self.handler._evidence_environment, environment)
        self.control.side_effect = None
        self.control.return_value = {"cleared": True}
        completed = self.handler.close()
        self.assertTrue(completed.closed)
        self.assertTrue(completed.secrets_zeroized)
        self.assertEqual(self.handler._markers, ())
        self.assertEqual(self.handler._evidence_environment, {})

    def test_caller_cannot_supply_route_packet_or_observation_truth(self):
        with self.assertRaises(EphemeralCapabilityBlocked):
            self.invoke("arm", {"markers": [MARKER.decode(), "second-" + MARKER.decode()],
                                "plaintextObserved": False})
        self.handler._snapshot.assert_not_called()
        self.control.assert_not_called()

    def namespace(self, ports):
        self.handler.config.compose_project = "pt-relay"
        self.handler.config.libp2p_port = 4112
        self.handler.inventory["relayRuntime"] = {"processIds": [12], "containerId": "container"}
        container = {
            "State": {"Pid": 12, "Running": True},
            "Config": {"Labels": {
                "org.opencontainers.image.revision": "a" * 40,
                "com.docker.compose.project": "pt-relay",
                "com.docker.compose.service": "relay",
            }},
            "NetworkSettings": {"Ports": ports},
        }

        def remote(argv, *, wire, **_):
            output = io.StringIO()
            with patch.object(capture.subprocess, "check_output", return_value=json.dumps([container])), \
                    patch.object(Path, "read_text", return_value="12 (relay runtime) S " + "0 " * 18 + "34"), \
                    patch("sys.stdin", io.StringIO(wire)), patch("sys.stdout", output):
                exec(argv[2], {})
            return output.getvalue()

        self.handler._remote = remote
        return self.handler._namespace(deadline=time.monotonic() + 30, cancellation=threading.Event())

    def test_namespace_resolves_published_port_to_actual_container_listener(self):
        binding = self.namespace({
            "4001/tcp": [{"HostIp": "0.0.0.0", "HostPort": "4112"},
                         {"HostIp": "::", "HostPort": "4112"}],
            "18443/tcp": [{"HostIp": "0.0.0.0", "HostPort": "18681"}],
        })
        self.assertEqual(binding, {"pid": 12, "startTicks": "34", "tcpPort": 4001})

    def test_namespace_rejects_missing_udp_only_or_ambiguous_published_tcp_binding(self):
        for ports in ({}, {"4001/tcp": [{"HostPort": "4999"}]},
                      {"4001/udp": [{"HostPort": "4112"}]},
                      {"4001/tcp": [{"HostPort": "4112"}],
                       "4002/tcp": [{"HostPort": "4112"}]}):
            with self.subTest(ports=ports), self.assertRaises(ValueError):
                self.namespace(ports)

    def snapshot_from_connections(self, connections, *, observer_exit=0, metadata_status=200):
        self.handler.config.public_base_url = "https://relay.example"
        self.handler.config.libp2p_port = 4112
        self.handler.config.transport = Mock()
        self.handler.inventory["relayPeerId"] = "relay"
        self.handler.inventory["stations"] = {
            peer: {"stationPeerId": peer, "attachment": {"route_generation": 1}}
            for peer in ("first", "second")
        }
        self.handler._namespace = Mock(return_value={"pid": 12, "startTicks": "34", "tcpPort": 4001})
        self.handler.probe_digest = hashlib.sha256(b"observer").hexdigest()
        routes = {peer: {"nodePeerId": "node-" + peer, "routeId": "route-" + peer,
                        "generation": 1, "addresses": ["route-address"],
                        "innerSpkiSha256": "d" * 64} for peer in ("first", "second")}
        with patch.object(Path, "read_bytes", return_value=b"observer"), \
                patch.object(capture.subprocess, "run", return_value=SimpleNamespace(
                    returncode=observer_exit, stdout=json.dumps(routes))), \
                patch.object(capture, "mint_posix_relay_operator_token", return_value="test-token"), \
                patch.object(capture, "relay_json_request", return_value=(metadata_status, {"connections": connections})):
            return capture.SocialRelayCaptureHandler._snapshot(
                self.handler, deadline=time.monotonic() + 30, cancellation=threading.Event())

    def connections(self, local_port=4001):
        return [{
            "id": "connection-" + peer, "node_peer_id": "node-" + peer,
            "local_multiaddr": f"/ip4/192.0.2.3/tcp/{local_port}",
            "remote_multiaddr": f"/ip4/192.0.2.1/tcp/{39000 + index}",
        } for index, peer in enumerate(("first", "second"))]

    def test_snapshot_binds_actual_namespace_ports_and_preserves_worker_process_identity(self):
        result = self.snapshot_from_connections(self.connections())
        self.assertEqual(result["namespace"], {"pid": 12, "startTicks": "34"})
        self.assertEqual([leg["relayPort"] for leg in result["legs"]], [4001, 4001])
        self.assertEqual([leg["stationPort"] for leg in result["legs"]], [39000, 39001])

    def test_snapshot_captures_all_authenticated_parallel_node_connections(self):
        duplicate = self.connections()
        duplicate.append({**duplicate[0], "id": "duplicate", "remote_multiaddr": "/ip4/192.0.2.1/tcp/39999"})
        result = self.snapshot_from_connections(duplicate)
        self.assertEqual([leg["stationPort"] for leg in result["legs"]], [39000, 39999, 39001])
        self.assertEqual(result["stationLegs"], [[0, 1], [2]])
        self.assertEqual(result, self.snapshot_from_connections(list(reversed(duplicate))))
        with self.assertRaises(ValueError):
            self.snapshot_from_connections(self.connections(4112))

    def test_original_snapshot_worker_and_finish_cover_parallel_flows_and_connection_churn(self):
        candidates = self.connections()
        candidates.append({**candidates[0], "id": "parallel",
                           "remote_multiaddr": "/ip4/192.0.2.1/tcp/39999"})
        self.snapshot = self.snapshot_from_connections(candidates)
        legs = self.snapshot["legs"]
        with patch.object(worker, "alive", return_value=True):
            bpf = worker.validate({"namespace": self.snapshot["namespace"],
                                   "sourceDigest": "c" * 64, "legs": legs})
        for leg in legs:
            self.assertIn(f"src port {leg['stationPort']}", bpf)
            self.assertIn(f"dst port {leg['stationPort']}", bpf)
        self.data = wire(legs=legs, segments=[
            (index, direction, 100, b"opaque") for index in (1, 2) for direction in (0, 1)])
        self.arm()
        result = self.invoke("finish")
        self.assertEqual(result["directionBytes"], [[0, 0], [6, 6], [6, 6]])
        self.assertEqual(result["stationLegs"], [[0, 1], [2]])
        self.assertEqual(next(value for name, value in self.files.items()
                              if name.endswith(".pcap")), self.data)
        self.assertTrue(self.handler.close().closed)
        for mutation in ("removed", "added", "replaced", "route"):
            with self.subTest(mutation=mutation):
                self.handler._closed = self.handler._finished = False
                self.handler._before = None
                self.snapshot = self.snapshot_from_connections(candidates)
                self.arm()
                if mutation == "removed":
                    self.snapshot["connections"].pop()
                elif mutation == "added":
                    self.snapshot["connections"].append(copy.deepcopy(self.snapshot["connections"][0]))
                elif mutation == "replaced":
                    self.snapshot["connections"][0]["connectionId"] = "replacement"
                else:
                    self.snapshot["connections"][0]["route"]["generation"] = 2
                with self.assertRaises(EphemeralCapabilityBlocked):
                    self.invoke("finish")
                self.assertTrue(self.handler.close().closed)

    def test_ambiguous_selection_keeps_bounded_candidate_identity_at_original_failure(self):
        connections = self.connections()
        connections.extend({
            **connections[0], "id": f"{MARKER.decode()}-{index}",
            "remote_multiaddr": f"/ip4/192.0.2.1/tcp/{39990 + index}",
        } for index in range(5))
        self.handler._snapshot = lambda **_: self.snapshot_from_connections(connections)
        with self.assertRaises(EphemeralCapabilityBlocked) as failure:
            self.arm()
        observed = failure.exception.diagnostic.to_dict()["resourceChecks"][0]["observed"]
        digest = lambda value: hashlib.sha256(value.encode()).hexdigest()
        self.assertEqual(observed["stage"], "authenticated-tcp-legs")
        self.assertEqual(observed["matchedConnections"], 6)
        self.assertEqual(observed["stationPeerIdSha256"], digest("first"))
        self.assertEqual(observed["nodePeerIdSha256"], digest("node-first"))
        self.assertTrue(observed["tcpCandidatesTruncated"])
        self.assertEqual(len(observed["tcpCandidates"]), 4)
        self.assertEqual(observed["tcpCandidates"][0], {
            "connectionIdSha256": digest("connection-first"),
            "relayAddressSha256": digest("192.0.2.3"), "relayPort": 4001,
            "stationAddressSha256": digest("192.0.2.1"), "stationPort": 39000,
        })
        self.assertEqual([candidate["stationPort"] for candidate in observed["tcpCandidates"]],
                         [39000, 39990, 39991, 39992])
        self.assertNotIn(MARKER.decode(), repr(observed))
        self.assertNotIn("192.0.2.1", repr(observed))
        self.control.assert_not_called()
        connections.clear()
        self.assertEqual(observed["matchedConnections"], 6)

    def test_failure_diagnostic_distinguishes_routes_metadata_and_connection_selection(self):
        for options, stage, observed in (
            ({"observer_exit": 2}, "signed-routes", {"observerExitCode": 2}),
            ({"metadata_status": 503}, "authenticated-metadata", {"httpStatus": 503}),
            ({}, "authenticated-tcp-legs", {"matchedConnections": 0}),
        ):
            with self.subTest(stage=stage):
                self.handler._before = None
                self.handler._snapshot = lambda **_: self.snapshot_from_connections(
                    self.connections(4112), **options)
                with self.assertRaises(EphemeralCapabilityBlocked) as failure:
                    self.arm()
                diagnostic = failure.exception.diagnostic
                diagnostic.require_resource(capture.CAPABILITY_ID)
                result = diagnostic.to_dict()["resourceChecks"][0]["observed"]
                self.assertEqual(result["stage"], stage)
                self.assertEqual(result["operation"], "arm")
                for key, value in observed.items():
                    self.assertEqual(result[key], value)
                if stage == "authenticated-tcp-legs":
                    self.assertEqual(result["tcpCandidates"], [])
                    self.assertFalse(result["tcpCandidatesTruncated"])
                self.assertNotIn(MARKER.decode(), repr(diagnostic.to_dict()))
                self.control.assert_not_called()

    def test_worker_failure_projection_rejects_untrusted_output_and_keeps_partial_root_owned(self):
        for output, projected in (
            (json.dumps({"error": {"code": "permission", "errorType": "PermissionError"}}), True),
            (json.dumps({"error": {"code": MARKER.decode(), "errorType": "PermissionError"}}), False),
            (json.dumps({"error": {"code": "startup", "errorType": MARKER.decode()}}), False),
            (json.dumps({"error": {"code": "startup", "errorType": "ValueError", "payload": MARKER.decode()}}), False),
            (MARKER.decode(), False),
        ):
            with self.subTest(projected=projected, output_is_json=output.startswith("{")):
                self.handler._before = None
                self.handler._control = lambda operation, **options: capture.SocialRelayCaptureHandler._control(
                    self.handler, operation, **options)
                self.handler.config.transport = Mock(return_value=Mock(run_argv=Mock(
                    return_value=SimpleNamespace(returncode=2, stdout=output, stderr=MARKER.decode()))))
                with self.assertRaises(EphemeralCapabilityBlocked) as failure:
                    self.arm()
                result = failure.exception.diagnostic.to_dict()["resourceChecks"][0]["observed"]
                self.assertEqual(result["stage"], "worker-arm")
                self.assertEqual(result["remoteExitCode"], 2)
                self.assertEqual("workerFailure" in result, projected)
                self.assertNotIn(MARKER.decode(), repr(result))
                self.assertTrue(self.handler._may_exist)


class CaptureWorkerDiagnosticTests(unittest.TestCase):
    def test_worker_errors_project_fixed_categories_without_exception_details(self):
        for error, code in (
            (ValueError("capture file ownership differs"), "ownership"),
            (ValueError("capture namespace or source differs"), "namespace"),
            (FileNotFoundError(MARKER.decode()), "tool-missing"),
            (PermissionError(MARKER.decode()), "permission"),
            (RuntimeError(MARKER.decode()), "operation"),
        ):
            with self.subTest(code=code):
                result = worker.failure_details(error)
                self.assertEqual(result["code"], code)
                self.assertEqual(set(result), {"code", "errorType"})
                self.assertNotIn(MARKER.decode(), repr(result))

    def test_startup_failure_uses_owned_bounded_log_without_exposing_text(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(worker, "owned") as owned:
            root = Path(directory)
            log = root / "tcpdump.log"
            for text, code in (
                (b"nsenter: Operation not permitted " + MARKER, "permission"),
                (b"tcpdump: failed " + MARKER, "tcpdump"),
                (b"listening on any " + MARKER, "startup"),
                (b"", "startup"),
            ):
                log.write_bytes(text)
                result = worker.startup_failure(root)
                self.assertEqual(result["code"], code)
                self.assertNotIn(MARKER.decode(), repr(result))
                owned.assert_called_with(log)
            owned.side_effect = ValueError("capture file ownership differs")
            with self.assertRaisesRegex(ValueError, "ownership"):
                worker.startup_failure(root)

    def test_worker_startup_failure_remains_in_original_cleanup_inventory(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(worker, "owned"), \
                patch.object(worker.os, "geteuid", return_value=0), \
                patch.object(worker, "worker", side_effect=PermissionError(MARKER.decode())):
            root = Path(directory) / ("peers-social-capture-" + "a" * 32)
            root.mkdir()
            with patch.object(worker.re, "fullmatch", return_value=True):
                with self.assertRaises(PermissionError):
                    worker.main("worker", root)
            self.assertIn("failure.json", worker.FILES)
            result = worker.startup_failure(root)
            self.assertEqual(result, {"code": "permission", "errorType": "PermissionError"})
            self.assertNotIn(MARKER.decode(), (root / "failure.json").read_text())
