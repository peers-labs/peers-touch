package logrus

import (
    "context"
    "fmt"
    "io"
    "path/filepath"

    "github.com/peers-labs/peers-touch/station/frame/core/logger"
    ls "github.com/peers-labs/peers-touch/station/frame/core/plugin/logger/logrus/logrus"
    "github.com/peers-labs/peers-touch/station/frame/core/plugin/logger/logrus/lumberjack.v2"
)

func prepareLevelHooks(ctx context.Context, opts logger.PersistenceOptions, l ls.Level) ls.LevelHooks {
	hooks := make(ls.LevelHooks)

	for _, level := range ls.AllLevels {
        if level <= l {
            var base string
            if fn := opts.FileNamePattern; fn != "" {
                if filepath.IsAbs(fn) {
                    base = filepath.Base(fn)
                } else {
                    base = filepath.Base(filepath.Join(opts.Dir, fn))
                }
            } else {
                base = "app.log"
            }
            ext := filepath.Ext(base)
            name := base[:len(base)-len(ext)]
            fileName := filepath.Join(opts.Dir, fmt.Sprintf("%s-%s%s", name, level.String(), ext))
            logger.Infof(ctx, "level %s logs to file: %s", level.String(), fileName)
            
            maxBackups := 14
            if opts.MaxFileSize != 0 {
                maxBackups = opts.MaxBackupSize / opts.MaxFileSize
            }

			hook := &PersistenceLevelHook{
				Writer: &lumberjack.Logger{
					Filename:   fileName,
					MaxSize:    opts.MaxFileSize,
					MaxBackups: maxBackups,
					MaxAge:     opts.MaxBackupKeepDays,
					Compress:   true,
					LocalTime:  true,
					BackupDir:  opts.BackupDir,
				},
				Fired:  true,
				levels: []ls.Level{level},
			}

			hooks[level] = []ls.Hook{hook}
		}
	}

	return hooks
}

type PersistenceLevelHook struct {
	Writer io.Writer
	Fired  bool
	levels []ls.Level
}

func (hook *PersistenceLevelHook) Levels() []ls.Level {
	return hook.levels
}

func (hook *PersistenceLevelHook) Fire(entry *ls.Entry) error {
	line, err := entry.String()
	if err != nil {
		return err
	}
	_, err = hook.Writer.Write([]byte(line))
	return err
}
