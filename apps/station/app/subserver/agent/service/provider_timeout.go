package service

import (
	"context"
	"errors"
	"fmt"
	"time"
)

type providerTimeoutError struct {
	Deadline time.Time
	Cause    error
}

func (e *providerTimeoutError) Error() string {
	return fmt.Sprintf(
		"provider request deadline %s exceeded: %v",
		e.Deadline.UTC().Format(time.RFC3339Nano),
		e.Cause,
	)
}

func (e *providerTimeoutError) Unwrap() error {
	return e.Cause
}

func (e *providerTimeoutError) Timeout() bool {
	return true
}

func (e *providerTimeoutError) Temporary() bool {
	return true
}

func (s *ProviderService) callWithProviderDeadline(
	ctx context.Context,
	call func(context.Context) (*ProviderCallResponse, error),
) (*ProviderCallResponse, error) {
	timeout := s.providerTimeout
	if timeout <= 0 {
		timeout = providerHTTPTimeout
	}
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	deadline, _ := callCtx.Deadline()

	response, err := call(callCtx)
	if err == nil || ctx.Err() != nil {
		return response, err
	}
	if errors.Is(callCtx.Err(), context.DeadlineExceeded) || isTimeoutError(err) {
		return nil, &providerTimeoutError{
			Deadline: deadline,
			Cause:    err,
		}
	}
	return response, err
}

func providerTimeoutDeadline(err error) (time.Time, bool) {
	var timeoutErr *providerTimeoutError
	if !errors.As(err, &timeoutErr) || timeoutErr.Deadline.IsZero() {
		return time.Time{}, false
	}
	return timeoutErr.Deadline.UTC(), true
}
