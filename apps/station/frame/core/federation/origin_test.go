package federation

import "testing"

func TestCanonicalStationOrigin(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{
			name:  "http with port",
			input: " http://station.example:18080/ ",
			want:  "http://station.example:18080",
		},
		{
			name:  "https",
			input: "https://station.example",
			want:  "https://station.example",
		},
		{name: "credentials", input: "https://user@station.example", wantErr: true},
		{name: "path", input: "https://station.example/path", wantErr: true},
		{name: "query", input: "https://station.example?q=1", wantErr: true},
		{name: "fragment", input: "https://station.example#x", wantErr: true},
		{name: "unsupported scheme", input: "ftp://station.example", wantErr: true},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := CanonicalStationOrigin(test.input)
			if test.wantErr {
				if err == nil {
					t.Fatalf("CanonicalStationOrigin(%q) succeeded", test.input)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("origin = %q, want %q", got, test.want)
			}
		})
	}
}
