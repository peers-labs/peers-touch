package config

import (
	"github.com/peers-labs/peers-touch/station/frame/core/pkg/config/reader"
)

var (
	_sugar Config
)

func IsInitialized() bool {
	return _sugar != nil
}

func Get(path ...string) reader.Value {
	return _sugar.Get(path...)
}
