# ─── Monorepo (pnpm) ────────────────────────────────────────────

.PHONY: mono-check mono-lint mono-test mono-build

mono-check:
	pnpm -r --if-present run check

mono-lint:
	pnpm -r --if-present run lint

mono-test:
	pnpm -r --if-present run test

mono-build:
	pnpm -r --if-present run build
