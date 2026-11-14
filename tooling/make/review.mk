# ─── Code Review Framework ─────────────────────────────────────

.PHONY: review review-route review-hard-rules review-structure-signals review-frontend-runtime-registry review-knowledge review-skill-check quality-evidence review-submit acceptance-evidence-export acceptance-evidence-verify

REVIEW_RANGE ?= HEAD
REVIEW_BASE ?= origin/master
INTEGRATION_OURS ?= HEAD
INTEGRATION_THEIRS ?= $(REVIEW_BASE)
INTEGRATION_CANDIDATE ?= auto

review:
	tooling/scripts/review/run.sh --range "$(REVIEW_RANGE)"

review-route:
	tooling/scripts/review/route-change.sh --range "$(REVIEW_RANGE)"

review-hard-rules:
	tooling/scripts/review/hard-rules.sh --range "$(REVIEW_RANGE)"

review-structure-signals:
	node tooling/skills/pt-code-structure-review/scripts/structure-signals.mjs --range "$(REVIEW_RANGE)"

review-frontend-runtime-registry:
	node tooling/scripts/check-frontend-runtime-registry.mjs --range "$(REVIEW_RANGE)"

review-knowledge:
	tooling/scripts/review/knowledge-match.sh --range "$(REVIEW_RANGE)" --strict

review-skill-check:
	tooling/scripts/review/skill-check.sh

quality-evidence:
	python3 tooling/scripts/quality-evidence.py --range "$(REVIEW_RANGE)"

review-submit:
	tooling/scripts/review/submit-pipeline.sh --base "$(REVIEW_BASE)" \
		--integration-plan "$(INTEGRATION_PLAN)" \
		--integration-results "$(INTEGRATION_RESULTS)" \
		--integration-review "$(INTEGRATION_REVIEW)"

.PHONY: review-integration-regressions review-integration-verify
review-integration-regressions:
	python3 tooling/scripts/review/integration_review_test.py

review-integration-verify:
	python3 tooling/scripts/review/integration_review.py verify \
		--ours "$(INTEGRATION_OURS)" --theirs "$(INTEGRATION_THEIRS)" \
		--candidate "$(INTEGRATION_CANDIDATE)" --plan "$(INTEGRATION_PLAN)" \
		--results "$(INTEGRATION_RESULTS)" --review "$(INTEGRATION_REVIEW)"

acceptance-evidence-export:
	python3 tooling/scripts/acceptance-evidence.py export

acceptance-evidence-verify:
	python3 tooling/scripts/acceptance-evidence.py verify --base "$(REVIEW_BASE)" --head HEAD
