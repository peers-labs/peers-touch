"""Cleanup evidence role-kind mapping for the Mobile finalizer.

This module is the generator source for the Mobile D-19 finalizer protected
baseline. It defines only the cleanup evidence role-to-kind mapping consumed
by the isolated finalizer child process. No forbidden imports.
"""

CLEANUP_ROLE_KINDS = {
    "mobile-lease-outcome": "mobile-lease-outcome",
    "mobile-redaction-audit": "mobile-redaction-audit",
    "station-post-cleanup-proof": "station-oauth-proof-snapshot",
}
