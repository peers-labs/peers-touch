"""Generate the deterministic, non-speech voice-preview test stimulus."""
import math
import struct
import wave
from pathlib import Path

sample_rate = 8000
destination = Path(__file__).resolve().parents[1] / "public" / "acceptance-voice-preview.wav"
destination.parent.mkdir(exist_ok=True)
with wave.open(str(destination), "wb") as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(sample_rate)
    output.writeframes(b"".join(
        struct.pack("<h", round(math.sin(index * 440 * 2 * math.pi / sample_rate) * 2000))
        for index in range(sample_rate)
    ))
