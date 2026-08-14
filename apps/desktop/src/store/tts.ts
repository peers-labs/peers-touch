/**
 * TTS (Text-to-Speech) store — manages speech synthesis state using the Web Speech API.
 *
 * Responsibilities:
 * - Speak/pause/resume/stop text for a given message
 * - Track which message is currently being read aloud
 * - Persist user preferences (voice, rate, pitch, volume) to localStorage
 * - Load available system voices
 *
 * P4-M2: v1 implementation using browser-native speechSynthesis.
 */

import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';

// ── Constants ──

const STORAGE_KEY = 'peers-tts-preferences';

const DEFAULT_RATE = 1.0;
const DEFAULT_PITCH = 1.0;
const DEFAULT_VOLUME = 1.0;
const MIN_RATE = 0.5;
const MAX_RATE = 2.0;
const MIN_PITCH = 0;
const MAX_PITCH = 2;
const MIN_VOLUME = 0;
const MAX_VOLUME = 1;

// ── Types ──

interface TTSPreferences {
  voice: string;
  rate: number;
  pitch: number;
  volume: number;
}

interface TTSState {
  speaking: boolean;
  paused: boolean;
  currentMessageId: string | null;
  voice: string;
  rate: number;
  pitch: number;
  volume: number;
  availableVoices: SpeechSynthesisVoice[];
}

interface TTSActions {
  speak: (messageId: string, text: string) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  setVoice: (voiceName: string) => void;
  setRate: (rate: number) => void;
  setPitch: (pitch: number) => void;
  setVolume: (volume: number) => void;
  loadVoices: () => void;
}

type TTSStore = TTSState & TTSActions;

// ── Persistence helpers ──

function loadPreferences(): TTSPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TTSPreferences>;
      return {
        voice: typeof parsed.voice === 'string' ? parsed.voice : '',
        rate: clampRate(typeof parsed.rate === 'number' ? parsed.rate : DEFAULT_RATE),
        pitch: clampPitch(typeof parsed.pitch === 'number' ? parsed.pitch : DEFAULT_PITCH),
        volume: clampVolume(typeof parsed.volume === 'number' ? parsed.volume : DEFAULT_VOLUME),
      };
    }
  } catch {
    log.warn('tts', 'Failed to load TTS preferences from localStorage');
  }
  return { voice: '', rate: DEFAULT_RATE, pitch: DEFAULT_PITCH, volume: DEFAULT_VOLUME };
}

function savePreferences(prefs: TTSPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    log.warn('tts', 'Failed to save TTS preferences to localStorage');
  }
}

// ── Clamping utilities ──

function clampRate(v: number): number {
  return Math.max(MIN_RATE, Math.min(MAX_RATE, v));
}

function clampPitch(v: number): number {
  return Math.max(MIN_PITCH, Math.min(MAX_PITCH, v));
}

function clampVolume(v: number): number {
  return Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, v));
}

// ── Synthesis access ──

function getSynthesis(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis ?? null;
}

// ── Store ──

const prefs = loadPreferences();

export const useTTSStore = createDesktopStore<TTSStore>('tts', (set, get) => ({
  // State
  speaking: false,
  paused: false,
  currentMessageId: null,
  voice: prefs.voice,
  rate: prefs.rate,
  pitch: prefs.pitch,
  volume: prefs.volume,
  availableVoices: [],

  // Actions

  speak: (messageId: string, text: string) => {
    const synthesis = getSynthesis();
    if (!synthesis) {
      log.warn('tts', 'SpeechSynthesis API not available');
      return;
    }

    const state = get();

    // Toggle: if same message is speaking, stop it
    if (state.currentMessageId === messageId && state.speaking) {
      synthesis.cancel();
      set({ speaking: false, paused: false, currentMessageId: null });
      return;
    }

    // Cancel any ongoing speech before starting new
    synthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = state.rate;
    utterance.pitch = state.pitch;
    utterance.volume = state.volume;

    // Resolve voice by name
    if (state.voice) {
      const voices = synthesis.getVoices();
      const match = voices.find((v) => v.name === state.voice);
      if (match) {
        utterance.voice = match;
      }
    }

    utterance.onend = () => {
      set({ speaking: false, paused: false, currentMessageId: null });
    };

    utterance.onerror = (event) => {
      // 'canceled' is expected when user stops manually
      if (event.error !== 'canceled') {
        log.error('tts', 'Speech synthesis error', { error: event.error, messageId });
      }
      set({ speaking: false, paused: false, currentMessageId: null });
    };

    set({ speaking: true, paused: false, currentMessageId: messageId });
    synthesis.speak(utterance);
  },

  stop: () => {
    const synthesis = getSynthesis();
    if (synthesis) {
      synthesis.cancel();
    }
    set({ speaking: false, paused: false, currentMessageId: null });
  },

  pause: () => {
    const synthesis = getSynthesis();
    if (synthesis && get().speaking) {
      synthesis.pause();
      set({ paused: true });
    }
  },

  resume: () => {
    const synthesis = getSynthesis();
    if (synthesis && get().paused) {
      synthesis.resume();
      set({ paused: false });
    }
  },

  setVoice: (voiceName: string) => {
    set({ voice: voiceName });
    const state = get();
    savePreferences({ voice: voiceName, rate: state.rate, pitch: state.pitch, volume: state.volume });
  },

  setRate: (rate: number) => {
    const clamped = clampRate(rate);
    set({ rate: clamped });
    const state = get();
    savePreferences({ voice: state.voice, rate: clamped, pitch: state.pitch, volume: state.volume });
  },

  setPitch: (pitch: number) => {
    const clamped = clampPitch(pitch);
    set({ pitch: clamped });
    const state = get();
    savePreferences({ voice: state.voice, rate: state.rate, pitch: clamped, volume: state.volume });
  },

  setVolume: (volume: number) => {
    const clamped = clampVolume(volume);
    set({ volume: clamped });
    const state = get();
    savePreferences({ voice: state.voice, rate: state.rate, pitch: state.pitch, volume: clamped });
  },

  loadVoices: () => {
    const synthesis = getSynthesis();
    if (!synthesis) return;

    const doLoad = () => {
      const voices = synthesis.getVoices();
      if (voices.length > 0) {
        set({ availableVoices: voices });
      }
    };

    // Voices may load asynchronously in some browsers
    doLoad();
    if (synthesis.onvoiceschanged !== undefined) {
      synthesis.onvoiceschanged = doLoad;
    }
  },
}));
