# ─── Code Review Framework ─────────────────────────────────────

.PHONY: review review-route review-hard-rules review-knowledge review-skill-check

REVIEW_RANGE ?= HEAD

review:
	tooling/scripts/review/run.sh --range "$(REVIEW_RANGE)"

review-route:
	tooling/scripts/review/route-change.sh --range "$(REVIEW_RANGE)"

review-hard-rules:
	tooling/scripts/review/hard-rules.sh --range "$(REVIEW_RANGE)"

review-knowledge:
	tooling/scripts/review/knowledge-match.sh --range "$(REVIEW_RANGE)" --strict

review-skill-check:
	tooling/scripts/review/skill-check.sh
