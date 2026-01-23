package logrus

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/config"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	scfg "github.com/peers-labs/peers-touch/station/frame/core/peers/config"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/logger/logrus/logrus"
)

type PackageSamplingConfigItem struct {
	Package    string `pconf:"package"`
	Initial    int    `pconf:"initial"`
	Thereafter int    `pconf:"thereafter"`
	Window     string `pconf:"window"`
}

var options struct {
	Peers struct {
		Logger struct {
			scfg.Logger
			PkgPathReplacer map[string]string `pconf:"pkg-path-replacer"`
			Logrus          struct {
				SplitLevel      bool                        `pconf:"split-level"`
				ReportCaller    bool                        `pconf:"report-caller"`
				Formatter       string                      `pconf:"formatter"`
				WithoutKey      bool                        `pconf:"without-key"`
				WithoutQuote    bool                        `pconf:"without-quote"`
				TimestampFormat string                      `pconf:"timestamp-format"`
				IncludePackages []string                    `pconf:"include-packages"`
				ExcludePackages []string                    `pconf:"exclude-packages"`
				Sampling        SamplingConfig              `pconf:"sampling"`
				PackageSampling []PackageSamplingConfigItem `pconf:"package-sampling"`
			} `pconf:"slogrus"`
		} `pconf:"logger"`
	} `pconf:"peers"`
}

type logrusLogPlugin struct{}

func (l *logrusLogPlugin) Name() string {
	return "slogrus"
}

func (l *logrusLogPlugin) Options() []logger.Option {
	var opts []logger.Option

	loggerCfg := options.Peers.Logger
	if len(loggerCfg.Level) > 0 {
		if level, err := logger.GetLevel(loggerCfg.Level); err == nil {
			opts = append(opts, logger.WithLevel(level))
		}
	}

	if loggerCfg.CallerSkipCount > 0 {
		opts = append(opts, logger.WithCallerSkipCount(loggerCfg.CallerSkipCount))
	}

	if len(loggerCfg.PkgPathReplacer) > 0 {
		opts = append(opts, PkgPathReplacer(loggerCfg.PkgPathReplacer))
	}

	lc := options.Peers.Logger.Logrus
	opts = append(opts, SplitLevel(lc.SplitLevel))
	opts = append(opts, ReportCaller(lc.ReportCaller))
	opts = append(opts, WithoutKey(lc.WithoutKey))
	opts = append(opts, WithoutQuote(lc.WithoutQuote))

	if len(lc.TimestampFormat) > 0 {
		opts = append(opts, TimestampFormat(lc.TimestampFormat))
	}

	if len(lc.IncludePackages) > 0 {
		opts = append(opts, IncludePackages(lc.IncludePackages...))
	}
	if len(lc.ExcludePackages) > 0 {
		opts = append(opts, ExcludePackages(lc.ExcludePackages...))
	}

	if lc.Sampling.Enable {
		opts = append(opts, WithSampling(lc.Sampling))
	}

	for _, ps := range lc.PackageSampling {
		if ps.Package == "" {
			continue
		}
		window, err := time.ParseDuration(ps.Window)
		if err != nil {
			window = 1 * time.Minute
		}
		opts = append(opts, WithPackageSampling(ps.Package, ps.Initial, ps.Thereafter, window))
	}

	switch lc.Formatter {
	case "text":
		opts = append(opts, TextFormatter(new(logrus.TextFormatter)))
	case "json":
		opts = append(opts, JSONFormatter(new(logrus.JSONFormatter)))
	}

	return opts
}

func (l *logrusLogPlugin) New(opts ...logger.Option) logger.Logger {
	return NewLogger(opts...)
}

func init() {
	config.RegisterOptions(&options)
	plugin.LoggerPlugins["slogrus"] = &logrusLogPlugin{}
}
