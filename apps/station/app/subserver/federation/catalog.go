package federation

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"golang.org/x/time/rate"
	"google.golang.org/protobuf/proto"
)

const (
	defaultCatalogQPS             = 10
	defaultCatalogBurst           = 30
	defaultCatalogFanoutTimeout   = 800 * time.Millisecond
	defaultCatalogMaxPrefixLength = 64
	catalogLimiterIdleTTL         = 10 * time.Minute
)

type catalogConfig struct {
	Enabled         bool
	QPS             float64
	Burst           int
	FanoutTimeout   time.Duration
	MaxPageSize     int
	MaxPrefixLength int
}

type federationCatalogCaller interface {
	CallPeer(context.Context, federationruntime.PeerCall) error
	LocalStationPeerID() string
}

type catalogCoordinator struct {
	config         catalogConfig
	projection     *application.ProjectionService
	federations    domain.FederationRepository
	memberships    domain.MembershipRepository
	caller         federationCatalogCaller
	clientLimiters *catalogLimiterSet
	peerLimiters   *catalogLimiterSet
}

type catalogLimiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

type catalogLimiterSet struct {
	mu      sync.Mutex
	qps     rate.Limit
	burst   int
	entries map[string]catalogLimiterEntry
}

type catalogCursor struct {
	Handle string
	PTID   string
}

type catalogSourceTarget struct {
	peerID string
	name   string
}

type catalogSourceResult struct {
	target   catalogSourceTarget
	response *pb.FederationCatalogSearchResponse
	outcome  pb.FederationCatalogSourceOutcome
}

func (s *subServer) SearchLocalFederationCatalog(
	ctx context.Context,
	sourceStationPeerID string,
	request *pb.FederationCatalogSearchRequest,
) (*pb.FederationCatalogSearchResponse, error) {
	if s == nil || s.catalog == nil {
		return nil, server.NewHandlerError(
			503,
			"Federation catalog is unavailable",
		)
	}
	return s.catalog.SearchLocalForPeer(ctx, sourceStationPeerID, request)
}

func catalogConfigFromEnvironment() catalogConfig {
	config := catalogConfig{
		Enabled:         true,
		QPS:             defaultCatalogQPS,
		Burst:           defaultCatalogBurst,
		FanoutTimeout:   defaultCatalogFanoutTimeout,
		MaxPageSize:     maxCatalogPageSize,
		MaxPrefixLength: defaultCatalogMaxPrefixLength,
	}
	config.Enabled = catalogBoolEnvironment(
		"PEERS_FEDERATION_CATALOG_ENABLED",
		config.Enabled,
	)
	config.QPS = catalogFloatEnvironment(
		"PEERS_FEDERATION_CATALOG_QPS",
		config.QPS,
		1,
		500,
	)
	config.Burst = catalogIntEnvironment(
		"PEERS_FEDERATION_CATALOG_BURST",
		config.Burst,
		1,
		500,
	)
	timeoutMS := catalogIntEnvironment(
		"PEERS_FEDERATION_CATALOG_FANOUT_TIMEOUT_MS",
		int(config.FanoutTimeout/time.Millisecond),
		100,
		5000,
	)
	config.FanoutTimeout = time.Duration(timeoutMS) * time.Millisecond
	config.MaxPageSize = catalogIntEnvironment(
		"PEERS_FEDERATION_CATALOG_MAX_PAGE_SIZE",
		config.MaxPageSize,
		1,
		200,
	)
	config.MaxPrefixLength = catalogIntEnvironment(
		"PEERS_FEDERATION_CATALOG_MAX_PREFIX_CHARS",
		config.MaxPrefixLength,
		1,
		256,
	)
	return config
}

func newCatalogCoordinator(
	config catalogConfig,
	projection *application.ProjectionService,
	federations domain.FederationRepository,
	memberships domain.MembershipRepository,
	caller federationCatalogCaller,
) *catalogCoordinator {
	return &catalogCoordinator{
		config:         config,
		projection:     projection,
		federations:    federations,
		memberships:    memberships,
		caller:         caller,
		clientLimiters: newCatalogLimiterSet(config.QPS, config.Burst),
		peerLimiters:   newCatalogLimiterSet(config.QPS, config.Burst),
	}
}

func newCatalogLimiterSet(qps float64, burst int) *catalogLimiterSet {
	return &catalogLimiterSet{
		qps:     rate.Limit(qps),
		burst:   burst,
		entries: make(map[string]catalogLimiterEntry),
	}
}

