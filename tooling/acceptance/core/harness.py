from __future__ import annotations

import json
from typing import Any

from .errors import GateError


HARNESS_ERROR_DETAIL_FIELDS = (
    "status",
    "error_code",
    "locale_key",
    "retryable",
    "terminal",
    "required_gate",
)
HARNESS_ERROR_VALUE_LIMIT = 256


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
  .catch((error) => {
    const candidate = error && typeof error === 'object' ? error : {};
    const sourceDetails = candidate.details && typeof candidate.details === 'object'
      ? candidate.details
      : {};
    const errorDetails = {};
    for (const field of [
      'status',
      'error_code',
      'locale_key',
      'retryable',
      'terminal',
      'required_gate',
    ]) {
      const value = sourceDetails[field];
      if (typeof value === 'number' || typeof value === 'boolean') {
        errorDetails[field] = value;
      } else if (typeof value === 'string') {
        errorDetails[field] = value.slice(0, 256);
      }
    }
    done({
      error: String(error && error.message || error).slice(0, 512),
      errorCode: typeof candidate.code === 'string'
        ? candidate.code.slice(0, 128)
        : null,
      errorDetails,
    });
  });
"""


def _harness_error_context(result: dict[str, Any]) -> str:
    context: dict[str, Any] = {}
    error_code = result.get("errorCode")
    if isinstance(error_code, str) and error_code:
        context["code"] = error_code[:HARNESS_ERROR_VALUE_LIMIT]
    details = result.get("errorDetails")
    if isinstance(details, dict):
        for field in HARNESS_ERROR_DETAIL_FIELDS:
            value = details.get(field)
            if isinstance(value, bool):
                context[field] = value
            elif isinstance(value, (int, float)):
                context[field] = value
            elif isinstance(value, str) and value:
                context[field] = value[:HARNESS_ERROR_VALUE_LIMIT]
    if not context:
        return ""
    return f" [{json.dumps(context, sort_keys=True, separators=(',', ':'))}]"


def _set_script_timeout(driver: Any, timeout: float) -> None:
    target = driver.driver if hasattr(driver, "driver") else driver
    setter = getattr(target, "set_script_timeout", None)
    if callable(setter):
        setter(timeout)
    command_executor = getattr(target, "command_executor", None)
    client_config = getattr(command_executor, "_client_config", None)
    transport_timeout = timeout + 5
    if client_config is not None and hasattr(client_config, "timeout"):
        current_timeout = getattr(client_config, "timeout", 0) or 0
        client_config.timeout = max(current_timeout, transport_timeout)
        return
    transport_setter = getattr(command_executor, "set_timeout", None)
    if callable(transport_setter):
        transport_setter(transport_timeout)


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
        context = _harness_error_context(result)
        raise GateError(
            f"harness {namespace + '.' if namespace else ''}{method} "
            f"failed: {result['error']}{context}"
        )
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
