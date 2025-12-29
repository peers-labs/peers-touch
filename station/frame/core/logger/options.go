package logger

import (
	"context"
	"io"
)

type Option func(*Options)

type Options struct {
	// logger's name, same to logger.String(). console, logrus, zap etc.
	Name string

	// It's common to set this to a file, or leave it default which is `os.Stderr`
	Out io.Writer
	// Alternative options
	Context context.Context
	// fields to always be logged
	Fields map[string]interface{}
	// Caller skip frame count for file:line info
	CallerSkipCount int
	// The logging level the logger should log at. default is `InfoLevel`
	Level Level

	// PackageLevels maps package/path substrings to specific log levels
	PackageLevels map[string]Level

	Persistence *PersistenceOptions
}

type PersistenceOptions struct {
	Enable    bool   `pconf:"enable"`
	Dir       string `pconf:"dir"`
	BackupDir string `pconf:"back-dir"`
	// log file max size in megabytes
	MaxFileSize int `pconf:"max-file-size"`
	// backup dir max size in megabytes
	MaxBackupSize int `pconf:"max-backup-size"`
	// backup files keep max days
	MaxBackupKeepDays int `pconf:"max-backup-keep-days"`
	// default pattern is ${serviceName}_${level}.log
	// todo available patterns map
	FileNamePattern string `pconf:"file-name-pattern"`
	// default pattern is ${serviceName}_${level}_${yyyyMMdd_HH}_${idx}.zip
	// todo available patterns map
	BackupFileNamePattern string `pconf:"backup-file-name-pattern"`
}

// WithFields set default fields for the logger.
func WithFields(fields map[string]interface{}) Option {
	return func(args *Options) {
		args.Fields = fields
	}
}

// WithLevel set default level for the logger.
func WithLevel(level Level) Option {
	return func(args *Options) {
		args.Level = level
	}
}

// WithPackageLevel sets the log level for a specific package/path substring.
// When logging, if the caller's file path contains the given substring,
// the specified level will be used.
func WithPackageLevel(path string, level Level) Option {
	return func(args *Options) {
		if args.PackageLevels == nil {
			args.PackageLevels = make(map[string]Level)
		}
		args.PackageLevels[path] = level
	}
}

// WithOutput set default output writer for the logger.
func WithOutput(out io.Writer) Option {
	return func(args *Options) {
		args.Out = out
	}
}

func WithName(n string) Option {
	return func(options *Options) {
		options.Name = n
	}
}

// WithCallerSkipCount set frame count to skip.
func WithCallerSkipCount(c int) Option {
	return func(args *Options) {
		args.CallerSkipCount = c
	}
}

func WithPersistence(o *PersistenceOptions) Option {
	return func(options *Options) {
		options.Persistence = o
	}
}

func SetOption(k, v interface{}) Option {
	return func(o *Options) {
		if o.Context == nil {
			o.Context = context.Background()
		}
		o.Context = context.WithValue(o.Context, k, v)
	}
}
