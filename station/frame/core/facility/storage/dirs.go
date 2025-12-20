package storage

import (
	"os"
	"path/filepath"
	"runtime"
)

func appID() string {
	if v := os.Getenv("PEERS_APP_ID"); v != "" {
		return v
	}
	return "peers-touch"
}

func AppConfigDir() string {
	id := appID()
	switch runtime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Library", "Preferences", id)
	case "windows":
		base := os.Getenv("APPDATA")
		if base == "" {
			base, _ = os.UserHomeDir()
		}
		return filepath.Join(base, id)
	default:
		base := os.Getenv("XDG_CONFIG_HOME")
		if base == "" {
			home, _ := os.UserHomeDir()
			base = filepath.Join(home, ".config")
		}
		return filepath.Join(base, id)
	}
}

func AppDataDir() string {
	id := appID()
	switch runtime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Library", "Application Support", id)
	case "windows":
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			base, _ = os.UserHomeDir()
		}
		return filepath.Join(base, id)
	default:
		base := os.Getenv("XDG_DATA_HOME")
		if base == "" {
			home, _ := os.UserHomeDir()
			base = filepath.Join(home, ".local", "share")
		}
		return filepath.Join(base, id)
	}
}

func AppCacheDir() string {
	id := appID()
	switch runtime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Library", "Caches", id)
	case "windows":
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			base, _ = os.UserHomeDir()
		}
		return filepath.Join(base, id, "Cache")
	default:
		base := os.Getenv("XDG_CACHE_HOME")
		if base == "" {
			home, _ := os.UserHomeDir()
			base = filepath.Join(home, ".cache")
		}
		return filepath.Join(base, id)
	}
}

func AppLogsDir() string {
	id := appID()
	switch runtime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Library", "Logs", id)
	case "windows":
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			base, _ = os.UserHomeDir()
		}
		return filepath.Join(base, id, "Logs")
	default:
		home, _ := os.UserHomeDir()
		return filepath.Join(home, ".local", "state", id, "logs")
	}
}

func AppRuntimeDir() string {
	id := appID()
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(AppDataDir(), "run")
	case "windows":
		base := os.Getenv("TEMP")
		if base == "" {
			base = os.TempDir()
		}
		return filepath.Join(base, id)
	default:
		base := os.Getenv("XDG_RUNTIME_DIR")
		if base == "" {
			base = os.TempDir()
		}
		return filepath.Join(base, id)
	}
}

func EnsureAppDirs() error {
	dirs := []string{AppConfigDir(), AppDataDir(), AppCacheDir(), AppLogsDir(), AppRuntimeDir()}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return err
		}
	}
	return nil
}
