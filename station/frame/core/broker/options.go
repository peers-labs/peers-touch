package broker

type GetOptions struct {
	Name string
}

type GetOption func(*GetOptions)

func WithName(name string) GetOption { return func(o *GetOptions) { o.Name = name } }