func (s *catalogLimiterSet) Allow(key string) bool {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	for existingKey, entry := range s.entries {
		if now.Sub(entry.lastSeen) > catalogLimiterIdleTTL {
			delete(s.entries, existingKey)
		}
	}
	entry, ok := s.entries[key]
	if !ok {
		entry.limiter = rate.NewLimiter(s.qps, s.burst)
	}
	entry.lastSeen = now
	s.entries[key] = entry
	return entry.limiter.Allow()
}

func (c *catalogCoordinator) Search(
	ctx context.Context,
	subjectPTID string,
	request *pb.FederationCatalogSearchRequest,
) (*pb.FederationCatalogSearchResponse, error) {
	normalized, err := c.normalizeRequest(request)
	if err != nil {
		return nil, err
	}
	if !c.clientLimiters.Allow("actor:" + strings.TrimSpace(subjectPTID)) {
		return nil, server.NewHandlerError(429, "Federation catalog rate limit exceeded")
	}
	activeFederation, err := c.isActiveFederation(ctx, normalized.FederationId)
	if err != nil {
		return nil, server.InternalErrorWithCause(
			"inspect Federation catalog lifecycle",
			err,
		)
	}
	if !activeFederation {
		return nil, server.Forbidden("Federation catalog is not active")
	}
	localStationPeerID := strings.TrimSpace(c.caller.LocalStationPeerID())
	if localStationPeerID == "" {
		return nil, server.InternalError("local Station peer identity unavailable")
	}
	active, err := c.isActiveMember(
		ctx,
		normalized.FederationId,
		localStationPeerID,
	)
	if err != nil {
		return nil, server.InternalErrorWithCause(
			"inspect local Federation membership",
			err,
		)
	}
	if !active {
		return nil, server.Forbidden(
			"local Station is not an active member of the Federation",
		)
	}

	members, err := c.projection.ListMemberStations(
		ctx,
		normalized.FederationId,
	)
	if err != nil {
		return nil, server.InternalErrorWithCause(
			"list Federation catalog sources",
			err,
		)
	}
	targets := make([]catalogSourceTarget, 0, len(members.Stations))
	for _, member := range members.Stations {
		if member == nil || member.Status != "active" {
			continue
		}
		if normalized.StationId != "" &&
			member.StationPeerId != normalized.StationId {
			continue
		}
		targets = append(targets, catalogSourceTarget{
			peerID: member.StationPeerId,
			name:   member.StationName,
		})
	}
	if normalized.StationId != "" && len(targets) == 0 {
		return nil, server.BadRequest(
			"station_id is not an active member of the Federation",
		)
	}
	sort.Slice(targets, func(i, j int) bool {
		return targets[i].peerID < targets[j].peerID
	})

	results := make(chan catalogSourceResult, len(targets))
	var wait sync.WaitGroup
	for _, target := range targets {
		target := target
		wait.Add(1)
		go func() {
			defer wait.Done()
			if target.peerID == localStationPeerID {
				response := c.searchLocal(normalized, target)
				results <- catalogSourceResult{
					target:   target,
					response: response,
					outcome:  catalogResponseOutcome(response),
				}
				return
			}
			response, outcome := c.searchRemote(
				ctx,
				subjectPTID,
				localStationPeerID,
				target,
				normalized,
			)
			results <- catalogSourceResult{
				target:   target,
				response: response,
				outcome:  outcome,
			}
		}()
	}
	wait.Wait()
	close(results)

	return aggregateCatalogResults(
		localStationPeerID,
		normalized,
		results,
	), nil
}

