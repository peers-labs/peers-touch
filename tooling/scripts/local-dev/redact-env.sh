#!/usr/bin/env bash

print_redacted_env_file() {
  local env_file="$1"
  awk -F= '
    function is_sensitive(name, normalized) {
      normalized = toupper(name)
      return normalized ~ /(^|_)(API_)?KEY($|_)/ ||
        normalized ~ /(^|_)TOKEN($|_)/ ||
        normalized ~ /(^|_)SECRET($|_)/ ||
        normalized ~ /(^|_)PASSWORD($|_)/ ||
        normalized ~ /(^|_)CREDENTIAL(S)?($|_)/ ||
        normalized ~ /(^|_)AUTH($|_)/
    }

    /^[[:space:]]*#/ || /^[[:space:]]*$/ {
      next
    }

    {
      key = $1
      if (is_sensitive(key)) {
        print key "=[REDACTED]"
      } else {
        print
      }
    }
  ' "$env_file"
}
