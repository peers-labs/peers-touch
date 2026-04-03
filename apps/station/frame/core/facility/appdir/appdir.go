package appdir

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	fstorage "github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"gopkg.in/yaml.v2"
)

type Dirs struct {
	Config string `yaml:"config"`
	Data   string `yaml:"data"`
	Cache  string `yaml:"cache"`
	Logs   string `yaml:"logs"`
	Run    string `yaml:"run"`
	Temp   string `yaml:"temp"`
}

type PathsYML struct {
	Version string `yaml:"version"`
	Profile string `yaml:"profile"`
	Base    string `yaml:"base"`
	Station Dirs   `yaml:"station"`
	Desktop Dirs   `yaml:"desktop"`
	Shared  struct {
		Runtime struct {
			EndpointFile string `yaml:"endpoint_file"`
		} `yaml:"runtime"`
	} `yaml:"shared"`
}

type Options struct {
	Vendor    string
	Suite     string
	Profile   string
	PathsFile string
	Overrides Dirs
}

type Report struct {
	Component string
	Paths     map[string]string
	Sources   map[string]string
	Profile   string
	PathsFile string
}

type Option func(*Options)

// WithVendor sets the vendor name.
func WithVendor(v string) Option {
	return func(o *Options) {
		o.Vendor = v
	}
}

// WithSuite sets the suite name.
func WithSuite(s string) Option { return func(o *Options) { o.Suite = s } }

// WithProfile sets the profile identifier.
func WithProfile(p string) Option { return func(o *Options) { o.Profile = p } }

// WithPathsFile sets the paths.yml file path.
func WithPathsFile(p string) Option { return func(o *Options) { o.PathsFile = p } }

// WithOverrides overrides default directories.
func WithOverrides(d Dirs) Option { return func(o *Options) { o.Overrides = d } }

// Resolve returns a resolved directory of given component and kind.
func Resolve(component string, kind string, opts ...Option) (string, error) {
	report, err := ResolveReport(component, opts...)
	if err != nil {
		return "", err
	}
	switch kind {
	case "config", "data", "cache", "logs", "run", "runtime", "temp":
		if path, ok := report.Paths[kind]; ok {
			return path, nil
		}
		return "", errors.New("unknown kind")
	default:
		return "", errors.New("unknown kind")
	}
}

func ResolveReport(component string, opts ...Option) (*Report, error) {
	o := &Options{Vendor: "peers", Suite: "peers-touch", Profile: os.Getenv("PEERS_PROFILE")}
	for _, fn := range opts {
		fn(o)
	}
	if o.PathsFile == "" {
		o.PathsFile = os.Getenv("PEERS_PATHS_FILE")
	}
	env := readEnvOverrides()
	py, _ := readPathsYML(o.PathsFile)
	base := ""
	if py != nil && py.Base != "" {
		base = py.Base
	}
	var dirs Dirs
	sources := map[string]string{}
	if component == "station" && py != nil {
		dirs = py.Station
		applySources(sources, py.Station, "paths_file")
	}
	if component == "desktop" && py != nil {
		dirs = py.Desktop
		applySources(sources, py.Desktop, "paths_file")
	}
	dirs = mergeDirs(dirs, o.Overrides)
	applySources(sources, o.Overrides, "option_override")
	dirs = mergeDirs(dirs, env)
	applySources(sources, env, "env_override")
	def := defaults(o.Vendor, o.Suite, component)
	dirs = fillEmpty(dirs, def)
	fillSourceDefaults(sources)
	resolveBase := func(p string) string {
		if p == "" {
			return p
		}
		if filepath.IsAbs(p) {
			return p
		}
		if base != "" {
			return filepath.Join(base, p)
		}
		return p
	}
	paths := map[string]string{
		"config":  resolveBase(dirs.Config),
		"data":    resolveBase(dirs.Data),
		"cache":   resolveBase(dirs.Cache),
		"logs":    resolveBase(dirs.Logs),
		"runtime": resolveBase(dirs.Run),
		"run":     resolveBase(dirs.Run),
		"temp":    resolveBase(dirs.Temp),
	}
	return &Report{
		Component: component,
		Paths:     paths,
		Sources:   sources,
		Profile:   o.Profile,
		PathsFile: o.PathsFile,
	}, nil
}

// ResolveAll returns all resolved directories for the given component.
func ResolveAll(component string, opts ...Option) (map[string]string, error) {
	report, err := ResolveReport(component, opts...)
	if err != nil {
		return nil, err
	}
	return report.Paths, nil
}

