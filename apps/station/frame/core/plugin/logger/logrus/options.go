package logrus

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/logger/logrus/logrus"
)

type Options struct {
	logger.Options
	Formatter logrus.Formatter
	// Flag for whether to log caller info (off by default)
	ReportCaller    bool
	SplitLevel      bool
	WithoutKey      bool
	WithoutQuote    bool
	TimestampFormat string
	// Package filtering
	IncludePackages []string
	ExcludePackages []string
	// Package path replacer (prefix -> replacement)
	PkgPathReplacer map[string]string
	// Sampling configuration
	Sampling             SamplingConfig
	PackageSamplingRules []*PackageSamplingRule
	// Exit Function to call when FatalLevel log
	ExitFunc func(int)
}

type formatterKey struct{}
type splitLevelKey struct{}
type reportCallerKey struct{}
type exitKey struct{}
type withoutKeyKey struct{}
type withoutQuoteKey struct{}
type timestampFormat struct{}
type includePackagesKey struct{}
type excludePackagesKey struct{}
type pkgPathReplacerKey struct{}
type samplingConfigKey struct{}
type packageSamplingRulesKey struct{}

func TextFormatter(formatter *logrus.TextFormatter) logger.Option {
	return logger.SetOption(formatterKey{}, formatter)
}

func JSONFormatter(formatter *logrus.JSONFormatter) logger.Option {
	return logger.SetOption(formatterKey{}, formatter)
}

func ExitFunc(exit func(int)) logger.Option {
	return logger.SetOption(exitKey{}, exit)
}

func SplitLevel(s bool) logger.Option {
	return logger.SetOption(splitLevelKey{}, s)
}

func WithoutKey(w bool) logger.Option {
	return logger.SetOption(withoutKeyKey{}, w)
}

func WithoutQuote(w bool) logger.Option {
	return logger.SetOption(withoutQuoteKey{}, w)
}

func TimestampFormat(format string) logger.Option {
	return logger.SetOption(timestampFormat{}, format)
}

// warning to use this option. because logrus doest not open CallerDepth option
// this will only print this package
func ReportCaller(r bool) logger.Option {
	return logger.SetOption(reportCallerKey{}, r)
}

// IncludePackages sets allowed package patterns (prefix or "*" suffix supported)
func IncludePackages(pkgs ...string) logger.Option {
	return logger.SetOption(includePackagesKey{}, pkgs)
}

// ExcludePackages sets denied package patterns (prefix or "*" suffix supported)
func ExcludePackages(pkgs ...string) logger.Option {
	return logger.SetOption(excludePackagesKey{}, pkgs)
}

// PkgPathReplacer sets package path prefix replacements
// Example: {"github.com/peers-labs/peers-touch/station/frame": "@frame"}
func PkgPathReplacer(replacer map[string]string) logger.Option {
	return logger.SetOption(pkgPathReplacerKey{}, replacer)
}

// WithSampling configures log sampling for high-frequency logs
func WithSampling(config SamplingConfig) logger.Option {
	return logger.SetOption(samplingConfigKey{}, config)
}

// WithPackageSampling configures log sampling for a specific package
func WithPackageSampling(pkg string, initial, thereafter int, window time.Duration) logger.Option {
	return func(o *logger.Options) {
		if o.Context == nil {
			o.Context = context.Background()
		}

		var rules []*PackageSamplingRule
		if existing, ok := o.Context.Value(packageSamplingRulesKey{}).([]*PackageSamplingRule); ok {
			rules = existing
		}

		rules = append(rules, &PackageSamplingRule{
			Package:    pkg,
			Initial:    initial,
			Thereafter: thereafter,
			Window:     window,
		})

		o.Context = context.WithValue(o.Context, packageSamplingRulesKey{}, rules)
	}
}
