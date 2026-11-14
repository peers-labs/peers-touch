"""Bounded Linux capture process, invoked by the retained Social parent over SSH.

No service API, payload parser or credential is installed at Relay. This
run-private executable owns only tcpdump and its immutable output.
"""
from __future__ import annotations

import base64
import ctypes
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import resource
import signal
import stat
import subprocess
import sys
import time

MAX_BYTES = 16 << 20
MAX_SECONDS = 240
FILES = {"worker.py", "binding.json", "owner.json", "capture.json", "done.json",
         "capture.pcap", "tcpdump.log", "control.lock"}


def process_identity(pid: int) -> dict[str, object]:
    text = Path(f"/proc/{pid}/stat").read_text()
    fields = text[text.rindex(")") + 2:].split()
    if fields[0] == "Z":
        raise ProcessLookupError("process is a zombie")
    return {"pid": pid, "startTicks": fields[19]}


def alive(identity: dict[str, object]) -> bool:
    try:
        return process_identity(identity["pid"]) == identity
    except (FileNotFoundError, ProcessLookupError):
        return False


def owned(path: Path, *, directory: bool = False) -> None:
    info = path.lstat()
    expected = stat.S_IFDIR if directory else stat.S_IFREG
    if stat.S_IFMT(info.st_mode) != expected or info.st_uid != 0 or (
            stat.S_IMODE(info.st_mode) != (0o700 if directory else 0o600)):
        raise ValueError("capture file ownership differs")


def write(path: Path, value: object) -> None:
    with path.open("x") as stream:
        json.dump(value, stream, separators=(",", ":"), sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())


def read(path: Path) -> dict:
    owned(path)
    if path.stat().st_size > 65536:
        raise ValueError("capture descriptor exceeds its bound")
    return json.loads(path.read_text())


def validate(binding: dict) -> str:
    if set(binding) != {"namespace", "legs", "sourceDigest"}:
        raise ValueError("invalid capture binding")
    if not alive(binding["namespace"]) or not re.fullmatch(r"[0-9a-f]{64}", binding["sourceDigest"]):
        raise ValueError("capture namespace or source differs")
    legs = binding["legs"]
    if len(legs) != 2 or legs[0] == legs[1]:
        raise ValueError("capture requires two distinct legs")
    terms = []
    for leg in legs:
        if set(leg) != {"relayAddress", "relayPort", "stationAddress", "stationPort"}:
            raise ValueError("invalid capture leg")
        relay, station = (ipaddress.ip_address(leg[field])
                          for field in ("relayAddress", "stationAddress"))
        if relay == station or relay.version != station.version or any(
                type(leg[field]) is not int or not 1 <= leg[field] <= 65535
                for field in ("relayPort", "stationPort")):
            raise ValueError("invalid capture leg address/port")
        terms.append(
            f"((src host {station} and src port {leg['stationPort']} and "
            f"dst host {relay} and dst port {leg['relayPort']}) or "
            f"(src host {relay} and src port {leg['relayPort']} and "
            f"dst host {station} and dst port {leg['stationPort']}))")
    return "tcp and (" + " or ".join(terms) + ")"


def child_limits() -> None:
    # A killed owner cannot orphan its privileged capture. nsenter exec
    # preserves this Linux parent-death signal through tcpdump startup.
    parent = os.getppid()
    if parent == 1 or ctypes.CDLL(None).prctl(1, signal.SIGINT, 0, 0, 0) != 0:
        raise OSError("cannot bind capture to its owner")
    if os.getppid() != parent:
        os._exit(2)
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_BYTES, MAX_BYTES))


def worker(root: Path) -> None:
    binding = read(root / "binding.json")
    expression = validate(binding)
    deadline = time.monotonic() + 5
    while not (root / "owner.json").exists() and time.monotonic() < deadline:
        time.sleep(0.02)
    owner = read(root / "owner.json")
    if owner != process_identity(os.getpid()):
        raise ValueError("capture owner differs")
    requested = False
    def stop(_signal, _frame):
        nonlocal requested
        requested = True
    signal.signal(signal.SIGUSR1, stop)
    process = None
    result = {"reason": "failure", "exitCode": -1, "stopped": False}
    try:
        with (root / "capture.pcap").open("xb") as output, (root / "tcpdump.log").open("xb") as log:
            process = subprocess.Popen([
                "/usr/bin/nsenter", "-t", str(binding["namespace"]["pid"]), "-n",
                "/usr/bin/tcpdump", "-i", "any", "-nn", "-s", "65535",
                "--immediate-mode", "-U", "-Z", "root", "-w", "-", expression,
            ], stdin=subprocess.DEVNULL, stdout=output, stderr=log,
                preexec_fn=child_limits)
            identity = process_identity(process.pid)
            write(root / "capture.json", identity)
            deadline = time.monotonic() + MAX_SECONDS
            while process.poll() is None and not requested and time.monotonic() < deadline:
                if not alive(binding["namespace"]):
                    break
                time.sleep(0.05)
            result["reason"] = ("requested" if requested else
                                "deadline" if time.monotonic() >= deadline else "failure")
            if process.poll() is None:
                if not alive(identity):
                    raise ValueError("capture process identity changed")
                process.send_signal(signal.SIGINT)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
                result["reason"] = "forced"
            output.flush()
            os.fsync(output.fileno())
            result.update(exitCode=process.returncode, stopped=not alive(identity))
    finally:
        if process is not None and process.poll() is None:
            process.kill()
            process.wait(timeout=2)
            result.update(reason="forced", exitCode=process.returncode, stopped=True)
        write(root / "done.json", result)


