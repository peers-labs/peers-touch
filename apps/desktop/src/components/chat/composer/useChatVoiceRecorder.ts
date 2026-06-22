import { useCallback, useEffect, useRef, useState } from 'react';

import { log } from '../../../utils/logger';

interface UseChatVoiceRecorderOptions {
  disabled: boolean;
  editing: boolean;
  onRecorded: (file: File, durationSeconds: number) => void;
  onDenied: () => void;
  onUnsupported: () => void;
}

export function useChatVoiceRecorder({
  disabled,
  editing,
  onRecorded,
  onDenied,
  onUnsupported,
}: UseChatVoiceRecorderOptions) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const stopRecording = useCallback((cancelled: boolean) => {
    cancelledRef.current = cancelled;
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (disabled || editing || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onUnsupported();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      cancelledRef.current = false;
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const chunks = chunksRef.current;
        const startedAt = recordingStartedAtRef.current ?? Date.now();
        chunksRef.current = [];
        recordingStartedAtRef.current = null;
        if (cancelledRef.current || chunks.length === 0) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        onRecorded(
          new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || 'audio/webm' }),
          durationSeconds,
        );
      };
      setRecordingSeconds(0);
      recordingStartedAtRef.current = Date.now();
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((seconds) => seconds + 1);
      }, 1000);
      recorder.start();
      setRecording(true);
    } catch (error) {
      log.error('chat', 'voice recording start failed', error);
      onDenied();
    }
  }, [disabled, editing, onDenied, onRecorded, onUnsupported, recording]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
    }
  }, []);

  return {
    recording,
    recordingSeconds,
    startRecording,
    stopRecording,
  };
}