func (c *catalogCoordinator) SearchLocalForPeer(
	ctx context.Context,
	sourceStationPeerID string,
	request *pb.FederationCatalogSearchRequest,
) (*pb.FederationCatalogSearchResponse, error) {
	normalized, err := c.normalizeRequest(request)
	if err != nil {
		return nil, err
	}
	localStationPeerID := strings.TrimSpace(c.caller.LocalStationPeerID())
	if normalized.StationId != "" &&
		normalized.StationId != localStationPeerID {
		return nil, server.BadRequest(
			"station_id does not match the target Station",
		)
	}
	activeFederation, err := c.isActiveFederation(ctx, normalized.FederationId)
	if err != nil {
		return nil, server.InternalErrorWithCause(
			"inspect Federation catalog lifecycle",
			err,
		)
	}
	if !activeFederation {
		return nil, server.Forbidden("Federation catalog is not active")
	}
	for _, stationPeerID := range []string{
		strings.TrimSpace(sourceStationPeerID),
		localStationPeerID,
	} {
		active, membershipErr := c.isActiveMember(
			ctx,
			normalized.FederationId,
			stationPeerID,
		)
		if membershipErr != nil {
			return nil, server.InternalErrorWithCause(
				"inspect Federation catalog membership",
				membershipErr,
			)
		}
		if !active {
			return nil, server.Forbidden(
				"catalog source and target must be active Federation members",
			)
		}
	}
	target := catalogSourceTarget{
		peerID: localStationPeerID,
	}
	localMembership, err := c.memberships.GetByStation(
		ctx,
		normalized.FederationId,
		localStationPeerID,
	)
	if err != nil {
		return nil, server.InternalErrorWithCause(
			"load local Federation catalog membership",
			err,
		)
	}
	if localMembership != nil {
		target.name = localMembership.StationName
	}
	if !c.config.Enabled {
		return catalogSourceResponse(
			target,
			pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_DISABLED,
			false,
		), nil
	}
	if !c.peerLimiters.Allow("station:" + strings.TrimSpace(sourceStationPeerID)) {
		return catalogSourceResponse(
			target,
			pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_RATE_LIMITED,
			true,
		), nil
	}
	return c.searchLocal(normalized, target), nil
}

func (c *catalogCoordinator) searchRemote(
	ctx context.Context,
	subjectPTID string,
	localStationPeerID string,
	target catalogSourceTarget,
	request *pb.FederationCatalogSearchRequest,
) (*pb.FederationCatalogSearchResponse, pb.FederationCatalogSourceOutcome) {
	peerRequest := proto.Clone(request).(*pb.FederationCatalogSearchRequest)
	peerRequest.StationId = target.peerID
	requestSHA256, err := catalogRequestSHA256(peerRequest)
	if err != nil {
		return nil, pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_UNAVAILABLE
	}
	response := &pb.FederationCatalogSearchResponse{}
	callContext, cancel := context.WithTimeout(ctx, c.config.FanoutTimeout)
	defer cancel()
	err = c.caller.CallPeer(callContext, federationruntime.PeerCall{
		TargetStationPeerID: target.peerID,
		Route:               federationruntime.PeerRouteFederationCatalogSearch,
		Subject:             strings.TrimSpace(subjectPTID),
		Claims: map[string]string{
			federationruntime.ClaimFederationID:         normalizedFederationID(peerRequest),
			federationruntime.ClaimCatalogRequestSHA256: requestSHA256,
			federationruntime.ClaimSourceStationPeerID:  localStationPeerID,
			federationruntime.ClaimTargetStationPeerID:  target.peerID,
		},
		Request:  peerRequest,
		Response: response,
	})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) ||
			errors.Is(callContext.Err(), context.DeadlineExceeded) {
			return nil, pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_TIMEOUT
		}
		return nil, pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_UNAVAILABLE
	}
	return response, catalogResponseOutcome(response)
}

func (c *catalogCoordinator) searchLocal(
	request *pb.FederationCatalogSearchRequest,
	target catalogSourceTarget,
) *pb.FederationCatalogSearchResponse {
	if !c.config.Enabled {
		return catalogSourceResponse(
			target,
			pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_DISABLED,
			false,
		)
	}
	cursor, _ := decodeCatalogCursor(request.PageToken)
	actors, total, hasMore := touchactor.SearchFederationCatalog(
		touchactor.FederationCatalogQuery{
			FederationID: request.FederationId,
			Prefix:       request.Prefix,
			RegionPrefix: request.Region,
			AfterHandle:  cursor.Handle,
			AfterPTID:    cursor.PTID,
			Limit:        int(request.PageSize),
		},
	)
	response := &pb.FederationCatalogSearchResponse{
		Entries:               make([]*pb.FederationCatalogEntry, 0, len(actors)),
		TotalCount:            total,
		LocalDirectoryEnabled: true,
		Sources: []*pb.FederationCatalogSource{{
			StationPeerId: target.peerID,
			StationName:   target.name,
			Outcome:       pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_OK,
			ResultCount:   uint32(len(actors)),
		}},
	}
	for i := range actors {
		response.Entries = append(response.Entries, &pb.FederationCatalogEntry{
			ActorPtid:         actors[i].ActorPTID,
			FederatedHandle:   actors[i].FederatedHandle,
			DisplayName:       actors[i].DisplayName,
			AvatarUrl:         actors[i].AvatarURL,
			HomeStationPeerId: actors[i].HomeStationPeerID,
			HomeStationName:   target.name,
			Visibility:        "indexed",
		})
	}
	if hasMore && len(response.Entries) > 0 {
		last := response.Entries[len(response.Entries)-1]
		response.NextPageToken = encodeCatalogCursor(catalogCursor{
			Handle: last.FederatedHandle,
			PTID:   last.ActorPtid,
		})
	}
	return response
}

