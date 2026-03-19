package logrus

import (
	"runtime"
	"testing"

	ls "github.com/peers-labs/peers-touch/station/frame/core/plugin/logger/logrus/logrus"
)

func TestCallerPackagePath(t *testing.T) {
	entry := &ls.Entry{
		Caller: &runtime.Frame{
			Function: "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/registry.HealthCheck",
		},
	}

	pkgPath := callerPackagePath(entry)
	t.Logf("Package path: %q", pkgPath)

	pattern := "plugin/native/registry"
	matched := matchPackage(pkgPath, pattern)
	t.Logf("Pattern %q matches %q: %v", pattern, pkgPath, matched)

	if !matched {
		t.Errorf("Expected pattern %q to match %q", pattern, pkgPath)
	}
}
