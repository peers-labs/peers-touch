package compat_chat

import (
	"context"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/html"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type LinkPreviewRequest struct {
	URL string `json:"url" query:"url"`
}

type LinkPreviewResponse struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       string `json:"image"`
	SiteName    string `json:"site_name"`
}

var urlSafePattern = regexp.MustCompile(`^https?://`)

func (s *subServer) handleLinkPreview(_ context.Context, req *LinkPreviewRequest) (*LinkPreviewResponse, error) {
	if req.URL == "" {
		return nil, server.BadRequest("url is required")
	}
	if !urlSafePattern.MatchString(req.URL) {
		return nil, server.BadRequest("url must start with http:// or https://")
	}

	client := &http.Client{Timeout: 5 * time.Second}
	httpReq, err := http.NewRequest("GET", req.URL, nil)
	if err != nil {
		return nil, server.BadRequest("invalid url")
	}
	httpReq.Header.Set("User-Agent", "PeersTouchBot/1.0 (link preview)")
	httpReq.Header.Set("Accept", "text/html")

	resp, err := client.Do(httpReq)
	if err != nil {
		return &LinkPreviewResponse{URL: req.URL}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return &LinkPreviewResponse{URL: req.URL}, nil
	}

	body := io.LimitReader(resp.Body, 256*1024)
	og := extractOGMeta(body)
	og.URL = req.URL

	return og, nil
}

func extractOGMeta(r io.Reader) *LinkPreviewResponse {
	result := &LinkPreviewResponse{}
	tokenizer := html.NewTokenizer(r)
	inHead := false

	for {
		tt := tokenizer.Next()
		switch tt {
		case html.ErrorToken:
			return result
		case html.StartTagToken, html.SelfClosingTagToken:
			tn, hasAttr := tokenizer.TagName()
			tag := string(tn)
			if tag == "head" {
				inHead = true
				continue
			}
			if tag == "body" {
				return result
			}
			if !inHead || tag != "meta" || !hasAttr {
				continue
			}
			attrs := collectAttrs(tokenizer)
			prop := attrs["property"]
			if prop == "" {
				prop = attrs["name"]
			}
			content := attrs["content"]
			switch strings.ToLower(prop) {
			case "og:title":
				result.Title = content
			case "og:description":
				result.Description = content
			case "og:image":
				result.Image = content
			case "og:site_name":
				result.SiteName = content
			}
		case html.EndTagToken:
			tn, _ := tokenizer.TagName()
			if string(tn) == "head" {
				return result
			}
		}
	}
}

func collectAttrs(tokenizer *html.Tokenizer) map[string]string {
	attrs := make(map[string]string)
	for {
		key, val, more := tokenizer.TagAttr()
		if len(key) > 0 {
			attrs[strings.ToLower(string(key))] = string(val)
		}
		if !more {
			break
		}
	}
	return attrs
}
