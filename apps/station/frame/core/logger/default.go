package logger

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/debug/log"
)

// TODO no explicitly
func init() {
	lvl, err := GetLevel(os.Getenv("PEERS_LOG_LEVEL"))
	if err != nil {
		lvl = InfoLevel
	}

	DefaultLogger = NewLogger(context.Background(), WithLevel(lvl))
}

type Record struct {
	// Timestamp of logged event
	Timestamp time.Time `json:"timestamp"`
	// Metadata to enrich log record
	Metadata map[string]string `json:"metadata"`
	// Value contains log entry
	Message interface{} `json:"message"`
}

type defaultLogger struct {
	opts Options
	sync.RWMutex
}

// Init (opts...) should only overwrite provided options.
func (l *defaultLogger) Init(ctx context.Context, opts ...Option) error {
	for _, o := range opts {
		o(&l.opts)
	}

	return nil
}

// String returns the logger name.
func (l *defaultLogger) String() string {
	return "default"
}

// Fields returns a new logger that logs with merged default fields.
func (l *defaultLogger) Fields(fields map[string]interface{}) Logger {
	l.Lock()
	nfields := make(map[string]interface{}, len(l.opts.Fields))

	for k, v := range l.opts.Fields {
		nfields[k] = v
	}
	l.Unlock()

	for k, v := range fields {
		nfields[k] = v
	}

	return &defaultLogger{opts: Options{
		Level:           l.opts.Level,
		Fields:          nfields,
		Out:             l.opts.Out,
		CallerSkipCount: l.opts.CallerSkipCount,
		Context:         l.opts.Context,
	}}
}

func copyFields(src map[string]interface{}) map[string]interface{} {
	dst := make(map[string]interface{}, len(src))
	for k, v := range src {
		dst[k] = v
	}

	return dst
}

// logCallerfilePath returns a package/file:line description of the caller,
// preserving only the leaf directory name and file name.
func logCallerfilePath(loggingFilePath string) string {
	// To make sure we trim the path correctly on Windows too, we
	// counter-intuitively need to use '/' and *not* os.PathSeparator here,
	// because the path given originates from Go stdlib, specifically
	// runtime.Caller() which (as of Mar/17) returns forward slashes even on
	// Windows.
	//
	// See https://github.com/golang/go/issues/3335
	// and https://github.com/golang/go/issues/18151
	//
	// for discussion on the issue on Go side.
	idx := strings.LastIndexByte(loggingFilePath, '/')
	if idx == -1 {
		return loggingFilePath
	}

	idx = strings.LastIndexByte(loggingFilePath[:idx], '/')

	if idx == -1 {
		return loggingFilePath
	}

	return loggingFilePath[idx+1:]
}

// extractPackagePathFromFunction extracts the full package path from function name.
// This is more efficient than using runtime.FuncForPC.
func extractPackagePathFromFunction(fullName string) string {
	if fullName == "" {
		return ""
	}
	// strip method/function suffix after last dot
	if idx := strings.LastIndex(fullName, "."); idx != -1 {
		return fullName[:idx]
	}
	return fullName
}

// tailPackage returns the last segment of a package path.
func tailPackage(pkgPath string) string {
	if pkgPath == "" {
		return ""
	}
	// take last segment after slash
	if idx := strings.LastIndex(pkgPath, "/"); idx != -1 {
		return pkgPath[idx+1:]
	}
	return pkgPath
}

func (l *defaultLogger) getEffectiveLevel(skip int) Level {
	// Fast path: if no package levels are defined, return global level
	if len(l.opts.PackageLevels) == 0 {
		return l.opts.Level
	}

	// Get caller file path
	_, file, _, ok := runtime.Caller(skip + 1) // +1 for getEffectiveLevel itself
	if !ok {
		return l.opts.Level
	}

	// Check if any package level matches
	for path, level := range l.opts.PackageLevels {
		if strings.Contains(file, path) {
			return level
		}
	}

	return l.opts.Level
}

