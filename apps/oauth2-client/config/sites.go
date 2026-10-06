package config

import _ "embed"

//go:embed sites.json
var sitesJSON []byte

func SitesJSON() []byte {
	return append([]byte(nil), sitesJSON...)
}
