import { useId, useLayoutEffect, useMemo, useState } from 'react';
import { Button } from 'antd';
import copy from '../../../../../locales/en/common.json';
import type { Message } from '../types';
import type { PrototypeListMemory } from '../listPresentation';
import type { SearchDemoControl } from '../searchDemo';
import { PrototypeListWindow } from './PrototypeListWindow';

const messageKey = (message: Message) => message.id;

export function ChatHistorySearch({ messages, conversationKey, peerName, memory, searchDemo, onSelect }: {
  messages: Message[];
  conversationKey: string;
  peerName: string;
  memory: PrototypeListMemory;
  searchDemo?: SearchDemoControl;
  onSelect: (id: string) => void;
}) {
  const queryKey = `history-query:${conversationKey}`;
  const instanceId = useId();
  const owner = `${conversationKey}:${instanceId}`;
  const dispatch = searchDemo?.dispatch;
  useLayoutEffect(() => {
    dispatch?.({ type: 'open', owner });
    return () => dispatch?.({ type: 'close', owner });
  }, [dispatch, owner]);
  const [query, setQuery] = useState(() => memory.read(queryKey)?.query ?? '');
  const [submittedQuery, setSubmittedQuery] = useState(() => memory.read(queryKey)?.submittedQuery ?? '');
  const controlled = searchDemo?.state.owner === owner ? searchDemo.state : undefined;
  const resultQuery = searchDemo
    ? controlled?.status === 'results' ? controlled.ticket?.query ?? '' : ''
    : submittedQuery;
  const results = useMemo(() => {
    if (!resultQuery) return [];
    return messages.filter((message) => !message.recalled && !message.dateLabel
      && message.text?.toLowerCase().includes(resultQuery.toLowerCase())).reverse();
  }, [messages, resultQuery]);
  const status = searchDemo ? controlled?.status ?? 'idle'
    : submittedQuery ? 'results' : 'idle';

  return (
    <div className="mp-chat-details-body" data-prototype-page="history-search"
      data-demo-search-status={status}>
      <form className="mp-details-search-box mp-history-search-form" onSubmit={(event) => {
        event.preventDefault();
        const submitted = query.trim();
        if (searchDemo) {
          dispatch?.(submitted ? { type: 'submit', owner, query: submitted } : { type: 'edit', owner });
          memory.save(queryKey, { query });
        } else {
          setSubmittedQuery(submitted);
          memory.save(queryKey, { query, submittedQuery: submitted });
        }
      }}>
        <input type="search" className="mp-details-search-input"
          aria-label={copy['mobile.chat.searchMessagesPlaceholder']}
          placeholder={copy['mobile.chat.searchMessagesPlaceholder']}
          value={query} onChange={(event) => {
            setQuery(event.target.value);
            if (searchDemo) {
              dispatch?.({ type: 'edit', owner });
              memory.save(queryKey, { query: event.target.value });
            } else {
              memory.save(queryKey, { query: event.target.value, submittedQuery });
            }
          }} autoFocus />
        <button type="submit" className="mp-list-control">{copy['mobile.contacts.search']}</button>
      </form>
      <div className="mp-details-search-results" aria-busy={status === 'loading'}>
        {status === 'loading' && (
          <div className="mp-details-empty" role="status">{copy['common.state.loading']}</div>
        )}
        {status === 'error' && (
          <div className="mp-details-empty mp-history-search-error" role="alert">
            <span>{copy['mobile.chat.searchFailed']}</span>
            <Button onClick={() => {
              if (controlled?.ticket) dispatch?.({ type: 'submit', owner, query: controlled.ticket.query });
            }}>{copy['common.action.retry']}</Button>
          </div>
        )}
        {status === 'results' && (
          <PrototypeListWindow items={results} itemKey={messageKey}
            surfaceKey={`history-search:${conversationKey}:${resultQuery.toLowerCase()}`} memory={memory}>
            {(window) => window.map((message) => (
              <button key={message.id} type="button" className="mp-details-search-result-item mp-history-result"
                data-scroll-anchor-id={message.id} onClick={() => onSelect(message.id)}>
                <span className="mp-details-search-result-sender">
                  {message.mine ? copy['mobile.contacts.self'] : peerName}
                </span>
                <span className="mp-details-search-result-text">{message.text}</span>
                <span className="mp-details-search-result-time">{message.time}</span>
              </button>
            ))}
          </PrototypeListWindow>
        )}
        {status === 'idle' && (
          <div className="mp-details-empty" role="status">{copy['mobile.chat.searchMessagesPlaceholder']}</div>
        )}
        {(status === 'empty' || (status === 'results' && results.length === 0)) && (
          <div className="mp-details-empty" role="status">{copy['mobile.chat.noMessageResults']}</div>
        )}
      </div>
    </div>
  );
}
