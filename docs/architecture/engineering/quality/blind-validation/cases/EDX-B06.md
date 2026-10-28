# EDX-B06: Search Chat History

## Starting Context

The user opens history search inside one Mobile prototype conversation. The
prototype is interaction evidence only; it is not production proof.

## User Goal

Enter a query, understand search progress and outcome, recover from failure,
and jump to the selected message.

## Required Sources

- `packages/prototypes/mobile/chat/src/components/ChatHistorySearch.tsx:11-105`
- `docs/architecture/domains/chat/lifecycle/product-definition.md:13-58`
- `docs/client/common/ui-identity/interaction.md:20-73`

## States To Walk

- search opens with no submitted query;
- query editing and submission;
- loading;
- failure and retry;
- results;
- empty result;
- result selection;
- close and reopen with remembered query.

## Review Boundary

Review the interaction and state contract demonstrated by the prototype. Do not
claim that the production message index, navigation, persistence, or native
runtime is proven.

Return the report required by `rubric.md`.
