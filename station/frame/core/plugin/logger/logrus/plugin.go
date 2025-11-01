package logrus

import (
	"github.com/peers-touch/peers-touch/station/frame/core/config"
	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	scfg "github.com/peers-touch/peers-touch/station/frame/core/peers/config"
	"github.com/peers-touch/peers-touch/station/frame/core/plugin"
	"github.com/peers-touch/peers-touch/station/frame/core/plugin/logger/logrus/logrus"
)

var options struct {
	Peers struct {
		Logger struct {
			scfg.Logger
			Logrus struct {
				SplitLevel      bool   `pconf:"split-level"`
				ReportCaller    bool   `pconf:"report-caller"`
				Formatter       string `pconf:"formatter"`
				WithoutKey      bool   `pconf:"without-key"`
				WithoutQuote    bool   `pconf:"without-quote"`
				TimestampFormat string `pconf:"timestamp-format"`
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
	lc := options.Peers.Logger.Logrus
	opts = append(opts, SplitLevel(lc.SplitLevel))
	opts = append(opts, ReportCaller(lc.ReportCaller))
	opts = append(opts, WithoutKey(lc.WithoutKey))
	opts = append(opts, WithoutQuote(lc.WithoutQuote))

	if len(lc.TimestampFormat) > 0 {
		opts = append(opts, TimestampFormat(lc.TimestampFormat))
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
