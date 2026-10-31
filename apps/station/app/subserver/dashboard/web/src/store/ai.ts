import { create } from 'zustand';
import { ai, aiError, type Access, type Credential, type Install, type ModelRecord, type Policy, type Provider } from '../api/ai';
import { getAuthEpoch, onAuthChange } from '../api/client';

interface AIState {
  providers: Provider[];
  policy: Policy | null;
  selected: string;
  detail: Provider | null;
  models: ModelRecord[];
  access: Access | null;
  credential: Credential | null;
  installs: Record<string, Install>;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  select: (id: string) => Promise<void>;
  pollInstalls: () => Promise<void>;
  startInstall: (id: string) => Promise<void>;
}

let selectionRequest = 0;
let refreshRequest = 0;
let pollEpoch: number | null = null;
export const useAIStore = create<AIState>((set, get) => ({
  providers: [], policy: null, selected: '', detail: null, models: [],
  access: null, credential: null, installs: {}, loading: false, error: '',
  async refresh() {
    const request = ++refreshRequest;
    const auth = getAuthEpoch();
    set({ loading: true, error: '' });
    try {
      const [catalog, policy] = await Promise.all([ai.list(), ai.policy()]);
      if (request !== refreshRequest || auth !== getAuthEpoch()) return;
      const providers = catalog.providers || [];
      set({ providers, policy: policy.policy, loading: false });
      const id = providers.some((p) => p.id === get().selected) ? get().selected : providers[0]?.id;
      if (id) await get().select(id);
      else set({ selected: '', detail: null, models: [], access: null, credential: null });
      if (auth !== getAuthEpoch()) return;
      await get().pollInstalls();
    } catch (error) {
      if (request === refreshRequest && auth === getAuthEpoch()) set({ error: aiError(error), loading: false });
    }
  },
  async select(id) {
    const request = ++selectionRequest;
    const auth = getAuthEpoch();
    if (get().selected !== id) set({ selected: id, detail: null, models: [], access: null, credential: null, error: '' });
    else set({ error: '' });
    try {
      const [detail, models, access, credential] = await Promise.all([
        ai.get(id), ai.models(id), ai.access(id), ai.credential(id),
      ]);
      if (request !== selectionRequest || auth !== getAuthEpoch()) return;
      set({ detail: detail.provider, models: models.models || [], access: access.access, credential: credential.status });
    } catch (error) {
      if (request === selectionRequest && auth === getAuthEpoch()) set({
        detail: null, models: [], access: null, credential: null, error: aiError(error),
      });
    }
  },
  async pollInstalls() {
    const auth = getAuthEpoch();
    if (pollEpoch === auth) return;
    pollEpoch = auth;
    try {
      const entries = await Promise.all(get().providers.filter((p) => p.runtime_kind === 'cli').map(async (p) =>
        [p.id, await ai.installStatus(p.id)] as const));
      if (auth !== getAuthEpoch()) return;
      const previous = get().installs;
      const installs = Object.fromEntries(entries);
      const finished = entries.some(([id, job]) => previous[id]?.install_state === 'installing' && job.install_state === 'ready');
      set({ installs });
      if (finished) await get().refresh();
    } catch {
      // Keep real progress on transient network failures; the next poll reconciles.
    } finally { if (pollEpoch === auth) pollEpoch = null; }
  },
  async startInstall(id) {
    const auth = getAuthEpoch();
    try {
      const job = await ai.install(id);
      if (auth !== getAuthEpoch()) return;
      set((state) => ({ installs: { ...state.installs, [id]: job }, error: '' }));
      await get().pollInstalls();
    } catch (error) {
      if (auth === getAuthEpoch()) set({ error: aiError(error) });
    }
  },
}));

onAuthChange(() => {
  selectionRequest++;
  refreshRequest++;
  useAIStore.setState({
    providers: [], policy: null, selected: '', detail: null, models: [], access: null,
    credential: null, installs: {}, loading: false, error: '',
  });
});
