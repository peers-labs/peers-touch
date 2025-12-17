package appdir

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"

	"github.com/peers-labs/peers-touch/station/frame/core/storage"
	"gopkg.in/yaml.v2"
)

type Dirs struct {
	Config string `yaml:"config"`
	Data   string `yaml:"data"`
	Cache  string `yaml:"cache"`
	Logs   string `yaml:"logs"`
	Run    string `yaml:"run"`
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

type Option func(*Options)

func WithVendor(v string) Option    { return func(o *Options) { o.Vendor = v } }
func WithSuite(s string) Option     { return func(o *Options) { o.Suite = s } }
func WithProfile(p string) Option   { return func(o *Options) { o.Profile = p } }
func WithPathsFile(p string) Option { return func(o *Options) { o.PathsFile = p } }
func WithOverrides(d Dirs) Option   { return func(o *Options) { o.Overrides = d } }

func Resolve(component string, kind string, opts ...Option) (string, error) {
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
	if component == "station" && py != nil {
		dirs = py.Station
	}
	if component == "desktop" && py != nil {
		dirs = py.Desktop
	}
	dirs = mergeDirs(dirs, o.Overrides)
	dirs = mergeDirs(dirs, env)
	def := defaults(o.Vendor, o.Suite, component)
	dirs = fillEmpty(dirs, def)
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
	switch kind {
	case "config":
		return resolveBase(dirs.Config), nil
	case "data":
		return resolveBase(dirs.Data), nil
	case "cache":
		return resolveBase(dirs.Cache), nil
	case "logs":
		return resolveBase(dirs.Logs), nil
	case "run":
		return resolveBase(dirs.Run), nil
	default:
		return "", errors.New("unknown kind")
	}
}

func ResolveAll(component string, opts ...Option) (map[string]string, error) {
	m := map[string]string{}
	kinds := []string{"config", "data", "cache", "logs", "run"}
	for _, k := range kinds {
		p, err := Resolve(component, k, opts...)
		if err != nil {
			return nil, err
		}
		m[k] = p
	}
	return m, nil
}

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
	return r
}

func defaults(vendor, suite, component string) Dirs {
	segs := []string{vendor, suite, component}
	join := func(root string) string { return filepath.Join(append([]string{root}, segs...)...) }
	cfg := storage.AppConfigDir()
	dat := storage.AppDataDir()
	cac := storage.AppCacheDir()
	log := storage.AppLogsDir()
	run := storage.AppRuntimeDir()
	if runtime.GOOS == "windows" {
		log = filepath.Join(log)
	}
	return Dirs{
		Config: join(cfg),
		Data:   join(dat),
		Cache:  join(cac),
		Logs:   join(log),
		Run:    join(run),
	}
}
