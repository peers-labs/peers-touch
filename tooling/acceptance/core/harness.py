from __future__ import annotations

from typing import Any

from .errors import GateError


ASYNC_HARNESS_SCRIPT = """
const method = arguments[0];
const payload = arguments[1];
const namespace = arguments[2] || null;
const done = arguments[arguments.length - 1];
const root = window.__PT_ACCEPTANCE__;
if (!root) {
  done({ error: 'acceptance harness not mounted' });
  return;
}
const harness = namespace ? (root[namespace] || null) : root;
if (!harness || typeof harness[method] !== 'function') {
  done({ error: `acceptance harness method unavailable: ${namespace ? namespace + '.' : ''}${method}` });
  return;
}
harness[method](payload)
  .then((value) => done({ value }))
  .catch((error) => done({ error: String(error && error.message || error) }));
"""


def _set_script_timeout(driver: Any, timeout: float) -> None:
    target = driver.driver if hasattr(driver, "driver") else driver
    setter = getattr(target, "set_script_timeout", None)
    if callable(setter):
        setter(timeout)
    command_executor = getattr(target, "command_executor", None)
    transport_setter = getattr(command_executor, "set_timeout", None)
    if callable(transport_setter):
        transport_setter(timeout + 5)


def call_async_harness(
    driver: Any,
    method: str,
    payload: dict[str, Any] | None = None,
    namespace: str | None = None,
    script_timeout: float = 45.0,
) -> Any:
    _set_script_timeout(driver, script_timeout)
    raw_driver = driver.driver if hasattr(driver, "driver") else driver
    result = raw_driver.execute_async_script(
        ASYNC_HARNESS_SCRIPT,
        method,
        payload or {},
        namespace,
    )
    if not isinstance(result, dict):
        raise GateError(f"harness {method} returned non-dict: {result!r}")
    if result.get("error"):
        raise GateError(f"harness {namespace + '.' if namespace else ''}{method} failed: {result['error']}")
    return result.get("value")


def harness_ready(driver: Any, namespace: str | None = None, timeout: float = 30.0) -> bool:
    script = """
    const ns = arguments[0];
    return Boolean(
      document.querySelector('#root') &&
      window.__PT_ACCEPTANCE__ &&
      (ns ? window.__PT_ACCEPTANCE__[ns] : true)
    );
    """
    raw_driver = driver.driver if hasattr(driver, "driver") else driver
    _set_script_timeout(driver, 5)
    end_time = _time() + timeout
    while _time() < end_time:
        try:
            ready = raw_driver.execute_script(script, namespace)
            if ready:
                return True
        except Exception:
            pass
        _sleep(0.3)
    return False


def _time() -> float:
    import time
    return time.time()


def _sleep(seconds: float) -> None:
    import time
    time.sleep(seconds)
