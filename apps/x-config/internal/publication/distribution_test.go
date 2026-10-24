package publication

import (
	"testing"

	"github.com/peers-labs/peers-touch/x-config/internal/domain/catalog"
)

func TestBuildDistribution(t *testing.T) {
	cases := []struct {
		name    string
		origins []string
		wantOK  bool
	}{
		{"nil", nil, true},
		{"empty", []string{}, true},
		{
			"https ordered",
			[]string{"https://xconfig.example.test", "https://mirror.example.test"},
			true,
		},
		{"private ipv4 http", []string{"http://10.37.221.38:18082"}, true},
		{"loopback http", []string{"http://127.0.0.1:8080"}, true},
		{"ipv6 loopback http", []string{"http://[::1]:8080"}, true},
		{"http domain rejected", []string{"http://corp.example.test"}, false},
		{"http public ip rejected", []string{"http://8.8.8.8:8080"}, false},
		{"http ula rejected", []string{"http://[fd00::1]:8080"}, false},
		{"query rejected", []string{"https://xconfig.example.test?a=b"}, false},
		{"path rejected", []string{"https://xconfig.example.test/channels"}, false},
		{"credentials rejected", []string{"https://u:p@xconfig.example.test"}, false},
		{"duplicate rejected", []string{
			"https://xconfig.example.test",
			"https://xconfig.example.test",
		}, false},
		{"too many rejected", []string{
			"https://a.example.test",
			"https://b.example.test",
			"https://c.example.test",
			"https://d.example.test",
			"https://e.example.test",
		}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var input *catalog.CatalogDistribution
			if tc.origins != nil {
				input = &catalog.CatalogDistribution{Origins: tc.origins}
			}
			got, err := buildDistribution(input)
			if tc.wantOK != (err == nil) {
				t.Fatalf("want ok=%v, got err=%v result=%v", tc.wantOK, err, got)
			}
			if !tc.wantOK || tc.origins == nil {
				return
			}
			if len(tc.origins) == 0 {
				if got != nil {
					t.Fatalf("empty list must project to nil, got %+v", got)
				}
				return
			}
			if len(got.GetOrigins()) != len(tc.origins) {
				t.Fatalf("origin count = %d", len(got.GetOrigins()))
			}
			for index, origin := range tc.origins {
				if got.Origins[index].GetOrigin() != origin {
					t.Fatalf("origin %d = %q want %q (order must be preserved)",
						index, got.Origins[index].GetOrigin(), origin)
				}
			}
		})
	}
}
