# ─── QA / Integration Testing ───────────────────────────────────

.PHONY: test test-docker test-docker-keep test-docker-logs test-api clean-test

test: test-docker

test-docker:
	@echo "Running Docker isolated tests..."
	/bin/bash qa/station/run_docker_tests.sh

test-docker-keep:
	@echo "Running Docker tests (keep containers)..."
	/bin/bash qa/station/run_docker_tests.sh --keep

test-docker-logs:
	@echo "Running Docker tests (show logs)..."
	/bin/bash qa/station/run_docker_tests.sh --logs

test-api:
	@echo "Running API tests (service must be running)..."
	/bin/bash qa/station/api_tests/integration_test.sh

clean-test:
	@echo "Cleaning test environment..."
	cd qa/station && docker-compose -f docker-compose.test.yml down -v
	rm -f apps/station/app/coverage.out apps/station/app/coverage.html
	@echo "Done."
