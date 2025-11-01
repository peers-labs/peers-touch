package config

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/peers-touch/peers-touch/station/frame/core/cmd"
	cfg "github.com/peers-touch/peers-touch/station/frame/core/config"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
	"github.com/peers-touch/peers-touch/station/frame/core/pkg/config/source"
	cliSource "github.com/peers-touch/peers-touch/station/frame/core/pkg/config/source/cli"
	"github.com/peers-touch/peers-touch/station/frame/core/pkg/config/source/file"
	"github.com/peers-touch/peers-touch/station/frame/core/pkg/config/source/memory"
)

var (
	ymlFile = []byte(`peers:
  broker:
    name: http
    address: :8081
  client:
    pool:
      size: 2
      ttl: 200
    request:
      timeout: 300ms
      retries: 3
  registry:
    name: mdns
    address: 127.0.0.1:6500
  node:
    name: test-node
    server:
      address: :8090
      advertise: no-test
      id: test-id
      metadata:
        - A=a
        - B=b
      version: 1.0.0
      registry:
        interval: 200
        ttl: 300
  selector:
    name: robin
  transport:
    name: gRPC
    address: :7788
  profile: _1
  runtime:
ext:
  date-time: 2021-03-10 23:10:23.999`)
	conf = PeersConfig{}
)

func init() {
	cfg.RegisterOptions(&conf)
}

func TestPeersConfig_File(t *testing.T) {
	path := filepath.Join(os.TempDir(), "file.yaml")
	fh, err := os.Create(path)
	if err != nil {
		t.Error(fmt.Errorf("Config create tmp yml error: %s ", err))
	}
	_, err = fh.Write(ymlFile)
	if err != nil {
		t.Error(fmt.Errorf("Config write tmp yml error: %s ", err))
	}
	defer func() {
		fh.Close()
		os.Remove(path)
	}()

	ctx := context.Background()
	src := file.NewSource(option.WithRootCtx(ctx), file.WithPath(path))
	c := cfg.NewConfig(cfg.WithSources(src))
	if err = c.Init(); err != nil {
		t.Error(fmt.Errorf("Config init error: %s ", err))
	}
	defer c.Close()

	if err := c.Scan(&conf); err != nil {
		t.Error(fmt.Errorf("Config scan confi error: %s ", err))
	}
	t.Log(string(c.Bytes()))
	t.Log(conf)

	if conf.Peers.Service.Server.Address != ":8090" {
		t.Fatal(fmt.Errorf("server address should be [:8090], not: [%s]", conf.Peers.Service.Server.Address))
	}
}

func TestPeersConfig_Config(t *testing.T) {
	path := filepath.Join(os.TempDir(), "file_config.yaml")
	fh, err := os.Create(path)
	if err != nil {
		t.Error(fmt.Errorf("Config create tmp yml error: %s ", err))
	}
	_, err = fh.Write(ymlFile)
	if err != nil {
		t.Error(fmt.Errorf("Config write tmp yml error: %s ", err))
	}
	defer func() {
		fh.Close()
		os.Remove(path)
	}()

	// setup app
	app := cmd.NewCmd().App()
	app.Name = "testcmd"
	app.Flags = cmd.DefaultFlags

	// set args
	os.Args = []string{"run"}
	// string arg
	os.Args = append(os.Args, "--broker", "http", "--broker_address", ":10086")
	// int arg
	os.Args = append(os.Args, "--client_pool_ttl=100")
	// map
	os.Args = append(os.Args, "--server_metadata", "C=c")
	os.Args = append(os.Args, "--server_metadata", "D=d")

	conf.Peers.Service.Server.Name = "default-srv-name"
	defaultBytes, _ := json.Marshal(conf)
	t.Log(string(defaultBytes))

	ctx := context.Background()
	srcMemory := memory.NewSource(option.WithRootCtx(ctx), memory.WithJSON(defaultBytes))
	srcFile := file.NewSource(file.WithPath(path))
	srcCli := cliSource.NewSource(app, cliSource.Context(app.Context()))

	sources := []source.Source{
		srcMemory, srcFile, srcCli,
	}

	c := cfg.NewConfig(cfg.WithSources(sources...))
	if err = c.Init(); err != nil {
		t.Error(fmt.Errorf("Config init error: %s ", err))
	}
	defer c.Close()

	t.Log(string(c.Bytes()))
	t.Log(conf)

	// test default
	if conf.Peers.Service.Server.Name != "default-srv-name" {
		t.Fatal(fmt.Errorf("server name should be [default-srv-name], not: [%s]", conf.Peers.Service.Server.Name))
	}
	if c.Get("peers", "node", "server", "name").String("") != "default-srv-name" {
		t.Fatal(fmt.Errorf("server name in [c] should be [default-srv-name], not: [%s]", c.Get("peers", "node", "server", "name").String("")))
	}

	if conf.Peers.Service.Server.ID != "test-id" {
		t.Fatal(fmt.Errorf("server id should be [test-id] which is peersCmd value, not: [%s]", conf.Peers.Service.Server.ID))
	}

	if conf.Peers.Client.Pool.TTL != 100 {
		t.Fatal(fmt.Errorf("client pool ttl should be [100] which is peersCmd value, not: [%d]", conf.Peers.Client.Pool.TTL))
	}

	// test map value: the extra values
	if conf.Peers.Service.Server.Metadata.Value("C") != "c" {
		t.Fatal(fmt.Errorf("peers metadata should have [C-c], not: [%s]", conf.Peers.Service.Server.Metadata.Value("C")))
	}
	// test map value: the peersCmd value
	if conf.Peers.Service.Server.Metadata.Value("D") != "d" {
		t.Fatal(fmt.Errorf("peers metadata should have [D-d], not: [%s]", conf.Peers.Service.Server.Metadata.Value("D")))
	}
}

