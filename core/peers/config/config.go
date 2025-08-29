package config

import (
	"fmt"
	"strings"

	cfg "github.com/dirty-bro-tech/peers-touch-go/core/config"
	lg "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/plugin"
	ser "github.com/dirty-bro-tech/peers-touch-go/core/server"
	pp "github.com/dirty-bro-tech/peers-touch-go/core/service"
	"github.com/dirty-bro-tech/peers-touch-go/core/util/log"
)

var (
	peersStdConfigDir  = "conf"
	peersStdConfigFile = "peers.yml"
	peersConfig        = PeersConfig{}
)

func init() {
	cfg.RegisterOptions(&peersConfig)
}

type Config struct {
	HierarchyMerge bool `yaml:"hierarchy-merge" json:"hierarchy-merge" pconf:"hierarchy-merge"`
	Storage        bool `yaml:"storage" json:"storage" pconf:"storage"`
}

func (c *Config) Options() []option.Option {
	var cfgOptions []option.Option

	cfgOptions = append(cfgOptions, cfg.WithHierarchyMerge(c.HierarchyMerge))
	cfgOptions = append(cfgOptions, cfg.WithStorage(c.Storage))

	return cfgOptions
}

type pool struct {
	Size int `json:"size" pconf:"size"`
	TTL  int `json:"ttl" pconf:"ttl"`
}

type clientRequest struct {
	Retries int    `json:"retries" pconf:"retries"`
	Timeout string `json:"timeout" pconf:"timeout"`
}

type Client struct {
	Name     string        `json:"name" pconf:"name"`
	Protocol string        `json:"protocol" pconf:"protocol"`
	Pool     pool          `json:"pool" pconf:"pool"`
	Request  clientRequest `json:"request" pconf:"request"`
}

func (c *Client) Options() []option.Option {
	var cliOpts []option.Option

	return cliOpts
}

type Registry struct {
	Address string `json:"address" pconf:"address"`
	Name    string `json:"name" pconf:"name"`
}

func (r *Registry) Options() []option.Option {
	var regOptions []option.Option

	return regOptions
}

type metadata []string

func (m metadata) Value(k string) string {
	for _, s := range m {
		kv := strings.Split(s, "=")
		if len(kv) == 2 && kv[0] == k {
			return kv[1]
		}
	}

	return ""
}

type Service struct {
	Name   string `json:"name" pconf:"name"`
	Server Server `json:"server" pconf:"server"`
}

func (s *Service) Options() []option.Option {
	var opts serviceOpts

	if len(s.Name) > 0 {
		opts = append(opts, pp.Name(s.Name))
	}

	return opts
}

type serviceOpts []option.Option

func (s serviceOpts) opts() pp.Options {
	opts := pp.Options{}
	for _, o := range s {
		opts.Apply(o)
	}

	return opts
}

type Server struct {
	Address     string   `json:"address" pconf:"address"`
	Advertise   string   `json:"advertise" pconf:"advertise"`
	ID          string   `json:"id" pconf:"id"`
	Metadata    metadata `json:"metadata" pconf:"metadata"`
	Name        string   `json:"name" pconf:"name"`
	Protocol    string   `json:"protocol" pconf:"protocol"`
	Version     string   `json:"version" pconf:"version"`
	EnableDebug bool     `json:"enableDebug" pconf:"enable-debug"`
}

func (s *Server) Options() []option.Option {
	var serverOpts []option.Option

	// Parse the server options
	metadata := make(map[string]string)
	for _, d := range s.Metadata {
		var key, val string
		parts := strings.Split(d, "=")
		key = parts[0]
		if len(parts) > 1 {
			val = strings.Join(parts[1:], "=")
		}
		metadata[key] = val
	}

	if len(metadata) > 0 {
		serverOpts = append(serverOpts, ser.WithMetadata(metadata))
	}

	if len(s.Address) > 0 {
		serverOpts = append(serverOpts, ser.WithAddress(s.Address))
	}

	return serverOpts
}

type Logger struct {
	Name  string `json:"name" pconf:"name"`
	Level string `json:"level" pconf:"level"`
	// todo support map settings
	// Fields          map[string]string `json:"fields" pconf:"fields"`
	CallerSkipCount int            `json:"caller-skip-count" pconf:"caller-skip-count"`
	Persistence     logPersistence `json:"persistence" pconf:"persistence"`
}

type logPersistence struct {
	Enable    bool   `json:"enable" pconf:"enable"`
	Dir       string `json:"dir" pconf:"dir"`
	BackupDir string `json:"backupDir" pconf:"back-dir"`
	// log file max size in megabytes
	MaxFileSize int `json:"maxFileSize" pconf:"max-file-size"`
	// backup dir max size in megabytes
	MaxBackupSize int `json:"maxBackupSize" pconf:"max-backup-size"`
	// backup files keep max days
	MaxBackupKeepDays int `json:"maxBackupKeepDays" pconf:"max-backup-keep-days"`
	// default pattern is ${serviceName}_${level}.log
	// todo available patterns map
	FileNamePattern string `json:"fileNamePattern" pconf:"file-name-pattern"`
	// default pattern is ${serviceName}_${level}_${yyyyMMdd_HH}_${idx}.zip
	// todo available patterns map
	BackupFileNamePattern string `json:"backupFileNamePattern" pconf:"backup-file-name-pattern"`
}

func (l *logPersistence) Options() *lg.PersistenceOptions {
	o := &lg.PersistenceOptions{
		Enable:                l.Enable,
		Dir:                   l.Dir,
		BackupDir:             l.BackupDir,
		MaxFileSize:           l.MaxFileSize,
		MaxBackupSize:         l.MaxBackupSize,
		MaxBackupKeepDays:     l.MaxBackupKeepDays,
		FileNamePattern:       l.FileNamePattern,
		BackupFileNamePattern: l.BackupFileNamePattern,
	}

	return o
}

func (l *Logger) Options() []lg.Option {
	var logOptions []lg.Option

	if len(l.Name) > 0 {
		logOptions = append(logOptions, lg.WithName(l.Name))
	}

	if len(l.Level) > 0 {
		level, err := lg.GetLevel(l.Level)
		if err != nil {
			err = fmt.Errorf("ilegal logger level error: %s", err)
			log.Warn(err)
		} else {
			logOptions = append(logOptions, lg.WithLevel(level))
		}
	}

	if l.Persistence.Enable {
		logOptions = append(logOptions, lg.WithPersistence(l.Persistence.Options()))
	}

	if plugin.LoggerPlugins[l.Name] != nil {
		logOptions = append(logOptions, plugin.LoggerPlugins[l.Name].Options()...)
	} else if len(l.Name) > 0 {
		log.Warnf("seems you declared a logger name:[%s] which stack can't find out.", l.Name)
	}

	return logOptions
}



type PeersConfig struct {
	Peers struct {
		Includes string       `json:"includes" pconf:"includes"`
		Config   Config       `json:"config" pconf:"config"`
		Registry Registry     `json:"registry" pconf:"registry"`
		Client   Client       `json:"client" pconf:"client"`
		Logger   Logger       `json:"logger" pconf:"logger"`
		Service  Service      `json:"service" pconf:"service"`

	} `json:"peers" pconf:"peers"`
}
