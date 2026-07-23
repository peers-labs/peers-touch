---
kind: pitfall
title: Review skill ignores code structure decay (AGENTS.md §7)
status: active
owns:
  - apps/desktop/src/
referenced-by: []
related:
  - docs/client/desktop/dev-overlay-system.md
detected: 2026-07-23
---

# Review skill ignores code structure decay (AGENTS.md §7)

## Symptom

`main.tsx` contained a duplicate dynamic import, a 40-line inline gateway polyfill, an inline ErrorBoundary class, and mixed concerns. `App.tsx` had 5 flat `useEffect` blocks with no structural grouping. Both accumulated over multiple PRs undetected.

This is not limited to shell files — any file touched by multiple PRs with small diffs gradually decays when review only checks correctness of the diff, not structural health of the file.

## Root cause

The review skill (`pt-github-review`) classifies structural/readability concerns as "style preferences" and explicitly lists "blocking on style preferences" as an anti-pattern. This directly contradicts AGENTS.md §7 which mandates:

1. **Single Responsibility** at every level: file, function, class, module
2. **No circular dependencies**
3. **Composition over inheritance**
4. **Code structure reveals intent**

These are architectural constraints, not style preferences. The review skill fails to distinguish between bikeshedding (naming, formatting) and structural violations (mixed responsibilities, duplicate logic, inline definitions that belong in separate modules).

## Mitigation

### What was done in code

- Dev Overlay refactored to slot architecture to prevent future business-code pollution
- Review skill updated with `duplicate-side-effect-import` hard rule

### What guards against regression

1. Hard rule: `duplicate-side-effect-import` — same dynamic import path 2+ times in one file
2. Review profile `code-structure`: when any file in the diff has 5+ effects, 150+ lines, or inline class definitions, flag for structural review
3. Review skill must distinguish "style preference" (naming, spacing) from "structural violation" (mixed responsibility, duplicate logic, inline definitions)

## How to detect a recurrence

```bash
# Files with too many useEffect (threshold: 3 per component)
rg --count "useEffect\(" apps/desktop/src/ | awk -F: '$2 > 3' | sort -t: -k2 -rn

# Inline class definitions outside dedicated files
rg "^(export )?class " apps/desktop/src/ --glob '!**/*.test.*' | grep -v "/components/\|/views/"

# Duplicate dynamic imports in any file
for f in $(find apps/desktop/src -name "*.tsx" -o -name "*.ts"); do
  dupes=$(grep -oP "import\(['\"]([^'\"]+)" "$f" | sort | uniq -d)
  [ -n "$dupes" ] && echo "$f: $dupes"
done
```

## Crosswalks

- Skill update: `pt-github-review` needs to treat §7 structural violations as `convention` severity (blocks merge), not style preference
- Hard rule candidate: `duplicate-side-effect-import`
- Hard rule candidate: `inline-class-in-non-component-file`
