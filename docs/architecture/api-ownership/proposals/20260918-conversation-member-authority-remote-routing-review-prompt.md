# AO-D10A Remote Routing Review Prompt

Review:

`docs/architecture/api-ownership/proposals/20260918-conversation-member-authority-remote-routing-amendment.md`

## Review Boundary

Determine whether AO-D10A closes the cross-Station member-authority trust and
delivery gap without changing AO-D10 business semantics or creating another
owner.

## Required Questions

1. Does the evidence prove that the current canonical handlers work only when
   the connected Home Station is also the authority Station?
2. Is generalizing `ConversationCommandProposal` preferable to a new
   member-authority-only forwarding protocol?
3. Does the proposed signature bind the exact
   `ConversationMemberAuthorityCommand`, actor device, Federation, Home
   Station, authority Station/epoch, command kind, hash, and expiry?
4. Can field `1` of both AO-D10 request messages remain wire-compatible while
   adding a signed proposal submission?
5. Does Home Station forwarding remain durable and return only
   `accepted_for_forwarding`, never committed success?
6. Can the authority map the proposal through `MapMemberAuthorityCommand` and
   the existing `SubmitForwarded` UOW without duplicating authorization logic?
7. Does admitting `KindMemberAuthority` preserve exact replay, stable failure
   codes, and command-result integrity?
8. Does the Device Messaging Engine need a generalized durable command payload
   envelope, and can it reuse the existing command tables without split truth?
9. Is ordered `member_authority_committed` projection still the only path to
   `projected` completion?
10. Are direct remote bearer use, unsigned forwarding, optimistic UI patches,
    Group aliases, synchronous fallback, and second result stores all
    explicitly forbidden?
11. Do the source gates cover stale head/epoch, missing/revoked keys, signature
    mismatch, exact replay, command conflict, authority outage, restart, and
    event/command contradiction?
12. Does the two-Station runtime scenario prove that a newly transferred remote
    owner can perform a later member-authority mutation?

## Verdict

Return one:

- `ACCEPTED`: AO-D10A.1 through AO-D10A.6 may become implementation authority.
- `REVISION_REQUIRED`: list blocking contract or trust-boundary corrections.
- `REJECTED`: state the replacement architecture boundary.

No implementation or Plan advancement is authorized by a partial review.