// Log writes an unformatted log entry.
func (l *defaultLogger) Log(ctx context.Context, level Level, v ...interface{}) {
	// TODO decide does we need to write message if log level not used?
	if !l.getEffectiveLevel(l.opts.CallerSkipCount).Enabled(level) {
		return
	}

	l.RLock()
	fields := copyFields(l.opts.Fields)
	l.RUnlock()

	fields["level"] = level.String()

	if _, file, line, ok := runtime.Caller(l.opts.CallerSkipCount); ok {
		fields["file"] = fmt.Sprintf("%s:%d", logCallerfilePath(file), line)

		// Use runtime.Callers + CallersFrames for better performance
		// instead of runtime.FuncForPC which is slower
		pcs := make([]uintptr, 1)
		if n := runtime.Callers(l.opts.CallerSkipCount+1, pcs); n > 0 {
			frames := runtime.CallersFrames(pcs[:n])
			frame, _ := frames.Next()
			pkgPath := extractPackagePathFromFunction(frame.Function)
			fields["pkg_path"] = pkgPath
			fields["pkg"] = tailPackage(pkgPath)
		}
	}

	// todo migrate the tow records in debug and logger packages
	rec := log.Record{
		Timestamp: time.Now(),
		Message:   fmt.Sprint(v...),
		Metadata:  make(map[string]string, len(fields)),
	}

	keys := make([]string, 0, len(fields))
	for k, v := range fields {
		keys = append(keys, k)
		rec.Metadata[k] = fmt.Sprintf("%v", v)
	}

	sort.Strings(keys)

	metadata := ""

	for _, k := range keys {
		metadata += fmt.Sprintf(" %s=%v", k, fields[k])
	}

	log.DefaultLog.Write(rec)

	t := rec.Timestamp.Format("2006-01-02 15:04:05")
	fmt.Printf("%s %s %v\n", t, metadata, rec.Message)
}

// Logf writes a formatted log entry.
func (l *defaultLogger) Logf(ctx context.Context, level Level, format string, v ...interface{}) {
	//	 TODO decide does we need to write message if log level not used?
	if !l.getEffectiveLevel(l.opts.CallerSkipCount).Enabled(level) {
		return
	}

	l.RLock()
	fields := copyFields(l.opts.Fields)
	l.RUnlock()

	fields["level"] = level.String()

	if _, file, line, ok := runtime.Caller(l.opts.CallerSkipCount); ok {
		fields["file"] = fmt.Sprintf("%s:%d", logCallerfilePath(file), line)

		// Use runtime.Callers + CallersFrames for better performance
		// instead of runtime.FuncForPC which is slower
		pcs := make([]uintptr, 1)
		if n := runtime.Callers(l.opts.CallerSkipCount+1, pcs); n > 0 {
			frames := runtime.CallersFrames(pcs[:n])
			frame, _ := frames.Next()
			pkgPath := extractPackagePathFromFunction(frame.Function)
			fields["pkg_path"] = pkgPath
			fields["pkg"] = tailPackage(pkgPath)
		}
	}

	rec := log.Record{
		Timestamp: time.Now(),
		Message:   fmt.Sprintf(format, v...),
		Metadata:  make(map[string]string, len(fields)),
	}

	keys := make([]string, 0, len(fields))
	for k, v := range fields {
		keys = append(keys, k)
		rec.Metadata[k] = fmt.Sprintf("%v", v)
	}

	sort.Strings(keys)

	metadata := ""

	for _, k := range keys {
		metadata += fmt.Sprintf(" %s=%v", k, fields[k])
	}

	log.DefaultLog.Write(rec)

	t := rec.Timestamp.Format("2006-01-02 15:04:05")
	fmt.Printf("%s %s %v\n", t, metadata, rec.Message)
}

// Options returns a safe copy of logger options.
func (l *defaultLogger) Options() Options {
	// not guard against options Context values
	l.RLock()
	defer l.RUnlock()

	opts := l.opts
	opts.Fields = copyFields(l.opts.Fields)

	return opts
}

// NewLogger builds a new logger based on options.
func NewLogger(ctx context.Context, opts ...Option) Logger {
	// Default options
	options := Options{
		Level:           InfoLevel,
		Fields:          make(map[string]interface{}),
		Out:             os.Stderr,
		CallerSkipCount: 2,
		Context:         context.Background(),
	}

	l := &defaultLogger{opts: options}
	if err := l.Init(ctx, opts...); err != nil {
		l.Log(ctx, FatalLevel, err)
	}

	return l
}
