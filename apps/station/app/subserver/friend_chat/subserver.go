package friend_chat

import (
	"context"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/infrastructure"
	notifbridge "github.com/peers-labs/peers-touch/station/app/subserver/notification"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type subServer struct {
	status     server.Status
	addrs      []string
	jwtWrapper server.Wrapper
	service    *application.Service
	repo       *infrastructure.GormRepo
	mu         sync.RWMutex
	online     map[string]int64
	pending    map[string][]pendingMessage

	// presenceMu guards `presenceSubs`. Kept separate from `mu` so an SSE
	// fan-out cannot block the chat send / online toggle paths.
	presenceMu   sync.RWMutex
	presenceSubs map[string]chan PresenceEvent // sub-id → buffered channel
}

type pendingMessage struct {
	ULID             string
	SenderDID        string
	SessionULID      string
	EncryptedPayload []byte
	CreatedAt        int64
}

// PresenceEvent is the JSON payload streamed to clients on /friend-chat/presence/stream.
//
// We deliberately use a hand-rolled struct rather than reusing the broader
// `event.Event` schema: presence is small, very frequent, and consumed by
// only the friend-chat header. Coupling it to the global event system
// would force every presence flip to traverse the outbox + broker which
// is wasteful for an in-memory ephemeral signal.
type PresenceEvent struct {
	Did     string `json:"did"`
	Online  bool   `json:"online"`
	AtUnix  int64  `json:"at"`
}

// publishPresence broadcasts a presence flip to every SSE subscriber.
// Channel sends are non-blocking — if a subscriber's buffer is full, the
// event is dropped for that subscriber (it can re-fetch /friend-chat/sessions
// to resync). This keeps a slow/disconnected client from stalling the
// online/offline path.
func (s *subServer) publishPresence(did string, online bool) {
	evt := PresenceEvent{Did: did, Online: online, AtUnix: time.Now().Unix()}
	s.presenceMu.RLock()
	for _, ch := range s.presenceSubs {
		select {
		case ch <- evt:
		default:
		}
	}
	s.presenceMu.RUnlock()
}

func (s *subServer) addPresenceSub(id string, ch chan PresenceEvent) {
	s.presenceMu.Lock()
	if s.presenceSubs == nil {
		s.presenceSubs = make(map[string]chan PresenceEvent)
	}
	s.presenceSubs[id] = ch
	s.presenceMu.Unlock()
}

func (s *subServer) removePresenceSub(id string) {
	s.presenceMu.Lock()
	delete(s.presenceSubs, id)
	s.presenceMu.Unlock()
}

func NewFriendChatSubServer(opts ...option.Option) server.Subserver {
	return &subServer{
		status: server.StatusStopped,
		addrs:  []string{},
	}
}

func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	_ = ctx
	s.status = server.StatusStarting
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	repo := infrastructure.NewGormRepo(rds)
	if err := repo.AutoMigrate(); err != nil {
		return err
	}
	s.repo = repo
	s.service = application.NewService(repo)
	s.online = make(map[string]int64)
	s.pending = make(map[string][]pendingMessage)
	return nil
}

func (s *subServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	// Wire notification bridge during Start() — notification SubServer is initialized by now.
	s.service.SetNotifier(notifbridge.NewBridge())
	now := time.Now().Unix()
	s.mu.Lock()
	for did := range s.online {
		s.online[did] = now
	}
	s.mu.Unlock()
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if s.repo != nil {
					_, _ = s.repo.DispatchOutbox(100)
				}
			}
		}
	}()
	return nil
}

func (s *subServer) Stop(ctx context.Context) error {
	_ = ctx
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string               { return "friend_chat" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *subServer) Status() server.Status { return s.status }
