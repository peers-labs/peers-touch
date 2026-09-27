import type { Dispatch } from 'react';

export type SearchDemoOutcome = 'results' | 'empty' | 'error';
interface SearchTicket {
  readonly owner: string;
  readonly revision: number;
  readonly query: string;
}

export interface SearchDemoState {
  readonly owner: string | null;
  readonly revision: number;
  readonly status: 'idle' | 'loading' | SearchDemoOutcome;
  readonly ticket: SearchTicket | null;
  readonly discarded: SearchTicket | null;
}

export type SearchDemoAction =
  | { type: 'reset' }
  | { type: 'open' | 'close' | 'edit'; owner: string }
  | { type: 'submit'; owner: string; query: string }
  | { type: 'resolve'; ticket: SearchTicket; outcome: SearchDemoOutcome };

export interface SearchDemoControl {
  state: SearchDemoState;
  dispatch: Dispatch<SearchDemoAction>;
}

export const emptySearchDemo: SearchDemoState = {
  owner: null, revision: 0, status: 'idle', ticket: null, discarded: null,
};

// One current and one discarded intent, solely for explicit prototype outcomes.
export function searchDemoReducer(state: SearchDemoState, action: SearchDemoAction): SearchDemoState {
  switch (action.type) {
    case 'reset':
      return emptySearchDemo;
    case 'open':
      return {
        ...state, owner: action.owner, revision: state.revision + 1,
        status: 'idle', ticket: null, discarded: state.ticket ?? state.discarded,
      };
    case 'close':
    case 'edit':
      if (state.owner !== action.owner) return state;
      return {
        ...state, owner: action.type === 'close' ? null : state.owner,
        revision: state.revision + 1, status: 'idle', ticket: null,
        discarded: state.ticket ?? state.discarded,
      };
    case 'submit': {
      if (state.owner !== action.owner || !action.query.trim()) return state;
      const revision = state.revision + 1;
      return {
        ...state, revision, status: 'loading',
        ticket: { owner: action.owner, revision, query: action.query.trim() },
        discarded: state.ticket ?? state.discarded,
      };
    }
    case 'resolve':
      if (state.status !== 'loading' || state.ticket !== action.ticket
        || state.owner !== action.ticket.owner || state.revision !== action.ticket.revision) return state;
      return { ...state, status: action.outcome };
  }
}
