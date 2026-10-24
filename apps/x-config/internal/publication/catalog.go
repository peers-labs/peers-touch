package publication

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	peer "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	xconfig "github.com/peers-labs/peers-touch/station/frame/touch/model/xconfig"
	catalogdomain "github.com/peers-labs/peers-touch/x-config/internal/domain/catalog"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gopkg.in/yaml.v3"
)

const (
	CatalogSchemaVersion    = 1
	SnapshotSchemaVersion   = 1
	MaxCatalogBytes         = 256 * 1024
	MaxSnapshotLifetime     = 7 * 24 * time.Hour
	SnapshotClockSkew       = 5 * time.Minute
	MaxDirectives           = 32
	MaxDirectiveRules       = 16
	MaxTargetValues         = 8
	MaxRolloutPermille      = 1000
	MaxDistributionOrigins  = 4
	MaxDistributionOriginCh = 512
)

var (
	ErrCatalogInvalid = errors.New("x_config_catalog_invalid")
	semanticVersion   = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$`)
)

type Catalog = catalogdomain.Catalog
type CatalogEndpoint = catalogdomain.CatalogEndpoint
type CatalogRelease = catalogdomain.CatalogRelease

func ParseCatalog(raw []byte) (*Catalog, error) {
	if len(raw) == 0 || len(raw) > MaxCatalogBytes {
		return nil, ErrCatalogInvalid
	}
	decoder := yaml.NewDecoder(bytes.NewReader(raw))
	decoder.KnownFields(true)
	var catalog Catalog
	if err := decoder.Decode(&catalog); err != nil {
		return nil, ErrCatalogInvalid
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil, ErrCatalogInvalid
	}
	if catalog.SchemaVersion != CatalogSchemaVersion ||
		!validIdentifier(catalog.Channel, 32) ||
		len(catalog.Endpoints) > 128 ||
		len(catalog.Releases) > 64 ||
		len(catalog.Directives) > MaxDirectives {
		return nil, ErrCatalogInvalid
	}
	return &catalog, nil
}

func BuildStatement(
	catalog *Catalog,
	sequence uint64,
	issuedAt time.Time,
	expiresAt time.Time,
) (*xconfig.XConfigSnapshotStatement, []byte, error) {
	if catalog == nil ||
		sequence == 0 ||
		!expiresAt.After(issuedAt) ||
		expiresAt.Sub(issuedAt) > MaxSnapshotLifetime {
		return nil, nil, ErrCatalogInvalid
	}
	endpoints := make([]*xconfig.EndpointSeed, 0, len(catalog.Endpoints))
	seenEndpoints := make(map[string]struct{}, len(catalog.Endpoints))
	for _, input := range catalog.Endpoints {
		endpoint, err := buildEndpoint(input, issuedAt, expiresAt)
		if err != nil {
			return nil, nil, err
		}
		if _, exists := seenEndpoints[endpoint.GetSeedId()]; exists {
			return nil, nil, ErrCatalogInvalid
		}
		seenEndpoints[endpoint.GetSeedId()] = struct{}{}
		endpoints = append(endpoints, endpoint)
	}
	sort.Slice(endpoints, func(left, right int) bool {
		return endpoints[left].GetSeedId() < endpoints[right].GetSeedId()
	})

	releases := make([]*xconfig.ReleaseDescriptor, 0, len(catalog.Releases))
	seenReleases := make(map[string]struct{}, len(catalog.Releases))
	for _, input := range catalog.Releases {
		release, err := buildRelease(input, issuedAt, expiresAt)
		if err != nil {
			return nil, nil, err
		}
		if _, exists := seenReleases[release.GetReleaseId()]; exists {
			return nil, nil, ErrCatalogInvalid
		}
		seenReleases[release.GetReleaseId()] = struct{}{}
		releases = append(releases, release)
	}
	sort.Slice(releases, func(left, right int) bool {
		return releases[left].GetReleaseId() < releases[right].GetReleaseId()
	})

	seedKinds := make(map[string]xconfig.EndpointSeedKind, len(catalog.Endpoints))
	for _, input := range catalog.Endpoints {
		switch input.Kind {
		case "relay":
			seedKinds[input.SeedID] = xconfig.EndpointSeedKind_ENDPOINT_SEED_KIND_RELAY
		case "direct_station":
			seedKinds[input.SeedID] = xconfig.EndpointSeedKind_ENDPOINT_SEED_KIND_DIRECT_STATION
		default:
			return nil, nil, ErrCatalogInvalid
		}
	}
	directives, err := buildDirectives(catalog.Directives, seedKinds)
	if err != nil {
		return nil, nil, err
	}
	sort.Slice(directives, func(left, right int) bool {
		return directives[left].GetKey() < directives[right].GetKey()
	})

	distribution, err := buildDistribution(catalog.Distribution)
	if err != nil {
		return nil, nil, err
	}

	statement := &xconfig.XConfigSnapshotStatement{
		SchemaVersion: SnapshotSchemaVersion,
		Channel:       catalog.Channel,
		Sequence:      sequence,
		IssuedAt:      timestamppb.New(issuedAt.UTC()),
		ExpiresAt:     timestamppb.New(expiresAt.UTC()),
		EndpointSeeds: endpoints,
		Releases:      releases,
		Directives:    directives,
		Distribution:  distribution,
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(statement)
	if err != nil || len(raw) == 0 || len(raw) > MaxCatalogBytes {
		return nil, nil, ErrCatalogInvalid
	}
	return statement, raw, nil
}

func buildEndpoint(
	input CatalogEndpoint,
	now time.Time,
	snapshotExpiresAt time.Time,
) (*xconfig.EndpointSeed, error) {
	if !validIdentifier(input.SeedID, 128) ||
		!validText(input.DisplayName, 128) ||
		len(input.Regions) > 8 {
		return nil, ErrCatalogInvalid
	}
	regions := append([]string(nil), input.Regions...)
	sort.Strings(regions)
	for index, region := range regions {
		if !validIdentifier(region, 64) ||
			(index > 0 && regions[index-1] == region) {
			return nil, ErrCatalogInvalid
		}
	}
	materialBytes, err := decodeBase64Bounded(
		input.ConnectionMaterialBase64,
		MaxCatalogBytes,
	)
	if err != nil {
		return nil, err
	}
	material := &peer.PublicEndpointConnectionMaterial{}
	if err := proto.Unmarshal(materialBytes, material); err != nil {
		return nil, ErrCatalogInvalid
	}
	canonicalMaterial, err := proto.MarshalOptions{Deterministic: true}.Marshal(material)
	if err != nil || !bytes.Equal(canonicalMaterial, materialBytes) {
		return nil, ErrCatalogInvalid
	}
	verifiedMaterial, err := peer.VerifyPublicEndpointConnectionMaterial(
		material,
		true,
		now,
	)
	if err != nil {
		return nil, ErrCatalogInvalid
	}
	var kind xconfig.EndpointSeedKind
	switch input.Kind {
	case "relay":
		kind = xconfig.EndpointSeedKind_ENDPOINT_SEED_KIND_RELAY
		if verifiedMaterial.ExpectedEndpointRole !=
			peer.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY ||
			input.StationAdvertisementBase64 != "" {
			return nil, ErrCatalogInvalid
		}
	case "direct_station":
		kind = xconfig.EndpointSeedKind_ENDPOINT_SEED_KIND_DIRECT_STATION
		if verifiedMaterial.ExpectedEndpointRole !=
			peer.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION {
			return nil, ErrCatalogInvalid
		}
	default:
		return nil, ErrCatalogInvalid
	}
	availableFrom, err := parseOptionalTime(
		input.AvailableFrom,
		time.UnixMilli(material.GetIssuedAtUnixMs()).UTC(),
	)
	if err != nil {
		return nil, err
	}
	availableUntil, err := parseOptionalTime(
		input.AvailableUntil,
		time.UnixMilli(material.GetExpiresAtUnixMs()).UTC(),
	)
	if err != nil ||
		!availableUntil.After(availableFrom) ||
		availableUntil.After(snapshotExpiresAt) ||
		availableUntil.After(verifiedMaterial.ExpiresAt) {
		return nil, ErrCatalogInvalid
	}
	seed := &xconfig.EndpointSeed{
		SeedId:             input.SeedID,
		Kind:               kind,
		DisplayName:        input.DisplayName,
		ConnectionMaterial: material,
		Regions:            regions,
		AvailableFrom:      timestamppb.New(availableFrom),
		AvailableUntil:     timestamppb.New(availableUntil),
	}
	if kind == xconfig.EndpointSeedKind_ENDPOINT_SEED_KIND_DIRECT_STATION {
		advertisementBytes, err := decodeBase64Bounded(
			input.StationAdvertisementBase64,
			MaxCatalogBytes,
		)
		if err != nil {
			return nil, err
		}
		advertisement := &peer.SignedPublicStationAdvertisement{}
		if err := proto.Unmarshal(advertisementBytes, advertisement); err != nil {
			return nil, ErrCatalogInvalid
		}
		canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(
			advertisement,
		)
		if err != nil || !bytes.Equal(canonical, advertisementBytes) {
			return nil, ErrCatalogInvalid
		}
		verified, err := peer.VerifyPublicStationAdvertisement(
			advertisement,
			material,
			now,
		)
		if err != nil ||
			verified.Statement.GetDisplayName() != input.DisplayName ||
			time.UnixMilli(
				verified.Statement.GetExpiresAtUnixMs(),
			).UTC().Before(availableUntil) {
			return nil, ErrCatalogInvalid
		}
		seed.StationAdvertisement = advertisement
	}
	return seed, nil
}

func buildRelease(
	input CatalogRelease,
	snapshotIssuedAt time.Time,
	snapshotExpiresAt time.Time,
) (*xconfig.ReleaseDescriptor, error) {
	if !validIdentifier(input.ReleaseID, 128) ||
		!semanticVersion.MatchString(input.Version) ||
		!semanticVersion.MatchString(input.MinimumSupportedVersion) ||
		!validHTTPSURL(input.ManifestURL) ||
		!validHTTPSURL(input.ReleaseNotesURL) ||
		!validIdentifier(input.ReleaseSigningKeyID, 128) {
		return nil, ErrCatalogInvalid
	}
	manifestDigest, err := hex.DecodeString(strings.TrimSpace(input.ManifestSHA256))
	if err != nil || len(manifestDigest) != 32 {
		return nil, ErrCatalogInvalid
	}
	publishedAt, err := time.Parse(time.RFC3339, input.PublishedAt)
	if err != nil ||
		publishedAt.After(snapshotIssuedAt.Add(SnapshotClockSkew)) ||
		publishedAt.After(snapshotExpiresAt) {
		return nil, ErrCatalogInvalid
	}
	platform, ok := mapPlatform(input.Platform)
	if !ok {
		return nil, ErrCatalogInvalid
	}
	architecture, ok := mapArchitecture(input.Architecture)
	if !ok {
		return nil, ErrCatalogInvalid
	}
	return &xconfig.ReleaseDescriptor{
		ReleaseId:               input.ReleaseID,
		Platform:                platform,
		Architecture:            architecture,
		Version:                 input.Version,
		MinimumSupportedVersion: input.MinimumSupportedVersion,
		ManifestUrl:             input.ManifestURL,
		ManifestSha256:          manifestDigest,
		ReleaseSigningKeyId:     input.ReleaseSigningKeyID,
		ReleaseNotesUrl:         input.ReleaseNotesURL,
		PublishedAt:             timestamppb.New(publishedAt.UTC()),
	}, nil
}

func decodeBase64Bounded(value string, maximum int) ([]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil {
		decoded, err = base64.RawStdEncoding.DecodeString(strings.TrimSpace(value))
	}
	if err != nil || len(decoded) == 0 || len(decoded) > maximum {
		return nil, ErrCatalogInvalid
	}
	return decoded, nil
}

func parseOptionalTime(value string, fallback time.Time) (time.Time, error) {
	if strings.TrimSpace(value) == "" {
		return fallback, nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, ErrCatalogInvalid
	}
	return parsed.UTC(), nil
}

func validIdentifier(value string, maximum int) bool {
	return validText(value, maximum) &&
		!strings.ContainsAny(value, " \t\r\n")
}

func validText(value string, maximum int) bool {
	return value != "" &&
		value == strings.TrimSpace(value) &&
		len(value) <= maximum
}

func validHTTPSURL(value string) bool {
	if len(value) > 512 {
		return false
	}
	parsed, err := url.Parse(value)
	return err == nil &&
		parsed.Scheme == "https" &&
		parsed.Host != "" &&
		parsed.User == nil &&
		parsed.Fragment == ""
}

func mapPlatform(value string) (xconfig.ClientPlatform, bool) {
	switch value {
	case "macos":
		return xconfig.ClientPlatform_CLIENT_PLATFORM_MACOS, true
	case "windows":
		return xconfig.ClientPlatform_CLIENT_PLATFORM_WINDOWS, true
	case "linux":
		return xconfig.ClientPlatform_CLIENT_PLATFORM_LINUX, true
	case "ios":
		return xconfig.ClientPlatform_CLIENT_PLATFORM_IOS, true
	case "android":
		return xconfig.ClientPlatform_CLIENT_PLATFORM_ANDROID, true
	default:
		return xconfig.ClientPlatform_CLIENT_PLATFORM_UNSPECIFIED, false
	}
}

func mapArchitecture(
	value string,
) (xconfig.ClientArchitecture, bool) {
	switch value {
	case "arm64":
		return xconfig.ClientArchitecture_CLIENT_ARCHITECTURE_ARM64, true
	case "x86_64":
		return xconfig.ClientArchitecture_CLIENT_ARCHITECTURE_X86_64, true
	case "universal":
		return xconfig.ClientArchitecture_CLIENT_ARCHITECTURE_UNIVERSAL, true
	default:
		return xconfig.ClientArchitecture_CLIENT_ARCHITECTURE_UNSPECIFIED, false
	}
}

// buildDistribution converts the catalog transport-steering section. It
// mirrors the client admission policy in x-config-core origin.rs: HTTPS
// for any host; plain HTTP only for loopback/RFC1918/link-local IPv4 or
// IPv6 loopback; origins are bare base URLs because clients append the
// channel path. Operator-declared order is preserved as failover order.
func buildDistribution(
	input *catalogdomain.CatalogDistribution,
) (*xconfig.DistributionConfig, error) {
	if input == nil || len(input.Origins) == 0 {
		return nil, nil
	}
	if len(input.Origins) > MaxDistributionOrigins {
		return nil, ErrCatalogInvalid
	}
	seen := make(map[string]struct{}, len(input.Origins))
	origins := make([]*xconfig.DistributionOrigin, 0, len(input.Origins))
	for _, raw := range input.Origins {
		origin, err := canonicalDistributionOrigin(raw)
		if err != nil {
			return nil, err
		}
		if _, exists := seen[origin]; exists {
			return nil, ErrCatalogInvalid
		}
		seen[origin] = struct{}{}
		origins = append(origins, &xconfig.DistributionOrigin{
			Origin: origin,
		})
	}
	return &xconfig.DistributionConfig{Origins: origins}, nil
}

func canonicalDistributionOrigin(raw string) (string, error) {
	if len(raw) == 0 || len(raw) > MaxDistributionOriginCh {
		return "", ErrCatalogInvalid
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", ErrCatalogInvalid
	}
	switch parsed.Scheme {
	case "https":
		if parsed.Host == "" {
			return "", ErrCatalogInvalid
		}
	case "http":
		if !admittedPrivateHTTPHost(parsed.Hostname()) {
			return "", ErrCatalogInvalid
		}
	default:
		return "", ErrCatalogInvalid
	}
	if parsed.User != nil ||
		parsed.Path != "" ||
		parsed.RawPath != "" ||
		parsed.RawQuery != "" ||
		parsed.ForceQuery ||
		parsed.Fragment != "" ||
		strings.TrimSpace(parsed.Host) != parsed.Host {
		return "", ErrCatalogInvalid
	}
	return parsed.String(), nil
}

// admittedPrivateHTTPHost mirrors x-config-core::origin: plain HTTP is
// admitted only for IPv4 loopback/RFC1918/link-local literals or IPv6
// loopback; ULA IPv6 and DNS names stay rejected.
func admittedPrivateHTTPHost(host string) bool {
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		return v4.IsLoopback() || v4.IsPrivate() || v4.IsLinkLocalUnicast()
	}
	return ip.Equal(net.ParseIP("::1"))
}
