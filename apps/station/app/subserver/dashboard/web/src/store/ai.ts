import { create } from 'zustand';
import { ai, aiError, type Access, type CLIProfileDefault, type Credential, type Install, type ModelRecord, type Policy, type Provider } from '../api/ai';
import { getAuthEpoch, onAuthChange } from '../api/client';

interface AIState {
  providers: Provider[];
  profileDefaults: CLIProfileDefault[];
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
const installRequests = new Map<string, symbol>();
export const useAIStore = create<AIState>((set, get) => ({
  providers: [], profileDefaults: [], policy: null, selected: '', detail: null, models: [],
  access: null, credential: null, installs: {}, loading: false, error: '',
  async refresh() {
    const request = ++refreshRequest;
    const auth = getAuthEpoch();
    set({ loading: true, error: '' });
    try {
      const [catalog, policy] = await Promise.all([ai.list(), ai.policy()]);
      if (request !== refreshRequest || auth !== getAuthEpoch()) return;
      const providers = catalog.providers || [];
      set({ providers, profileDefaults: catalog.cli_profile_defaults || [], policy: policy.policy, loading: false });
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
    const observed = get().installs;
    try {
      const adapters = new Set(get().providers.filter((p) => p.runtime_kind === 'cli').map((p) => p.cli_adapter_id || p.id));
      const entries = await Promise.all([...adapters].map(async (id) =>
        [id, await ai.installStatus(id)] as const));
      if (auth !== getAuthEpoch()) return;
      const previous = get().installs;
      // A read started before a click must not overwrite the pending install,
      // even when its stale "missing" response arrives after the write.
      const accepted = entries.filter(([id]) => !installRequests.has(id) && observed[id] === previous[id]);
      const installs = { ...previous, ...Object.fromEntries(accepted) };
      const finished = accepted.some(([id, job]) => previous[id]?.install_state === 'installing' && job.install_state === 'ready');
      set({ installs });
      if (finished) await get().refresh();
    } catch {
      // Keep real progress on transient network failures; the next poll reconciles.
    } finally { if (pollEpoch === auth) pollEpoch = null; }
  },
  async startInstall(id) {
    if (installRequests.has(id) || get().installs[id]?.install_state === 'installing') return;
    const request = Symbol(id);
    installRequests.set(id, request);
    const auth = getAuthEpoch();
    const previous = get().installs[id];
    const provider = get().providers.find((p) => p.id === id);
    set((state) => ({ installs: { ...state.installs, [id]: {
      install_state: 'installing', phase: 'runtime', percent: 0,
      install_supported: provider?.install_supported ?? false,
      manual_install_url: provider?.manual_install_url || '',
    } }, error: '' }));
    try {
      const job = await ai.install(id);
      if (auth !== getAuthEpoch()) return;
      installRequests.delete(id);
      set((state) => ({ installs: { ...state.installs, [id]: { ...state.installs[id], ...job } }, error: '' }));
      await get().pollInstalls();
    } catch (error) {
      if (auth === getAuthEpoch()) set((state) => ({ installs: { ...state.installs, [id]: {
        ...previous, install_state: 'failed',
        install_supported: previous?.install_supported ?? provider?.install_supported ?? false,
        manual_install_url: previous?.manual_install_url || provider?.manual_install_url || '',
      } }, error: aiError(error) }));
    } finally {
      if (installRequests.get(id) === request) installRequests.delete(id);
    }
  },
}));

onAuthChange(() => {
  selectionRequest++;
  refreshRequest++;
  installRequests.clear();
  useAIStore.setState({
    providers: [], profileDefaults: [], policy: null, selected: '', detail: null, models: [], access: null,
    credential: null, installs: {}, loading: false, error: '',
  });
});
