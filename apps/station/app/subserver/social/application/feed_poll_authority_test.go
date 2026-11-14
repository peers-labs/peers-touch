package application

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

type pollIdentityFixture map[string]*feedIdentityFixture

func (i pollIdentityFixture) ResolveActorHomeStationPeerID(ctx context.Context, actor string) (string, error) {
	return i[actor].ResolveActorHomeStationPeerID(ctx, actor)
}
func (i pollIdentityFixture) ResolveRetainedActorIdentityPublicKey(ctx context.Context, tx delivery.Transaction, actor string) ([]byte, error) {
	return i[actor].ResolveRetainedActorIdentityPublicKey(ctx, tx, actor)
}
func (i pollIdentityFixture) ResolveVerifiedActorDeviceSigningKey(ctx context.Context, tx delivery.Transaction, actor, home, device, key string) (*model.VerifiedActorDeviceSigningKey, error) {
	return i[actor].ResolveVerifiedActorDeviceSigningKey(ctx, tx, actor, home, device, key)
}

type pollSignerFixture struct {
	privateContentTestSigner
	signatures int
}

func (s *pollSignerFixture) SignInTransaction(ctx context.Context, tx delivery.Transaction, key string, wire []byte) ([]byte, error) {
	s.signatures++
	return s.privateContentTestSigner.SignInTransaction(ctx, tx, key, wire)
}

type pollAuthorityFixture struct {
	service    *FeedLogService
	database   *gorm.DB
	identities pollIdentityFixture
	author     *model.FeedBundle
	voter      *model.FeedBundle
	signer     *pollSignerFixture
	now        time.Time
	definition *model.FeedPollDefinition
}

