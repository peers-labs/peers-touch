package config

import (
	"github.com/peers-touch/peers-touch/station/frame/core/pkg/config/reader"
)

var (
	_sugar Config
)

func Get(path ...string) reader.Value {
	return _sugar.Get(path...)
}
