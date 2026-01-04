package model

type SearchResultType string

const (
	SearchResultTypeFriend         SearchResultType = "friend"
	SearchResultTypePost           SearchResultType = "post"
	SearchResultTypeChat           SearchResultType = "chat"
	SearchResultTypeApplet         SearchResultType = "applet"
	SearchResultTypeStationContent SearchResultType = "stationContent"
)

type SearchResult struct {
	ID       string                 `json:"id"`
	Type     SearchResultType       `json:"type"`
	Title    string                 `json:"title"`
	Subtitle string                 `json:"subtitle,omitempty"`
	IconURL  string                 `json:"icon_url,omitempty"`
	URL      string                 `json:"url,omitempty"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

type SearchResponse struct {
	Results []SearchResult `json:"results"`
	Total   int            `json:"total"`
}
