package config

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/pkg/config/reader"
)

var (
	_sugar Config
)

func Get(path ...string) reader.Value {
	return _sugar.Get(path...)
}
