# ─── Code Review Framework ─────────────────────────────────────

.PHONY: review review-route review-hard-rules review-frontend-runtime-registry review-knowledge review-skill-check quality-evidence review-submit acceptance-evidence-export acceptance-evidence-verify

REVIEW_RANGE ?= HEAD
REVIEW_BASE ?= origin/master

review:
	tooling/scripts/review/run.sh --range "$(REVIEW_RANGE)"

review-route:
	tooling/scripts/review/route-change.sh --range "$(REVIEW_RANGE)"

review-hard-rules:
	tooling/scripts/review/hard-rules.sh --range "$(REVIEW_RANGE)"

review-frontend-runtime-registry:
	bash tooling/scripts/check-frontend-runtime-registry.sh --range "$(REVIEW_RANGE)"

review-knowledge:
	tooling/scripts/review/knowledge-match.sh --range "$(REVIEW_RANGE)" --strict

review-skill-check:
	tooling/scripts/review/skill-check.sh

quality-evidence:
	python3 tooling/scripts/quality-evidence.py --range "$(REVIEW_RANGE)"

review-submit:
	tooling/scripts/review/submit-pipeline.sh --base "$(REVIEW_BASE)"

acceptance-evidence-export:
	python3 tooling/scripts/acceptance-evidence.py export

acceptance-evidence-verify:
	python3 tooling/scripts/acceptance-evidence.py verify --base "$(REVIEW_BASE)" --head HEAD
