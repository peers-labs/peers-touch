package logrus

import (
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/logger/logrus/logrus"
)

type RequestIDHook struct{}

func (h *RequestIDHook) Levels() []logrus.Level {
	return logrus.AllLevels
}

func (h *RequestIDHook) Fire(entry *logrus.Entry) error {
	if entry.Context == nil {
		return nil
	}

	if requestID := logger.GetRequestID(entry.Context); requestID != "" {
		entry.Data["request_id"] = requestID
	}

	if traceID := logger.GetTraceID(entry.Context); traceID != "" {
		entry.Data["trace_id"] = traceID
	}

	return nil
}
