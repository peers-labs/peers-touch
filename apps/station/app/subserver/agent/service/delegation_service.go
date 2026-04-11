// Changelog:
// 2026-04-11 — Initial implementation of DelegationService: concurrent child-task
//   orchestration with semaphore-based concurrency control, per-task timeout,
//   panic recovery, and structured result collection. Executor callback is
//   injected by TurnService to keep delegation logic decoupled from turn internals.

package service

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// childTaskTimeout is the maximum wall-clock time each delegated child task
// is allowed to run before the context is cancelled.
const childTaskTimeout = 5 * time.Minute

// DelegateExecutor is a callback type that TurnService (or tests) provides to
// supply the actual execution logic for a single delegated child task.
// The implementation is expected to run a mini turn-loop scoped to the given
// toolset and return a result or error.
type DelegateExecutor func(ctx context.Context, task *domain.DelegationTask, toolset []string) (*domain.DelegationResult, error)

// DelegationService orchestrates the concurrent execution of delegated child
// tasks. It enforces depth / concurrency limits, computes per-child toolsets,
// and collects results — including failures — so the caller always receives a
// complete picture.
type DelegationService struct{}

func NewDelegationService() *DelegationService {
	return &DelegationService{}
}

// ---------------------------------------------------------------------------
// Execute — main orchestration entry point
// ---------------------------------------------------------------------------

// Execute validates the task list, computes child toolsets, and runs all tasks
// concurrently (bounded by MaxConcurrentChildren). Every task produces a
// DelegationResult regardless of success or failure; the error return is only
// used for pre-flight validation failures.
func (s *DelegationService) Execute(
	ctx context.Context,
	parentTurnID string,
	tasks []domain.DelegationTask,
	parentTools []string,
	executor DelegateExecutor,
) ([]domain.DelegationResult, error) {

	// Pre-flight validation.
	if err := s.validateTasks(tasks); err != nil {
		return nil, err
	}

	// Assign IDs and parent turn references where missing.
	for i := range tasks {
		if tasks[i].TaskID == "" {
			tasks[i].TaskID = generateID(fmt.Sprintf("delegate_%d", i))
		}
		if tasks[i].ParentTurnID == "" {
			tasks[i].ParentTurnID = parentTurnID
		}
	}

	// Pre-compute child toolsets and reject tasks with empty sets early.
	childToolsets := make([][]string, len(tasks))
	for i, task := range tasks {
		ts := domain.ComputeChildToolset(parentTools, task.RequestedTools)
		if len(ts) == 0 {
			logger.Warnf(ctx, "delegation: empty toolset for task_id=%s description=%q",
				task.TaskID, task.Description)
			return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
				fmt.Sprintf("delegated task '%s' has no usable tools after filtering", task.TaskID), nil)
		}
		childToolsets[i] = ts
	}

	logger.Infof(ctx, "delegation: starting %d child tasks, parent_turn_id=%s",
		len(tasks), parentTurnID)

	// Concurrent execution with a buffered-channel semaphore.
	var (
		mu      sync.Mutex
		results = make([]domain.DelegationResult, 0, len(tasks))
		wg      sync.WaitGroup
		sem     = make(chan struct{}, domain.MaxConcurrentChildren)
	)

	for i, task := range tasks {
		wg.Add(1)

		// Capture loop variables for the goroutine closure.
		taskCopy := task
		toolset := childToolsets[i]

		go func() {
			defer wg.Done()

			// Acquire semaphore slot.
			sem <- struct{}{}
			defer func() { <-sem }()

			result := s.executeChild(ctx, &taskCopy, toolset, executor)

			mu.Lock()
			results = append(results, result)
			mu.Unlock()
		}()
	}

	wg.Wait()

	// Log summary.
	var completed, failed, timedOut int
	for _, r := range results {
		switch r.Status {
		case domain.DelegationStatusCompleted:
			completed++
		case domain.DelegationStatusFailed:
			failed++
		case domain.DelegationStatusTimeout:
			timedOut++
		}
	}

	logger.Infof(ctx, "delegation: finished parent_turn_id=%s total=%d completed=%d failed=%d timeout=%d",
		parentTurnID, len(results), completed, failed, timedOut)

	return results, nil
}

