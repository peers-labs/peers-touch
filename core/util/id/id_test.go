package id

import (
	"context"
	"regexp"
	"strconv"
	"sync"
	"testing"
	"time"
)

// MockStore is a mock implementation of the store interface for testing
type MockStore struct{}

func (m *MockStore) Init() error                          { return nil }
func (m *MockStore) RDS() interface{}                    { return nil }
func (m *MockStore) Name() string                        { return "mock" }

func TestQuickHelpers(t *testing.T) {
	tests := []struct {
		name string
		fn   func() interface{}
		want string
	}{
		{"NextSonyflakeID", func() interface{} { return NextSonyflakeID() }, "uint64"},
		{"NextTimingID", func() interface{} { return NextTimingID() }, "uint64"},
		{"NextReadableID", func() interface{} { return NextReadableID() }, "string"},
		{"NextRandomID", func() interface{} { return NextRandomID() }, "string"},
		{"NextRandomID(12)", func() interface{} { return NextRandomID(12) }, "string"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.fn()
			if got == nil {
				t.Errorf("%s() returned nil", tt.name)
			}
			if tt.want == "uint64" {
				if _, ok := got.(uint64); !ok {
					t.Errorf("%s() = %T, want uint64", tt.name, got)
				}
			} else {
				if _, ok := got.(string); !ok {
					t.Errorf("%s() = %T, want string", tt.name, got)
				}
			}
		})
	}
}

func TestOptionCombinations(t *testing.T) {
	tests := []struct {
		name string
		opts []Option
		want string
		fn   func(opts ...Option) interface{}
	}{
		{
			"Sonyflake numeric",
			[]Option{WithSonyflake()},
			`^\d+$`,
			func(opts ...Option) interface{} { return NextID(opts...) },
		},
		{
			"Timing numeric",
			[]Option{WithTiming()},
			`^\d+$`,
			func(opts ...Option) interface{} { return NextID(opts...) },
		},
		{
			"Readable string",
			[]Option{WithReadable()},
			`^[a-zA-Z0-9-]+$`,
			func(opts ...Option) interface{} { return NextIDS(opts...) },
		},
		{
			"Random string",
			[]Option{WithRandom()},
			`^[a-zA-Z0-9]+$`,
			func(opts ...Option) interface{} { return NextIDS(opts...) },
		},
		{
			"Readable with prefix and suffix",
			[]Option{WithReadable(), WithPrefix("usr"), WithSuffix("dev")},
			`^usr[a-zA-Z0-9-]+dev$`,
			func(opts ...Option) interface{} { return NextIDS(opts...) },
		},
		{
			"Readable with timestamp",
			[]Option{WithReadable(), WithTimestamp(), WithLength(6)},
			`^[a-zA-Z0-9-]+\d{8}-\d{6}$`,
			func(opts ...Option) interface{} { return NextIDS(opts...) },
		},
		{
			"Random with custom length",
			[]Option{WithRandom(), WithLength(12)},
			`^[a-zA-Z0-9]{12}$`,
			func(opts ...Option) interface{} { return NextIDS(opts...) },
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.fn(tt.opts...)
			
			var str string
			switch v := got.(type) {
			case uint64:
				str = strconv.FormatUint(v, 10)
			case string:
				str = v
			default:
				t.Fatalf("unexpected type: %T", got)
			}

			matched, err := regexp.MatchString(tt.want, str)
			if err != nil {
				t.Fatalf("invalid regex: %v", err)
			}
			if !matched {
				t.Errorf("%s = %v, want to match %v", tt.name, str, tt.want)
			}
		})
	}
}

func TestIncompatibleOptions(t *testing.T) {
	tests := []struct {
		name string
		fn   func()
	}{
		{
			"NextID with Readable",
			func() { NextID(WithReadable()) },
		},
		{
			"NextID with Random",
			func() { NextID(WithRandom()) },
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Errorf("%s should panic", tt.name)
				}
			}()
			tt.fn()
		})
	}
}

func TestContextSupport(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name string
		fn   func() interface{}
		want string
	}{
		{
			"NextIDWithContext Sonyflake",
			func() interface{} { return NextIDWithContext(ctx, WithSonyflake()) },
			"uint64",
		},
		{
			"NextIDSWithContext Readable",
			func() interface{} { return NextIDSWithContext(ctx, WithReadable()) },
			"string",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.fn()
			if got == nil {
				t.Errorf("%s() returned nil", tt.name)
			}
		})
	}
}

func TestUniqueness(t *testing.T) {
	const iterations = 1000

	tests := []struct {
		name string
		fn   func() interface{}
	}{
		{"Sonyflake", func() interface{} { return NextID(WithSonyflake()) }},
		{"Readable", func() interface{} { return NextIDS(WithReadable()) }},
		{"Random", func() interface{} { return NextIDS(WithRandom()) }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			seen := make(map[interface{}]bool)
			for i := 0; i < iterations; i++ {
				id := tt.fn()
				if seen[id] {
					t.Errorf("duplicate %s ID: %v", tt.name, id)
				}
				seen[id] = true
			}
		})
	}
}

func TestPerformance(t *testing.T) {
	const iterations = 10000

	tests := []struct {
		name string
		fn   func()
	}{
		{"Sonyflake", func() { NextID(WithSonyflake()) }},
		{"Readable", func() { NextIDS(WithReadable()) }},
		{"Random", func() { NextIDS(WithRandom()) }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			start := time.Now()
			for i := 0; i < iterations; i++ {
				tt.fn()
			}
			elapsed := time.Since(start)
			rate := float64(iterations) / elapsed.Seconds()
			t.Logf("%s: %.2f/sec", tt.name, rate)
		})
	}
}

func TestConcurrentGeneration(t *testing.T) {
	const goroutines = 100
	const idsPerGoroutine = 100

	tests := []struct {
		name string
		fn   func() interface{}
	}{
		{"Sonyflake", func() interface{} { return NextID(WithSonyflake()) }},
		{"Readable", func() interface{} { return NextIDS(WithReadable()) }},
		{"Random", func() interface{} { return NextIDS(WithRandom()) }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var wg sync.WaitGroup
			results := make(chan interface{}, goroutines*idsPerGoroutine)

			for i := 0; i < goroutines; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					for j := 0; j < idsPerGoroutine; j++ {
						id := tt.fn()
						results <- id
					}
				}()
			}

			wg.Wait()
			close(results)

			seen := make(map[interface{}]bool)
			count := 0
			for id := range results {
				count++
				if seen[id] {
					t.Errorf("duplicate %s ID in concurrent test: %v", tt.name, id)
				}
				seen[id] = true
			}

			if count != goroutines*idsPerGoroutine {
				t.Errorf("expected %d IDs, got %d", goroutines*idsPerGoroutine, count)
			}
		})
	}
}
