"""Role-neutral incremental Git source synchronization for remote runtimes."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import socket
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Mapping

from .errors import ProvisioningError
from .lease import normalize_lease_resource
from tooling.acceptance.remote_platform import RemotePlatform

if TYPE_CHECKING:
    from tooling.acceptance.transports.ssh import SshTransport, SshTunnel


_SAFE_RELATIVE_PATH = re.compile(r"^[A-Za-z0-9._/-]+$")


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise ProvisioningError(
            f"cannot read source-sync environment {path}: {error}"
        ) from error
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def _required(values: Mapping[str, str], key: str, source: Path) -> str:
    value = values.get(key, "").strip()
    if not value:
        raise ProvisioningError(f"{key} is not set in {source}")
    return value


def _validate_relative_path(value: str, name: str) -> str:
    path = Path(value.strip())
    if (
        not value.strip()
        or path.is_absolute()
        or ".." in path.parts
        or not _SAFE_RELATIVE_PATH.fullmatch(path.as_posix())
    ):
        raise ProvisioningError(
            f"{name} must be a safe path relative to the remote home"
        )
    return path.as_posix()


def _run_local(
    command: list[str],
    *,
    cwd: Path,
    environment: Mapping[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        command,
        cwd=cwd,
        env=dict(environment) if environment is not None else None,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise ProvisioningError(
            f"source-sync command failed ({shlex.join(command)}): {detail[-4000:]}"
        )
    return completed


@dataclass(frozen=True)
class SourceSyncRequest:
    environment_name: str
    source_root: Path
    branch: str
    host: str
    user: str
    deploy_path: str
    source_mode: str
    repository_url: str = ""
    known_hosts_file: str = ""
    ssh_port: int = 22
    central_host: str = ""
    central_user: str = ""
    central_bare_path: str = ""
    central_known_hosts_file: str = ""
    central_ssh_port: int = 22
    central_daemon_port: int = 9418
    local_git_port: int = 9418
    remote_tunnel_port: int = 19418
    require_clean: bool = False
    remote_platform: RemotePlatform = RemotePlatform.POSIX

    @classmethod
    def from_env_files(
        cls,
        environment_name: str,
        *,
        source_root: Path,
        environments_dir: Path,
        central_environment_path: Path,
        environment_path: Path | None = None,
        branch: str = "",
        require_clean: bool = False,
        remote_platform: RemotePlatform | None = None,
    ) -> "SourceSyncRequest":
        normalized_name = normalize_lease_resource(environment_name)
        if normalized_name != environment_name:
            raise ProvisioningError(
                f"source-sync environment name is not canonical: {environment_name!r}"
            )
        selected_environment_path = (
            environment_path
            if environment_path is not None
            else environments_dir / f"{environment_name}.env"
        )
        if selected_environment_path.name not in (
            f"{environment_name}.env",
            f"{environment_name}.env.example",
        ):
            raise ProvisioningError(
                "source-sync environment file does not match environment "
                f"{environment_name!r}: {selected_environment_path}"
            )
        values = load_env_file(selected_environment_path)
        if remote_platform is None:
            platform_value = values.get(
                "PT_DEPLOY_PLATFORM",
                RemotePlatform.POSIX.value,
            ).strip().lower()
            try:
                remote_platform = RemotePlatform(platform_value)
            except ValueError as error:
                raise ProvisioningError(
                    "unsupported PT_DEPLOY_PLATFORM "
                    f"{platform_value!r} in {selected_environment_path}"
                ) from error
        source_mode = values.get("PT_DEPLOY_SOURCE", "central").strip()
        if source_mode not in ("direct", "central", "github", "local"):
            raise ProvisioningError(
                "unsupported PT_DEPLOY_SOURCE "
                f"{source_mode!r} in {selected_environment_path}"
            )
        selected_branch = (
            branch.strip()
            or values.get("PT_DEPLOY_BRANCH", "").strip()
            or _git_output(source_root, ["branch", "--show-current"])
        )
        _run_local(
            ["git", "check-ref-format", "--branch", selected_branch],
            cwd=source_root,
        )

        central: dict[str, str] = {}
        if source_mode == "central":
            central = load_env_file(central_environment_path)

        repository_url = values.get("PT_DEPLOY_REPO_URL", "").strip()
        if source_mode == "github" and not repository_url:
            try:
                repository_url = _git_output(
                    source_root,
                    ["remote", "get-url", "origin"],
                )
            except ProvisioningError as error:
                raise ProvisioningError(
                    "github source-sync requires PT_DEPLOY_REPO_URL or origin"
                ) from error

        return cls(
            environment_name=environment_name,
            source_root=source_root.resolve(),
            branch=selected_branch,
            host=_required(values, "PT_DEPLOY_HOST", selected_environment_path),
            user=_required(values, "PT_DEPLOY_USER", selected_environment_path),
            deploy_path=_validate_relative_path(
                _required(
                    values,
                    "PT_DEPLOY_PATH",
                    selected_environment_path,
                ),
                "PT_DEPLOY_PATH",
            ),
            source_mode=source_mode,
            repository_url=repository_url,
            known_hosts_file=values.get(
                "PT_DEPLOY_KNOWN_HOSTS_FILE", ""
            ).strip(),
            ssh_port=int(values.get("PT_DEPLOY_SSH_PORT", "22")),
            central_host=central.get("PT_GIT_SERVER_HOST", "").strip(),
            central_user=central.get("PT_GIT_SERVER_USER", "").strip(),
            central_bare_path=central.get(
                "PT_GIT_SERVER_BARE_PATH", ""
            ).strip(),
            central_known_hosts_file=central.get(
                "PT_GIT_SERVER_KNOWN_HOSTS_FILE",
                "",
            ).strip(),
            central_ssh_port=int(
                central.get("PT_GIT_SERVER_SSH_PORT", "22")
            ),
            central_daemon_port=int(
                central.get("PT_GIT_SERVER_DAEMON_PORT", "9418")
            ),
            local_git_port=int(values.get("PT_GIT_SERVE_PORT", "9418")),
            remote_tunnel_port=int(
                values.get("PT_DEPLOY_GIT_TUNNEL_PORT", "19418")
            ),
            require_clean=require_clean,
            remote_platform=remote_platform,
        )


@dataclass(frozen=True)
class SourceSyncResult:
    environment_name: str
    branch: str
    commit: str
    remote_commit: str
    remote_source_digest: str
    remote_checkout_clean: bool
    source_mode: str
    deploy_path: str

    def to_dict(self) -> dict[str, object]:
        return {
            "artifactKind": "acceptance-source-sync-result",
            "environmentName": self.environment_name,
            "branch": self.branch,
            "commit": self.commit,
            "remoteCommit": self.remote_commit,
            "remoteSourceDigest": self.remote_source_digest,
            "remoteCheckoutClean": self.remote_checkout_clean,
            "sourceMode": self.source_mode,
            "deployPath": self.deploy_path,
        }


def _git_output(root: Path, arguments: list[str]) -> str:
    return _run_local(["git", "-C", str(root), *arguments], cwd=root).stdout.strip()


def _git_tree_digest(root: Path, commit: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(root), "ls-tree", "-r", "-z", "--full-tree", commit],
        cwd=root,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise ProvisioningError(
            f"cannot digest source tree at {commit}: {detail[-4000:]}"
        )
    return f"sha256:{hashlib.sha256(completed.stdout).hexdigest()}"


def _local_git_server_running(source_root: Path, port: int) -> bool:
    pid_path = source_root / ".local" / "dev" / "pids" / "git-daemon.pid"
    try:
        pid = int(pid_path.read_text(encoding="utf-8").strip())
        os.kill(pid, 0)
    except (OSError, ValueError):
        return False
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
            return True
    except OSError as error:
        raise ProvisioningError(
            f"local Git daemon PID {pid} is not listening on port {port}"
        ) from error


def _remote_python(remote_platform: RemotePlatform) -> str:
    return "python" if remote_platform == RemotePlatform.WINDOWS else "python3"


def _remote_checkout_script() -> str:
    return "\n".join(
        (
            "import hashlib",
            "import json",
            "import os",
            "import pathlib",
            "import shutil",
            "import subprocess",
            "import sys",
            "",
            "if os.name == 'nt':",
            "    import msvcrt",
            "",
            "    def try_lock(handle):",
            "        if os.fstat(handle.fileno()).st_size == 0:",
            "            handle.write('\\0')",
            "            handle.flush()",
            "        handle.seek(0)",
            "        try:",
            "            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)",
            "        except OSError:",
            "            return False",
            "        return True",
            "",
            "    def unlock(handle):",
            "        handle.seek(0)",
            "        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)",
            "else:",
            "    import fcntl",
            "",
            "    def try_lock(handle):",
            "        try:",
            "            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)",
            "        except BlockingIOError:",
            "            return False",
            "        return True",
            "",
            "    def unlock(handle):",
            "        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)",
            "",
            "def read_owner(handle):",
            "    handle.seek(1 if os.name == 'nt' else 0)",
            "    return handle.readline().strip('\\0\\r\\n')",
            "",
            "def write_owner(handle, owner):",
            "    handle.seek(1 if os.name == 'nt' else 0)",
            "    handle.write(owner + '\\n')",
            "    handle.truncate()",
            "    handle.flush()",
            "    os.fsync(handle.fileno())",
            "",
            "environment_name, deploy_path, fetch_kind, fetch_value, branch, expected_commit, expected_digest, owner, lease_mode = sys.argv[1:]",
            "repo = pathlib.Path.home() / deploy_path",
            "lock_root = pathlib.Path.home() / '.cache/peers-touch/source-leases'",
            "lock_root.mkdir(parents=True, exist_ok=True)",
            "lock_path = lock_root / (environment_name + '.lock')",
            "if lease_mode not in ('acquire', 'held'):",
            "    print('BLOCKED:invalid-lease-mode', flush=True)",
            "    raise SystemExit(79)",
            "lease = None",
            "if lease_mode == 'acquire':",
            "    lock_path.touch(exist_ok=True)",
            "    lease = lock_path.open('r+', encoding='utf-8')",
            "    if not try_lock(lease):",
            "        current_owner = read_owner(lease)",
            "        print(f'BLOCKED:lease-held:{current_owner}', flush=True)",
            "        raise SystemExit(73)",
            "    write_owner(lease, owner)",
            "else:",
            "    lock_path.touch(exist_ok=True)",
            "    lease = lock_path.open('r+', encoding='utf-8')",
            "    if not try_lock(lease):",
            "        current_owner = read_owner(lease)",
            "        if current_owner != owner:",
            "            print(f'BLOCKED:lease-owner-mismatch:{current_owner}', flush=True)",
            "            raise SystemExit(80)",
            "    else:",
            "        unlock(lease)",
            "        print('BLOCKED:source-lease-not-held', flush=True)",
            "        raise SystemExit(81)",
            "",
            "def run(args):",
            "    result = subprocess.run(args, capture_output=True, text=True)",
            "    if result.returncode != 0:",
            "        detail = result.stderr.strip() or result.stdout.strip()",
            "        print(f'FAILED:{detail}', file=sys.stderr)",
            "        raise SystemExit(result.returncode or 1)",
            "    return result.stdout.strip()",
            "",
            "def meaningful_status():",
            "    lines = run(['git', '-C', str(repo), 'status', '--porcelain', '--untracked-files=all']).splitlines()",
            "    return lines",
            "",
            "repo.mkdir(parents=True, exist_ok=True)",
            "legacy_bare = repo / '.bare.git'",
            "if legacy_bare.exists():",
            "    legacy_identity = subprocess.run(",
            "        ['git', '--git-dir', str(legacy_bare), 'rev-parse', '--is-bare-repository'],",
            "        capture_output=True,",
            "        text=True,",
            "    )",
            "    if legacy_identity.returncode == 0 and legacy_identity.stdout.strip() == 'true':",
            "        shutil.rmtree(legacy_bare)",
            "if not (repo / '.git').is_dir():",
            "    if any(repo.iterdir()):",
            "        print('BLOCKED:nonempty-non-git-worktree', flush=True)",
            "        raise SystemExit(72)",
            "    run(['git', 'init', str(repo)])",
            "if os.name == 'nt':",
            "    run(['git', '-C', str(repo), 'config', 'core.longpaths', 'true'])",
            "if meaningful_status():",
            "    print('BLOCKED:dirty-remote-worktree', flush=True)",
            "    raise SystemExit(75)",
            "",
            "fetch_url = str(pathlib.Path.home() / fetch_value) if fetch_kind == 'home' else fetch_value",
            "run(['git', '-C', str(repo), 'fetch', fetch_url, f'+refs/heads/{branch}:refs/remotes/deploy/{branch}'])",
            "remote_commit = run(['git', '-C', str(repo), 'rev-parse', f'refs/remotes/deploy/{branch}^{{commit}}'])",
            "if remote_commit != expected_commit:",
            "    print(f'BLOCKED:commit-mismatch:{remote_commit}', flush=True)",
            "    raise SystemExit(76)",
            "run(['git', '-C', str(repo), 'checkout', '-f', '-B', branch, remote_commit])",
            "run(['git', '-C', str(repo), 'reset', '--hard', remote_commit])",
            "run(['git', '-C', str(repo), 'clean', '-ffdqx'])",
            "tree = subprocess.run(",
            "    ['git', '-C', str(repo), 'ls-tree', '-r', '-z', '--full-tree', remote_commit],",
            "    capture_output=True,",
            ")",
            "if tree.returncode != 0:",
            "    detail = tree.stderr.decode('utf-8', errors='replace').strip()",
            "    print(f'FAILED:{detail}', file=sys.stderr)",
            "    raise SystemExit(tree.returncode or 1)",
            "remote_source_digest = 'sha256:' + hashlib.sha256(tree.stdout).hexdigest()",
            "if remote_source_digest != expected_digest:",
            "    print(f'BLOCKED:source-digest-mismatch:{remote_source_digest}', flush=True)",
            "    raise SystemExit(78)",
            "residue = run(['git', '-C', str(repo), 'status', '--porcelain', '--ignored', '--untracked-files=all']).splitlines()",
            "if residue:",
            "    print('BLOCKED:source-residue-after-checkout', flush=True)",
            "    raise SystemExit(77)",
            "print(json.dumps({'remoteCommit': remote_commit, 'remoteSourceDigest': remote_source_digest, 'remoteCheckoutClean': True}, sort_keys=True))",
        )
    )


class RemoteSourceSynchronizer:
    def __init__(
        self,
        request: SourceSyncRequest,
        *,
        source_lease_held: bool = False,
        source_lease_owner: str = "",
    ) -> None:
        from tooling.acceptance.transports.ssh import SshTarget, SshTransport

        normalized_owner = source_lease_owner.strip()
        if source_lease_held and not normalized_owner:
            raise ValueError(
                "source-sync held lease mode requires source_lease_owner"
            )
        if "\n" in normalized_owner or "\r" in normalized_owner:
            raise ValueError("source-sync lease owner must be one line")
        self.request = request
        self.source_lease_held = source_lease_held
        self.source_lease_owner = normalized_owner
        self.transport = SshTransport(
            SshTarget(
                host=request.host,
                user=request.user,
                port=request.ssh_port,
                known_hosts_file=request.known_hosts_file,
                remote_platform=request.remote_platform,
            )
        )

    def preflight(self) -> tuple[str, str]:
        request = self.request
        commit = _git_output(request.source_root, ["rev-parse", "HEAD"])
        if request.require_clean:
            dirty = _git_output(
                request.source_root,
                ["status", "--porcelain", "--untracked-files=all"],
            )
            if dirty:
                raise ProvisioningError(
                    "source-sync requires a clean local Git worktree"
                )
        return commit, _git_tree_digest(request.source_root, commit)

    def sync(self) -> SourceSyncResult:
        request = self.request
        commit, source_digest = self.preflight()
        tunnel: SshTunnel | None = None
        local_server_started = False
        try:
            (
                fetch_kind,
                fetch_value,
                tunnel,
                local_server_started,
            ) = self._publish_source()
            checkout_script = _remote_checkout_script()
            windows_remote = request.remote_platform == RemotePlatform.WINDOWS
            remote = self.transport.run_argv(
                [
                    _remote_python(request.remote_platform),
                    "-" if windows_remote else "-c",
                    *(() if windows_remote else (checkout_script,)),
                    request.environment_name,
                    request.deploy_path,
                    fetch_kind,
                    fetch_value,
                    request.branch,
                    commit,
                    source_digest,
                    (
                        self.source_lease_owner
                        or f"source-sync:{request.environment_name}"
                    ),
                    "held" if self.source_lease_held else "acquire",
                ],
                timeout=300,
                check=False,
                input_text=checkout_script if windows_remote else None,
            )
        finally:
            if tunnel is not None:
                tunnel.stop()
            if local_server_started:
                git_server_environment = os.environ.copy()
                git_server_environment["PT_GIT_SERVE_PORT"] = str(
                    request.local_git_port
                )
                _run_local(
                    [
                        "/bin/bash",
                        str(
                            request.source_root
                            / "tooling"
                            / "scripts"
                            / "deploy"
                            / "git-serve.sh"
                        ),
                        "stop",
                    ],
                    cwd=request.source_root,
                    environment=git_server_environment,
                )
        if remote.returncode != 0:
            detail = remote.stdout.strip() or remote.stderr.strip()
            raise ProvisioningError(
                f"remote source-sync failed with exit {remote.returncode}: "
                f"{detail[-4000:]}"
            )
        try:
            payload = json.loads(remote.stdout.strip().splitlines()[-1])
        except (IndexError, json.JSONDecodeError) as error:
            raise ProvisioningError(
                "remote source-sync did not return a valid result"
            ) from error
        remote_commit = str(payload.get("remoteCommit") or "")
        remote_source_digest = str(payload.get("remoteSourceDigest") or "")
        remote_clean = payload.get("remoteCheckoutClean") is True
        if (
            remote_commit != commit
            or remote_source_digest != source_digest
            or not remote_clean
        ):
            raise ProvisioningError(
                "remote source-sync identity validation failed"
            )
        return SourceSyncResult(
            environment_name=request.environment_name,
            branch=request.branch,
            commit=commit,
            remote_commit=remote_commit,
            remote_source_digest=remote_source_digest,
            remote_checkout_clean=remote_clean,
            source_mode=request.source_mode,
            deploy_path=request.deploy_path,
        )

    def _publish_source(
        self,
    ) -> tuple[str, str, SshTunnel | None, bool]:
        from tooling.acceptance.transports.ssh import SshTarget, SshTransport

        request = self.request
        if request.source_mode == "direct":
            bare_path = (
                ".cache/peers-touch/source-repositories/"
                f"{request.environment_name}.git"
            )
            self.transport.run_argv(
                [
                    _remote_python(request.remote_platform),
                    "-c",
                    (
                        "import pathlib,sys;"
                        "(pathlib.Path.home()/sys.argv[1]).mkdir("
                        "parents=True,exist_ok=True)"
                    ),
                    ".cache/peers-touch/source-repositories",
                ],
                timeout=30,
                check=True,
            )
            self.transport.run_argv(
                [
                    "git",
                    "init",
                    "--bare",
                    bare_path,
                ],
                timeout=30,
                check=True,
            )
            self._push(
                (
                    f"{request.user}@{request.host}:"
                    f"{bare_path}"
                ),
                self.transport.git_ssh_command(),
            )
            return "home", bare_path, None, False

        if request.source_mode == "central":
            if not (
                request.central_host
                and request.central_user
                and request.central_bare_path
            ):
                raise ProvisioningError(
                    "central source-sync requires git server host, user, and bare path"
                )
            bare_path = _validate_relative_path(
                request.central_bare_path,
                "PT_GIT_SERVER_BARE_PATH",
            )
            central = SshTransport(
                SshTarget(
                    host=request.central_host,
                    user=request.central_user,
                    port=request.central_ssh_port,
                    known_hosts_file=request.central_known_hosts_file,
                )
            )
            self._push(
                f"{request.central_user}@{request.central_host}:{bare_path}",
                central.git_ssh_command(),
            )
            if request.host == request.central_host:
                return "home", bare_path, None, False
            return (
                "url",
                (
                    f"git://{request.central_host}:"
                    f"{request.central_daemon_port}/{Path(bare_path).name}"
                ),
                None,
                False,
            )

        if request.source_mode == "github":
            if not request.repository_url:
                raise ProvisioningError(
                    "github source-sync requires PT_DEPLOY_REPO_URL or origin"
                )
            return "url", request.repository_url, None, False

        git_serve_script = (
            request.source_root / "tooling" / "scripts" / "deploy" / "git-serve.sh"
        )
        local_server_started = not _local_git_server_running(
            request.source_root,
            request.local_git_port,
        )
        tunnel: SshTunnel | None = None
        git_server_environment = os.environ.copy()
        git_server_environment["PT_GIT_SERVE_PORT"] = str(
            request.local_git_port
        )
        try:
            _run_local(
                ["/bin/bash", str(git_serve_script), "start"],
                cwd=request.source_root,
                environment=git_server_environment,
            )
            tunnel = self.transport.start_reverse_forward(
                local_port=request.local_git_port,
                remote_port=request.remote_tunnel_port,
            )
            fetch_url = (
                f"git://127.0.0.1:{request.remote_tunnel_port}/"
                f"{request.source_root.name}"
            )
            probe = self.transport.run_argv(
                ["git", "ls-remote", fetch_url, "HEAD"],
                timeout=15,
                check=False,
            )
            if probe.returncode != 0:
                detail = probe.stderr.strip() or probe.stdout.strip()
                raise ProvisioningError(
                    f"local source-sync reverse tunnel is unavailable: "
                    f"{detail[-4000:]}"
                )
        except BaseException:
            if tunnel is not None:
                tunnel.stop()
            if local_server_started:
                _run_local(
                    ["/bin/bash", str(git_serve_script), "stop"],
                    cwd=request.source_root,
                    environment=git_server_environment,
                )
            raise
        return "url", fetch_url, tunnel, local_server_started

    def _push(self, destination: str, git_ssh_command: str) -> None:
        environment = os.environ.copy()
        environment["GIT_SSH_COMMAND"] = git_ssh_command
        _run_local(
            [
                "git",
                "-C",
                str(self.request.source_root),
                "push",
                "--force",
                destination,
                f"HEAD:refs/heads/{self.request.branch}",
            ],
            cwd=self.request.source_root,
            environment=environment,
        )
