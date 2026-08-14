export const TEST_ACCOUNTS = {
  alice: {
    email: 'alice@p.t',
    password: 'Test1234!',
    name: 'Alice two',
    role: 'primary-sender',
  },
  bob: {
    email: 'bob@p.t',
    password: 'Test1234!',
    name: 'Bob two',
    role: 'primary-receiver',
  },
  carol: {
    email: 'carol@p.t',
    password: 'Test1234!',
    name: 'Carol two',
    role: 'group-member',
  },
} as const;

export type AccountName = keyof typeof TEST_ACCOUNTS;
export type TestAccount = (typeof TEST_ACCOUNTS)[AccountName];
