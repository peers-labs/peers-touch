package domain

import (
	"fmt"
	"sort"
	"unicode/utf16"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// MaximumMentions bounds the per-resource mention list so a request
// cannot force an O(n²) validation / fan-out cost.
const MaximumMentions = 20

// maximumMentionActorPtidLen mirrors the actor identity PTID bound used
// across the Social subserver; mentions longer than this are rejected
// before they reach persistence or the notification fan-out.
const maximumMentionActorPtidLen = 255

// ValidateTypedMentions verifies position-aware @-mentions against the
// text they annotate. Offsets and lengths are UTF-16 code unit indices
// (the wire contract shared with JS / Java / Swift clients).
//
// Rules:
//   - actor_ptid is required and bounded;
//   - offset/length stay inside the UTF-16 text and length is positive;
//   - display MUST equal the UTF-16 slice at [offset, offset+length);
//   - ranges MUST NOT overlap;
//   - the same actor MAY be mentioned at most once.
//
// On success mentions are returned sorted by offset and cloned so the
// caller can persist them without retaining request aliases.
func ValidateTypedMentions(content string, mentions []*model.Mention) ([]*model.Mention, error) {
	if len(mentions) == 0 {
		return nil, nil
	}
	if len(mentions) > MaximumMentions {
		return nil, fmt.Errorf("too many mentions: %d > %d", len(mentions), MaximumMentions)
	}

	textUnits := utf16.Encode([]rune(content))
	seenActors := make(map[string]struct{}, len(mentions))
	normalized := make([]*model.Mention, 0, len(mentions))
	for index, mention := range mentions {
		if mention == nil {
			return nil, fmt.Errorf("mention %d is nil", index)
		}
		actorPtid := mention.GetActorPtid()
		if actorPtid == "" || len(actorPtid) > maximumMentionActorPtidLen {
			return nil, fmt.Errorf("mention %d actor_ptid is required and must be <= %d chars", index, maximumMentionActorPtidLen)
		}
		if mention.GetOffset() < 0 {
			return nil, fmt.Errorf("mention %d offset must be non-negative", index)
		}
		if mention.GetLength() <= 0 {
			return nil, fmt.Errorf("mention %d length must be positive", index)
		}
		start := int(mention.GetOffset())
		end := start + int(mention.GetLength())
		if end > len(textUnits) {
			return nil, fmt.Errorf("mention %d range exceeds content length", index)
		}
		display := string(utf16.Decode(textUnits[start:end]))
		if display != mention.GetDisplay() {
			return nil, fmt.Errorf(
				"mention %d display %q does not match content range %q",
				index, mention.GetDisplay(), display,
			)
		}
		if _, duplicated := seenActors[actorPtid]; duplicated {
			return nil, fmt.Errorf("mention %d duplicates actor %s", index, actorPtid)
		}
		seenActors[actorPtid] = struct{}{}
		normalized = append(normalized, &model.Mention{
			ActorPtid: actorPtid,
			Offset:    mention.GetOffset(),
			Length:    mention.GetLength(),
			Display:   mention.GetDisplay(),
		})
	}

	sort.Slice(normalized, func(i, j int) bool {
		return normalized[i].GetOffset() < normalized[j].GetOffset()
	})
	for index := 1; index < len(normalized); index++ {
		previousEnd := normalized[index-1].GetOffset() + normalized[index-1].GetLength()
		if normalized[index].GetOffset() < previousEnd {
			return nil, fmt.Errorf("mention ranges overlap at offset %d", normalized[index].GetOffset())
		}
	}
	return normalized, nil
}

// MentionActorPTIDs returns the de-duplicated, order-stable actor PTIDs
// carried by a validated mention list.
func MentionActorPTIDs(mentions []*model.Mention) []string {
	seen := make(map[string]struct{}, len(mentions))
	ptids := make([]string, 0, len(mentions))
	for _, mention := range mentions {
		if mention == nil || mention.GetActorPtid() == "" {
			continue
		}
		if _, ok := seen[mention.GetActorPtid()]; ok {
			continue
		}
		seen[mention.GetActorPtid()] = struct{}{}
		ptids = append(ptids, mention.GetActorPtid())
	}
	return ptids
}