// ---------------------------------------------------------------------------
// executeChild — runs a single child task with timeout and panic recovery
// ---------------------------------------------------------------------------

func (s *DelegationService) executeChild(
	ctx context.Context,
	task *domain.DelegationTask,
	toolset []string,
	executor DelegateExecutor,
) (result domain.DelegationResult) {

	startedAt := time.Now()

	// Pre-populate fields that are known regardless of outcome.
	result = domain.DelegationResult{
		TaskID:          task.TaskID,
		ParentTurnID:    task.ParentTurnID,
		TaskDescription: task.Description,
		ChildToolset:    toolset,
		Status:          domain.DelegationStatusFailed,
		StartedAt:       startedAt,
	}

	childCtx, cancel := context.WithTimeout(ctx, childTaskTimeout)
	defer cancel()

	// Panic recovery — any unhandled panic in the executor must not crash the
	// orchestrator; instead, it is captured as a failed result.
	defer func() {
		if r := recover(); r != nil {
			now := time.Now()
			result.EndedAt = &now
			result.Status = domain.DelegationStatusFailed
			result.ResultSummary = fmt.Sprintf("panic recovered: %v", r)

			logger.Errorf(ctx, "delegation: panic in child task_id=%s err=%v", task.TaskID, r)
		}
	}()

	logger.Infof(ctx, "delegation: executing child task_id=%s depth=%d tools=%v",
		task.TaskID, task.Depth, toolset)

	execResult, err := executor(childCtx, task, toolset)

	now := time.Now()
	result.EndedAt = &now

	if err != nil {
		// Distinguish context deadline exceeded (timeout) from other errors.
		if childCtx.Err() == context.DeadlineExceeded {
			result.Status = domain.DelegationStatusTimeout
			result.ResultSummary = fmt.Sprintf("task timed out after %s", childTaskTimeout)

			logger.Warnf(ctx, "delegation: child task timed out task_id=%s", task.TaskID)
		} else {
			result.Status = domain.DelegationStatusFailed
			result.ResultSummary = fmt.Sprintf("executor error: %v", err)

			logger.Errorf(ctx, "delegation: child task failed task_id=%s err=%v", task.TaskID, err)
		}

		return result
	}

	// Executor returned a valid result — adopt its fields.
	if execResult != nil {
		result.Status = execResult.Status
		result.ResultSummary = execResult.ResultSummary
		result.ToolIterations = execResult.ToolIterations

		if execResult.EndedAt != nil {
			result.EndedAt = execResult.EndedAt
		}
	}

	logger.Infof(ctx, "delegation: child task completed task_id=%s status=%s iterations=%d",
		task.TaskID, result.Status, result.ToolIterations)

	return result
}

// ---------------------------------------------------------------------------
// validateTasks — private pre-flight validation
// ---------------------------------------------------------------------------

func (s *DelegationService) validateTasks(tasks []domain.DelegationTask) error {
	if len(tasks) == 0 {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"delegation requires at least one task", nil)
	}

	if len(tasks) > domain.MaxConcurrentChildren {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			fmt.Sprintf("too many delegation tasks: got %d, max %d",
				len(tasks), domain.MaxConcurrentChildren), nil)
	}

	for i, task := range tasks {
		if task.Depth >= domain.MaxDelegationDepth {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
				fmt.Sprintf("task[%d] exceeds max delegation depth: depth=%d, max=%d",
					i, task.Depth, domain.MaxDelegationDepth), nil)
		}

		if task.Description == "" {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
				fmt.Sprintf("task[%d] has empty description", i), nil)
		}

		if len(task.RequestedTools) == 0 {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
				fmt.Sprintf("task[%d] has no requested tools", i), nil)
		}
	}

	return nil
}
