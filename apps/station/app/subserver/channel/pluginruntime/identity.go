package pluginruntime

import "context"

type pluginIdentityKey struct{}

func WithPluginIdentity(ctx context.Context, pluginID string) context.Context {
	return context.WithValue(ctx, pluginIdentityKey{}, pluginID)
}

func PluginIdentity(ctx context.Context) string {
	value, _ := ctx.Value(pluginIdentityKey{}).(string)
	return value
}
