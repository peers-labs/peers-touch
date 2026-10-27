# EDX-B02: Find a Person and Send a Request

## Starting Context

The Desktop user is signed in. The Find People dialog can search local people
and federated handles. Zero, one, or several Federation contexts may be
available.

## User Goal

Find the intended person, understand enough identity context to trust the
choice, and send one friend request.

## Required Sources

- `apps/desktop/src/components/chat/FindPeopleModal.tsx:73-265`
- `apps/desktop/src/components/chat/FindPeopleModal.tsx:267-543`
- `docs/architecture/domains/chat/lifecycle/product-definition.md:13-58`
- `docs/architecture/platform/station/access/experience-contract.md:49-68`
- `docs/client/common/ui-identity/interaction.md:20-73`

## States To Walk

- empty query;
- local username search;
- full federated handle search;
- no Federation context;
- loading, no results, and search failure;
- friendship state loading or unavailable;
- request available, pending, complete, and failed;
- dialog close.

## Review Boundary

Review the user's search and request journey. Treat Station and Federation
metadata as useful only when it changes identity, scope, trust, or the next
action. Do not redesign Federation governance.

Return the report required by `rubric.md`.
