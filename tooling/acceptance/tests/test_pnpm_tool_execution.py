"""Real Node loading, input drift and original cache/exit-state observations."""

from __future__ import annotations

from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.core.errors import EphemeralLaunchTimeout
from tooling.acceptance.core.launch_context import GateLaunchSpec
from tooling.acceptance.input_owners import pnpm_tool_execution as owner
from tooling.acceptance.input_owners.pnpm_launchers import TEMPLATE


@unittest.skipUnless(os.sys.platform == "darwin" and shutil.which("node"), "macOS Node")
class PnpmToolExecutionTest(unittest.TestCase):
    def fixture(self, root: Path) -> tuple[Path, Path, Path]:
        package = root / "node_modules/tool"
        (package / "bin").mkdir(parents=True)
        (package / "package.json").write_text(json.dumps({
            "name": "tool", "version": "1.0.0", "bin": {"tool": "bin/tool.cjs"},
        }))
        dependency = root / "lookup/shared"
        dependency.mkdir(parents=True)
        (dependency / "package.json").write_text('{"name":"shared","main":"index.js"}')
        code = dependency / "index.js"
        code.write_text("module.exports = 'first';\n")
        module = dependency / "module.mjs"
        module.write_text("export default 'module';\n")
        entry = package / "bin/tool.cjs"
        entry.write_text(
            "#!/usr/bin/env node\n"
            "const m = require('node:module');m.enableCompileCache();\n"
            "const value = require('shared');\n"
            f"import({json.dumps(str(module))}).then(other => {{\n"
            "try { require('missing-optional-input'); } catch {}\n"
            "process.stdout.write(JSON.stringify({value,other:other.default}));\n"
            "process.exitCode = Number(process.env.PT_TEST_TOOL_EXIT || 0);\n"
            "});\n"
        )
        launcher = root / "node_modules/.bin/tool"
        launcher.parent.mkdir()
        launcher.write_text(TEMPLATE.format(
            node_path=str(root / "lookup"), entry="../tool/bin/tool.cjs",
        ))
        launcher.chmod(0o755)
        pnpm = root / "pnpm.cjs"
        pnpm.write_text(
            "#!/usr/bin/env node\n"
            f"const result=require('node:child_process').spawnSync({json.dumps(str(launcher))},"
            "process.argv.slice(3),{env:process.env,stdio:'inherit'});\n"
            "process.exitCode=result.status ?? 1;\n"
        )
        pnpm.chmod(0o755)
        (root / "package.json").write_text('{"name":"fixture","version":"1.0.0"}')
        return pnpm, entry, code

    def selection(self, root: Path, pnpm: Path) -> ExitStack:
        stack = ExitStack()
        stack.enter_context(patch.object(owner, "pnpm_entry", return_value=(pnpm, root)))
        stack.enter_context(patch.object(
            owner, "delegation_candidates", return_value={str(pnpm): (root, pnpm)},
        ))
        stack.enter_context(patch.dict(os.environ, {
            "NODE_OPTIONS": "", "NODE_PATH": "",
            "NODE_COMPILE_CACHE": str(root / "cache"),
            "PT_TEST_TOOL_EXIT": "0",
        }))
        os.environ.pop("NODE_DISABLE_COMPILE_CACHE", None)
        return stack

    def test_actual_tool_loads_global_and_esm_inputs_with_original_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            pnpm, entry, code = self.fixture(root)
            with self.selection(root, pnpm):
                first = owner.pnpm_tool_execution_inputs(root, "tool")
                self.assertEqual(first["commandExitCode"], 0)
                self.assertTrue(first["allProcessesReportedExit"])
                self.assertEqual(first["qualification"], "OBSERVED_TOOL_VERSION_INPUTS_ONLY")
                self.assertFalse(first["completeToolQualification"])
                self.assertFalse(first["completeBuildQualification"])
                self.assertEqual(first["compileCacheQualification"], "UNPROVEN")
                self.assertIn(str(code), first["loadedSources"])
                with self.subTest(identity="json-roundtrip"):
                    self.assertEqual(json.loads(json.dumps(first)), first)
                self.assertIn(str(code.with_name("module.mjs")), first["loadedSources"])
                tool = next(value for value in first["processes"] if value["entry"] == str(entry))
                self.assertFalse(tool["finalCache"]["disabled"])
                self.assertIsNotNone(tool["finalCache"]["directory"])
                self.assertTrue(any(
                    row["specifier"] == "shared" and row["url"].endswith("/index.js")
                    for row in tool["resolutions"]
                ))
                self.assertTrue(any(
                    row["specifier"] == "missing-optional-input" and row["code"] == "MODULE_NOT_FOUND"
                    for row in tool["failures"]
                ))
                metadata = code.stat()
                code.write_text("module.exports = 'other';\n")
                os.utime(code, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
                second = owner.pnpm_tool_execution_inputs(root, "tool")
                self.assertNotEqual(
                    first["loadedSources"][str(code)]["bytes"],
                    second["loadedSources"][str(code)]["bytes"],
                )
                with patch.dict(os.environ, {"PT_TEST_TOOL_EXIT": "7"}):
                    failed = owner.pnpm_tool_execution_inputs(root, "tool")
                self.assertEqual(failed["commandExitCode"], 7)
                self.assertTrue(any(value["exitCode"] == 7 for value in failed["processes"]))
                self.assertFalse(failed["completeToolQualification"])

    def test_changed_loader_entry_and_after_execution_content_reject(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            pnpm, entry, code = self.fixture(root)
            with self.selection(root, pnpm):
                for name in ("", "../tool", "tool;command"):
                    with self.subTest(name=name), self.assertRaises(ValueError):
                        owner.pnpm_tool_execution_inputs(root, name)
                for key in ("NODE_OPTIONS", "NODE_PATH"):
                    with self.subTest(key=key), patch.dict(os.environ, {key: "foreign"}):
                        with self.assertRaisesRegex(ValueError, "loader"):
                            owner.pnpm_tool_execution_inputs(root, "tool")
                original = owner.GateProcessLauncher.run

                def changing(launcher, *arguments, **options):
                    result = original(launcher, *arguments, **options)
                    code.write_text("module.exports = 'other';\n")
                    return result

                with patch.object(owner.GateProcessLauncher, "run", new=changing):
                    with self.assertRaisesRegex(ValueError, "bytes changed"):
                        owner.pnpm_tool_execution_inputs(root, "tool")
                entry.write_text(
                    "#!/usr/bin/env node\n"
                    "import('data:text/javascript,export default 1').catch(()=>{});\n"
                )
                with self.assertRaisesRegex(ValueError, "incomplete"):
                    owner.pnpm_tool_execution_inputs(root, "tool")

    def test_loaded_generated_file_lifetime_preserves_exit_and_rejects_incomplete_inputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            pnpm, entry, _ = self.fixture(root)
            generated = entry.parent / "generated-config.cjs"
            original = "module.exports = 'first';\n"
            changed = "module.exports = 'other';\n"
            with self.selection(root, pnpm):
                for state in ("present", "absent", "changed"):
                    with self.subTest(state=state):
                        exit_code = 7 if state == "present" else 0
                        action = {
                            "present": "",
                            "absent": "fs.unlinkSync(filename);",
                            "changed": (
                                f"fs.writeFileSync(filename,{json.dumps(changed)});"
                                "fs.utimesSync(filename,stat.atime,stat.mtime);"
                            ),
                        }[state]
                        entry.write_text(
                            "#!/usr/bin/env node\n"
                            "const fs=require('node:fs');\n"
                            f"const filename={json.dumps(str(generated))};\n"
                            f"fs.writeFileSync(filename,{json.dumps(original)});\n"
                            "const stat=fs.statSync(filename);\n"
                            "require(filename);\n"
                            + action + f"\nprocess.exitCode={exit_code};\n"
                        )
                        result = owner.GateProcessLauncher(
                            cwd=str(root), environment={
                                **os.environ,
                                "NODE_OPTIONS": "--require=" + json.dumps(str(owner.WORKER)),
                                "PT_NODE_OBSERVATION_ENTRIES": json.dumps([str(pnpm), str(entry)]),
                            }, termination_timeout_seconds=1,
                        ).run(GateLaunchSpec((str(pnpm), "exec", "tool", "--version"), 2, ()), None)
                        self.assertEqual(result.returncode, exit_code)
                        samples, _ = owner.node_execution_observations(result.stdout)
                        tool = next(row for row in samples if row["entry"] == str(entry))
                        self.assertEqual(tool["event"], "exit")
                        self.assertEqual(tool["exitCode"], exit_code)
                        self.assertEqual(tool["complete"], state == "present")
                        row = next(row for row in tool["modules"] if row["path"] == str(generated))
                        self.assertEqual(row["fileBytes"], hashlib.sha256(original.encode()).hexdigest())
                        self.assertEqual(row["postLoad"]["state"], state)
                        if state == "absent":
                            self.assertEqual(row["postLoad"], {"state": "absent", "errorCode": "ENOENT"})
                        else:
                            content = changed if state == "changed" else original
                            self.assertEqual(row["postLoad"]["fileBytes"], hashlib.sha256(content.encode()).hexdigest())
                            self.assertEqual(row["postLoad"]["resolved"], str(generated))
                        if state == "present":
                            self.assertEqual(owner.pnpm_tool_execution_inputs(root, "tool")["commandExitCode"], 7)
                        else:
                            with self.assertRaisesRegex(ValueError, "incomplete"):
                                owner.pnpm_tool_execution_inputs(root, "tool")

    def test_async_loader_preserves_transferred_options_and_records_unclosed_thread(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            pnpm, entry, code = self.fixture(root)
            module = code.with_name("module.mjs")
            hooks = entry.parent / "hooks.mjs"
            dependency = hooks.with_name("hook-options.mjs")
            dependency.write_text("export const option = 'original-options';\n")
            missing = root / "missing-module.mjs"
            result_file = root / "loader-result.json"
            worker_file = root / "worker.cjs"
            worker_file.write_text(
                "const {parentPort,workerData}=require('node:worker_threads');\n"
                "parentPort.postMessage({value:workerData.value,pid:process.pid});\n"
            )
            hooks.write_text(
                "import {isInternalThread,threadId} from 'node:worker_threads';\n"
                "import {option} from './hook-options.mjs';\n"
                "export function initialize({port,expected}) {\n"
                "if(expected!==option)throw new Error('registration options changed');\n"
                "port.postMessage({expected,pid:process.pid,threadId,isInternalThread,"
                "argv:process.argv});port.close();\n"
                "}\n"
                "export async function resolve(specifier,context,nextResolve) {\n"
                "if(specifier==='original-resolve-error') {\n"
                "const error=new TypeError('original resolution failure');\n"
                "error.code='ORIGINAL_RESOLVE_ERROR';throw error;\n"
                "}\nreturn await nextResolve(specifier,context);\n"
                "}\n"
                "export async function load(url,context,nextLoad) {\n"
                f"if(url==={json.dumps(code.as_uri())})"
                "return {format:'commonjs',source:null,shortCircuit:true};\n"
                "const value=await nextLoad(url,context);\n"
                f"return url==={json.dumps(module.as_uri())}"
                "?{...value,source:\"export default 'transformed';\"}:value;\n"
                "}\n"
            )
            entry.write_text(
                "#!/usr/bin/env node\n"
                "const fs=require('node:fs'),m=require('node:module');\n"
                "const {MessageChannel,Worker}=require('node:worker_threads');\n"
                "const {once}=require('node:events');\n"
                "m.enableCompileCache();\n"
                "const {port1,port2}=new MessageChannel();\n"
                "const ready=once(port1,'message');\n"
                f"m.register({json.dumps(hooks.as_uri())},{{"
                f"parentURL:{json.dumps(entry.as_uri())},"
                "data:{port:port2,expected:'original-options'},transferList:[port2]});\n"
                "ready.then(async ([info])=>{\n"
                f"const value=await import({json.dumps(module.as_uri())});\n"
                f"const cjs=await import({json.dumps(code.as_uri())});\n"
                "const failures=[];\n"
                f"for(const specifier of [{json.dumps(missing.as_uri())},"
                "'original-resolve-error']) {\n"
                "try {await import(specifier);throw new Error('resolution unexpectedly succeeded');}\n"
                "catch(error) {failures.push({specifier,name:error.name,code:error.code,"
                "message:error.message});}\n"
                "}\n"
                f"const worker=new Worker({json.dumps(str(worker_file))},"
                "{workerData:{value:'original-worker-options'}});\n"
                "const exited=once(worker,'exit');\n"
                "const [workerResult]=await once(worker,'message');await exited;\n"
                f"fs.writeFileSync({json.dumps(str(result_file))},JSON.stringify({{"
                "info,workerResult,failures,value:value.default,cjs:cjs.default,cache:m.getCompileCacheDir(),"
                "configuredCache:process.env.NODE_COMPILE_CACHE,"
                "disabled:process.env.NODE_DISABLE_COMPILE_CACHE==='1'}));\n"
                "port1.close();process.exitCode=Number(process.env.PT_TEST_TOOL_EXIT);\n"
                "});\n"
            )
            with self.selection(root, pnpm):
                for observed, exit_code in ((False, 0), (True, 0), (True, 7)):
                    with self.subTest(observed=observed, exit_code=exit_code):
                        environment = {**os.environ, "PT_TEST_TOOL_EXIT": str(exit_code)}
                        if observed:
                            environment.update(
                                NODE_OPTIONS="--require=" + json.dumps(str(owner.WORKER)),
                                PT_NODE_OBSERVATION_ENTRIES=json.dumps([str(pnpm), str(entry)]),
                            )
                        result = owner.GateProcessLauncher(
                            cwd=str(root), environment=environment, termination_timeout_seconds=1,
                        ).run(GateLaunchSpec((str(pnpm), "exec", "tool", "--version"), 2, ()), None)
                        self.assertEqual(result.returncode, exit_code)
                        actual = json.loads(result_file.read_text())
                        self.assertEqual(actual["value"], "transformed")
                        self.assertEqual(actual["cjs"], "first")
                        self.assertEqual(actual["workerResult"], {
                            "value": "original-worker-options", "pid": actual["info"]["pid"],
                        })
                        self.assertEqual(actual["info"]["expected"], "original-options")
                        self.assertTrue(actual["info"]["isInternalThread"])
                        self.assertEqual(len(actual["info"]["argv"]), 1)
                        self.assertEqual(actual["configuredCache"], str(root / "cache"))
                        self.assertIsNotNone(actual["cache"])
                        self.assertFalse(actual["disabled"])
                        self.assertEqual(actual["failures"][0]["specifier"], missing.as_uri())
                        self.assertEqual(actual["failures"][0]["code"], "ERR_MODULE_NOT_FOUND")
                        self.assertEqual(actual["failures"][0]["name"], "Error")
                        self.assertIn(str(missing), actual["failures"][0]["message"])
                        self.assertEqual(actual["failures"][1], {
                            "specifier": "original-resolve-error", "name": "TypeError",
                            "code": "ORIGINAL_RESOLVE_ERROR",
                            "message": "original resolution failure",
                        })
                        if observed:
                            samples, _ = owner.node_execution_observations(result.stdout)
                            loader = next(row for row in samples if row["event"] == "loader-initialized")
                            self.assertEqual(loader["entry"], str(entry))
                            self.assertEqual(loader["context"], {
                                "pid": actual["info"]["pid"],
                                "threadId": actual["info"]["threadId"],
                                "isMainThread": False, "isInternalThread": True,
                            })
                            self.assertFalse(loader["complete"])
                            self.assertIsNone(loader["exitCode"])
                            registrar = [
                                row for row in samples
                                if row["event"] == "async-registrar-module-loaded"
                            ]
                            recorded = {
                                row["path"]: row for sample in registrar
                                for row in sample["modules"]
                            }
                            self.assertTrue({str(hooks), str(dependency)} <= set(recorded))
                            for filename in (hooks, dependency):
                                loaded = recorded[str(filename)]
                                expected_bytes = hashlib.sha256(filename.read_bytes()).hexdigest()
                                self.assertEqual(loaded["format"], "module")
                                self.assertEqual(loaded["fileBytes"], expected_bytes)
                                self.assertEqual(loaded["loadedSourceBytes"], expected_bytes)
                                self.assertEqual(loaded["postLoad"]["state"], "present")
                            for sample in registrar:
                                self.assertEqual(sample["context"], loader["context"])
                                self.assertEqual(sample["entry"], str(entry))
                                self.assertFalse(sample["complete"])
                                self.assertIsNone(sample["exitCode"])
                                self.assertEqual(len(sample["modules"]), 1)
                                self.assertEqual(sample["resolutions"], [])
                                self.assertEqual(sample["failures"], [])
                            resolutions = [
                                row for row in samples if row["event"] == "async-module-resolved"
                            ]
                            self.assertTrue(resolutions)
                            for sample in resolutions:
                                self.assertEqual(sample["context"], loader["context"])
                                self.assertEqual(sample["entry"], str(entry))
                                self.assertFalse(sample["complete"])
                                self.assertIsNone(sample["exitCode"])
                                self.assertEqual(sample["modules"], [])
                                self.assertEqual(sample["failures"], [])
                                self.assertEqual(len(sample["resolutions"]), 1)
                                self.assertEqual(
                                    sample["resolutions"][0]["conditions"],
                                    sorted(sample["resolutions"][0]["conditions"]),
                                )
                            failed = [
                                row for row in samples if row["event"] == "async-resolution-failed"
                            ]
                            self.assertEqual(len(failed), 2)
                            self.assertEqual(
                                {row["failures"][0]["specifier"]: row["failures"][0]["code"]
                                 for row in failed},
                                {missing.as_uri(): "ERR_MODULE_NOT_FOUND",
                                 "original-resolve-error": "ORIGINAL_RESOLVE_ERROR"},
                            )
                            for sample in failed:
                                self.assertEqual(sample["context"], loader["context"])
                                self.assertEqual(sample["entry"], str(entry))
                                self.assertFalse(sample["complete"])
                                self.assertIsNone(sample["exitCode"])
                                self.assertEqual(sample["modules"], [])
                                self.assertEqual(sample["resolutions"], [])
                                self.assertEqual(len(sample["failures"]), 1)
                                self.assertEqual(sample["failures"][0]["parent"], entry.as_uri())
                            asynchronous = [
                                row for row in samples if row["event"] == "async-module-loaded"
                            ]
                            self.assertEqual(len(asynchronous), 2)
                            for sample in asynchronous:
                                self.assertEqual(sample["context"], loader["context"])
                                self.assertEqual(sample["entry"], str(entry))
                                self.assertFalse(sample["complete"])
                                self.assertIsNone(sample["exitCode"])
                                self.assertEqual(sample["resolutions"], [])
                                self.assertEqual(len(sample["modules"]), 1)
                                loaded = sample["modules"][0]
                                self.assertTrue(any(
                                    row["resolutions"][0]["url"] == Path(loaded["path"]).as_uri()
                                    for row in resolutions
                                ))
                                expected = {
                                    str(module): (
                                        "module", hashlib.sha256(
                                            b"export default 'transformed';"
                                        ).hexdigest(),
                                    ),
                                    str(code): ("commonjs", None),
                                }
                                self.assertIn(loaded["path"], expected)
                                expected_format, loaded_bytes = expected[loaded["path"]]
                                file_bytes = hashlib.sha256(
                                    Path(loaded["path"]).read_bytes()
                                ).hexdigest()
                                self.assertEqual(loaded["format"], expected_format)
                                self.assertEqual(loaded["fileBytes"], file_bytes)
                                self.assertEqual(loaded["loadedSourceBytes"], loaded_bytes)
                                self.assertEqual(loaded["postLoad"], {
                                    "state": "present", "fileBytes": file_bytes,
                                    "resolved": loaded["path"],
                                })
                            thread = next(row for row in samples if row["event"] == "worker-initialized")
                            self.assertEqual(thread["entry"], str(entry))
                            self.assertEqual(thread["threadEntry"], str(worker_file))
                            self.assertFalse(thread["complete"])
                            self.assertFalse(thread["context"]["isMainThread"])
                            self.assertFalse(thread["context"]["isInternalThread"])
                            self.assertEqual(thread["context"]["pid"], actual["info"]["pid"])
                            worker_terminal = next(
                                row for row in samples
                                if row["event"] == "exit"
                                and row["context"] == thread["context"]
                            )
                            self.assertFalse(worker_terminal["complete"])
                            self.assertEqual(worker_terminal["exitCode"], 0)
                            self.assertEqual(worker_terminal["threadEntry"], str(worker_file))
                            loaded = next(
                                row for row in worker_terminal["modules"]
                                if row["path"] == str(worker_file)
                            )
                            expected_bytes = hashlib.sha256(worker_file.read_bytes()).hexdigest()
                            self.assertEqual(loaded["fileBytes"], expected_bytes)
                            self.assertEqual(loaded["loadedSourceBytes"], expected_bytes)
                            self.assertEqual(loaded["format"], "commonjs")
                            self.assertEqual(loaded["cache"], worker_terminal["finalCache"])
                            self.assertEqual(loaded["postLoad"], {
                                "state": "present", "fileBytes": expected_bytes,
                                "resolved": str(worker_file),
                            })
                            terminal = next(
                                row for row in samples
                                if row["entry"] == str(entry) and row["event"] == "exit"
                                and row["context"]["isMainThread"]
                            )
                            self.assertEqual(terminal["exitCode"], exit_code)
                            self.assertEqual(terminal["context"]["pid"], actual["info"]["pid"])
                            self.assertTrue(terminal["context"]["isMainThread"])
                with self.assertRaisesRegex(ValueError, "incomplete"):
                    owner.pnpm_tool_execution_inputs(root, "tool")

    def test_repeated_registration_and_registration_failure_preserve_loading(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            pnpm, entry, code = self.fixture(root)
            first_module, second_module, later_module = (
                root / name for name in ("first.mjs", "second.mjs", "later.mjs")
            )
            for filename in (first_module, second_module, later_module):
                filename.write_text("export default 'original';\n")
            dependency = root / "registration-options.mjs"
            dependency.write_text("export const value = 'second';\n")
            hooks = [root / "first-hooks.mjs", root / "second-hooks.mjs"]
            hooks[0].write_text(
                "export async function load(url,context,nextLoad) {\n"
                f"if(url==={json.dumps(code.as_uri())})"
                "return {format:'commonjs',source:null,shortCircuit:true};\n"
                "const result=await nextLoad(url,context);\n"
                f"return [{json.dumps(first_module.as_uri())},"
                f"{json.dumps(second_module.as_uri())}].includes(url)"
                "?{...result,source:\"export default 'first';\"}:result;\n"
                "}\n"
            )
            hooks[1].write_text(
                "import {value} from './registration-options.mjs';\n"
                "export async function load(url,context,nextLoad) {\n"
                "const result=await nextLoad(url,context);\n"
                f"return url==={json.dumps(second_module.as_uri())}"
                "?{...result,source:`export default '${value}';`}:result;\n"
                "}\n"
            )
            failed_hook = root / "failed-hooks.mjs"
            failed_hook.write_text(
                "export function initialize() {\n"
                "const error=new TypeError('original registration failure');\n"
                "error.code='ORIGINAL_REGISTRATION_ERROR';throw error;\n"
                "}\n"
            )
            result_file = root / "registration-result.json"
            entry.write_text(
                "#!/usr/bin/env node\n"
                "const fs=require('node:fs'),m=require('node:module');m.enableCompileCache();\n"
                "const failures=[];\n"
                "function failing() {try {\n"
                f"m.register({json.dumps(failed_hook.as_uri())},"
                f"{{parentURL:{json.dumps(entry.as_uri())}}});\n"
                "throw new Error('registration unexpectedly succeeded');\n"
                "} catch(error) {failures.push({name:error.name,code:error.code,"
                "message:error.message});}}\n"
                "(async()=>{\n"
                "if(process.env.PT_TEST_REGISTRATION_FAILURE==='before')failing();\n"
                f"const firstResult=m.register({json.dumps(hooks[0].as_uri())},"
                f"{{parentURL:{json.dumps(entry.as_uri())}}});\n"
                f"const first=await import({json.dumps(first_module.as_uri())});\n"
                f"const secondResult=m.register({json.dumps(hooks[1].as_uri())},"
                f"{{parentURL:{json.dumps(entry.as_uri())}}});\n"
                f"const second=await import({json.dumps(second_module.as_uri())});\n"
                f"const cjs=await import({json.dumps(code.as_uri())});\n"
                "if(process.env.PT_TEST_REGISTRATION_FAILURE==='after')failing();\n"
                f"const later=await import({json.dumps(later_module.as_uri())});\n"
                f"fs.writeFileSync({json.dumps(str(result_file))},JSON.stringify({{"
                "first:first.default,second:second.default,cjs:cjs.default,later:later.default,"
                "returnsUndefined:firstResult===undefined&&secondResult===undefined,"
                "failures,cache:m.getCompileCacheDir(),disabled:"
                "process.env.NODE_DISABLE_COMPILE_CACHE==='1'}));\n"
                "process.exitCode=Number(process.env.PT_TEST_TOOL_EXIT);})();\n"
            )
            with self.selection(root, pnpm):
                for failure in ("none", "before", "after"):
                    for observed, exit_code in ((False, 0), (True, 0), (True, 7)):
                        with self.subTest(failure=failure, observed=observed, exit_code=exit_code):
                            environment = {
                                **os.environ, "PT_TEST_TOOL_EXIT": str(exit_code),
                                "PT_TEST_REGISTRATION_FAILURE": failure,
                            }
                            if observed:
                                environment.update(
                                    NODE_OPTIONS="--require=" + json.dumps(str(owner.WORKER)),
                                    PT_NODE_OBSERVATION_ENTRIES=json.dumps([str(pnpm), str(entry)]),
                                )
                            result = owner.GateProcessLauncher(
                                cwd=str(root), environment=environment, termination_timeout_seconds=1,
                            ).run(GateLaunchSpec((str(pnpm), "exec", "tool", "--version"), 2, ()), None)
                            self.assertEqual(result.returncode, exit_code, result.stderr)
                            actual = json.loads(result_file.read_text())
                            self.assertEqual(
                                [actual[key] for key in ("first", "second", "cjs", "later")],
                                ["first", "second", "first", "original"],
                            )
                            self.assertTrue(actual["returnsUndefined"])
                            self.assertIsNotNone(actual["cache"])
                            self.assertFalse(actual["disabled"])
                            self.assertEqual(actual["failures"], [] if failure == "none" else [{
                                "name": "TypeError", "code": "ORIGINAL_REGISTRATION_ERROR",
                                "message": "original registration failure",
                            }])
                            if not observed:
                                continue
                            samples, _ = owner.node_execution_observations(result.stdout)
                            registrar = [
                                row for row in samples
                                if row["event"] == "async-registrar-module-loaded"
                            ]
                            required = {str(filename) for filename in (*hooks, dependency)}
                            if failure != "none":
                                required.add(str(failed_hook))
                            recorded = {
                                row["path"] for sample in registrar for row in sample["modules"]
                            }
                            self.assertTrue(required <= recorded)
                            self.assertTrue(all(not row["complete"] for row in registrar))
                            runtime = [
                                row for row in samples if row["event"] == "async-module-loaded"
                            ]
                            self.assertEqual(len(runtime), 4)
                            for sample in runtime:
                                self.assertFalse(sample["complete"])
                                loaded = sample["modules"][0]
                                filename = loaded["path"]
                                expected_source = {
                                    str(first_module): b"export default 'first';",
                                    str(second_module): b"export default 'second';",
                                    str(later_module): later_module.read_bytes(), str(code): None,
                                }[filename]
                                self.assertEqual(loaded["loadedSourceBytes"], None if expected_source is None
                                                 else hashlib.sha256(expected_source).hexdigest())
                                self.assertEqual(loaded["fileBytes"], hashlib.sha256(Path(filename).read_bytes()).hexdigest())
                            terminal = next(
                                row for row in samples if row["entry"] == str(entry)
                                and row["event"] == "exit" and row["context"]["isMainThread"]
                            )
                            self.assertFalse(terminal["complete"])
                            self.assertEqual(terminal["exitCode"], exit_code)

    def test_async_resolution_delegate_returns_original_result_and_error_objects(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            pnpm, entry, code = self.fixture(root)
            adapter = owner.WORKER.with_name("node_async_execution_observation.mjs")
            entry.write_text(
                "#!/usr/bin/env node\n"
                "const assert=require('node:assert/strict');\n"
                f"import({json.dumps(adapter.as_uri())}).then(async adapter=>{{\n"
                "const context={conditions:['node','import'],"
                f"parentURL:{json.dumps(entry.as_uri())}}};\n"
                f"const original={{url:{json.dumps(code.as_uri())},"
                "format:'commonjs',shortCircuit:true};\n"
                "let calls=0;\n"
                "const actual=await adapter.resolve('original-success',context,"
                "async(specifier,received)=>{calls++;"
                "assert.equal(specifier,'original-success');"
                "assert.strictEqual(received,context);return original;});\n"
                "assert.strictEqual(actual,original);\n"
                "const error=new TypeError('original delegate failure');error.code='ORIGINAL_ERROR';\n"
                "await assert.rejects(adapter.resolve('original-failure',context,"
                "async(specifier,received)=>{calls++;"
                "assert.equal(specifier,'original-failure');"
                "assert.strictEqual(received,context);throw error;}),"
                "received=>received===error);\n"
                "assert.equal(calls,2);process.stdout.write('original-identities\\n');\n"
                "process.exitCode=7;});\n"
            )
            with self.selection(root, pnpm):
                result = owner.GateProcessLauncher(
                    cwd=str(root), environment={
                        **os.environ,
                        "NODE_OPTIONS": "--require=" + json.dumps(str(owner.WORKER)),
                        "PT_NODE_OBSERVATION_ENTRIES": json.dumps([str(pnpm), str(entry)]),
                    }, termination_timeout_seconds=1,
                ).run(GateLaunchSpec((str(pnpm), "exec", "tool", "--version"), 2, ()), None)
                self.assertEqual(result.returncode, 7, result.stderr)
                samples, output = owner.node_execution_observations(result.stdout)
                self.assertIn("original-identities\n", output)
                resolved = next(
                    row for row in samples if row["event"] == "async-module-resolved"
                )
                failed = next(
                    row for row in samples if row["event"] == "async-resolution-failed"
                )
                self.assertEqual(resolved["resolutions"], [{
                    "specifier": "original-success", "parent": entry.as_uri(),
                    "url": code.as_uri(), "conditions": ["import", "node"],
                }])
                self.assertEqual(failed["failures"], [{
                    "specifier": "original-failure", "parent": entry.as_uri(),
                    "code": "ORIGINAL_ERROR",
                }])

    def test_native_typescript_load_preserves_source_and_rejects_incomplete_format(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            pnpm, entry, _ = self.fixture(root)
            module = root / "configuration.mts"
            module.write_text("const value: string = 'typed';export default value;\n")
            result_file = root / "typescript-result.json"
            entry.write_text(
                "#!/usr/bin/env node\n"
                f"import({json.dumps(module.as_uri())}).then(value=>{{\n"
                f"require('node:fs').writeFileSync({json.dumps(str(result_file))},"
                "JSON.stringify({value:value.default}));\n"
                "process.exitCode=Number(process.env.PT_TEST_TOOL_EXIT);});\n"
            )
            with self.selection(root, pnpm):
                for observed, exit_code in ((False, 0), (True, 0), (True, 7)):
                    with self.subTest(observed=observed, exit_code=exit_code):
                        environment = {**os.environ, "PT_TEST_TOOL_EXIT": str(exit_code)}
                        if observed:
                            environment.update(
                                NODE_OPTIONS="--require=" + json.dumps(str(owner.WORKER)),
                                PT_NODE_OBSERVATION_ENTRIES=json.dumps([str(pnpm), str(entry)]),
                            )
                        result = owner.GateProcessLauncher(
                            cwd=str(root), environment=environment, termination_timeout_seconds=1,
                        ).run(GateLaunchSpec((str(pnpm), "exec", "tool", "--version"), 2, ()), None)
                        self.assertEqual(result.returncode, exit_code)
                        self.assertEqual(json.loads(result_file.read_text()), {"value": "typed"})
                        if observed:
                            samples, _ = owner.node_execution_observations(result.stdout)
                            terminal = next(
                                row for row in samples
                                if row["entry"] == str(entry) and row["event"] == "exit"
                            )
                            self.assertEqual(terminal["exitCode"], exit_code)
                            self.assertFalse(terminal["complete"])
                            loaded = next(
                                row for row in terminal["modules"] if row["path"] == str(module)
                            )
                            self.assertEqual(loaded["format"], "module-typescript")
                            self.assertEqual(
                                loaded["fileBytes"], hashlib.sha256(module.read_bytes()).hexdigest(),
                            )
                            self.assertEqual(loaded["postLoad"]["state"], "present")
                with self.assertRaisesRegex(ValueError, "incomplete"):
                    owner.pnpm_tool_execution_inputs(root, "tool")

    def test_large_input_inventory_is_complete_and_deadline_releases_processes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            pnpm, entry, _ = self.fixture(root)
            files = []
            imports = []
            for index in range(180):
                filename = entry.parent / f"source-{index:03}.cjs"
                filename.write_text(f"module.exports = {index};\n")
                files.append(str(filename))
                imports.append(f"require('./source-{index:03}.cjs');")
            entry.write_text("#!/usr/bin/env node\n" + "\n".join(imports) + "\n")
            with self.selection(root, pnpm):
                value = owner.pnpm_tool_execution_inputs(root, "tool")
                self.assertEqual(value["commandExitCode"], 0)
                self.assertTrue(set(files).issubset(value["loadedSources"]))
                tool = next(row for row in value["processes"] if row["entry"] == str(entry))
                self.assertGreater(len(json.dumps(tool)), 64 * 1024)
                self.assertEqual(
                    {row["path"] for row in tool["modules"]},
                    {str(entry), *files},
                )
                entry.write_text(
                    "#!/usr/bin/env node\n"
                    f"require('node:fs').writeFileSync({json.dumps(str(root / 'process.json'))},"
                    "JSON.stringify({pid:process.pid,parent:process.ppid}));\n"
                    "setInterval(()=>{},1000);\n"
                )
                with self.assertRaises(EphemeralLaunchTimeout):
                    owner.pnpm_tool_execution_inputs(root, "tool")
                identity = json.loads((root / "process.json").read_text())
                for pid in (identity["pid"], identity["parent"]):
                    with self.subTest(pid=pid), self.assertRaises(ProcessLookupError):
                        os.kill(pid, 0)

    def test_concurrent_worker_output_roundtrips_after_one_worker_terminates(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            pnpm, entry, _ = self.fixture(root)
            imports = []
            for index in range(180):
                filename = entry.parent / f"shared-{index:03}.cjs"
                filename.write_text(f"module.exports = {index};\n")
                imports.append(f"require('./shared-{index:03}.cjs');")
            worker_file = entry.parent / "concurrent-worker.cjs"
            worker_file.write_text(
                "const {parentPort,workerData}=require('node:worker_threads');\n"
                + "\n".join(imports)
                + "\nparentPort.postMessage({pid:process.pid,value:179});\n"
                "if(workerData.stop)setInterval(()=>{},1000);\n"
                "else Atomics.wait(new Int32Array(workerData.barrier),0,0);\n"
            )
            result_file = root / "concurrent-result.json"
            entry.write_text(
                "#!/usr/bin/env node\n"
                "const fs=require('node:fs'),m=require('node:module');\n"
                "const {Worker}=require('node:worker_threads'),{once}=require('node:events');\n"
                "m.enableCompileCache();const barrier=new SharedArrayBuffer(4);\n"
                f"const workers=Array.from({{length:5}},(_,index)=>new Worker("
                f"{json.dumps(str(worker_file))},{{workerData:{{barrier,stop:index===4}}}}));\n"
                "const exits=workers.slice(0,4).map(worker=>once(worker,'exit'));\n"
                "Promise.all(workers.map(worker=>once(worker,'message'))).then(async values=>{\n"
                "const stopped=await workers[4].terminate();\n"
                "Atomics.store(new Int32Array(barrier),0,1);Atomics.notify(new Int32Array(barrier),0);\n"
                "await Promise.all(exits);\n"
                f"fs.writeFileSync({json.dumps(str(result_file))},JSON.stringify({{"
                "values,stopped,pid:process.pid,cache:m.getCompileCacheDir()}));\n"
                "fs.writeSync(1,'original-output\\n');process.exitCode=7;});\n"
            )
            with self.selection(root, pnpm):
                for observed in (False, True):
                    with self.subTest(observed=observed):
                        environment = dict(os.environ)
                        if observed:
                            environment.update(
                                NODE_OPTIONS="--require=" + json.dumps(str(owner.WORKER)),
                                PT_NODE_OBSERVATION_ENTRIES=json.dumps([str(pnpm), str(entry)]),
                            )
                        result = owner.GateProcessLauncher(
                            cwd=str(root), environment=environment, termination_timeout_seconds=1,
                        ).run(GateLaunchSpec((str(pnpm), "exec", "tool", "--version"), 2, ()), None)
                        self.assertEqual(result.returncode, 7, result.stderr)
                        actual = json.loads(result_file.read_text())
                        self.assertEqual(actual["stopped"], 1)
                        self.assertIsNotNone(actual["cache"])
                        self.assertEqual(actual["values"], [
                            [{"pid": actual["pid"], "value": 179}] for _ in range(5)
                        ])
                        for pid in (actual["pid"],):
                            with self.assertRaises(ProcessLookupError):
                                os.kill(pid, 0)
                        if not observed:
                            self.assertEqual(result.stdout, "original-output\n")
                            continue
                        frames = [
                            line for line in result.stdout.splitlines()
                            if line.startswith(owner.MARKER)
                        ]
                        self.assertTrue(frames)
                        # Include the emitter's leading/trailing newline in PIPE_BUF.
                        self.assertLessEqual(max(len(line.encode()) + 2 for line in frames), 512)
                        samples, output = owner.node_execution_observations(result.stdout)
                        self.assertIn("original-output\n", output)
                        self.assertEqual(len([
                            row for row in samples if row["event"] == "worker-created"
                        ]), 5)
                        initialized = [
                            row for row in samples if row["event"] == "worker-initialized"
                        ]
                        terminals = [
                            row for row in samples
                            if row["event"] == "exit" and not row["context"]["isMainThread"]
                        ]
                        self.assertEqual(len(initialized), 5)
                        self.assertEqual(len(terminals), 4)
                        self.assertEqual(len({
                            row["context"]["threadId"] for row in initialized
                        }), 5)
                        for row in terminals:
                            self.assertFalse(row["complete"])
                            self.assertEqual(row["exitCode"], 0)
                            self.assertEqual(row["threadEntry"], str(worker_file))
                            self.assertEqual(len(row["modules"]), 181)
                        main = next(
                            row for row in samples
                            if row["entry"] == str(entry) and row["event"] == "exit"
                            and row["context"]["isMainThread"]
                        )
                        self.assertFalse(main["complete"])
                        self.assertEqual(main["exitCode"], 7)
                        reordered, _ = owner.node_execution_observations(
                            "\n".join(reversed(frames)) + "\n",
                        )
                        self.assertEqual(
                            sorted(json.dumps(row, sort_keys=True) for row in samples),
                            sorted(json.dumps(row, sort_keys=True) for row in reordered),
                        )
                        with self.subTest(frame="missing"), self.assertRaises(ValueError):
                            owner.node_execution_observations(result.stdout.replace(frames[-1] + "\n", "", 1))
                        with self.subTest(frame="duplicate"), self.assertRaises(ValueError):
                            owner.node_execution_observations(result.stdout + frames[0] + "\n")
                        with self.subTest(frame="changed"), self.assertRaises(ValueError):
                            owner.node_execution_observations(
                                result.stdout.replace(frames[-1], frames[-1][:-1] + "!", 1),
                            )

    @unittest.skipUnless(shutil.which("pnpm"), "installed pnpm")
    def test_installed_tauri_reports_native_sample_without_terminal_claim(self):
        root = Path(__file__).resolve().parents[3]
        with patch.dict(os.environ, {
            "NODE_OPTIONS": "", "NODE_PATH": "", "NODE_DISABLE_COMPILE_CACHE": "",
        }):
            value = owner.pnpm_tool_execution_inputs(root / "apps/desktop", "tauri")
        self.assertEqual(value["commandExitCode"], 0)
        self.assertFalse(value["allProcessesReportedExit"])
        samples = [row for row in value["processes"] if row["event"] == "native-library-loaded"]
        self.assertEqual(len(samples), 1)
        self.assertIsNone(samples[0]["exitCode"])
        self.assertTrue(any(row["format"] == "addon" for row in samples[0]["modules"]))
        self.assertTrue(any(path.endswith(".node") for path in value["loadedLibraries"]))
        self.assertFalse(value["completeToolQualification"])
        self.assertEqual(value["compileCacheQualification"], "UNPROVEN")


if __name__ == "__main__":
    unittest.main()
