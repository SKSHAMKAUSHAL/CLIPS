#!/usr/bin/env python3
"""Bridge script: calls faster-whisper and outputs JSON transcript to stdout."""

import json
import sys
import os

os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"


def detect_device():
    """Detect whether CUDA is actually usable, not just installed."""
    try:
        import ctypes
        ctypes.cdll.LoadLibrary("cublas64_12.dll" if os.name == "nt" else "libcublas.so.12")
        return "cuda", "float16"
    except OSError:
        pass
    # Also try generic ctranslate2 check
    try:
        import ctranslate2
        if "cuda" in ctranslate2.get_supported_compute_types("cuda"):
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def transcribe_audio(audio_path, model_size, device, compute_type):
    """Run transcription and materialize all segments eagerly."""
    from faster_whisper import WhisperModel

    print(f"Loading Whisper model '{model_size}' on {device} ({compute_type})...", file=sys.stderr, flush=True)
    model = WhisperModel(model_size, device=device, compute_type=compute_type)
    segments_gen, info = model.transcribe(audio_path, word_timestamps=True, vad_filter=True)

    # Eagerly consume the generator so any CUDA errors surface here
    segments = list(segments_gen)
    return segments, info


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: whisper_transcribe.py <audio_file> [model_size]"}), file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({"error": "faster-whisper not installed. Run: pip install faster-whisper"}), file=sys.stderr)
        sys.exit(1)

    # Detect best available device
    device, compute_type = detect_device()

    try:
        segments, info = transcribe_audio(audio_path, model_size, device, compute_type)
    except Exception as e:
        if device != "cpu":
            print(f"Warning: {device} failed ({e}). Falling back to CPU.", file=sys.stderr, flush=True)
            device, compute_type = "cpu", "int8"
            segments, info = transcribe_audio(audio_path, model_size, device, compute_type)
        else:
            raise

    result = {
        "language": info.language,
        "duration": info.duration,
        "segments": [],
    }

    for seg in segments:
        seg_dict = {
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text.strip(),
            "words": [],
        }
        
        # Log progress to stderr for the Node backend to capture
        print(f"Transcribed: {seg.start:.1f}s -> {seg.end:.1f}s", file=sys.stderr, flush=True)

        if seg.words:
            for w in seg.words:
                seg_dict["words"].append({
                    "word": w.word.strip(),
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "probability": round(w.probability, 3),
                })
        result["segments"].append(seg_dict)

    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    main()

