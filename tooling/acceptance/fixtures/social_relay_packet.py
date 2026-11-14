"""Strict pcap framing and exact TCP-leg observation; dpkt owns decoding."""
from __future__ import annotations

import hashlib
import io
import ipaddress
import socket
import struct

import dpkt

MAX_CAPTURE_BYTES = 16 << 20


def complete_capture(wire: bytes) -> None:
    if not 24 < len(wire) <= MAX_CAPTURE_BYTES:
        raise ValueError("capture is absent or outside its byte bound")
    endian = {
        b"\xd4\xc3\xb2\xa1": "<", b"\xa1\xb2\xc3\xd4": ">",
        b"\x4d\x3c\xb2\xa1": "<", b"\xa1\xb2\x3c\x4d": ">",
    }.get(wire[:4])
    if endian is None:
        raise ValueError("capture format is unsupported")
    major, minor, _, _, snaplen, _ = struct.unpack(endian + "HHiIII", wire[4:24])
    if (major, minor) != (2, 4) or not 1 <= snaplen <= 65535:
        raise ValueError("capture header is invalid")
    position = 24
    while position < len(wire):
        if len(wire) - position < 16:
            raise ValueError("capture record header is truncated")
        _, _, captured, original = struct.unpack(endian + "IIII", wire[position:position + 16])
        position += 16
        if not captured or captured != original or captured > snaplen or captured > len(wire) - position:
            raise ValueError("capture packet is missing or truncated")
        position += captured


def contiguous_streams(segments: list[tuple[int, bytes]]) -> list[bytes]:
    """Retain gaps; join only consistent TCP bytes, including retransmissions."""
    if not segments:
        return []
    anchor = segments[0][0]
    ordered = sorted(
        (((sequence - anchor + (1 << 31)) % (1 << 32) - (1 << 31), data)
         for sequence, data in segments), key=lambda segment: segment[0],
    )
    runs: list[bytes] = []
    beginning, first = ordered[0]
    current = bytearray(first)
    for offset, data in ordered[1:]:
        relative = offset - beginning
        if relative > len(current):
            runs.append(bytes(current))
            beginning, current = offset, bytearray(data)
            continue
        overlap = min(len(data), len(current) - relative)
        if current[relative:relative + overlap] != data[:overlap]:
            raise ValueError("capture TCP overlap is inconsistent")
        current.extend(data[overlap:])
    runs.append(bytes(current))
    return runs


def validate_legs(legs: list[dict[str, object]]) -> None:
    if len(legs) != 2 or legs[0] == legs[1]:
        raise ValueError("two distinct prepared TCP legs are required")
    for leg in legs:
        if set(leg) != {"relayAddress", "relayPort", "stationAddress", "stationPort"}:
            raise ValueError("TCP leg fields are invalid")
        relay, station = (ipaddress.ip_address(leg[field])
                          for field in ("relayAddress", "stationAddress"))
        if relay.version != station.version or relay == station:
            raise ValueError("TCP leg addresses are invalid")
        if any(type(leg[field]) is not int or not 1 <= leg[field] <= 65535
               for field in ("relayPort", "stationPort")):
            raise ValueError("TCP leg ports are invalid")


def observe(wire: bytes, *, legs: list[dict[str, object]],
            markers: tuple[bytes, ...]) -> dict[str, object]:
    validate_legs(legs)
    if not markers or any(not marker or len(marker) > 4096 for marker in markers):
        raise ValueError("capture marker scope is invalid")
    complete_capture(wire)
    scoped_flows = {}
    for index, leg in enumerate(legs):
        def binary(field):
            address = str(leg[field])
            return socket.inet_pton(socket.AF_INET6 if ":" in address else socket.AF_INET, address)
        relay, station = binary("relayAddress"), binary("stationAddress")
        forward = (station, relay, leg["stationPort"], leg["relayPort"])
        reverse = (relay, station, leg["relayPort"], leg["stationPort"])
        for direction, flow in enumerate((forward, reverse)):
            if flow in scoped_flows:
                raise ValueError("capture TCP legs overlap")
            scoped_flows[flow] = (index, direction)
    reader = dpkt.pcap.Reader(io.BytesIO(wire))
    decoder = {
        dpkt.pcap.DLT_EN10MB: dpkt.ethernet.Ethernet,
        dpkt.pcap.DLT_LINUX_SLL: dpkt.sll.SLL,
        dpkt.pcap.DLT_LINUX_SLL2: dpkt.sll2.SLL2,
    }.get(reader.datalink())
    if decoder is None:
        raise ValueError("capture link layer is unsupported")
    flows = {}
    records = 0
    for _, packet in reader:
        records += 1
        try:
            network = decoder(packet).data
            if not isinstance(network, (dpkt.ip.IP, dpkt.ip6.IP6)):
                raise ValueError("capture contains traffic outside prepared TCP scope")
            if isinstance(network, dpkt.ip.IP) and (network.mf or network.offset):
                raise ValueError("capture contains fragmented packets")
            if isinstance(network, dpkt.ip6.IP6) and dpkt.ip.IP_PROTO_FRAGMENT in network.extension_hdrs:
                raise ValueError("capture contains fragmented packets")
            if ((isinstance(network, dpkt.ip.IP) and network.len != len(network))
                    or (isinstance(network, dpkt.ip6.IP6) and network.plen != len(network) - 40)):
                raise ValueError("capture network payload is truncated")
            tcp = network.data
            if not isinstance(tcp, dpkt.tcp.TCP):
                raise ValueError("capture contains non-TCP traffic")
            flow = (network.src, network.dst, tcp.sport, tcp.dport)
            if flow not in scoped_flows:
                raise ValueError("capture contains an unbound TCP leg")
            if tcp.data:
                flows.setdefault(flow, []).append((tcp.seq, bytes(tcp.data)))
        except (dpkt.UnpackError, IndexError, TypeError) as error:
            raise ValueError("capture packet cannot be decoded") from error
    direction_bytes = [[0, 0], [0, 0]]
    plaintext_observed = any(marker in wire for marker in markers)
    for flow, segments in flows.items():
        runs = contiguous_streams(segments)
        index, direction = scoped_flows[flow]
        direction_bytes[index][direction] += sum(map(len, runs))
        plaintext_observed |= any(marker in run for run in runs for marker in markers)
    if not all(count for leg in direction_bytes for count in leg):
        raise ValueError("capture did not observe both directions on both prepared TCP legs")
    return {
        "captureSha256": hashlib.sha256(wire).hexdigest(),
        "captureBytes": len(wire), "records": records,
        "directionBytes": direction_bytes, "plaintextObserved": plaintext_observed,
    }