func TestStackConfig_MultiConfig(t *testing.T) {
	ymlData := []byte(`
peers:
  broker:
    name: http
    address: :8081
  transport:
    name: gRPC
    address: :7788
`)
	ymlPath := filepath.Join(os.TempDir(), "file_MultiConfig.yaml")
	ymlFile, err := os.Create(ymlPath)
	if err != nil {
		t.Error(fmt.Errorf("MultiConfig create tmp yml error: %s", err))
	}
	_, err = ymlFile.Write(ymlData)
	if err != nil {
		t.Error(fmt.Errorf("MultiConfig write tmp yml error: %s", err))
	}
	defer func() {
		ymlFile.Close()
		os.Remove(ymlPath)
	}()

	// 2 config
	jsonData := []byte(`
{ "db" : "mysql"}
`)
	jsonPath := filepath.Join(os.TempDir(), "file.json")
	jsonFile, err := os.Create(jsonPath)
	if err != nil {
		t.Error(fmt.Errorf("MultiConfig create tmp json error: %s", err))
	}
	_, err = jsonFile.Write(jsonData)
	if err != nil {
		t.Error(fmt.Errorf("MultiConfig write tmp json error: %s", err))
	}
	defer func() {
		jsonFile.Close()
		os.Remove(jsonPath)
	}()

	// setup app
	app := cmd.NewCmd().App()
	app.Name = "testcmd"
	app.Flags = cmd.DefaultFlags

	// set args
	os.Args = []string{"run"}
	os.Args = append(os.Args, "--broker", "kafka")

	ctx := context.Background()
	srcFileYML := file.NewSource(option.WithRootCtx(ctx), file.WithPath(ymlPath))
	srcFileJSON := file.NewSource(file.WithPath(jsonPath))
	srcCli := cliSource.NewSource(app, cliSource.Context(app.Context()))

	sources := []source.Source{
		srcFileYML,
		srcFileJSON,
		srcCli,
	}

	c := cfg.NewConfig(cfg.WithSources(sources...))
	if err = c.Init(); err != nil {
		t.Error(fmt.Errorf("Config init error: %s ", err))
	}
	defer c.Close()

	if c.Get("db").String("default") != "mysql" {
		t.Fatal(fmt.Errorf("db setting should be 'mysql', not %s", c.Get("db").String("default")))
	}

	var conf = PeersConfig{}

	conf.Peers.Service.Server.Name = "default"

	if err := c.Scan(&conf); err != nil {
		t.Fatal(fmt.Errorf("MultiConfig scan conf error %s", err))
	}

	if conf.Peers.Service.Server.Name != "default" {
		t.Fatal(fmt.Errorf("broker name [%s] should be 'default'", conf.Peers.Service.Server.Name))
	}
}

func TestConfigHierarchyMerge(t *testing.T) {
	defer func() {
		conf = PeersConfig{}
	}()

	path := filepath.Join(os.TempDir(), "file_hierarchy_merge.yaml")
	fh, err := os.Create(path)
	if err != nil {
		t.Error(fmt.Errorf("Config create tmp yml error: %s ", err))
	}
	_, err = fh.Write(ymlFile)
	if err != nil {
		t.Error(fmt.Errorf("Config write tmp yml error: %s ", err))
	}
	defer func() {
		fh.Close()
		os.Remove(path)
	}()

	c := cfg.NewConfig(cfg.WithSources(file.NewSource(option.WithRootCtx(context.Background()), file.WithPath(path))), cfg.WithHierarchyMerge(true))
	if err = c.Init(); err != nil {
		t.Error(fmt.Errorf("Config init error: %s ", err))
	}
	defer c.Close()

	if c.Get("peers.broker.name").String("") != "http" {
		t.Fatal(fmt.Errorf("peers.broker.name should be [http], not: [%s]", c.Get("peers.broker.name").String("")))
	}

	if c.Get("peers", "broker", "name").String("") != "http" {
		t.Fatal(fmt.Errorf("peers broker name should be [http], not: [%s]", c.Get("peers", "broker", "name").String("")))
	}
}

func TestConfigIncludes(t *testing.T) {
	defer func() {
		conf = PeersConfig{}
	}()

	mainYml := []byte(`
peers:
  includes: testA.yml
`)
	includedYml := []byte(`
testA:
  aKey: aValue
`)
	mF, mP, err := touchFile(t, "main.yml", mainYml)
	if err != nil {
		t.Fatalf("touch file err: %s", err)
	}
	iF, iP, err := touchFile(t, "included.yml", includedYml)
	if err != nil {
		t.Fatalf("touch file err: %s", err)
	}
	defer func() {
		mF.Close()
		os.Remove(mP)
		iF.Close()
		os.Remove(iP)
	}()

	type testA struct {
		AKey string `sc:"aKey"`
	}
}

func touchFile(t *testing.T, fileName string, data []byte) (f *os.File, fullPath string, err error) {
	fileName = t.Name() + fileName
	filePath := filepath.Join(os.TempDir(), fileName)
	file, err := os.Create(filePath)
	if err != nil {
		return nil, "", fmt.Errorf("create tmp file [%s] error: %s", fileName, err)
	}

	_, err = file.Write(data)
	if err != nil {
		return nil, "", fmt.Errorf("write tmp file [%s] error: %s", fileName, err)
	}

	return file, filePath, nil
}
