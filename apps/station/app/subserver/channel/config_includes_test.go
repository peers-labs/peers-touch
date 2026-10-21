package channel_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v2"
)

func TestStationConfigsIncludeChannelSubserver(t *testing.T) {
	t.Parallel()

	for _, name := range []string{"peers.yml", "peers-sqlite.yml"} {
		name := name
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			content, err := os.ReadFile(filepath.Join("..", "..", "conf", name))
			if err != nil {
				t.Fatalf("read %s: %v", name, err)
			}
			var config struct {
				Peers struct {
					Includes string `yaml:"includes"`
				} `yaml:"peers"`
			}
			if err := yaml.Unmarshal(content, &config); err != nil {
				t.Fatalf("parse %s: %v", name, err)
			}
			for _, include := range strings.Split(config.Peers.Includes, ",") {
				if strings.TrimSpace(include) == "sub_channel.yml" {
					return
				}
			}
			t.Fatalf("%s must include sub_channel.yml", name)
		})
	}
}

func TestStationStoresDeclareChannelDatabase(t *testing.T) {
	t.Parallel()

	for _, name := range []string{"store.yml", "store.sqlite.yml"} {
		name := name
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			assertChannelStore(t, readTestFile(t, filepath.Join("..", "..", "conf", name)))
		})
	}

	t.Run("docker overlay", func(t *testing.T) {
		t.Parallel()

		entrypoint := string(readTestFile(
			t,
			filepath.Join("..", "..", "..", "..", "..", "tooling", "docker", "entrypoint.sh"),
		))
		const startMarker = "cat > /app/conf/store.docker.yml <<EOF\n"
		start := strings.Index(entrypoint, startMarker)
		if start < 0 {
			t.Fatal("Docker entrypoint store overlay is missing")
		}
		body := entrypoint[start+len(startMarker):]
		end := strings.Index(body, "\nEOF\n")
		if end < 0 {
			t.Fatal("Docker entrypoint store overlay is unterminated")
		}
		body = strings.ReplaceAll(body[:end], "${PEERS_DB_DSN}", "postgres://test")
		assertChannelStore(t, []byte(body))
	})
}

func TestStationImagePackagesOfficialLarkRuntime(t *testing.T) {
	t.Parallel()

	var manifest struct {
		Entry map[string]struct {
			Path string `json:"path"`
		} `json:"entry"`
	}
	if err := json.Unmarshal(
		readTestFile(t, filepath.Join("..", "..", "cmd", "lark-channel-plugin", "plugin.json")),
		&manifest,
	); err != nil {
		t.Fatalf("parse official Lark plugin manifest: %v", err)
	}
	for _, platform := range []string{"linux/amd64", "linux/arm64", "linux/riscv64"} {
		entry, ok := manifest.Entry[platform]
		if !ok || entry.Path != "bin/lark-channel-plugin" {
			t.Fatalf("official Lark plugin manifest must package %s", platform)
		}
	}

	repoTooling := filepath.Join("..", "..", "..", "..", "..", "tooling")
	dockerfile := string(readTestFile(
		t,
		filepath.Join(repoTooling, "docker", "station.Dockerfile"),
	))
	for _, required := range []string{
		"/src/tooling/plugins/build-lark-plugin.sh",
		"COPY --from=builder /out/plugins/ ./plugins/",
		"PT_CHANNEL_LARK_CLI=/usr/local/bin/lark-cli",
		"PT_CHANNEL_LARK_PLUGIN_PACKAGE=/app/plugins/lark",
		"PT_CHANNEL_PLUGIN_ROOT=/app/data/channel/plugins",
	} {
		if !strings.Contains(dockerfile, required) {
			t.Fatalf("Station image must contain %q", required)
		}
	}

	entrypoint := string(readTestFile(
		t,
		filepath.Join(repoTooling, "docker", "entrypoint.sh"),
	))
	for _, required := range []string{
		"/app/data/channel/plugins",
		"/app/data/channel/lark-requesters",
	} {
		if !strings.Contains(entrypoint, required) {
			t.Fatalf("Station entrypoint must prepare %q", required)
		}
	}
}

func readTestFile(t *testing.T, path string) []byte {
	t.Helper()

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return content
}

func assertChannelStore(t *testing.T, content []byte) {
	t.Helper()

	var config struct {
		Peers struct {
			Store struct {
				RDS struct {
					Gorm []struct {
						Name string `yaml:"name"`
					} `yaml:"gorm"`
				} `yaml:"rds"`
			} `yaml:"store"`
		} `yaml:"peers"`
	}
	if err := yaml.Unmarshal(content, &config); err != nil {
		t.Fatalf("parse store configuration: %v", err)
	}
	for _, store := range config.Peers.Store.RDS.Gorm {
		if store.Name == "channel" {
			return
		}
	}
	t.Fatal("store configuration must declare the channel database")
}
