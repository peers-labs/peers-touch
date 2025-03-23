package native

import "github.com/dirty-bro-tech/peers-touch-go/core/plugin"

func init() {
	plugin.StorePlugins["native"] = &nativeStorePlugin{}
}
