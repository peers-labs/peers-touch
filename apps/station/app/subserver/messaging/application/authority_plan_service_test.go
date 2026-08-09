package application_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPrepareGroupGenesisReservesKeyPackagesWithoutPublishingConversation(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&touchactor.ActorIdentityRecord{},
		&touchactor.DeviceRecord{},
	); err != nil {
		t.Fatal(err)
	}
	uow, err := infrastructure.NewAuthorityUnitOfWork(
		db,
		messaging.QueueLimits{MaxUnackedItems: 100, MaxUnackedBytes: 1024 * 1024},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := uow.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 789).UTC()
	service, err := application.NewAuthorityPlanService(
		uow,
		"station-local",
		application.AuthorityPlanPolicy{ReservationTTL: 5 * time.Minute},
		func() time.Time { return now },
	)
	if err != nil {
		t.Fatal(err)
	}

	for index, ptid := range []string{"alice", "bob"} {
		publicKey := bytes.Repeat([]byte{byte(index + 1)}, 32)
		fingerprint := sha256.Sum256(publicKey)
		if err := db.Create(&touchactor.ActorIdentityRecord{
			PTID:           ptid,
			PublicKey:      publicKey,
			Fingerprint:    fingerprint[:],
			ProfileVersion: 1,
			CreatedAt:      now,
			UpdatedAt:      now,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	devices := []touchactor.DeviceRecord{
		planVerifiedDevice("alice", "alice-1", now),
		planVerifiedDevice("bob", "bob-1", now),
		planVerifiedDevice("bob", "bob-2", now),
	}
	if err := db.Create(&devices).Error; err != nil {
		t.Fatal(err)
	}
	for index, deviceID := range []string{"bob-1", "bob-2"} {
		data := []byte("key-package-" + deviceID)
		hash := sha256.Sum256(data)
		if err := db.Create(&infrastructure.MlsKeyPackageModel{
			PTID:       "bob",
			DeviceID:   deviceID,
			StationID:  "station-local",
			Data:       data,
			DataSHA256: hash[:],
			CreatedAt:  now.Add(time.Duration(index) * time.Second),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}

	response, err := service.PrepareGroupGenesis(
		context.Background(),
		&chat.PrepareMessagingGroupGenesisRequest{
			ConversationId: "group-1",
			Name:           "Alice and Bob",
			MemberPtids:    []string{"bob"},
			Creator: &chat.CryptoEndpoint{
				Ptid:     "alice",
				DeviceId: "alice-1",
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.AuthorityPlanId == "" ||
		response.AuthorityStationId != "station-local" ||
		len(response.AuthorityPlanSha256) != sha256.Size ||
		len(response.ProspectiveEndpoints) != 3 ||
		len(response.ReservedKeyPackages) != 2 {
		t.Fatalf("group genesis plan = %+v", response)
	}
	if response.ExpiresAt.AsTime().Nanosecond()%1_000 != 0 {
		t.Fatalf("group genesis expiry is not PostgreSQL-safe: %s", response.ExpiresAt.AsTime())
	}

	for name, model := range map[string]any{
		"conversations": &infrastructure.AuthorityConversationModel{},
		"events":        &infrastructure.AuthorityEventModel{},
		"queue":         &infrastructure.DeviceQueueItemModel{},
	} {
		var count int64
		if err := db.Model(model).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s count = %d, want 0 before genesis commit", name, count)
		}
	}
	var planCount, reservedCount int64
	if err := db.Model(&infrastructure.AuthorityPlanModel{}).Count(&planCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&infrastructure.MlsKeyPackageModel{}).
		Where("reserved_plan_id = ?", response.AuthorityPlanId).
		Count(&reservedCount).Error; err != nil {
		t.Fatal(err)
	}
	if planCount != 1 || reservedCount != 2 {
		t.Fatalf("plan count = %d, reserved KeyPackages = %d", planCount, reservedCount)
	}

	authority, err := application.NewAuthorityService(uow, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	commit := []byte("opaque RFC9420 commit")
	commitHash := sha256.Sum256(commit)
	welcome := []byte("opaque RFC9420 welcome")
	welcomeHash := sha256.Sum256(welcome)
	changes := make([]*chat.MessagingMembershipChangeIntent, 0, len(response.ProspectiveEndpoints))
	welcomes := make([]*chat.PreparedEndpointPayload, 0, len(response.ProspectiveEndpoints)-1)
	seenActors := make(map[string]struct{})
	for _, endpoint := range response.ProspectiveEndpoints {
		action := chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_DEVICE
		if _, ok := seenActors[endpoint.Ptid]; !ok {
			action = chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR
			seenActors[endpoint.Ptid] = struct{}{}
		}
		changes = append(changes, &chat.MessagingMembershipChangeIntent{
			Action:   action,
			Ptid:     endpoint.Ptid,
			DeviceId: endpoint.DeviceId,
			Role:     "member",
		})
		if endpoint.Ptid == "alice" && endpoint.DeviceId == "alice-1" {
			continue
		}
		welcomes = append(welcomes, &chat.PreparedEndpointPayload{
			Recipient:     endpoint,
			Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_WELCOME,
			OpaquePayload: welcome,
			PayloadSha256: welcomeHash[:],
		})
	}
	command := &chat.ChatCommand{
		CommandId:               "genesis-command",
		ConversationId:          "group-1",
		Sender:                  response.ProspectiveEndpoints[0],
		ObservedMembershipEpoch: 0,
		ObservedMlsEpoch:        0,
		ClientTimestamp:         timestamppb.New(now),
		DeliveryPlanSha256:      response.AuthorityPlanSha256,
		Payload: &chat.ChatCommand_MembershipTransition{
			MembershipTransition: &chat.MembershipTransitionIntent{
				TransitionId:        "transition-1",
				FromMembershipEpoch: 0,
				FromMlsEpoch:        0,
				ToMlsEpoch:          1,
				Changes:             changes,
				MlsCommit:           commit,
				MlsCommitSha256:     commitHash[:],
				WelcomePayloads:     welcomes,
				AuthorityPlanId:     response.AuthorityPlanId,
				AuthorityPlanSha256: response.AuthorityPlanSha256,
			},
		},
	}
	event, err := authority.Submit(context.Background(), command)
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := authority.Submit(context.Background(), command)
	if err != nil {
		t.Fatal(err)
	}
	if event.Sequence != 2 ||
		event.MembershipEpoch != 1 ||
		event.MlsEpoch != 1 ||
		replayed.EventId != event.EventId {
		t.Fatalf("genesis events: first=%+v replay=%+v", event, replayed)
	}
	var conversation infrastructure.AuthorityConversationModel
	if err := db.First(&conversation, "conversation_id = ?", "group-1").Error; err != nil {
		t.Fatal(err)
	}
	if conversation.CurrentSequence != 2 ||
		conversation.MembershipEpoch != 1 ||
		conversation.MlsEpoch != 1 {
		t.Fatalf("group authority state = %+v", conversation)
	}
	var eventCount, queueCount, packageCount int64
	if err := db.Model(&infrastructure.AuthorityEventModel{}).Count(&eventCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&infrastructure.DeviceQueueItemModel{}).Count(&queueCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&infrastructure.MlsKeyPackageModel{}).Count(&packageCount).Error; err != nil {
		t.Fatal(err)
	}
	if eventCount != 2 || queueCount != 6 || packageCount != 0 {
		t.Fatalf(
			"atomic genesis counts: events=%d queue=%d packages=%d",
			eventCount,
			queueCount,
			packageCount,
		)
	}
	var consumedPlan infrastructure.AuthorityPlanModel
	if err := db.First(&consumedPlan, "plan_id = ?", response.AuthorityPlanId).Error; err != nil {
		t.Fatal(err)
	}
	if consumedPlan.State != string(messaging.AuthorityPlanStateConsumed) {
		t.Fatalf("authority plan state = %s", consumedPlan.State)
	}

	carolPublicKey := bytes.Repeat([]byte{3}, 32)
	carolFingerprint := sha256.Sum256(carolPublicKey)
	if err := db.Create(&touchactor.ActorIdentityRecord{
		PTID:           "carol",
		PublicKey:      carolPublicKey,
		Fingerprint:    carolFingerprint[:],
		ProfileVersion: 1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	carolDevice := planVerifiedDevice("carol", "carol-1", now)
	if err := db.Create(&carolDevice).Error; err != nil {
		t.Fatal(err)
	}
	carolKeyPackage := []byte("key-package-carol-1")
	carolKeyPackageHash := sha256.Sum256(carolKeyPackage)
	if err := db.Create(&infrastructure.MlsKeyPackageModel{
		PTID:       "carol",
		DeviceID:   "carol-1",
		StationID:  "station-local",
		Data:       carolKeyPackage,
		DataSHA256: carolKeyPackageHash[:],
		CreatedAt:  now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	transitionPlan, err := service.PrepareMembershipTransition(
		context.Background(),
		&chat.PrepareMessagingMembershipTransitionRequest{
			ConversationId: "group-1",
			Sender:         response.ProspectiveEndpoints[0],
			Action:         chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR,
			TargetPtid:     "carol",
			Role:           "member",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if transitionPlan.AuthoritySequence != 2 ||
		transitionPlan.FromMembershipEpoch != 1 ||
		transitionPlan.FromMlsEpoch != 1 ||
		len(transitionPlan.AuthorityHash) != sha256.Size ||
		len(transitionPlan.PreEndpoints) != 3 ||
		len(transitionPlan.PostEndpoints) != 4 ||
		len(transitionPlan.AddedEndpoints) != 1 ||
		transitionPlan.AddedEndpoints[0].Ptid != "carol" ||
		transitionPlan.AddedEndpoints[0].DeviceId != "carol-1" ||
		len(transitionPlan.RemovedEndpoints) != 0 ||
		len(transitionPlan.ReservedKeyPackages) != 1 ||
		transitionPlan.ReservedKeyPackages[0].Target.Ptid != "carol" ||
		len(transitionPlan.AuthorityPlanSha256) != sha256.Size {
		t.Fatalf("membership transition plan = %+v", transitionPlan)
	}
	if err := db.First(&conversation, "conversation_id = ?", "group-1").Error; err != nil {
		t.Fatal(err)
	}
	if conversation.CurrentSequence != 2 ||
		conversation.MembershipEpoch != 1 ||
		conversation.MlsEpoch != 1 {
		t.Fatalf("prepare mutated authority state = %+v", conversation)
	}
	var carolMemberCount int64
	if err := db.Model(&infrastructure.AuthorityMemberModel{}).
		Where("conversation_id = ? AND ptid = ?", "group-1", "carol").
		Count(&carolMemberCount).Error; err != nil {
		t.Fatal(err)
	}
	if carolMemberCount != 0 {
		t.Fatalf("prepare published Carol membership rows = %d", carolMemberCount)
	}

	carolWelcome := []byte("opaque RFC9420 welcome for Carol")
	carolWelcomeHash := sha256.Sum256(carolWelcome)
	addCommit := []byte("opaque RFC9420 add Carol commit")
	addCommitHash := sha256.Sum256(addCommit)
	addCommand := &chat.ChatCommand{
		CommandId:               "add-carol-command",
		ConversationId:          "group-1",
		Sender:                  response.ProspectiveEndpoints[0],
		ObservedMembershipEpoch: transitionPlan.FromMembershipEpoch,
		ObservedMlsEpoch:        transitionPlan.FromMlsEpoch,
		ClientTimestamp:         timestamppb.New(now),
		DeliveryPlanSha256:      transitionPlan.AuthorityPlanSha256,
		Payload: &chat.ChatCommand_MembershipTransition{
			MembershipTransition: &chat.MembershipTransitionIntent{
				TransitionId:        "add-carol-transition",
				FromMembershipEpoch: transitionPlan.FromMembershipEpoch,
				FromMlsEpoch:        transitionPlan.FromMlsEpoch,
				ToMlsEpoch:          transitionPlan.FromMlsEpoch + 1,
				Changes: []*chat.MessagingMembershipChangeIntent{{
					Action:   chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR,
					Ptid:     "carol",
					DeviceId: "carol-1",
					Role:     "member",
				}},
				MlsCommit:       addCommit,
				MlsCommitSha256: addCommitHash[:],
				WelcomePayloads: []*chat.PreparedEndpointPayload{{
					Recipient:     transitionPlan.AddedEndpoints[0],
					Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_WELCOME,
					OpaquePayload: carolWelcome,
					PayloadSha256: carolWelcomeHash[:],
				}},
				AuthorityPlanId:     transitionPlan.AuthorityPlanId,
				AuthorityPlanSha256: transitionPlan.AuthorityPlanSha256,
			},
		},
	}
	addEvent, err := authority.Submit(context.Background(), addCommand)
	if err != nil {
		t.Fatal(err)
	}
	addReplay, err := authority.Submit(context.Background(), addCommand)
	if err != nil {
		t.Fatal(err)
	}
	if addEvent.Sequence != 3 ||
		addEvent.MembershipEpoch != 2 ||
		addEvent.MlsEpoch != 2 ||
		addReplay.EventId != addEvent.EventId {
		t.Fatalf("add actor events: first=%+v replay=%+v", addEvent, addReplay)
	}
	carolMember, err := infrastructure.NewAuthorityRepository(db).GetMember(
		context.Background(),
		"group-1",
		"carol",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !carolMember.Active || carolMember.Role != "member" {
		t.Fatalf("Carol membership = %+v", carolMember)
	}
	if err := db.Model(&infrastructure.DeviceQueueItemModel{}).Count(&queueCount).Error; err != nil {
		t.Fatal(err)
	}
	if queueCount != 10 {
		t.Fatalf("queue items after add actor = %d, want 10", queueCount)
	}
	var carolDeliveryModel infrastructure.DeviceQueueItemModel
	if err := db.Where(
		"conversation_id = ? AND event_id = ? AND recipient_ptid = ?",
		"group-1",
		addEvent.EventId,
		"carol",
	).First(&carolDeliveryModel).Error; err != nil {
		t.Fatal(err)
	}
	var carolDelivery chat.DeviceEventDelivery
	if err := proto.Unmarshal(carolDeliveryModel.OpaquePayload, &carolDelivery); err != nil {
		t.Fatal(err)
	}
	var carolWrapped chat.MlsQueuePayload
	if err := proto.Unmarshal(carolDelivery.EndpointPayload, &carolWrapped); err != nil {
		t.Fatal(err)
	}
	if carolDelivery.PayloadKind != chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_WELCOME ||
		carolWrapped.Kind != chat.MlsQueuePayloadKind_MLS_QUEUE_PAYLOAD_KIND_WELCOME ||
		carolWrapped.ToMembershipEpoch != 2 ||
		carolWrapped.ToMlsEpoch != 2 ||
		!bytes.Equal(carolWrapped.OpaqueMlsBytes, carolWelcome) {
		t.Fatalf("Carol Welcome delivery = %+v %+v", carolDelivery, carolWrapped)
	}

	removePlan, err := service.PrepareMembershipTransition(
		context.Background(),
		&chat.PrepareMessagingMembershipTransitionRequest{
			ConversationId: "group-1",
			Sender:         response.ProspectiveEndpoints[0],
			Action:         chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_ACTOR,
			TargetPtid:     "carol",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if removePlan.AuthoritySequence != 3 ||
		removePlan.FromMembershipEpoch != 2 ||
		removePlan.FromMlsEpoch != 2 ||
		len(removePlan.PreEndpoints) != 4 ||
		len(removePlan.PostEndpoints) != 3 ||
		len(removePlan.AddedEndpoints) != 0 ||
		len(removePlan.RemovedEndpoints) != 1 ||
		removePlan.RemovedEndpoints[0].Ptid != "carol" ||
		len(removePlan.ReservedKeyPackages) != 0 {
		t.Fatalf("remove actor plan = %+v", removePlan)
	}
	removeCommit := []byte("opaque RFC9420 remove Carol commit")
	removeCommitHash := sha256.Sum256(removeCommit)
	removeCommand := &chat.ChatCommand{
		CommandId:               "remove-carol-command",
		ConversationId:          "group-1",
		Sender:                  response.ProspectiveEndpoints[0],
		ObservedMembershipEpoch: removePlan.FromMembershipEpoch,
		ObservedMlsEpoch:        removePlan.FromMlsEpoch,
		ClientTimestamp:         timestamppb.New(now),
		DeliveryPlanSha256:      removePlan.AuthorityPlanSha256,
		Payload: &chat.ChatCommand_MembershipTransition{
			MembershipTransition: &chat.MembershipTransitionIntent{
				TransitionId:        "remove-carol-transition",
				FromMembershipEpoch: removePlan.FromMembershipEpoch,
				FromMlsEpoch:        removePlan.FromMlsEpoch,
				ToMlsEpoch:          removePlan.FromMlsEpoch + 1,
				Changes: []*chat.MessagingMembershipChangeIntent{{
					Action:   chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_ACTOR,
					Ptid:     "carol",
					DeviceId: "carol-1",
				}},
				MlsCommit:           removeCommit,
				MlsCommitSha256:     removeCommitHash[:],
				AuthorityPlanId:     removePlan.AuthorityPlanId,
				AuthorityPlanSha256: removePlan.AuthorityPlanSha256,
			},
		},
	}
	removeEvent, err := authority.Submit(context.Background(), removeCommand)
	if err != nil {
		t.Fatal(err)
	}
	removeReplay, err := authority.Submit(context.Background(), removeCommand)
	if err != nil {
		t.Fatal(err)
	}
	if removeEvent.Sequence != 4 ||
		removeEvent.MembershipEpoch != 3 ||
		removeEvent.MlsEpoch != 3 ||
		removeReplay.EventId != removeEvent.EventId {
		t.Fatalf("remove actor events: first=%+v replay=%+v", removeEvent, removeReplay)
	}
	carolMember, err = infrastructure.NewAuthorityRepository(db).GetMember(
		context.Background(),
		"group-1",
		"carol",
	)
	if err != nil {
		t.Fatal(err)
	}
	if carolMember.Active {
		t.Fatalf("Carol membership remains active: %+v", carolMember)
	}
	if err := db.Model(&infrastructure.DeviceQueueItemModel{}).Count(&queueCount).Error; err != nil {
		t.Fatal(err)
	}
	if queueCount != 14 {
		t.Fatalf("queue items after remove actor = %d, want 14", queueCount)
	}
	carolDeliveryModel = infrastructure.DeviceQueueItemModel{}
	if err := db.Where(
		"conversation_id = ? AND event_id = ? AND recipient_ptid = ?",
		"group-1",
		removeEvent.EventId,
		"carol",
	).First(&carolDeliveryModel).Error; err != nil {
		t.Fatal(err)
	}
	if err := proto.Unmarshal(carolDeliveryModel.OpaquePayload, &carolDelivery); err != nil {
		t.Fatal(err)
	}
	if carolDelivery.PayloadKind != chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT ||
		carolDelivery.GetEvent().GetMembershipTransitionCommitted() == nil {
		t.Fatalf("Carol keyless removal delivery = %+v", carolDelivery)
	}

	bobThirdDevice := planVerifiedDevice("bob", "bob-3", now)
	if err := db.Create(&bobThirdDevice).Error; err != nil {
		t.Fatal(err)
	}
	bobThirdKeyPackage := []byte("key-package-bob-3")
	bobThirdKeyPackageHash := sha256.Sum256(bobThirdKeyPackage)
	if err := db.Create(&infrastructure.MlsKeyPackageModel{
		PTID:       "bob",
		DeviceID:   "bob-3",
		StationID:  "station-local",
		Data:       bobThirdKeyPackage,
		DataSHA256: bobThirdKeyPackageHash[:],
		CreatedAt:  now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	addDevicePlan, err := service.PrepareMembershipTransition(
		context.Background(),
		&chat.PrepareMessagingMembershipTransitionRequest{
			ConversationId: "group-1",
			Sender:         response.ProspectiveEndpoints[0],
			Action:         chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_DEVICE,
			TargetPtid:     "bob",
			TargetDeviceId: "bob-3",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if addDevicePlan.AuthoritySequence != 4 ||
		addDevicePlan.FromMembershipEpoch != 3 ||
		addDevicePlan.FromMlsEpoch != 3 ||
		len(addDevicePlan.PreEndpoints) != 3 ||
		len(addDevicePlan.PostEndpoints) != 4 ||
		len(addDevicePlan.AddedEndpoints) != 1 ||
		addDevicePlan.AddedEndpoints[0].DeviceId != "bob-3" ||
		len(addDevicePlan.RemovedEndpoints) != 0 ||
		len(addDevicePlan.ReservedKeyPackages) != 1 {
		t.Fatalf("add device plan = %+v", addDevicePlan)
	}
	addDeviceWelcome := []byte("opaque RFC9420 Welcome for bob-3")
	addDeviceWelcomeHash := sha256.Sum256(addDeviceWelcome)
	addDeviceCommit := []byte("opaque RFC9420 add bob-3 commit")
	addDeviceCommitHash := sha256.Sum256(addDeviceCommit)
	addDeviceCommand := membershipTransitionCommand(
		"add-bob-device-command",
		"add-bob-device-transition",
		response.ProspectiveEndpoints[0],
		addDevicePlan,
		chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_DEVICE,
		"bob",
		"bob-3",
		addDeviceCommit,
		addDeviceCommitHash[:],
		[]*chat.PreparedEndpointPayload{{
			Recipient:     addDevicePlan.AddedEndpoints[0],
			Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_WELCOME,
			OpaquePayload: addDeviceWelcome,
			PayloadSha256: addDeviceWelcomeHash[:],
		}},
		now,
	)
	addDeviceEvent, err := authority.Submit(context.Background(), addDeviceCommand)
	if err != nil {
		t.Fatal(err)
	}
	if replay, err := authority.Submit(context.Background(), addDeviceCommand); err != nil ||
		replay.EventId != addDeviceEvent.EventId {
		t.Fatalf("add device replay = %+v, err=%v", replay, err)
	}
	if addDeviceEvent.Sequence != 5 ||
		addDeviceEvent.MembershipEpoch != 4 ||
		addDeviceEvent.MlsEpoch != 4 {
		t.Fatalf("add device event = %+v", addDeviceEvent)
	}
	var bobThirdLeaf infrastructure.AuthorityMemberDeviceModel
	if err := db.First(
		&bobThirdLeaf,
		"conversation_id = ? AND ptid = ? AND device_id = ?",
		"group-1",
		"bob",
		"bob-3",
	).Error; err != nil {
		t.Fatal(err)
	}
	if !bobThirdLeaf.Active || bobThirdLeaf.JoinedSequence != 5 {
		t.Fatalf("Bob third leaf = %+v", bobThirdLeaf)
	}
	if err := db.Model(&infrastructure.DeviceQueueItemModel{}).Count(&queueCount).Error; err != nil {
		t.Fatal(err)
	}
	if queueCount != 18 {
		t.Fatalf("queue items after add device = %d, want 18", queueCount)
	}

	removeDevicePlan, err := service.PrepareMembershipTransition(
		context.Background(),
		&chat.PrepareMessagingMembershipTransitionRequest{
			ConversationId: "group-1",
			Sender:         response.ProspectiveEndpoints[0],
			Action:         chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_DEVICE,
			TargetPtid:     "bob",
			TargetDeviceId: "bob-3",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if removeDevicePlan.AuthoritySequence != 5 ||
		removeDevicePlan.FromMembershipEpoch != 4 ||
		removeDevicePlan.FromMlsEpoch != 4 ||
		len(removeDevicePlan.PreEndpoints) != 4 ||
		len(removeDevicePlan.PostEndpoints) != 3 ||
		len(removeDevicePlan.AddedEndpoints) != 0 ||
		len(removeDevicePlan.RemovedEndpoints) != 1 ||
		removeDevicePlan.RemovedEndpoints[0].DeviceId != "bob-3" ||
		len(removeDevicePlan.ReservedKeyPackages) != 0 {
		t.Fatalf("remove device plan = %+v", removeDevicePlan)
	}
	removeDeviceCommit := []byte("opaque RFC9420 remove bob-3 commit")
	removeDeviceCommitHash := sha256.Sum256(removeDeviceCommit)
	removeDeviceCommand := membershipTransitionCommand(
		"remove-bob-device-command",
		"remove-bob-device-transition",
		response.ProspectiveEndpoints[0],
		removeDevicePlan,
		chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_DEVICE,
		"bob",
		"bob-3",
		removeDeviceCommit,
		removeDeviceCommitHash[:],
		nil,
		now,
	)
	removeDeviceEvent, err := authority.Submit(context.Background(), removeDeviceCommand)
	if err != nil {
		t.Fatal(err)
	}
	if replay, err := authority.Submit(context.Background(), removeDeviceCommand); err != nil ||
		replay.EventId != removeDeviceEvent.EventId {
		t.Fatalf("remove device replay = %+v, err=%v", replay, err)
	}
	if removeDeviceEvent.Sequence != 6 ||
		removeDeviceEvent.MembershipEpoch != 5 ||
		removeDeviceEvent.MlsEpoch != 5 {
		t.Fatalf("remove device event = %+v", removeDeviceEvent)
	}
	bobThirdLeaf = infrastructure.AuthorityMemberDeviceModel{}
	if err := db.First(
		&bobThirdLeaf,
		"conversation_id = ? AND ptid = ? AND device_id = ?",
		"group-1",
		"bob",
		"bob-3",
	).Error; err != nil {
		t.Fatal(err)
	}
	if bobThirdLeaf.Active || bobThirdLeaf.LeftSequence != 6 {
		t.Fatalf("removed Bob third leaf = %+v", bobThirdLeaf)
	}
	bobMember, err := infrastructure.NewAuthorityRepository(db).GetMember(
		context.Background(),
		"group-1",
		"bob",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !bobMember.Active {
		t.Fatalf("Bob actor membership was removed with one device: %+v", bobMember)
	}
	if err := db.Model(&infrastructure.DeviceQueueItemModel{}).Count(&queueCount).Error; err != nil {
		t.Fatal(err)
	}
	if queueCount != 22 {
		t.Fatalf("queue items after remove device = %d, want 22", queueCount)
	}
}

func membershipTransitionCommand(
	commandID string,
	transitionID string,
	sender *chat.CryptoEndpoint,
	plan *chat.PrepareMessagingMembershipTransitionResponse,
	action chat.MessagingMembershipAction,
	targetPTID string,
	targetDeviceID string,
	commit []byte,
	commitHash []byte,
	welcomes []*chat.PreparedEndpointPayload,
	now time.Time,
) *chat.ChatCommand {
	return &chat.ChatCommand{
		CommandId:               commandID,
		ConversationId:          "group-1",
		Sender:                  sender,
		ObservedMembershipEpoch: plan.FromMembershipEpoch,
		ObservedMlsEpoch:        plan.FromMlsEpoch,
		ClientTimestamp:         timestamppb.New(now),
		DeliveryPlanSha256:      plan.AuthorityPlanSha256,
		Payload: &chat.ChatCommand_MembershipTransition{
			MembershipTransition: &chat.MembershipTransitionIntent{
				TransitionId:        transitionID,
				FromMembershipEpoch: plan.FromMembershipEpoch,
				FromMlsEpoch:        plan.FromMlsEpoch,
				ToMlsEpoch:          plan.FromMlsEpoch + 1,
				Changes: []*chat.MessagingMembershipChangeIntent{{
					Action:   action,
					Ptid:     targetPTID,
					DeviceId: targetDeviceID,
				}},
				MlsCommit:           commit,
				MlsCommitSha256:     commitHash,
				WelcomePayloads:     welcomes,
				AuthorityPlanId:     plan.AuthorityPlanId,
				AuthorityPlanSha256: plan.AuthorityPlanSha256,
			},
		},
	}
}

func planVerifiedDevice(
	ptid string,
	deviceID string,
	createdAt time.Time,
) touchactor.DeviceRecord {
	return touchactor.DeviceRecord{
		Ptid:               ptid,
		DeviceID:           deviceID,
		HomeStationPeerID:  "station-local",
		SigningKeyID:       "key:" + deviceID,
		PublicKey:          bytes.Repeat([]byte{1}, 32),
		ProfileVersion:     1,
		VerificationSource: int32(actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION),
		CreatedAt:          createdAt,
	}
}