func (c *catalogCoordinator) normalizeRequest(
	request *pb.FederationCatalogSearchRequest,
) (*pb.FederationCatalogSearchRequest, error) {
	if request == nil {
		return nil, server.BadRequest("catalog request is required")
	}
	normalized := proto.Clone(request).(*pb.FederationCatalogSearchRequest)
	normalized.FederationId = normalizedFederationID(normalized)
	normalized.Prefix = strings.TrimSpace(normalized.Prefix)
	normalized.Locale = strings.TrimSpace(normalized.Locale)
	normalized.Region = strings.TrimSpace(normalized.Region)
	normalized.PageToken = strings.TrimSpace(normalized.PageToken)
	normalized.StationId = strings.TrimSpace(normalized.StationId)
	if normalized.FederationId == "" {
		return nil, server.BadRequest("federation_id is required")
	}
	if normalized.Prefix == "" {
		return nil, server.BadRequest("prefix is required for catalog search")
	}
	if utf8.RuneCountInString(normalized.Prefix) > c.config.MaxPrefixLength {
		return nil, server.BadRequest("catalog prefix exceeds the configured limit")
	}
	if normalized.Locale != "" {
		return nil, server.BadRequest("locale filtering is not supported")
	}
	if _, err := decodeCatalogCursor(normalized.PageToken); err != nil {
		return nil, server.BadRequest("catalog page_token is invalid")
	}
	pageSize := int(normalized.PageSize)
	if pageSize <= 0 {
		pageSize = defaultCatalogPageSize
	}
	if pageSize > c.config.MaxPageSize {
		pageSize = c.config.MaxPageSize
	}
	normalized.PageSize = uint32(pageSize)
	return normalized, nil
}

func (c *catalogCoordinator) isActiveMember(
	ctx context.Context,
	federationID string,
	stationPeerID string,
) (bool, error) {
	if c == nil || c.memberships == nil || stationPeerID == "" {
		return false, nil
	}
	record, err := c.memberships.GetByStation(ctx, federationID, stationPeerID)
	return record != nil && record.Status == "active", err
}

func (c *catalogCoordinator) isActiveFederation(
	ctx context.Context,
	federationID string,
) (bool, error) {
	if c == nil || c.federations == nil || federationID == "" {
		return false, nil
	}
	record, err := c.federations.GetByID(ctx, federationID)
	return record != nil && record.Status == "active", err
}

