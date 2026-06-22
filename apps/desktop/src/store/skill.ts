import { create } from 'zustand';
import {
  skillService,
  type BuiltinSkillInfo,
  type SkillListItem,
} from '../services/skill-service';
import { resolveI18nValue } from '../i18n/index';
import { log } from '../utils/logger';
import { beginMutation, endMutation, toStoreError, type RevalidationState } from './revalidation';

interface SkillState extends RevalidationState {
  skills: SkillListItem[];
  builtins: BuiltinSkillInfo[];
  loadSkills: () => Promise<void>;
  toggleSkill: (id: string, enabled: boolean) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
}

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  builtins: [],
  loading: false,
  error: null,
  lastLoadedAt: null,
  pendingMutations: {},

  loadSkills: async () => {
    set({ loading: true, error: null });
    try {
      const data = await skillService.list();
      set({
        skills: data.skills.map((skill) => ({
          ...skill,
          name: resolveI18nValue(skill.name),
          description: resolveI18nValue(skill.description),
        })),
        builtins: data.builtin.map((skill) => ({
          ...skill,
          name: resolveI18nValue(skill.name),
          description: resolveI18nValue(skill.description),
        })),
        lastLoadedAt: Date.now(),
      });
    } catch (error) {
      const message = toStoreError(error);
      log.error('skill', 'Failed to load skills', { error: message });
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },

  toggleSkill: async (id: string, enabled: boolean) => {
    const previous = get().skills;
    const mutationKey = `toggle:${id}`;
    set((state) => ({
      skills: state.skills.map((skill) => (skill.id === id ? { ...skill, enabled } : skill)),
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      await skillService.toggle(id, enabled);
      await get().loadSkills();
    } catch (error) {
      const message = toStoreError(error);
      log.error('skill', 'Failed to toggle skill', { id, enabled, error: message });
      set({ skills: previous, error: message });
      throw error;
    } finally {
      set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },

  deleteSkill: async (id: string) => {
    const previous = get().skills;
    const mutationKey = `delete:${id}`;
    set((state) => ({
      skills: state.skills.filter((skill) => skill.id !== id),
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      await skillService.delete(id);
      await get().loadSkills();
    } catch (error) {
      const message = toStoreError(error);
      log.error('skill', 'Failed to delete skill', { id, error: message });
      set({ skills: previous, error: message });
      throw error;
    } finally {
      set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },
}));