def stop_owner(root: Path) -> dict:
    owner_path = root / "owner.json"
    if owner_path.exists():
        owner = read(owner_path)
        if alive(owner):
            os.kill(owner["pid"], signal.SIGUSR1)
            deadline = time.monotonic() + 8
            while alive(owner) and time.monotonic() < deadline:
                time.sleep(0.02)
            if alive(owner):
                raise ValueError("capture owner did not stop")
    capture_path = root / "capture.json"
    if capture_path.exists():
        identity = read(capture_path)
        if alive(identity):
            # Recovery after an owner failure still targets only the exact
            # recorded child. This path never qualifies a successful capture.
            os.kill(identity["pid"], signal.SIGINT)
            deadline = time.monotonic() + 5
            while alive(identity) and time.monotonic() < deadline:
                time.sleep(0.02)
            if alive(identity):
                raise ValueError("capture child did not stop")
    done = root / "done.json"
    return read(done) if done.exists() else {"stopped": True, "reason": "incomplete", "exitCode": -1}


def main(operation: str, root: Path) -> dict:
    if not re.fullmatch(r"/tmp/peers-social-capture-[0-9a-f]{32}", str(root)) or os.geteuid() != 0:
        raise ValueError("invalid capture root or authority")
    if operation == "worker":
        owned(root, directory=True)
        worker(root)
        return {}
    if operation == "clear" and not root.exists():
        if root.is_symlink():
            raise ValueError("capture root is a symlink")
        return {"cleared": True}
    if operation == "arm":
        root.mkdir(mode=0o700)
    owned(root, directory=True)
    lock_path = root / "control.lock"
    if lock_path.exists():
        owned(lock_path)
    with lock_path.open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        if operation == "arm":
            payload = json.load(sys.stdin)
            source = payload.pop("workerSource")
            if hashlib.sha256(source.encode()).hexdigest() != payload["sourceDigest"]:
                raise ValueError("capture worker source differs")
            validate(payload)
            with (root / "worker.py").open("x") as stream:
                stream.write(source)
            write(root / "binding.json", payload)
            process = subprocess.Popen(
                [sys.executable, str(root / "worker.py"), "worker", str(root)],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            write(root / "owner.json", process_identity(process.pid))
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                log = root / "tcpdump.log"
                if log.exists():
                    owned(log)
                    if b"listening on " in log.read_bytes()[:4096] and (
                            root / "capture.json").exists():
                        identity = read(root / "capture.json")
                        if alive(identity) and Path(f"/proc/{identity['pid']}/exe").resolve() == Path("/usr/bin/tcpdump").resolve():
                            return {"armed": True, "owner": read(root / "owner.json"), "capture": identity}
                if process.poll() is not None:
                    break
                time.sleep(0.02)
            raise ValueError("capture did not become ready")
        if operation in {"finish", "clear"}:
            result = stop_owner(root)
            if operation == "finish":
                owned(root / "capture.pcap")
                owned(root / "tcpdump.log")
                wire = (root / "capture.pcap").read_bytes()
                log = (root / "tcpdump.log").read_bytes()[:65536]
                dropped = re.findall(rb"(\d+) packets dropped by kernel", log)
                result.update(
                    kernelDrops=int(dropped[-1]) if len(dropped) == 1 else None,
                    pcap=base64.b64encode(wire).decode() if len(wire) <= MAX_BYTES else "",
                )
                return result
            for path in root.iterdir():
                if path.name not in FILES:
                    raise ValueError("capture root contains unowned state")
                owned(path)
            for path in root.iterdir():
                path.unlink()
            root.rmdir()
            return {"cleared": True}
    raise ValueError("unknown capture operation")


if __name__ == "__main__":
    os.umask(0o077)
    try:
        value = main(sys.argv[1], Path(sys.argv[2]))
        print(json.dumps(value, separators=(",", ":"), sort_keys=True))
    except Exception:
        # Never emit packet bytes, input or exception details.
        print("owned capture operation failed", file=sys.stderr)
        sys.exit(2)