func newPollAuthorityFixture(t *testing.T) *pollAuthorityFixture {
	t.Helper()
	s, database, authorIdentity, request := feedServiceFixture(t)
	f := &pollAuthorityFixture{service: s, database: database, author: request.Bundle,
		now: time.Now().UTC(), identities: pollIdentityFixture{authorIdentity.key.ActorPtid: authorIdentity}}
	f.voter = proto.Clone(f.author).(*model.FeedBundle)
	root := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{3}, 32))
	writer := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{4}, 32))
	f.voter.Genesis.Statement.ActorPtid = "ptid:test:bob"
	f.voter.Genesis.Statement.ActorIdentityPublicKey = root.Public().(ed25519.PublicKey)
	wire, _ := signedlog.SigningBytes(domain.FeedGenesisDomain, f.voter.Genesis.Statement)
	f.voter.Genesis.ActorSignature = ed25519.Sign(root, wire)
	grant := f.voter.WriterGrant.Statement
	grant.ActorPtid, grant.DeviceId, grant.SigningKeyId = "ptid:test:bob", "bob-device", "bob-key"
	grant.DevicePublicKey = writer.Public().(ed25519.PublicKey)
	grant.GenesisHash, _ = signedlog.Hash(domain.FeedGenesisDomain, f.voter.Genesis)
	wire, _ = signedlog.SigningBytes(domain.FeedGrantDomain, grant)
	f.voter.WriterGrant.ActorSignature = ed25519.Sign(root, wire)
	f.identities[grant.ActorPtid] = &feedIdentityFixture{home: "station-b", root: root.Public().(ed25519.PublicKey),
		key: &model.VerifiedActorDeviceSigningKey{ActorPtid: grant.ActorPtid, ActorDeviceId: grant.DeviceId,
			HomeStationPeerId: "station-b", SigningKeyId: grant.SigningKeyId, Ed25519PublicKey: grant.DevicePublicKey,
			ValidFromUnixMs: 1, VerificationSource: model.ActorSigningKeyVerificationSource(1)}}
	s.actors, s.now = f.identities, func() time.Time { return f.now }
	s.SetProjector(infrastructure.NewFeedProjector("station-a"))
	s.SetWritePolicy(NewFeedWritePolicy())
	f.signer = &pollSignerFixture{privateContentTestSigner: privateContentTestSigner{
		stationID: "station-a", keyID: "author-home-key",
		privateKey: ed25519.NewKeyFromSeed(bytes.Repeat([]byte{7}, 32)),
	}}
	if err := s.ConfigurePollAuthority(f.signer, func(ctx context.Context, tx delivery.Transaction, home, key string, wire, signature []byte) error {
		if home != "station-a" {
			return domain.ErrFeedSignature
		}
		return f.signer.VerifyInTransaction(ctx, tx, key, wire, signature)
	}); err != nil {
		t.Fatal(err)
	}
	s.signer = feedTransportSigner{}
	if err := database.AutoMigrate(&db.Actor{}, &db.SocialPublicPost{}, &db.SocialComment{}, &db.SocialStationModerationPolicy{}); err != nil {
		t.Fatal(err)
	}
	if err := infrastructure.MigrateIdentitySchema(database); err != nil {
		t.Fatal(err)
	}
	for n, actor := range []string{f.author.Genesis.Statement.ActorPtid, grant.ActorPtid} {
		name := []string{"alice", "bob"}[n]
		if err := database.Create(&db.Actor{ID: uint64(n + 1), PTID: actor, PreferredUsername: name,
			Email: name + "@example.test", FederatedHandle: "@" + name + "@example.test"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	repository, err := delivery.NewGORMRepository(database, delivery.SystemClock{})
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	poll := &model.CreatePollPostRequest{Text: "A public poll", Question: "Which route?",
		Options: []string{"Direct", "Relay"}, DurationHours: 1}
	f.definition, err = domain.FeedPollDefinitionFor(poll, f.now.UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	post, _ := signedlog.Canonical(&model.CreatePostRequest{Type: model.PostType_POLL,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content:  &model.CreatePostRequest_Poll{Poll: poll}})
	f.author.Events = []*model.FeedEvent{f.event(t, f.author, 2, 1, model.FeedEventKind_FEED_EVENT_KIND_POST_CREATED,
		&model.FeedPayload{Mutation: &model.FeedPayload_Post{Post: &model.FeedPostMutation{PostId: "101", CreateRequest: post}}})}
	return f
}

func (f *pollAuthorityFixture) event(t *testing.T, bundle *model.FeedBundle, seed byte, sequence uint64, kind model.FeedEventKind, payload *model.FeedPayload) *model.FeedEvent {
	t.Helper()
	wire, err := signedlog.Canonical(payload)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(wire)
	previous, _ := signedlog.Hash(domain.FeedGenesisDomain, bundle.Genesis)
	if sequence > 1 {
		previous, _ = domain.FeedEventHash(bundle.Events[len(bundle.Events)-1])
	}
	grantHash, _ := signedlog.Hash(domain.FeedGrantDomain, bundle.WriterGrant)
	event := &model.FeedEvent{Statement: &model.FeedEventStatement{FormatVersion: 1,
		ActorPtid: bundle.Genesis.Statement.ActorPtid, ChainId: domain.PublicFeedChainID,
		Sequence: sequence, PreviousHash: previous, WriterGrantHash: grantHash, Kind: kind,
		PayloadHash: digest[:], CreatedAtUnixMs: f.now.UnixMilli()}, Payload: wire}
	input, _ := signedlog.SigningBytes(domain.FeedEventDomain, event.Statement)
	event.DeviceSignature = ed25519.Sign(ed25519.NewKeyFromSeed(bytes.Repeat([]byte{seed}, 32)), input)
	if err := domain.VerifyFeedEvent(event, bundle.WriterGrant); err != nil {
		t.Fatal(err)
	}
	return event
}

func (f *pollAuthorityFixture) create(t *testing.T) {
	t.Helper()
	w := f.author.WriterGrant.Statement
	if _, err := f.service.Submit(context.Background(), w.ActorPtid, w.DeviceId, &model.SubmitFeedEventRequest{Bundle: f.author}); err != nil {
		t.Fatal(err)
	}
}

func (f *pollAuthorityFixture) ballot(t *testing.T, bundle *model.FeedBundle, sequence uint64, choices ...int32) *model.FeedInteraction {
	t.Helper()
	hash, _ := domain.FeedPollDefinitionHash(f.definition)
	seed := byte(4)
	if bundle == f.author {
		seed = 2
	}
	event := f.event(t, bundle, seed, sequence, model.FeedEventKind_FEED_EVENT_KIND_POLL_BALLOT_SET,
		&model.FeedPayload{Mutation: &model.FeedPayload_PollBallot{PollBallot: &model.FeedPollBallotMutation{
			TargetPostRef: "oss://station-a/post/101", DefinitionHash: hash, OptionIndices: choices}}})
	bundle.Events = []*model.FeedEvent{event}
	return &model.FeedInteraction{Genesis: bundle.Genesis, WriterGrant: bundle.WriterGrant, Event: event}
}

func (f *pollAuthorityFixture) receive(t *testing.T, receipt *model.FeedInteraction) error {
	t.Helper()
	return f.service.store.Execute(context.Background(), func(tx delivery.Transaction) error {
		result, err := f.service.receiveInteraction(context.Background(), tx, receipt,
			&delivery.Frame{SourceStationPeerId: "station-b", TargetStationPeerId: "station-a"})
		if err == nil && result.Disposition == delivery.DispositionTerminal {
			return domain.ErrFeedInvalid
		}
		return err
	})
}

func (f *pollAuthorityFixture) row(t *testing.T, receipt *model.FeedInteraction) infrastructure.FeedInteractionRecord {
	t.Helper()
	var row infrastructure.FeedInteractionRecord
	if err := f.database.Where("actor_ptid = ? AND sequence = ?", receipt.Event.Statement.ActorPtid,
		receipt.Event.Statement.Sequence).Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	return row
}

func TestFeedPollExactRetryPreservesAdmissionAfterCutoff(t *testing.T) {
	f := newPollAuthorityFixture(t)
	f.create(t)
	receipt := f.ballot(t, f.author, 2, 0)
	submit := func() *model.SubmitFeedEventResponse {
		t.Helper()
		w := f.author.WriterGrant.Statement
		response, err := f.service.Submit(context.Background(), w.ActorPtid, w.DeviceId, &model.SubmitFeedEventRequest{Bundle: f.author})
		if err != nil {
			t.Fatal(err)
		}
		return response
	}
	first := submit()
	if len(first.PollAdmissions) != 1 || first.PollAdmissions[0].Statement.Result != model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_ACCEPTED {
		t.Fatal("local ballot lacks its verified Home decision")
	}
	f.now = f.now.Add(2 * time.Hour)
	retry := submit()
	if !retry.Duplicate || len(retry.PollAdmissions) != 1 ||
		!proto.Equal(first.PollAdmissions[0], retry.PollAdmissions[0]) || f.signer.signatures != 1 {
		t.Fatal("exact retry changed the accepted decision after cutoff")
	}
	receipt.PollAdmission = first.PollAdmissions[0]
	identity := f.identities[f.author.Genesis.Statement.ActorPtid]
	identity.root = bytes.Repeat([]byte{9}, 32)
	if err := f.service.store.Execute(context.Background(), func(tx delivery.Transaction) error {
		return f.service.verifyPollAdmission(infrastructure.FeedTransactionContext(context.Background(), tx), tx.DB(), receipt)
	}); !errors.Is(err, domain.ErrFeedWriter) {
		t.Fatal("creation index or device grant replaced independent author root", err)
	}
}

func TestFeedPollDelayedParentReplacementAndRejectedSupplement(t *testing.T) {
	f := newPollAuthorityFixture(t)
	first := f.ballot(t, f.voter, 1, 0)
	if err := f.receive(t, first); err != nil {
		t.Fatal(err)
	}
	row := f.row(t, first)
	var threads int64
	f.database.Model(&infrastructure.FeedThreadRecord{}).Count(&threads)
	if row.Projected || len(row.PollAdmission) != 0 || threads != 0 || f.signer.signatures != 0 {
		t.Fatal("unavailable parent exposed an unadmitted ballot")
	}
	f.create(t)
	if err := f.service.store.ProcessInteractions(context.Background(), f.service.projector,
		f.service.verifyStoredInteraction, f.service.forwardInteraction, f.service.returnPollAdmission); err != nil {
		t.Fatal(err)
	}
	row = f.row(t, first)
	if !row.Projected || !row.AdmissionReturnRequired || len(row.PollAdmission) == 0 {
		t.Fatal("retained ballot was not admitted after original parent arrived")
	}
	forged := proto.Clone(first).(*model.FeedInteraction)
	forged.PollAdmission = &model.FeedPollAdmission{}
	if err := signedlog.Decode(row.PollAdmission, forged.PollAdmission); err != nil {
		t.Fatal(err)
	}
	input, _ := domain.FeedPollAdmissionSigningBytes(forged.PollAdmission.Statement)
	forged.PollAdmission.StationSignature = ed25519.Sign(ed25519.NewKeyFromSeed(bytes.Repeat([]byte{8}, 32)), input)
	if err := f.service.store.Execute(context.Background(), func(tx delivery.Transaction) error {
		return f.service.verifyPollAdmission(infrastructure.FeedTransactionContext(context.Background(), tx), tx.DB(), forged)
	}); !errors.Is(err, domain.ErrFeedSignature) {
		t.Fatal("supplement verifier accepted a foreign Home signature", err)
	}
	if err := f.receive(t, forged); !errors.Is(err, domain.ErrFeedInvalid) {
		t.Fatal("changed or foreign Home signature accepted", err)
	}
	if !bytes.Equal(f.row(t, first).PollAdmission, row.PollAdmission) {
		t.Fatal("invalid supplement poisoned retained authentic decision")
	}
	second := f.ballot(t, f.voter, 2, 1)
	if err := f.receive(t, second); err != nil {
		t.Fatal(err)
	}
	if err := f.receive(t, first); err != nil {
		t.Fatal(err)
	}
	rejected := f.ballot(t, f.voter, 3, 0, 1)
	if err := f.receive(t, rejected); err != nil {
		t.Fatal(err)
	}
	var versions []infrastructure.FeedPollVersion
	if err := f.database.Find(&versions).Error; err != nil || len(versions) != 1 ||
		versions[0].Sequence != 2 || versions[0].Selections != "[1]" {
		t.Fatal("replay, replacement or rejection changed the unique accepted selection", versions, err)
	}
	f.now = f.now.Add(2 * time.Hour)
	if err := f.receive(t, f.ballot(t, f.voter, 4, 0)); err != nil {
		t.Fatal(err)
	}
	if err := f.database.Find(&versions).Error; err != nil || versions[0].Sequence != 2 {
		t.Fatal("closed poll replaced accepted ballot", err)
	}
}

func TestFeedPollReturnRemainsPendingAfterProjectionAndForwarding(t *testing.T) {
	f := newPollAuthorityFixture(t)
	f.create(t)
	receipt := f.ballot(t, f.voter, 1, 0)
	if err := f.receive(t, receipt); err != nil {
		t.Fatal(err)
	}
	pump := func() infrastructure.FeedInteractionRecord {
		t.Helper()
		f.database.Model(&infrastructure.FeedInteractionRecord{}).Where("actor_ptid = ?", receipt.Event.Statement.ActorPtid).
			Update("next_attempt_at", time.Time{})
		err := f.service.store.ProcessInteractions(context.Background(), f.service.projector,
			f.service.verifyStoredInteraction, func(context.Context, delivery.Transaction, string, *model.FeedInteraction) error {
				t.Fatal("completed forwarding was attempted again")
				return nil
			}, f.service.returnPollAdmission)
		if err != nil {
			t.Fatal(err)
		}
		return f.row(t, receipt)
	}
	row := pump()
	admission := append([]byte(nil), row.PollAdmission...)
	first := row.AdmissionFrameID
	if !row.Projected || !row.Forwarded || row.AdmissionReturned || first == "" || row.AdmissionDeliveryRevision != 1 {
		t.Fatal("projection or enqueue incorrectly completed return delivery")
	}
	row = pump()
	if row.AdmissionFrameID != first || row.AdmissionDeliveryRevision != 1 {
		t.Fatal("pending return was replaced")
	}
	f.now = f.now.Add(25 * time.Hour)
	row = pump()
	if row.AdmissionFrameID == first || row.AdmissionDeliveryRevision != 2 ||
		!bytes.Equal(row.PollAdmission, admission) || f.signer.signatures != 1 {
		t.Fatal("expired transport failed to renew or changed original admission")
	}
	if err := f.database.Model(&delivery.OutboxRecord{}).Where("frame_id = ?", row.AdmissionFrameID).
		Update("state", delivery.OutboxStateDelivered).Error; err != nil {
		t.Fatal(err)
	}
	row = pump()
	if !row.AdmissionReturned || row.AdmissionDeliveryRevision != 2 {
		t.Fatal("verified delivered return ACK was not retained")
	}
}
