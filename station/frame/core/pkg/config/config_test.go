package config

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/pkg/config/source/env"
	"github.com/peers-labs/peers-touch/station/frame/core/pkg/config/source/file"
)

func createFile(t *testing.T, content string, format string) *os.File {
	data := []byte(content)
	path := filepath.Join(os.TempDir(), fmt.Sprintf("file.%s", format))
	fh, err := os.Create(path)
	if err != nil {
		t.Error(err)
	}
	_, err = fh.Write(data)
	if err != nil {
		t.Error(err)
	}

	if err := fh.Close(); err != nil {
		t.Error(err)
	}

	return fh
}

func createFileForIssue18(t *testing.T, content string) *os.File {
	data := []byte(content)
	path := filepath.Join(os.TempDir(), fmt.Sprintf("file.%d", time.Now().UnixNano()))
	fh, err := os.Create(path)
	if err != nil {
		t.Error(err)
	}
	_, err = fh.Write(data)
	if err != nil {
		t.Error(err)
	}

	return fh
}

func createFileForTest(t *testing.T) *os.File {
	data := []byte(`
stack:
  node:
    name: demo.node
    rpc-port: 8081
    http-port: 8082`)
	path := filepath.Join(os.TempDir(), "file.yml")
	fh, err := os.Create(path)
	if err != nil {
		t.Error(err)
	}
	_, err = fh.Write(data)
	if err != nil {
		t.Error(err)
	}

	return fh
}

func TestConfigLoadWithGoodFile(t *testing.T) {
	fh := createFileForTest(t)
	path := fh.Name()
	defer func() {
		fh.Close()
		os.Remove(path)
	}()

	// Create new config
	conf, err := NewConfig()
	if err != nil {
		t.Fatalf("Expected no error but got %v", err)
	}
	defer conf.Close()

	// Load file source
	if err := conf.Load(file.NewSource(
		file.WithPath(path),
	)); err != nil {
		t.Fatalf("Expected no error but got %v", err)
	}
}

func TestConfigLoadWithInvalidFile(t *testing.T) {
	fh := createFileForTest(t)
	path := fh.Name()
	defer func() {
		fh.Close()
		os.Remove(path)
	}()

	// Create new config
	conf, err := NewConfig()
	if err != nil {
		t.Fatalf("Expected no error but got %v", err)
	}
	defer conf.Close()

	// Load file source
	err = conf.Load(file.NewSource(
		file.WithPath(path),
		file.WithPath("/i/do/not/exists.json"),
	))

	if err == nil {
		t.Fatal("Expected error but none !")
	}
	if !strings.Contains(fmt.Sprintf("%v", err), "/i/do/not/exists.json") {
		t.Fatalf("Expected error to contain the unexisting file but got %v", err)
	}
}

func TestConfigMerge(t *testing.T) {
	fh := createFileForIssue18(t, `{
  "amqp": {
    "host": "rabbit.platform",
    "port": 80
  },
  "handler": {
    "exchange": "springCloudBus"
  }
}`)
	path := fh.Name()
	defer func() {
		fh.Close()
		os.Remove(path)
	}()
	os.Setenv("AMQP_HOST", "rabbit.testing.com")

	conf, err := NewConfig()
	if err != nil {
		t.Fatalf("Expected no error but got %v", err)
	}
	defer conf.Close()
	if err := conf.Load(
		file.NewSource(
			file.WithPath(path),
		),
		env.NewSource(),
	); err != nil {
		t.Fatalf("Expected no error but got %v", err)
	}

	actualHost := conf.Get("amqp", "host").String("backup")
	if actualHost != "rabbit.testing.com" {
		t.Fatalf("Expected %v but got %v",
			"rabbit.testing.com",
			actualHost)
	}
}

func TestConfigLoadFromBackupFile(t *testing.T) {
	fh := createFileForIssue18(t, `{
  "amqp": {
    "host": "rabbit.platform",
    "port": 80
  },
  "handler": {
    "exchange": "springCloudBus"
  }
}`)
	path := fh.Name()
	defer func() {
		fh.Close()
		os.Remove(path)
	}()

	conf, err := NewConfig(Storage(true), StorageDir(os.TempDir()))
	if err != nil {
		t.Fatalf("Expected no error but got %v", err)
	}
	defer conf.Close()

	if err := conf.Load(
		file.NewSource(
			file.WithPath(path),
		),
	); err != nil {
		t.Fatalf("Expected no error but got %v", err)
	}

	conf2, err := NewConfig(Storage(true), StorageDir(os.TempDir()))
	if err != nil {
		t.Fatalf("Expected no error but got %v", err)
	}
	defer conf2.Close()
	if err := conf2.Load(
		file.NewSource(
			file.WithPath("/i/do/not/exists.json"),
		),
	); err != nil {
		t.Fatalf("Expected no error but got %v", err)
	}

	actualHost := conf.Get("amqp", "host").String("backup")
	if actualHost != "rabbit.platform" {
		t.Fatalf("Expected %v but got %v",
			"rabbit.platform",
			actualHost)
	}
}

