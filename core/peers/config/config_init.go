package config

import (
	"fmt"
	"os"
	"strings"

	cfg "github.com/dirty-bro-tech/peers-touch-go/core/config"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/source"
	cliSource "github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/source/cli"
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/source/file"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
	uf "github.com/dirty-bro-tech/peers-touch-go/core/util/file"
	"github.com/dirty-bro-tech/peers-touch-go/core/util/log"
	yaml "gopkg.in/yaml.v2"
)

func LoadConfig(sOpts *service.Options) (err error) {
	// set the config file path
	if filePath := sOpts.Cmd.App().Context().String("config"); len(filePath) > 0 {
		sOpts.Conf = filePath
	}

	// need to init the special config if specified
	if len(sOpts.Conf) == 0 {
		wkDir, errN := os.Getwd()
		if errN != nil {
			err = fmt.Errorf("stack can't access working wkDir: %s", errN)
			return
		}

		sOpts.Conf = fmt.Sprintf("%s%s%s%s%s", wkDir, string(os.PathSeparator), peersStdConfigDir, string(os.PathSeparator), peersStdConfigFile)
	}

	var appendSource []source.Source
	var cfgOption []option.Option
	if len(sOpts.Conf) > 0 {
		// check file exists
		exists, err := uf.Exists(sOpts.Conf)
		if err != nil {
			log.Error(fmt.Errorf("config file is not existed %s", err))
		}

		if exists {
			// todo support more types
			val := struct {
				Peers struct {
					Includes string `yaml:"includes"`
					Config   Config `yaml:"config"`
				} `yaml:"peers"`
			}{}
			stdFileSource := file.NewSource(file.WithPath(sOpts.Conf))
			appendSource = append(appendSource, stdFileSource)

			set, errN := stdFileSource.Read()
			if errN != nil {
				err = fmt.Errorf("stack read the stack.yml err: %s", errN)
				return err
			}

			errN = yaml.Unmarshal(set.Data, &val)
			if errN != nil {
				err = fmt.Errorf("unmarshal peers.yml err: %s", errN)
				return err
			}

			if len(val.Peers.Includes) > 0 {
				filePath := sOpts.Conf[:strings.LastIndex(sOpts.Conf, string(os.PathSeparator))+1]
				for _, f := range strings.Split(val.Peers.Includes, ",") {
					log.Infof("load extra config file: %s%s", filePath, f)
					f = strings.TrimSpace(f)
					extraFile := fmt.Sprintf("%s%s", filePath, f)
					extraExists, errIn := uf.Exists(extraFile)
					if errIn != nil {
						log.Error(fmt.Errorf("config file is not existed %s", errIn))
						continue
					} else if !extraExists {
						log.Error(fmt.Errorf("config file [%s] is not existed", extraFile))
						continue
					}

					extraFileSource := file.NewSource(file.WithPath(extraFile))
					appendSource = append(appendSource, extraFileSource)
				}
			}

			// config option
			cfgOption = append(cfgOption, cfg.WithStorage(val.Peers.Config.Storage), cfg.WithHierarchyMerge(val.Peers.Config.HierarchyMerge))
		}
	}

	// the last two must be env & Cmd line
	appendSource = append(appendSource, cliSource.NewSource(sOpts.Cmd.App(), cliSource.Context(sOpts.Cmd.App().Context())))
	cfgOption = append(cfgOption, cfg.WithSources(appendSource...))

	sOpts.Config = cfg.NewConfig(cfgOption...)
	err = sOpts.Config.Init()
	if err != nil {
		err = fmt.Errorf("init config err: %s", err)
		return
	}

	return
}

func SetOptions(sOpts *service.Options) (err error) {
	conf := peersConfig.Peers

	// serviceOptions
	for _, o := range conf.Service.Options() {
		sOpts.Apply(o)
	}

	sOpts.ServerOptions = append(sOpts.ServerOptions, conf.Service.Server.Options()...)
	sOpts.ClientOptions = append(sOpts.ClientOptions, conf.Client.Options()...)
	sOpts.ConfigOptions = append(sOpts.ConfigOptions, conf.Config.Options()...)
	sOpts.RegistryOptions = append(sOpts.RegistryOptions, conf.Registry.Options()...)
	sOpts.LoggerOptions = append(sOpts.LoggerOptions, conf.Logger.Options()...)

	return
}
