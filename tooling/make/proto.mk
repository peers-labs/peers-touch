# ─── Proto / Model ──────────────────────────────────────────────

.PHONY: model-gen model-lint

model-gen:
	cd packages/model && buf generate

model-lint:
	cd packages/model && buf lint