func TestYmlConfigLoadFromBackupFile(t *testing.T) {
	data := []byte(`
stack:
  node:
    name: demo.node
    rpc-port: 8081
    http-port: 8082`)
	path := filepath.Join(os.TempDir(), "file.yml")
	fh, err := os.Create(path)
	if err != nil {
		t.Error(err)
	}
	_, err = fh.Write(data)
	if err != nil {
		t.Error(err)
	}
	defer func() {
		fh.Close()
		os.Remove(path)
	}()

	conf, err := NewConfig(Storage(true), StorageDir(os.TempDir()))
	if err != nil {
		t.Fatalf("Expected no error but got %v", err)
	}
	defer conf.Close()

	if err := conf.Load(
		file.NewSource(
			file.WithPath(path),
		),
	); err != nil {
		t.Fatalf("Expected no error but got %v", err)
	}

	conf2, err := NewConfig(Storage(true), StorageDir(os.TempDir()))
	if err != nil {
		t.Fatalf("Expected no error but got %v", err)
	}
	defer conf2.Close()
	if err := conf2.Load(
		file.NewSource(
			file.WithPath("/i/do/not/exists.json"),
		),
	); err != nil {
		t.Fatalf("Expected no error but got %v", err)
	}

	port := conf.Get("stack", "node", "rpc-port").Int(1)
	if port != 8081 {
		t.Fatalf("Expected %d but got %d",
			8081,
			port)
	}
}

func TestSomeConfigLoad(t *testing.T) {
	formats := []string{"json", "yaml", "toml", "xml", "hcl", "yml"}
	for _, v := range formats {
		fh := createFile(t, "", v)
		path := fh.Name()
		defer func() {
			os.Remove(path)
		}()

		conf, err := NewConfig()
		if err != nil {
			t.Fatalf("Expected no error but got %v", err)
		}
		defer conf.Close()

		if err := conf.Load(
			file.NewSource(
				file.WithPath(path),
			),
		); err != nil {
			t.Fatalf("Expected no error but got %v", err)
		}
	}
}

func TestYAMLFileWithEnvVarSubstitution(t *testing.T) {
	option.GetOptions(option.WithRootCtx(context.Background()))

	os.Setenv("TEST_DB_HOST", "localhost")
	os.Setenv("TEST_DB_PORT", "5432")
	os.Setenv("TEST_STORE_PATH", "/tmp/test-storage")
	defer func() {
		os.Unsetenv("TEST_DB_HOST")
		os.Unsetenv("TEST_DB_PORT")
		os.Unsetenv("TEST_STORE_PATH")
	}()

	yamlContent := `
database:
  host: ${TEST_DB_HOST}
  port: ${TEST_DB_PORT}
storage:
  path: ${TEST_STORE_PATH}
  enabled: true
`

	tmpDir := os.TempDir()
	yamlPath := filepath.Join(tmpDir, "test_env_config.yml")

	err := os.WriteFile(yamlPath, []byte(yamlContent), 0644)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(yamlPath)

	conf, err := NewConfig()
	if err != nil {
		t.Fatalf("Failed to create config: %v", err)
	}
	defer conf.Close()

	err = conf.Load(file.NewSource(file.WithPath(yamlPath)))
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	testCases := []struct {
		path     []string
		expected string
		desc     string
	}{
		{[]string{"database", "host"}, "localhost", "database host"},
		{[]string{"database", "port"}, "5432", "database port"},
		{[]string{"storage", "path"}, "/tmp/test-storage", "storage path"},
	}

	for _, tc := range testCases {
		actual := conf.Get(tc.path...).String("")
		if actual != tc.expected {
			t.Errorf("%s: expected %s, got %s", tc.desc, tc.expected, actual)
		}
	}

	enabledVal := conf.Get("storage", "enabled").Bool(false)
	if !enabledVal {
		t.Errorf("Expected storage.enabled to be true, got false")
	}
}

func TestYAMLFileWithMissingEnvVar(t *testing.T) {
	option.GetOptions(option.WithRootCtx(context.Background()))

	os.Unsetenv("MISSING_ENV_VAR")

	yamlContent := `
config:
  missing: ${MISSING_ENV_VAR}
  static: "value"
`

	tmpDir := os.TempDir()
	yamlPath := filepath.Join(tmpDir, "test_missing_env.yml")

	err := os.WriteFile(yamlPath, []byte(yamlContent), 0644)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(yamlPath)

	conf, err := NewConfig()
	if err != nil {
		t.Fatalf("Failed to create config: %v", err)
	}
	defer conf.Close()

	err = conf.Load(file.NewSource(file.WithPath(yamlPath)))
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	missingVal := conf.Get("config", "missing").String("default")
	if missingVal != "" && missingVal != "default" {
		t.Logf("Note: Missing env var resulted in: '%s'", missingVal)
	}

	staticVal := conf.Get("config", "static").String("")
	if staticVal != "value" {
		t.Errorf("Expected 'value', got '%s'", staticVal)
	}
}

func TestYAMLFileWithoutEnvVars(t *testing.T) {
	option.GetOptions(option.WithRootCtx(context.Background()))

	yamlContent := `
app:
  name: "test-app"
  port: 8080
  debug: true
`

	tmpDir := os.TempDir()
	yamlPath := filepath.Join(tmpDir, "test_no_env.yml")

	err := os.WriteFile(yamlPath, []byte(yamlContent), 0644)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(yamlPath)

	conf, err := NewConfig()
	if err != nil {
		t.Fatalf("Failed to create config: %v", err)
	}
	defer conf.Close()

	err = conf.Load(file.NewSource(file.WithPath(yamlPath)))
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	if v := conf.Get("app", "name").String(""); v != "test-app" {
		t.Errorf("Expected 'test-app', got '%s'", v)
	}

	if v := conf.Get("app", "port").Int(0); v != 8080 {
		t.Errorf("Expected 8080, got %d", v)
	}

	if v := conf.Get("app", "debug").Bool(false); !v {
		t.Errorf("Expected true, got false")
	}
}
