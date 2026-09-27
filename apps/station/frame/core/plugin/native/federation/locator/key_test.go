package locator

import "testing"

func TestCanonicalHandle(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{
			name:  "canonicalizes case and leading marker",
			input: " @Alice@Home.Example ",
			want:  "alice@home.example",
		},
		{name: "missing separator", input: "alice", wantErr: true},
		{name: "missing local part", input: "@@home.example", wantErr: true},
		{name: "missing host", input: "alice@", wantErr: true},
		{name: "multiple separators", input: "alice@home@example", wantErr: true},
		{name: "local whitespace", input: "alice smith@home.example", wantErr: true},
		{name: "host whitespace", input: "alice@home example", wantErr: true},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := CanonicalHandle(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("CanonicalHandle(%q) = %q, want error", tt.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("CanonicalHandle(%q) error = %v", tt.input, err)
			}
			if got != tt.want {
				t.Fatalf("CanonicalHandle(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