func aggregateCatalogResults(
	localStationPeerID string,
	request *pb.FederationCatalogSearchRequest,
	results <-chan catalogSourceResult,
) *pb.FederationCatalogSearchResponse {
	response := &pb.FederationCatalogSearchResponse{}
	entriesByPTID := make(map[string]*pb.FederationCatalogEntry)
	hasMore := false
	sourceResults := make([]catalogSourceResult, 0, cap(results))
	for result := range results {
		sourceResults = append(sourceResults, result)
	}
	sort.Slice(sourceResults, func(i, j int) bool {
		return sourceResults[i].target.peerID < sourceResults[j].target.peerID
	})
	for _, result := range sourceResults {
		source := &pb.FederationCatalogSource{
			StationPeerId: result.target.peerID,
			StationName:   result.target.name,
			Outcome:       result.outcome,
		}
		if result.response != nil {
			response.TotalCount += result.response.TotalCount
			if result.response.NextPageToken != "" {
				hasMore = true
			}
			if result.target.peerID == localStationPeerID {
				response.LocalDirectoryEnabled =
					result.response.LocalDirectoryEnabled
			}
			for _, entry := range result.response.Entries {
				if entry == nil ||
					strings.TrimSpace(entry.ActorPtid) == "" ||
					strings.TrimSpace(entry.HomeStationPeerId) !=
						result.target.peerID {
					continue
				}
				if _, exists := entriesByPTID[entry.ActorPtid]; !exists {
					entriesByPTID[entry.ActorPtid] = entry
				}
				source.ResultCount++
			}
		}
		if result.outcome !=
			pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_OK {
			response.Partial = true
		}
		response.Sources = append(response.Sources, source)
	}
	sort.Slice(response.Sources, func(i, j int) bool {
		return response.Sources[i].StationPeerId <
			response.Sources[j].StationPeerId
	})
	response.Entries = make([]*pb.FederationCatalogEntry, 0, len(entriesByPTID))
	for _, entry := range entriesByPTID {
		response.Entries = append(response.Entries, entry)
	}
	sort.Slice(response.Entries, func(i, j int) bool {
		left := catalogEntrySortKey(response.Entries[i])
		right := catalogEntrySortKey(response.Entries[j])
		if left != right {
			return left < right
		}
		return response.Entries[i].ActorPtid < response.Entries[j].ActorPtid
	})
	pageSize := int(request.PageSize)
	if len(response.Entries) > pageSize {
		response.Entries = response.Entries[:pageSize]
		hasMore = true
	}
	if !response.Partial && hasMore && len(response.Entries) > 0 {
		last := response.Entries[len(response.Entries)-1]
		response.NextPageToken = encodeCatalogCursor(catalogCursor{
			Handle: last.FederatedHandle,
			PTID:   last.ActorPtid,
		})
	}
	return response
}

func catalogSourceResponse(
	target catalogSourceTarget,
	outcome pb.FederationCatalogSourceOutcome,
	enabled bool,
) *pb.FederationCatalogSearchResponse {
	return &pb.FederationCatalogSearchResponse{
		LocalDirectoryEnabled: enabled,
		Partial:               outcome != pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_OK,
		Sources: []*pb.FederationCatalogSource{{
			StationPeerId: target.peerID,
			StationName:   target.name,
			Outcome:       outcome,
		}},
	}
}

func catalogResponseOutcome(
	response *pb.FederationCatalogSearchResponse,
) pb.FederationCatalogSourceOutcome {
	if response == nil || len(response.Sources) != 1 {
		return pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_UNAVAILABLE
	}
	outcome := response.Sources[0].Outcome
	if outcome ==
		pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_UNSPECIFIED {
		return pb.FederationCatalogSourceOutcome_FEDERATION_CATALOG_SOURCE_OUTCOME_UNAVAILABLE
	}
	return outcome
}

func catalogRequestSHA256(request *pb.FederationCatalogSearchRequest) (string, error) {
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func encodeCatalogCursor(cursor catalogCursor) string {
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&pb.FederationCatalogCursor{
			FederatedHandle: cursor.Handle,
			ActorPtid:       cursor.PTID,
		},
	)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeCatalogCursor(value string) (catalogCursor, error) {
	if value == "" {
		return catalogCursor{}, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return catalogCursor{}, err
	}
	wire := &pb.FederationCatalogCursor{}
	if err := proto.Unmarshal(payload, wire); err != nil {
		return catalogCursor{}, err
	}
	cursor := catalogCursor{
		Handle: wire.FederatedHandle,
		PTID:   wire.ActorPtid,
	}
	if cursor.Handle == "" || cursor.PTID == "" {
		return catalogCursor{}, errors.New("catalog cursor is incomplete")
	}
	return cursor, nil
}

func catalogEntrySortKey(entry *pb.FederationCatalogEntry) string {
	if entry == nil {
		return ""
	}
	return strings.ToLower(strings.TrimPrefix(
		strings.TrimSpace(entry.FederatedHandle),
		"@",
	))
}

func normalizedFederationID(request *pb.FederationCatalogSearchRequest) string {
	if request == nil {
		return ""
	}
	return strings.TrimSpace(request.FederationId)
}

func catalogBoolEnvironment(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func catalogIntEnvironment(key string, fallback, minimum, maximum int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil || value < minimum || value > maximum {
		return fallback
	}
	return value
}

func catalogFloatEnvironment(
	key string,
	fallback float64,
	minimum float64,
	maximum float64,
) float64 {
	value, err := strconv.ParseFloat(strings.TrimSpace(os.Getenv(key)), 64)
	if err != nil || value < minimum || value > maximum {
		return fallback
	}
	return value
}