// Ensure creates all directories in the provided map.
func Ensure(dirs map[string]string) error {
	for _, d := range dirs {
		if d == "" {
			continue
		}
		if err := os.MkdirAll(d, 0o700); err != nil {
			return err
		}
	}
	return nil
}

func readEnvOverrides() Dirs {
	return Dirs{
		Config: os.Getenv("PEERS_CONFIG_DIR"),
		Data:   os.Getenv("PEERS_DATA_DIR"),
		Cache:  os.Getenv("PEERS_CACHE_DIR"),
		Logs:   os.Getenv("PEERS_LOGS_DIR"),
		Run:    os.Getenv("PEERS_RUNTIME_DIR"),
		Temp:   os.Getenv("PEERS_TEMP_DIR"),
	}
}

func readPathsYML(path string) (*PathsYML, error) {
	if path == "" {
		return nil, errors.New("no paths file")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var py PathsYML
	if err := yaml.Unmarshal(b, &py); err != nil {
		return nil, err
	}
	return &py, nil
}

func mergeDirs(a, b Dirs) Dirs {
	r := a
	if b.Config != "" {
		r.Config = b.Config
	}
	if b.Data != "" {
		r.Data = b.Data
	}
	if b.Cache != "" {
		r.Cache = b.Cache
	}
	if b.Logs != "" {
		r.Logs = b.Logs
	}
	if b.Run != "" {
		r.Run = b.Run
	}
	if b.Temp != "" {
		r.Temp = b.Temp
	}
	return r
}

func fillEmpty(d, def Dirs) Dirs {
	r := d
	if r.Config == "" {
		r.Config = def.Config
	}
	if r.Data == "" {
		r.Data = def.Data
	}
	if r.Cache == "" {
		r.Cache = def.Cache
	}
	if r.Logs == "" {
		r.Logs = def.Logs
	}
	if r.Run == "" {
		r.Run = def.Run
	}
	if r.Temp == "" {
		r.Temp = def.Temp
	}
	return r
}

func defaults(vendor, suite, component string) Dirs {
	_ = vendor
	_ = suite
	root := fstorage.AppDataDir()
	appRoot := filepath.Join(root, component)
	join := func(kind string) string { return filepath.Join(appRoot, kind) }
	return Dirs{
		Config: join("config"),
		Data:   join("data"),
		Cache:  join("cache"),
		Logs:   join("logs"),
		Run:    join("runtime"),
		Temp:   join("temp"),
	}
}

func applySources(sources map[string]string, dirs Dirs, source string) {
	if dirs.Config != "" {
		sources["config"] = source
	}
	if dirs.Data != "" {
		sources["data"] = source
	}
	if dirs.Cache != "" {
		sources["cache"] = source
	}
	if dirs.Logs != "" {
		sources["logs"] = source
	}
	if dirs.Run != "" {
		sources["runtime"] = source
		sources["run"] = source
	}
	if dirs.Temp != "" {
		sources["temp"] = source
	}
}

func fillSourceDefaults(sources map[string]string) {
	kinds := []string{"config", "data", "cache", "logs", "runtime", "run", "temp"}
	for _, kind := range kinds {
		if sources[kind] == "" {
			sources[kind] = "default"
		}
	}
}

// AppFilePath 与Desktop端语义一致的路径解析方法
// appName: 应用名(station/desktop)
// kind: 存储类型(config/data/cache/logs/runtime/temp)
// segments: 路径分段
func AppFilePath(appName string, kind string, segments []string) (string, error) {
	path, err := Resolve(appName, kind)
	if err != nil {
		return "", err
	}
	for _, seg := range segments {
		path = filepath.Join(path, seg)
	}
	return path, nil
}

// WriteStringAtomic 原子写字符串到文件，与Desktop端语义一致
func WriteStringAtomic(path string, payload string) error {
	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return fmt.Errorf("failed to create parent dir: %w", err)
	}

	filename := filepath.Base(path)
	timestamp := time.Now().UnixNano()
	tmpPath := filepath.Join(parent, fmt.Sprintf(".%s.tmp-%d", filename, timestamp))

	if err := os.WriteFile(tmpPath, []byte(payload), 0o600); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to write temp file: %w", err)
	}

	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to rename temp file: %w", err)
	}

	return nil
}

// InitializeAppStorage 初始化应用存储，与Desktop端语义一致
func InitializeAppStorage(appName string) error {
	dirs, err := ResolveAll(appName)
	if err != nil {
		return err
	}
	return Ensure(dirs)
}
