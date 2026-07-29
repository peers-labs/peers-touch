import type { AtelierState, Block } from './types';

export const PROTOTYPE_MESSAGE_WAITING_FOR_STATION_TEXT =
  '已追加到当前上下文，等待 Station 返回下一批 projection event。';

export function buildPrototypeMessageProjection(input: {
  state: AtelierState;
  taskId: string;
  text: string;
  now: string;
  suffix: string | number;
}): AtelierState {
  const text = input.text.trim();
  if (!text) return input.state;

  const existing = input.state.stream[input.taskId] ?? [];

  return {
    ...input.state,
    stream: {
      ...input.state.stream,
      [input.taskId]: [
        ...existing,
        prototypeMessageUserBlock(`u-${input.suffix}`, text, input.now),
        prototypeMessageAgentBlock(`a-${input.suffix}`, PROTOTYPE_MESSAGE_WAITING_FOR_STATION_TEXT, input.now),
      ],
    },
  };
}

function prototypeMessageUserBlock(id: string, text: string, at: string): Block {
  return { kind: 'user', id, text, at };
}

function prototypeMessageAgentBlock(id: string, text: string, at: string): Block {
  return { kind: 'agent', id, text, at, done: true };
}
