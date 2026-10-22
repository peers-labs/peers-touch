from __future__ import annotations

import copy
import dataclasses
import unittest

from tooling.acceptance.core.finalization_contracts import (
    DarwinRuntimeHostBuild,
    LinuxRuntimeHostBuild,
    PreflightLoadedRuntimeImage,
    PreflightRuntimeMeasurement,
    PreflightRuntimePlatformAttestation,
    PreflightStdlibModuleIdentity,
    PreflightSupervisorBuildIdentity,
    RuntimeImageOriginKind,
    RuntimeOsFamily,
    RuntimePathInput,
    RuntimePathKind,
    StdlibModuleOriginKind,
    domain_separated_sha256,
    raw_sha256,
)


def platform(os_family=RuntimeOsFamily.LINUX):
    loader = PreflightLoadedRuntimeImage.create(
        logical_name="dynamic-loader",
        origin_kind=RuntimeImageOriginKind.STANDALONE_FILE,
        path_hash="a" * 64,
        file_sha256="b" * 64,
    )
    if os_family is RuntimeOsFamily.LINUX:
        build = LinuxRuntimeHostBuild.create(
            os_release_file_sha256="c" * 64,
            kernel_release="synthetic-release",
            kernel_version="synthetic-kernel",
            machine="synthetic-machine",
        )
        cache_uuid = None
        images = (loader,)
    else:
        build = DarwinRuntimeHostBuild.create(
            product_version="synthetic-version",
            product_build_version="synthetic-build",
            kernel_release="synthetic-release",
            kernel_version="synthetic-kernel",
        )
        cache_uuid = "synthetic-cache"
        cached = PreflightLoadedRuntimeImage.create(
            logical_name="libsystem",
            origin_kind=RuntimeImageOriginKind.DARWIN_SHARED_CACHE,
            path_hash="d" * 64,
            macho_uuid="synthetic-macho",
            code_directory_hash=None,
            shared_cache_uuid=cache_uuid,
        )
        images = tuple(sorted((loader, cached), key=lambda item: item.identity_key))
    return PreflightRuntimePlatformAttestation.create(
        os_family=os_family,
        host_build=build,
        dynamic_loader_identity=loader,
        shared_cache_uuid=cache_uuid,
        loaded_images=images,
    )


def path_input(kind, path, module_name=None):
    return RuntimePathInput(kind, module_name, path, raw_sha256(path.encode("utf-8")))


def measurement():
    modules = (
        PreflightStdlibModuleIdentity("json", StdlibModuleOriginKind.FILE, "e" * 64),
        PreflightStdlibModuleIdentity("sys", StdlibModuleOriginKind.BUILTIN, None),
    )
    payload = {
        "supervisorSourcePath": "tooling/acceptance/core/finalization_supervisor.c",
        "supervisorSourceFileSha256": "a" * 64,
        "supervisorBinarySha256": "b" * 64,
        "supervisorBuildIdentity": PreflightSupervisorBuildIdentity.create(
            compiler_executable_path_hash=raw_sha256(b"/synthetic/compiler"),
            compiler_binary_sha256="c" * 64,
            compiler_version="synthetic-cc",
            target_triple="synthetic-target",
            compiler_flags=("-Wall", "-O2"),
        ).to_dict(),
        "protocolVersion": 1,
        "executablePathHash": raw_sha256(b"/synthetic/python"),
        "executableSha256": "d" * 64,
        "implementation": "CPython",
        "version": "3.synthetic",
        "stdlibModules": [item.to_dict() for item in modules],
        "stdlibDigest": domain_separated_sha256(
            "pt.acceptance.finalization.stdlib-closure.v1",
            [item.to_dict() for item in modules],
        ),
        "platformRuntime": platform().to_dict(),
        "coreBootstrapSourceDigest": "f" * 64,
    }
    return PreflightRuntimeMeasurement.from_dict({
        **payload,
        "preflightRuntimeDigest": domain_separated_sha256(
            "pt.acceptance.finalization.preflight-runtime.v1", payload
        ),
    })


def paths():
    return tuple(sorted((
        path_input(RuntimePathKind.COMPILER_BINARY, "/synthetic/compiler"),
        path_input(RuntimePathKind.PYTHON_EXECUTABLE, "/synthetic/python"),
        path_input(RuntimePathKind.SUPERVISOR_BINARY, "/synthetic/supervisor"),
        path_input(RuntimePathKind.STDLIB_MODULE, "/synthetic/json.py", "json"),
    ), key=lambda item: item.identity_key))


