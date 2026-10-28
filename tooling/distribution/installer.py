"""Station installation lifecycle. Secrets and recovery state never enter reports."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from installation_state import atomic_json, digest, instance_lock, private_directory


def run(arguments, *, output=None, input_file=None):
    result = subprocess.run(arguments, stdout=output or subprocess.PIPE,
                            stdin=input_file, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        # Docker errors may contain the expanded DSN; keep diagnostics private.
        raise RuntimeError(f"RD_COMMAND_FAILED: {arguments[0]} ({result.returncode})")
    return result.stdout.decode().strip() if output is None else None


def load(file):
    return json.loads(Path(file).read_text())


def ensure(condition, code):
    if not condition:
        raise RuntimeError(code)


def version_key(tag):
    match = re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?", tag)
    ensure(match, "RD_VERSION_INVALID")
    pre = match[4]
    parts = []
    for part in pre.split(".") if pre else []:
        ensure(not part.isdigit() or part == "0" or not part.startswith("0"), "RD_VERSION_INVALID")
        parts.append((0, int(part)) if part.isdigit() else (1, part))
    return tuple(int(match[i]) for i in (1, 2, 3)) + (not pre, tuple(parts))


class Installation:
    def __init__(self, args):
        self.args = args
        self.root = private_directory(args.root)
        self.assets = Path(args.assets)
        self.project = args.project
        ensure(self.project and all(c in "abcdefghijklmnopqrstuvwxyz0123456789-_" for c in self.project),
               "RD_PROJECT_INVALID")
        context = run(["docker", "context", "show"])
        endpoint = json.loads(run(["docker", "context", "inspect", context]))[0]["Endpoints"]["docker"]["Host"]
        ensure(endpoint.startswith("unix://") and not os.environ.get("DOCKER_HOST"),
               "RD_LOCAL_DOCKER_REQUIRED")
        daemon = json.loads(run(["docker", "info", "--format", "{{json .}}"]))
        ensure(daemon["OSType"] == "linux" and daemon["Architecture"] in ("aarch64", "arm64", "x86_64", "amd64"),
               "RD_PLATFORM_UNSUPPORTED")
        self.target = f"{endpoint}|{daemon['ID']}"
        self.state_file = self.root / "state.json"
        self.compose_root = self.root
        self.compose_project = self.project
        self.state = load(self.state_file) if self.state_file.exists() else None

    def reload(self):
        self.state = load(self.state_file) if self.state_file.exists() else None
        if self.state:
            ensure(self.state["root"] == str(self.root) and self.state["project"] == self.project
                   and self.state["target"] == self.target, "RD_INSTANCE_IDENTITY_MISMATCH")
        ids = run(["docker", "ps", "-aq", "--filter", f"label=com.docker.compose.project={self.project}"]).split()
        for identifier in ids:
            labels = json.loads(run(["docker", "inspect", identifier]))[0]["Config"]["Labels"]
            ensure(self.state is not None and labels.get("sh.peers.install-root") == str(self.root),
                   "RD_PROJECT_ALREADY_OWNED")

    def save(self, phase, **values):
        self.state.update(values)
        self.state["phase"] = phase
        atomic_json(self.state_file, self.state)

    def resume_current(self, release, code):
        try:
            self.compose("start", "station")
            self.healthy(release)
            self.save("HEALTHY", release=release, lastError=code)
        except Exception:
            self.save("FAILED", error=code)

    def compose(self, *arguments, output=None, input_file=None):
        return run(["docker", "compose", "-p", self.compose_project, "--env-file", str(self.compose_root / ".env"),
                    "-f", str(self.compose_root / "docker-compose.yml"), *arguments],
                   output=output, input_file=input_file)

    def release(self):
        release = load(self.assets / "station-release.json")
        ensure(release["tag"] == self.args.selected_version, "RD_ASSET_VERSION_MISMATCH")
        version_key(release["tag"])
        ensure(release["postgresMajor"] == 16, "RD_POSTGRES_MIGRATION_REQUIRED")
        image = release["image"]
        ensure(re.fullmatch(r"ghcr.io/peers-labs/peers-touch-station@sha256:[0-9a-f]{64}", image),
               "RD_IMAGE_DIGEST_REQUIRED")
        ensure(re.fullmatch(r"[0-9a-f]{40}", release["source"]), "RD_SOURCE_REQUIRED")
        return release

    def volume(self, name):
        existing = subprocess.run(["docker", "volume", "inspect", name], capture_output=True)
        if existing.returncode == 0:
            labels = json.loads(existing.stdout)[0]["Labels"] or {}
            ensure(labels.get("sh.peers.install-root") == str(self.root), "RD_VOLUME_ALREADY_OWNED")
        else:
            run(["docker", "volume", "create", "--label", f"sh.peers.install-root={self.root}", name])

    def write_environment(self, release, volumes, *, original=None):
        if original is None:
            original = (self.root / ".env").read_text() if (self.root / ".env").exists() else ""
        preserved = [line for line in original.splitlines()
                     if line and line.split("=")[0] not in
                     ("PEERS_STATION_IMAGE", "PEERS_PG_VOLUME", "PEERS_DATA_VOLUME", "PEERS_INSTALL_ROOT")]
        if not preserved:
            ensure(not self.args.federation or all((self.args.base_url, self.args.public_addrs, self.args.bootstrap_nodes)),
                   "RD_FEDERATION_CONFIG_REQUIRED")
            for port in [self.args.port, self.args.libp2p_port]:
                ensure(1 <= port <= 65535, "RD_PORT_INVALID")
                with socket.socket() as probe:
                    probe.bind(("0.0.0.0", port))
            preserved = [
                f"PEERS_AUTH_SECRET={secrets.token_hex(32)}",
                f"PEERS_DB_PASSWORD={secrets.token_hex(32)}",
                "PEERS_DASHBOARD_USERNAME=peers",
                f"PEERS_DASHBOARD_PASSWORD={secrets.token_hex(32)}",
                f"PEERS_DASHBOARD_JWT_SECRET={secrets.token_hex(32)}",
                f"STATION_PORT={self.args.port}", f"LIBP2P_PORT={self.args.libp2p_port}",
                f"STATION_BIND={'0.0.0.0' if self.args.federation else '127.0.0.1'}",
                f"PEERS_NODE_SERVER_BASEURL={self.args.base_url}",
                f"PEERS_LIBP2P_PUBLIC_ADDRS={self.args.public_addrs}",
                f"PEERS_BOOTSTRAP_NODES={self.args.bootstrap_nodes}",
                f"PEERS_FEDERATION_MIN_DHT_PEERS={1 if self.args.federation else 0}",
            ]
        preserved += [f"PEERS_STATION_IMAGE={release['image']}", f"PEERS_PG_VOLUME={volumes[0]}",
                      f"PEERS_DATA_VOLUME={volumes[1]}", f"PEERS_INSTALL_ROOT={self.root}"]
        ensure(all("\n" not in line and "\r" not in line and "'" not in line and '"' not in line and "$" not in line
                   for line in preserved), "RD_ENV_VALUE_INVALID")
        descriptor, temporary = tempfile.mkstemp(dir=self.compose_root, prefix=".env-")
        try:
            with os.fdopen(descriptor, "w") as stream:
                stream.write("\n".join(preserved) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.compose_root / ".env")
            directory = os.open(self.compose_root, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def healthy(self, release):
        values = dict(line.split("=", 1) for line in (self.compose_root / ".env").read_text().splitlines())
        origin = f"http://127.0.0.1:{values['STATION_PORT']}"
        deadline = time.monotonic() + self.args.timeout
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(origin + "/sub-oss/healthz", timeout=3) as response:
                    ensure(response.status == 200, "RD_HEALTH_FAILED")
                with urllib.request.urlopen(origin + "/app-meta/version", timeout=3) as response:
                    identity = json.load(response)
                identity = identity.get("data", identity)
                ensure(identity["build_commit"] == release["source"] and identity["build_label"] == release["tag"],
                       "RD_BUILD_IDENTITY_MISMATCH")
                return identity
            except (OSError, ValueError, KeyError):
                time.sleep(2)
        raise RuntimeError("RD_HEALTH_TIMEOUT")

    def schema(self):
        value = self.compose("exec", "-T", "postgres", "pg_dump", "-U", "peers", "-d", "peers_touch",
                             "--schema-only", "--no-owner", "--no-privileges")
        # Ignore dump-generation noise; retain all actual DDL and version-sensitive semantics.
        normalized = "\n".join(line for line in value.splitlines()
                               if line and not line.startswith(("--", "\\restrict", "\\unrestrict")))
        return hashlib.sha256(normalized.encode()).hexdigest()

    def readback(self):
        facts = {}
        projections = {
            "touch_actor": "ptid, preferred_username, email, origin",
            "actor_identity_keys": "ptid, fingerprint, public_key",
            "actor_devices": "ptid, device_id, revoked",
            "oss_files": "owner_ptid, key, size, sha256",
        }
        for table, columns in projections.items():
            present = self.compose("exec", "-T", "postgres", "psql", "-U", "peers", "-d", "peers_touch",
                                   "-At", "-c", f"SELECT to_regclass('public.{table}') IS NOT NULL")
            if present == "t":
                rows = self.compose("exec", "-T", "postgres", "psql", "-U", "peers", "-d", "peers_touch",
                                    "-At", "-c", (
                                        "SELECT COALESCE(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) "
                                        f"FROM (SELECT to_jsonb(projected) value FROM "
                                        f"(SELECT {columns} FROM {table}) projected) rows"
                                    ))
                facts[table] = hashlib.sha256(rows.encode()).hexdigest()
        files = run(["docker", "run", "--rm", "--network", "none", "-v",
                     f"{self.state['volumes'][1]}:/app/data:ro", "pgvector/pgvector:pg16", "sh", "-c",
                     "find /app/data -type f \\( -name '*.key' -o -path '/app/data/oss/*' \\) -exec sha256sum {} \\; | sort"])
        ensure("touch_actor" in facts and "oss_files" in facts and files,
               "RD_DURABLE_READBACK_MISSING")
        return {"tables": facts, "files": files}

    def install(self):
        release = self.release()
        if self.state and self.state["phase"] == "HEALTHY":
            ensure(self.state["release"] == release, "RD_USE_UPGRADE")
            self.healthy(release)
            return
        if self.state and self.state["phase"] == "STOPPED":
            ensure(self.state["release"] == release, "RD_USE_UPGRADE")
            self.compose("up", "-d")
            self.healthy(release)
            self.save("HEALTHY")
            return
        if self.state and self.state["phase"] == "PURGED":
            self.state = {
                "root": str(self.root),
                "project": self.project,
                "target": self.target,
                "volumes": [f"{self.project}-pg", f"{self.project}-data"],
                "release": release,
                "operation": secrets.token_hex(8),
            }
        if not self.state:
            ensure(not (self.root / ".env").exists() and not (self.root / "docker-compose.yml").exists(),
                   "RD_UNREGISTERED_CONFIG")
            self.state = {"root": str(self.root), "project": self.project, "target": self.target,
                          "volumes": [f"{self.project}-pg", f"{self.project}-data"],
                          "release": release, "operation": secrets.token_hex(8)}
        ensure(self.state["release"] == release, "RD_USE_RECOVERY")
        ensure(not self.state.get("attempted"), "RD_USE_RECOVERY")
        self.save("INSTALLING")
        for name in self.state["volumes"]:
            self.volume(name)
        self.write_environment(release, self.state["volumes"])
        shutil.copyfile(self.assets / "docker-compose.yml", self.root / "docker-compose.yml")
        self.compose("pull")
        self.compose("up", "-d")
        self.healthy(release)
        self.save("HEALTHY", schema=self.schema(), composeDigest=digest(self.root / "docker-compose.yml"))

    def backup(self, *, resume=True):
        ensure(self.state and self.state["phase"] == "HEALTHY", "RD_HEALTHY_INSTANCE_REQUIRED")
        self.save("BACKING_UP")
        self.compose("stop", "station")
        directory = private_directory(self.root / "backups" / secrets.token_hex(12))
        try:
            with (directory / "database.dump").open("wb") as stream:
                self.compose("exec", "-T", "postgres", "pg_dump", "-U", "peers", "-d", "peers_touch",
                             "--format=custom", output=stream)
            self.volume_archive(self.state["volumes"][1], directory / "peers-data.tar")
            for name in (".env", "docker-compose.yml", "state.json"):
                shutil.copyfile(self.root / name, directory / name)
                os.chmod(directory / name, 0o600)
            manifest = {"instance": str(self.root), "project": self.project, "target": self.target,
                        "release": self.state["release"], "schema": self.schema(),
                        "files": {name: {"sha256": digest(file), "size": file.stat().st_size}
                                  for name in ("database.dump", "peers-data.tar", ".env", "docker-compose.yml", "state.json")
                                  for file in [directory / name]}}
            atomic_json(directory / "manifest.json", manifest)
            self.verify_backup(directory)
            self.save("BACKED_UP", backup=str(directory), backupDigest=digest(directory / "manifest.json"))
            if resume:
                self.compose("start", "station")
                self.healthy(self.state["release"])
                self.save("HEALTHY")
            return directory
        except Exception:
            self.resume_current(self.state["release"], "RD_BACKUP_FAILED")
            raise

    def volume_archive(self, volume, file, *, restore=False):
        arguments = ["docker", "run", "--rm", "--network", "none", "-i",
                     "-v", f"{volume}:/data" + ("" if restore else ":ro"),
                     "pgvector/pgvector:pg16", "tar", "-C", "/data",
                     "-xf" if restore else "-cf", "-"]
        with file.open("rb" if restore else "wb") as stream:
            run(arguments, input_file=stream if restore else None, output=None if restore else stream)

    def verify_backup(self, directory):
        ensure(directory.resolve().parent == (self.root / "backups").resolve(), "RD_BACKUP_SCOPE_MISMATCH")
        manifest = load(directory / "manifest.json")
        ensure(manifest["instance"] == str(self.root) and manifest["project"] == self.project
               and manifest["target"] == self.target, "RD_BACKUP_IDENTITY_MISMATCH")
        ensure(set(manifest["files"]) == {"database.dump", "peers-data.tar", ".env", "docker-compose.yml", "state.json"},
               "RD_BACKUP_INCOMPLETE")
        for name, metadata in manifest["files"].items():
            file = directory / name
            ensure(not file.is_symlink() and file.stat().st_size == metadata["size"]
                   and digest(file) == metadata["sha256"], "RD_BACKUP_CORRUPT")
        return manifest

    def upgrade(self):
        release = self.release()
        ensure(self.state and self.state["phase"] == "HEALTHY", "RD_HEALTHY_INSTANCE_REQUIRED")
        old = self.state["release"]
        ensure(old["tag"].split(".")[0] == release["tag"].split(".")[0], "RD_MAJOR_MIGRATION_REQUIRED")
        ensure(version_key(release["tag"]) > version_key(old["tag"]), "RD_UPDATE_VERSION_NOT_INCREASING")
        backup = self.backup(resume=False)
        try:
            expected = self.readback()
        except Exception:
            self.resume_current(old, "RD_UPGRADE_PREFLIGHT_FAILED")
            raise
        self.save("UPGRADING", previous=old, attempted=release, readback=expected, backup=str(backup))
        self.write_environment(release, self.state["volumes"])
        shutil.copyfile(self.assets / "docker-compose.yml", self.root / "docker-compose.yml")
        self.compose("pull")
        self.compose("up", "-d")
        self.healthy(release)
        ensure(self.readback() == expected, "RD_UPGRADE_READBACK_MISMATCH")
        self.save("HEALTHY", release=release, schema=self.schema(),
                  composeDigest=digest(self.root / "docker-compose.yml"))

    def rollback(self):
        ensure(self.state and self.args.to, "RD_ROLLBACK_TARGET_REQUIRED")
        old = self.state.get("previous")
        ensure(old and old["tag"] == self.args.to, "RD_ROLLBACK_TARGET_MISMATCH")
        expected = self.state.get("readback")
        ensure(expected, "RD_ROLLBACK_READBACK_MISSING")
        backup = Path(self.args.restore_backup or self.state["backup"])
        manifest = self.verify_backup(backup)
        ensure(manifest["release"] == old, "RD_BACKUP_VERSION_MISMATCH")
        if self.args.restore_backup:
            ensure(self.args.confirm_loss, "RD_RESTORE_LOSS_CONFIRMATION_REQUIRED")
        else:
            ensure(self.args.compatibility, "RD_SCHEMA_COMPATIBILITY_REQUIRED")
            proof_file = Path(self.args.compatibility)
            ensure(proof_file.is_file() and not proof_file.is_symlink(),
                   "RD_SCHEMA_COMPATIBILITY_EVIDENCE_MISSING")
            proof = load(proof_file)
            report_name = proof.get("suiteReport", "")
            ensure(isinstance(report_name, str) and re.fullmatch(r"[A-Za-z0-9_.-]+", report_name),
                   "RD_SCHEMA_COMPATIBILITY_EVIDENCE_MISSING")
            report_root = proof_file.resolve().parent
            report_path = report_root / report_name
            ensure(report_path.resolve().parent == report_root
                   and report_path.is_file() and not report_path.is_symlink()
                   and digest(report_path) == proof.get("suiteReportDigest"),
                   "RD_SCHEMA_COMPATIBILITY_EVIDENCE_MISSING")
            report = load(report_path)
            ensure(proof["from"] == self.state["attempted"] and proof["to"] == old
                   and proof["schema"] == self.schema() and proof["result"] == "FUNCTIONAL_PASS"
                   and proof["readWriteVerified"] is True
                   and report["result"] == "FUNCTIONAL_PASS"
                   and report["from"] == proof["from"] and report["to"] == proof["to"]
                   and report["schema"] == proof["schema"]
                   and report["cleanup"]["result"] == "PASS"
                   and report["readWrite"]["oldProgramWriteReadback"] is True,
                   "RD_SCHEMA_COMPATIBILITY_MISMATCH")
        self.compose("stop", "station")
        if not self.args.restore_backup:
            # Never mount one PostgreSQL data volume into two running servers.
            self.compose("stop", "postgres")
        self.save("RESTORING" if self.args.restore_backup else "ROLLING_BACK")
        volumes = list(self.state["volumes"])
        if self.args.restore_backup:
            suffix = secrets.token_hex(8)
            volumes = [f"{self.project}-restore-pg-{suffix}", f"{self.project}-restore-data-{suffix}"]
            for name in volumes:
                self.volume(name)
            self.volume_archive(volumes[1], backup / "peers-data.tar", restore=True)
        original_volumes = list(self.state["volumes"])
        recovery = private_directory(self.root / "recovery" / secrets.token_hex(8))
        self.compose_root = recovery
        self.compose_project = f"{self.project}-recovery"
        switched = False
        try:
            self.write_environment(old, volumes, original=(backup / ".env").read_text())
            shutil.copyfile(backup / "docker-compose.yml", recovery / "docker-compose.yml")
            self.compose("up", "-d", "--wait", "postgres")
            if self.args.restore_backup:
                with (backup / "database.dump").open("rb") as stream:
                    self.compose("exec", "-T", "postgres", "pg_restore", "-U", "peers", "-d", "peers_touch",
                                 "--exit-on-error", "--no-owner", input_file=stream)
            self.compose("up", "-d", "station")
            self.state["volumes"] = volumes
            self.healthy(old)
            ensure(self.readback() == expected, "RD_RESTORE_READBACK_MISMATCH")
            self.compose("down")
            self.compose_root = self.root
            self.compose_project = self.project
            # Commit runtime binding only after the recovery instance readback.
            self.compose("down")
            self.write_environment(old, volumes, original=(backup / ".env").read_text())
            shutil.copyfile(backup / "docker-compose.yml", self.root / "docker-compose.yml")
            self.compose("up", "-d")
            self.healthy(old)
            ensure(self.readback() == expected, "RD_RESTORE_READBACK_MISMATCH")
            self.save("HEALTHY", release=old, retainedVolumes=original_volumes, volumes=volumes,
                      schema=self.schema(), composeDigest=digest(self.root / "docker-compose.yml"))
            switched = True
        finally:
            if not switched:
                self.state["volumes"] = original_volumes
                self.save("FAILED", recoveryRoot=str(recovery), recoveryVolumes=volumes,
                          error="RD_RESTORE_FAILED")
            self.compose_root = self.root
            self.compose_project = self.project

    def uninstall(self):
        ensure(self.state, "RD_INSTANCE_MISSING")
        if self.args.purge:
            ensure(self.args.confirm_purge == self.project, "RD_PURGE_CONFIRMATION_REQUIRED")
        self.compose("down")
        if self.args.purge:
            for name in self.state["volumes"]:
                metadata = json.loads(run(["docker", "volume", "inspect", name]))[0]
                ensure((metadata["Labels"] or {}).get("sh.peers.install-root") == str(self.root),
                       "RD_PURGE_SCOPE_MISMATCH")
                run(["docker", "volume", "rm", name])
        self.save("PURGED" if self.args.purge else "STOPPED")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["install", "backup", "upgrade", "rollback", "uninstall"])
    parser.add_argument("--assets", required=True)
    parser.add_argument("--selected-version", required=True)
    parser.add_argument("--version")
    parser.add_argument("--root", default=str(Path.home() / ".peers-touch" / "station"))
    parser.add_argument("--project", default="peers-station")
    parser.add_argument("--port", type=int, default=18080)
    parser.add_argument("--libp2p-port", type=int, default=4001)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--federation", action="store_true")
    parser.add_argument("--base-url", default="")
    parser.add_argument("--public-addrs", default="")
    parser.add_argument("--bootstrap-nodes", default="")
    parser.add_argument("--to")
    parser.add_argument("--compatibility")
    parser.add_argument("--restore-backup")
    parser.add_argument("--confirm-loss", action="store_true")
    parser.add_argument("--purge", action="store_true")
    parser.add_argument("--confirm-purge")
    args = parser.parse_args()
    installation = Installation(args)
    with instance_lock(installation.target, installation.project):
        installation.reload()
        try:
            getattr(installation, args.operation)()
        except Exception:
            if installation.state and installation.state["phase"] in ("INSTALLING", "UPGRADING", "RESTORING", "ROLLING_BACK"):
                installation.save("FAILED", error="RD_OPERATION_FAILED")
            raise
    values = dict(line.split("=", 1) for line in (installation.root / ".env").read_text().splitlines())
    station_url = values.get("PEERS_NODE_SERVER_BASEURL") or f"http://127.0.0.1:{values['STATION_PORT']}"
    sys.stdout.write(json.dumps({"operation": args.operation, "phase": installation.state["phase"],
                                "root": str(installation.root), "stationUrl": station_url,
                                "tag": installation.state["release"]["tag"]}) + "\n")


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except Exception as error:
        sys.stderr.write(f"{error}\n")
        sys.exit(1)
