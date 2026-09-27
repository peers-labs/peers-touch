import { useCallback, useEffect, useRef, useState } from 'react';

import { requestPermission } from '../../runtimes/nativeLifecycleBridge';
import type { MessagingVoiceNoteMetadata } from '../../services/mobileCommands';

interface RecordedVoiceNote {
  readonly file: File;
  readonly metadata: MessagingVoiceNoteMetadata;
}

interface UseMobileChatVoiceRecorderOptions {
  readonly disabled: boolean;
  readonly onRecorded: (recording: RecordedVoiceNote) => void;
  readonly onDenied: () => void;
  readonly onUnsupported: () => void;
  readonly onFailed: () => void;
}

function voiceFileExtension(mimeType: string): string {
  if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

export function useMobileChatVoiceRecorder({
  disabled,
  onRecorded,
  onDenied,
  onUnsupported,
  onFailed,
}: UseMobileChatVoiceRecorderOptions) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const releaseCapture = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const stopRecording = useCallback((cancelled: boolean) => {
    cancelledRef.current = cancelled;
    const recorder = recorderRef.current;
    if (recorder?.state !== 'inactive') {
      recorder?.stop();
    } else {
      chunksRef.current = [];
      releaseCapture();
    }
  }, [releaseCapture]);

  const startRecording = useCallback(async () => {
    if (disabled || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onUnsupported();
      return;
    }
    try {
      const permission = await requestPermission('microphone');
      if (permission.status !== 'granted') {
        onDenied();
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      cancelledRef.current = false;
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        cancelledRef.current = true;
        chunksRef.current = [];
        releaseCapture();
        onFailed();
      };
      recorder.onstop = () => {
        const chunks = chunksRef.current;
        const durationMs = Math.max(1, Date.now() - startedAtRef.current);
        const mimeType = recorder.mimeType || chunks[0]?.type || 'audio/webm';
        chunksRef.current = [];
        releaseCapture();
        if (cancelledRef.current || chunks.length === 0) return;
        const blob = new Blob(chunks, { type: mimeType });
        onRecorded({
          file: new File(
            [blob],
            `voice-${Date.now()}.${voiceFileExtension(mimeType)}`,
            { type: mimeType },
          ),
          metadata: {
            durationMs,
            codec: mimeType,
            waveform: [],
          },
        });
      };
      setRecordingSeconds(0);
      startedAtRef.current = Date.now();
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((seconds) => seconds + 1);
      }, 1000);
      recorder.start();
      setRecording(true);
    } catch {
      releaseCapture();
      onDenied();
    }
  }, [
    disabled,
    onDenied,
    onFailed,
    onRecorded,
    onUnsupported,
    recording,
    releaseCapture,
  ]);

  useEffect(() => () => {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    releaseCapture();
  }, [releaseCapture]);

  return {
    recording,
    recordingSeconds,
    startRecording,
    stopRecording,
  } as const;
}
