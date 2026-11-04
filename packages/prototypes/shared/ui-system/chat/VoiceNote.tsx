/**
 * Increment 13 — real microphone voice notes. The recorder follows the
 * desktop MediaRecorder state machine (idle → recording → cancelled/draft);
 * the player is a single presentational component reused by the composer
 * preview row and the in-bubble voice note, driven by a real audio blob URL.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

export type VoiceRecorder = {
  recording: boolean;
  recordingSeconds: number;
  start: () => Promise<void>;
  cancel: () => void;
  finish: () => void;
};

export type RecordedVoice = { url: string; durationSeconds: number };

export function useVoiceRecorder(onRecorded: (voice: RecordedVoice) => void, onError: (reason: 'denied' | 'unsupported') => void): VoiceRecorder {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const startedAtRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const stopStream = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setRecording(false);
  }, []);

  const finish = useCallback(() => {
    cancelledRef.current = false;
    stopStream();
  }, [stopStream]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stopStream();
  }, [stopStream]);

  const start = useCallback(async () => {
    if (recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError('unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      cancelledRef.current = false;
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const chunks = chunksRef.current;
        chunksRef.current = [];
        if (cancelledRef.current || chunks.length === 0) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        onRecorded({ url: URL.createObjectURL(blob), durationSeconds });
      };
      setRecordingSeconds(0);
      startedAtRef.current = Date.now();
      timerRef.current = window.setInterval(() => setRecordingSeconds(seconds => seconds + 1), 1000);
      recorder.start();
      setRecording(true);
    } catch {
      onError('denied');
    }
  }, [onError, onRecorded, recording]);

  useEffect(() => () => {
    cancelledRef.current = true;
    stopStream();
  }, [stopStream]);

  return { recording, recordingSeconds, start, cancel, finish };
}

export function formatVoiceDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

/* ── Voice player (preview row + bubble) ──────────────── */

export function VoicePlayer({ url, durationSeconds, variant = 'bubble', seedSeconds }: {
  url: string | null | undefined;
  durationSeconds: number;
  variant?: 'bubble' | 'preview';
  seedSeconds?: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(seedSeconds ?? durationSeconds);
  const [failed, setFailed] = useState(false);
  const available = Boolean(url) && !failed;

  useEffect(() => {
    setPlaying(false);
    setPosition(0);
    setDuration(seedSeconds ?? durationSeconds);
    setFailed(false);
  }, [url, durationSeconds, seedSeconds]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio || !url) return;
    if (audio.paused) {
      if (audio.ended) {
        audio.currentTime = 0;
      }
      void audio.play().catch(() => setFailed(true));
    } else {
      audio.pause();
    }
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio || !available) return;
    audio.currentTime = value;
    setPosition(value);
  };

  return (
    <div className={`sk-voice is-${variant}`} data-voice
      data-voice-playing={playing ? 'true' : 'false'}
      data-voice-available={available ? 'true' : 'false'}>
      {url && (
        <audio ref={audioRef} src={url} preload="metadata"
          onLoadedMetadata={event => {
            const d = event.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDuration(d);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
          onEnded={event => {
            setPlaying(false);
            setPosition(event.currentTarget.duration || duration);
          }}
          onError={() => {
            setPlaying(false);
            setFailed(true);
          }} />
      )}
      <button type="button" className="sk-voice-toggle"
        aria-label={playing ? '暂停语音' : '播放语音'}
        data-voice-toggle disabled={!available}
        onClick={toggle}>
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <input type="range" className="sk-voice-seek" min={0} max={Math.max(1, Math.round(duration))}
        step={0.1} value={Math.min(position, Math.max(1, duration))}
        aria-label="语音进度" data-voice-seek disabled={!available}
        onChange={event => seek(Number(event.target.value))} />
      <span className="sk-voice-time">
        {formatVoiceDuration(position)} / {formatVoiceDuration(duration)}
      </span>
    </div>
  );
}
