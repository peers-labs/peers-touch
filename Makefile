.PHONY: fmt import vet check format style lint test test-docker test-api test-unit clean-test

fmt:
	go fmt ./...
	gofmt -s -w .

import:
	@command -v goimports >/dev/null 2>&1 || go install golang.org/x/tools/cmd/goimports@latest
	goimports -w .

vet:
	go vet ./...

check:
	@out=$$(gofmt -l .); if [ -n "$$out" ]; then echo "$$out" && exit 1; fi

style:
	bash tools/check-go-style.sh

format: fmt import

lint:
	@command -v golangci-lint >/dev/null 2>&1 || go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	golangci-lint run

# 测试相关命令
test: test-docker

test-docker:
	@echo "🐳 运行 Docker 隔离测试..."
	bash qa/station/run_docker_tests.sh

test-docker-keep:
	@echo "🐳 运行 Docker 测试（保持容器）..."
	bash qa/station/run_docker_tests.sh --keep

test-docker-logs:
	@echo "🐳 运行 Docker 测试（显示日志）..."
	bash qa/station/run_docker_tests.sh --logs

test-api:
	@echo "🧪 运行 API 测试（需要先启动服务）..."
	bash qa/station/api_tests/integration_test.sh

test-unit:
	@echo "🧪 运行单元测试..."
	cd station/app && go test ./... -v

test-coverage:
	@echo "📊 生成测试覆盖率报告..."
	cd station/app && go test ./... -coverprofile=coverage.out
	cd station/app && go tool cover -html=coverage.out -o coverage.html
	@echo "✅ 覆盖率报告已生成: station/app/coverage.html"

clean-test:
	@echo "🧹 清理测试环境..."
	cd qa/station && docker-compose -f docker-compose.test.yml down -v
	rm -f station/app/coverage.out station/app/coverage.html
	@echo "✅ 清理完成"
