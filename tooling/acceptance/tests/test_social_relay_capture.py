"""Synthetic framing and failure checks; actual product proof stays at Suite."""
from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
import socket
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import dpkt

from tooling.acceptance.core import EphemeralCapabilityBlocked
from tooling.acceptance.fixtures import social_relay_capture as capture
from tooling.acceptance.fixtures import social_relay_packet as packet

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
                              markers=(MARKER,), **options)

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


class CaptureHandlerTests(unittest.TestCase):
    def setUp(self):
        self.handler = capture.SocialRelayCaptureHandler(
            config=SimpleNamespace(role="relay", environment_name="relay-fixture"),
            inventory={"artifactKind": "social-relay-preparation", "sourceCommit": "a" * 40,
                       "runId": "b" * 16, "stations": {"first": {}, "second": {}}},
            trust_anchor=b"public-ca", probe=ROOT, probe_digest="c" * 64, repo_root=ROOT,
        )
        self.snapshot = {"namespace": {"pid": 12, "startTicks": "34"},
                         "legs": LEGS, "connections": []}
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
        self.control.side_effect = RuntimeError("lost acknowledgement")
        with self.assertRaises(EphemeralCapabilityBlocked):
            self.arm()
        self.assertTrue(self.handler._may_exist)
        self.assertFalse(self.handler.close().closed)
        self.control.side_effect = None
        self.control.return_value = {"cleared": True}
        self.assertTrue(self.handler.close().closed)
        self.assertEqual(self.handler._markers, ())

    def test_caller_cannot_supply_route_packet_or_observation_truth(self):
        with self.assertRaises(EphemeralCapabilityBlocked):
            self.invoke("arm", {"markers": [MARKER.decode(), "second-" + MARKER.decode()],
                                "plaintextObserved": False})
        self.handler._snapshot.assert_not_called()
        self.control.assert_not_called()