class PreflightRuntimeContractTest(unittest.TestCase):
    def test_runtime_paths_validate_normalized_bytes_and_closed_branches(self):
        for item in paths():
            with self.subTest(kind=item.kind):
                self.assertEqual(RuntimePathInput.from_dict(item.to_dict()), item)
        for invalid in (
            "relative", "/synthetic/../python", "//synthetic/python",
            "/synthetic//python", "/synthetic/python/", "/synthetic/\0python",
        ):
            with self.subTest(path=invalid), self.assertRaises(ValueError):
                path_input(RuntimePathKind.PYTHON_EXECUTABLE, invalid)
        item = paths()[0]
        for changes in (
            {"module_name": "unexpected"},
            {"expected_path_hash": "a" * 64},
            {"kind": "COMPILER_BINARY"},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                dataclasses.replace(item, **changes)
        for module_name in (None, ""):
            with self.subTest(module=module_name), self.assertRaises(ValueError):
                path_input(RuntimePathKind.STDLIB_MODULE, "/synthetic/m.py", module_name)
        payload = item.to_dict()
        payload["kind"] = "LOADED_RUNTIME_IMAGE"
        with self.assertRaises(ValueError):
            RuntimePathInput.from_dict(payload)

    def test_platform_round_trip_and_complete_digest(self):
        for os_family in RuntimeOsFamily:
            original = platform(os_family)
            with self.subTest(os=os_family):
                self.assertEqual(
                    PreflightRuntimePlatformAttestation.from_dict(original.to_dict()),
                    original,
                )
                payload = original.to_dict()
                digest = payload.pop("preflightPlatformRuntimeDigest")
                self.assertEqual(digest, domain_separated_sha256(
                    "pt.acceptance.finalization.preflight-platform-runtime.v1", payload
                ))
                for field in original._WIRE_KEYS:
                    malformed = original.to_dict()
                    malformed.pop(field)
                    with self.subTest(missing=field), self.assertRaises(ValueError):
                        PreflightRuntimePlatformAttestation.from_dict(malformed)
                malformed = original.to_dict()
                malformed["artifactRef"] = {}
                with self.assertRaises(ValueError):
                    PreflightRuntimePlatformAttestation.from_dict(malformed)

    def test_platform_inventory_and_os_correlations(self):
        linux = platform()
        darwin = platform(RuntimeOsFamily.DARWIN)
        for changes in (
            {"loaded_images": ()},
            {"loaded_images": (linux.dynamic_loader_identity,) * 2},
            {"shared_cache_uuid": "forbidden"},
            {"host_build": darwin.host_build},
            {"preflight_platform_runtime_digest": "a" * 64},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                dataclasses.replace(linux, **changes)
        for changes in (
            {"loaded_images": tuple(reversed(darwin.loaded_images))},
            {"shared_cache_uuid": "different-cache"},
            {"shared_cache_uuid": None},
            {"dynamic_loader_identity": darwin.loaded_images[0]},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                dataclasses.replace(darwin, **changes)

    def test_measurement_full_digest_and_closed_decoder(self):
        original = measurement()
        self.assertEqual(PreflightRuntimeMeasurement.from_dict(original.to_dict()), original)
        payload = original.to_dict()
        digest = payload.pop("preflightRuntimeDigest")
        self.assertEqual(digest, domain_separated_sha256(
            "pt.acceptance.finalization.preflight-runtime.v1", payload
        ))
        for field in original._WIRE_KEYS:
            malformed = original.to_dict()
            malformed.pop(field)
            with self.subTest(missing=field), self.assertRaises(ValueError):
                PreflightRuntimeMeasurement.from_dict(malformed)
        for field, value in (
            ("version", "changed"),
            ("protocolVersion", True),
            ("stdlibDigest", "a" * 64),
            ("stdlibModules", list(reversed(payload["stdlibModules"]))),
            ("stdlibModules", payload["stdlibModules"] * 2),
            ("supervisorSourcePath", "../outside"),
            ("executableRef", {}),
        ):
            malformed = copy.deepcopy(original.to_dict())
            malformed[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                PreflightRuntimeMeasurement.from_dict(malformed)

    def test_runtime_inventory_is_exact_and_measurement_bound(self):
        original = measurement()
        valid = paths()
        original.validate_runtime_paths(valid)
        variants = (
            valid[:-1],
            tuple(reversed(valid)),
            valid + (valid[0],),
            tuple(sorted(valid + (
                path_input(RuntimePathKind.STDLIB_MODULE, "/synthetic/sys.py", "sys"),
            ), key=lambda item: item.identity_key)),
            tuple(sorted((
                *[item for item in valid if item.kind is not RuntimePathKind.PYTHON_EXECUTABLE],
                path_input(RuntimePathKind.PYTHON_EXECUTABLE, "/synthetic/other"),
            ), key=lambda item: item.identity_key)),
            tuple(sorted((
                *[item for item in valid if item.kind is not RuntimePathKind.COMPILER_BINARY],
                path_input(RuntimePathKind.COMPILER_BINARY, "/synthetic/other-cc"),
            ), key=lambda item: item.identity_key)),
        )
        for invalid in variants:
            with self.subTest(inventory=invalid), self.assertRaises(ValueError):
                original.validate_runtime_paths(invalid)
