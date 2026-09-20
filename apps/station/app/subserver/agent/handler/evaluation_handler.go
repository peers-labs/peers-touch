package handler

import (
	"context"
	"errors"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type EvaluationHandlers struct {
	service *service.EvaluationService
}

func NewEvaluationHandlers(
	evaluationService *service.EvaluationService,
) *EvaluationHandlers {
	return &EvaluationHandlers{service: evaluationService}
}

func (h *EvaluationHandlers) HandleCreateBenchmark(
	ctx context.Context,
	req *model.CreateEvaluationBenchmarkRequest,
) (*model.CreateEvaluationBenchmarkResponse, error) {
	benchmark, err := h.service.CreateBenchmark(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "create benchmark", err)
	}
	return &model.CreateEvaluationBenchmarkResponse{Benchmark: benchmark}, nil
}

func (h *EvaluationHandlers) HandleUpdateBenchmark(
	ctx context.Context,
	req *model.UpdateEvaluationBenchmarkRequest,
) (*model.UpdateEvaluationBenchmarkResponse, error) {
	benchmark, err := h.service.UpdateBenchmark(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "update benchmark", err)
	}
	return &model.UpdateEvaluationBenchmarkResponse{Benchmark: benchmark}, nil
}

func (h *EvaluationHandlers) HandleDeleteBenchmark(
	ctx context.Context,
	req *model.DeleteEvaluationBenchmarkRequest,
) (*model.DeleteEvaluationBenchmarkResponse, error) {
	deleted, err := h.service.DeleteBenchmark(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "delete benchmark", err)
	}
	return &model.DeleteEvaluationBenchmarkResponse{Deleted: deleted}, nil
}

func (h *EvaluationHandlers) HandleListBenchmarks(
	ctx context.Context,
	_ *model.ListEvaluationBenchmarksRequest,
) (*model.ListEvaluationBenchmarksResponse, error) {
	benchmarks, err := h.service.ListBenchmarks(ctx, subjectActorPTID(ctx))
	if err != nil {
		return nil, evaluationHandlerError(ctx, "list benchmarks", err)
	}
	return &model.ListEvaluationBenchmarksResponse{Benchmarks: benchmarks}, nil
}

func (h *EvaluationHandlers) HandleCreateDataset(
	ctx context.Context,
	req *model.CreateEvaluationDatasetRequest,
) (*model.CreateEvaluationDatasetResponse, error) {
	dataset, benchmark, err := h.service.CreateDataset(
		ctx,
		subjectActorPTID(ctx),
		req,
	)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "create dataset", err)
	}
	return &model.CreateEvaluationDatasetResponse{
		Dataset:   dataset,
		Benchmark: benchmark,
	}, nil
}

func (h *EvaluationHandlers) HandleUpdateDataset(
	ctx context.Context,
	req *model.UpdateEvaluationDatasetRequest,
) (*model.UpdateEvaluationDatasetResponse, error) {
	dataset, err := h.service.UpdateDataset(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "update dataset", err)
	}
	return &model.UpdateEvaluationDatasetResponse{Dataset: dataset}, nil
}

func (h *EvaluationHandlers) HandleDeleteDataset(
	ctx context.Context,
	req *model.DeleteEvaluationDatasetRequest,
) (*model.DeleteEvaluationDatasetResponse, error) {
	deleted, err := h.service.DeleteDataset(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "delete dataset", err)
	}
	return &model.DeleteEvaluationDatasetResponse{Deleted: deleted}, nil
}

func (h *EvaluationHandlers) HandleListDatasets(
	ctx context.Context,
	req *model.ListEvaluationDatasetsRequest,
) (*model.ListEvaluationDatasetsResponse, error) {
	datasets, err := h.service.ListDatasets(
		ctx,
		subjectActorPTID(ctx),
		req.GetBenchmarkId(),
	)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "list datasets", err)
	}
	return &model.ListEvaluationDatasetsResponse{Datasets: datasets}, nil
}

func (h *EvaluationHandlers) HandleCreateTestCase(
	ctx context.Context,
	req *model.CreateEvaluationTestCaseRequest,
) (*model.CreateEvaluationTestCaseResponse, error) {
	testCase, dataset, err := h.service.CreateTestCase(
		ctx,
		subjectActorPTID(ctx),
		req,
	)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "create test case", err)
	}
	return &model.CreateEvaluationTestCaseResponse{
		TestCase: testCase,
		Dataset:  dataset,
	}, nil
}

func (h *EvaluationHandlers) HandleUpdateTestCase(
	ctx context.Context,
	req *model.UpdateEvaluationTestCaseRequest,
) (*model.UpdateEvaluationTestCaseResponse, error) {
	testCase, dataset, err := h.service.UpdateTestCase(
		ctx,
		subjectActorPTID(ctx),
		req,
	)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "update test case", err)
	}
	return &model.UpdateEvaluationTestCaseResponse{
		TestCase: testCase,
		Dataset:  dataset,
	}, nil
}

func (h *EvaluationHandlers) HandleDeleteTestCase(
	ctx context.Context,
	req *model.DeleteEvaluationTestCaseRequest,
) (*model.DeleteEvaluationTestCaseResponse, error) {
	deleted, dataset, err := h.service.DeleteTestCase(
		ctx,
		subjectActorPTID(ctx),
		req,
	)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "delete test case", err)
	}
	return &model.DeleteEvaluationTestCaseResponse{
		Deleted: deleted,
		Dataset: dataset,
	}, nil
}

func (h *EvaluationHandlers) HandleListTestCases(
	ctx context.Context,
	req *model.ListEvaluationTestCasesRequest,
) (*model.ListEvaluationTestCasesResponse, error) {
	testCases, err := h.service.ListTestCases(
		ctx,
		subjectActorPTID(ctx),
		req.GetDatasetId(),
	)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "list test cases", err)
	}
	return &model.ListEvaluationTestCasesResponse{TestCases: testCases}, nil
}

func (h *EvaluationHandlers) HandleCreateRun(
	ctx context.Context,
	req *model.CreateEvaluationRunRequest,
) (*model.CreateEvaluationRunResponse, error) {
	run, err := h.service.CreateRun(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "create run", err)
	}
	return &model.CreateEvaluationRunResponse{Run: run}, nil
}

func (h *EvaluationHandlers) HandleStartRun(
	ctx context.Context,
	req *model.StartEvaluationRunRequest,
) (*model.StartEvaluationRunResponse, error) {
	run, err := h.service.StartRun(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "start run", err)
	}
	return &model.StartEvaluationRunResponse{Run: run}, nil
}

func (h *EvaluationHandlers) HandleCancelRun(
	ctx context.Context,
	req *model.CancelEvaluationRunRequest,
) (*model.CancelEvaluationRunResponse, error) {
	run, err := h.service.CancelRun(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "cancel run", err)
	}
	return &model.CancelEvaluationRunResponse{Run: run}, nil
}

func (h *EvaluationHandlers) HandleRetryCases(
	ctx context.Context,
	req *model.RetryEvaluationCasesRequest,
) (*model.RetryEvaluationCasesResponse, error) {
	run, err := h.service.RetryCases(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "retry cases", err)
	}
	return &model.RetryEvaluationCasesResponse{ChildRun: run}, nil
}

func (h *EvaluationHandlers) HandleGetRun(
	ctx context.Context,
	req *model.GetEvaluationRunRequest,
) (*model.GetEvaluationRunResponse, error) {
	response, err := h.service.GetRun(ctx, subjectActorPTID(ctx), req.GetRunId())
	if err != nil {
		return nil, evaluationHandlerError(ctx, "get run", err)
	}
	return response, nil
}

func (h *EvaluationHandlers) HandleListRuns(
	ctx context.Context,
	req *model.ListEvaluationRunsRequest,
) (*model.ListEvaluationRunsResponse, error) {
	response, err := h.service.ListRuns(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "list runs", err)
	}
	return response, nil
}

func (h *EvaluationHandlers) HandleListRunEvents(
	ctx context.Context,
	req *model.ListEvaluationRunEventsRequest,
) (*model.ListEvaluationRunEventsResponse, error) {
	response, err := h.service.ListRunEvents(
		ctx,
		subjectActorPTID(ctx),
		req,
	)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "list run events", err)
	}
	return response, nil
}

func (h *EvaluationHandlers) HandleDeleteRun(
	ctx context.Context,
	req *model.DeleteEvaluationRunRequest,
) (*model.DeleteEvaluationRunResponse, error) {
	deleted, err := h.service.DeleteRun(ctx, subjectActorPTID(ctx), req)
	if err != nil {
		return nil, evaluationHandlerError(ctx, "delete run", err)
	}
	return &model.DeleteEvaluationRunResponse{Deleted: deleted}, nil
}

func evaluationHandlerError(
	ctx context.Context,
	operation string,
	err error,
) error {
	logger.Errorf(ctx, "evaluation %s failed: %v", operation, err)
	var failure *service.EvaluationFailure
	if !errors.As(err, &failure) {
		return toHandlerError(err)
	}
	handlerError := server.NewHandlerErrorWithCause(
		failure.HTTPStatus,
		failure.Message,
		err,
	)
	if failure.Detail == nil {
		return handlerError
	}
	handlerError.Headers = map[string]string{
		"X-Peers-Error-Code":       failure.Detail.GetCode().String(),
		"X-Peers-Error-Locale-Key": failure.Detail.GetLocaleKey(),
		"X-Peers-Error-Retryable":  fmt.Sprintf("%t", failure.Detail.GetRetryable()),
		"X-Peers-Error-Terminal":   fmt.Sprintf("%t", failure.Detail.GetTerminal()),
	}
	if details := boundedErrorDetailsHeader(failure.Detail.GetDetails()); details != "" {
		handlerError.Headers[errorDetailsHeader] = details
	}
	return handlerError
}
