#!/usr/bin/env python3
"""
Voice embedding via pyannote.audio (pyannote/embedding only — no JS/FFT fallback).

Optional: crop to the dominant speaker using pyannote/speaker-diarization-3.1 before
embedding so mixed chunks map to one voice more cleanly. Requires HF access to both
gated models + segmentation dependency. Set VOICE_PYANNOTE_DIARIZATION=false to skip.
"""
import sys
import json
import os

try:
    import torch
    import numpy as np
except ImportError as e:
    print(
        "Error: Missing required package. Install with: pip3 install pyannote.audio torch torchaudio numpy",
        file=sys.stderr,
    )
    sys.exit(1)

_EMBEDDING_MODEL = None
_EMBEDDING_INFERENCE = None
_DIARIZATION_PIPELINE = None
_DIARIZATION_LOAD_FAILED = False


def _resolve_token(token):
    if token:
        return token
    t = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if t:
        return t
    try:
        from huggingface_hub import HfFolder

        return HfFolder.get_token()
    except Exception:
        return None


def _load_embedding_inference(auth_token):
    global _EMBEDDING_MODEL, _EMBEDDING_INFERENCE
    if _EMBEDDING_INFERENCE is not None:
        return _EMBEDDING_MODEL, _EMBEDDING_INFERENCE

    from pyannote.audio import Inference, Model

    max_retries = 3
    last_err = None
    for attempt in range(max_retries):
        try:
            if auth_token:
                print(
                    f"Using HuggingFace token (length: {len(auth_token)})",
                    file=sys.stderr,
                )
                print(
                    f"Loading pyannote/embedding (attempt {attempt + 1}/{max_retries})...",
                    file=sys.stderr,
                )
                _EMBEDDING_MODEL = Model.from_pretrained(
                    "pyannote/embedding",
                    use_auth_token=auth_token,
                    cache_dir=None,
                    strict=False,
                )
            else:
                print("No token found, trying cached HF credentials...", file=sys.stderr)
                _EMBEDDING_MODEL = Model.from_pretrained(
                    "pyannote/embedding", use_auth_token=True, strict=False
                )
            _EMBEDDING_INFERENCE = Inference(_EMBEDDING_MODEL, device="cpu")
            print("✅ Embedding model loaded", file=sys.stderr)
            return _EMBEDDING_MODEL, _EMBEDDING_INFERENCE
        except Exception as e:
            last_err = e
            err_s = str(e).lower()
            if (
                "locate the file" in err_s
                or "cannot find" in err_s
                or "connection" in err_s
            ) and attempt < max_retries - 1:
                print(
                    f"⚠️  Download/network issue, retrying ({attempt + 1}/{max_retries})...",
                    file=sys.stderr,
                )
                import time

                time.sleep(2)
            else:
                raise last_err


def _get_diarization_pipeline(auth_token):
    global _DIARIZATION_PIPELINE, _DIARIZATION_LOAD_FAILED
    if _DIARIZATION_LOAD_FAILED:
        return None
    if _DIARIZATION_PIPELINE is not None:
        return _DIARIZATION_PIPELINE
    try:
        from pyannote.audio import Pipeline

        if auth_token:
            _DIARIZATION_PIPELINE = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=auth_token,
            )
        else:
            _DIARIZATION_PIPELINE = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=True,
            )
        print("✅ Speaker diarization pipeline loaded", file=sys.stderr)
    except Exception as e:
        _DIARIZATION_LOAD_FAILED = True
        print(
            f"⚠️  Speaker diarization unavailable (using full clip for embedding): {e}",
            file=sys.stderr,
        )
        _DIARIZATION_PIPELINE = None
    return _DIARIZATION_PIPELINE


def _maybe_crop_to_dominant_speaker(waveform, sample_rate, auth_token):
    """Pick the speaker with the most time; embed their longest single segment."""
    flag = os.environ.get("VOICE_PYANNOTE_DIARIZATION", "true").lower()
    if flag in ("0", "false", "no", "off"):
        return waveform, sample_rate

    pipeline = _get_diarization_pipeline(auth_token)
    if pipeline is None:
        return waveform, sample_rate

    try:
        diarization = pipeline({"waveform": waveform, "sample_rate": sample_rate})
    except Exception as e:
        print(f"⚠️  Diarization run failed, using full clip: {e}", file=sys.stderr)
        return waveform, sample_rate

    from collections import defaultdict

    dur_by_spk = defaultdict(float)
    segs_by_spk = defaultdict(list)
    try:
        for segment, _, label in diarization.itertracks(yield_label=True):
            dur_by_spk[label] += segment.duration
            segs_by_spk[label].append(segment)
    except Exception as e:
        print(f"⚠️  Could not read diarization tracks: {e}", file=sys.stderr)
        return waveform, sample_rate

    if not dur_by_spk:
        return waveform, sample_rate

    dominant = max(dur_by_spk, key=dur_by_spk.get)
    segs = segs_by_spk.get(dominant) or []
    if not segs:
        return waveform, sample_rate

    longest = max(segs, key=lambda s: s.duration)
    start = int(longest.start * sample_rate)
    end = int(longest.end * sample_rate)
    end = min(end, waveform.shape[1])
    start = max(0, start)
    min_samples = int(float(os.environ.get("VOICE_DIAR_MIN_SEGMENT_SEC", "0.25")) * sample_rate)
    if end - start < min_samples:
        return waveform, sample_rate

    cropped = waveform[:, start:end]
    print(
        f"🎯 Diarization: using dominant speaker longest segment "
        f"({longest.duration:.2f}s of {dominant})",
        file=sys.stderr,
    )
    return cropped, sample_rate


def generate_embedding(audio_path, token=None):
    """Load audio → optional diarization crop → pyannote embedding."""
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    audio_path_abs = os.path.abspath(audio_path)
    auth_token = _resolve_token(token)

    try:
        embedding_model, inference = _load_embedding_inference(auth_token)
    except Exception as e:
        _print_hf_help(str(e).lower())
        raise

    import torchaudio

    waveform, sample_rate = torchaudio.load(audio_path_abs)
    if waveform.shape[0] > 1:
        waveform = torch.mean(waveform, dim=0, keepdim=True)
    if sample_rate != 16000:
        resampler = torchaudio.transforms.Resample(sample_rate, 16000)
        waveform = resampler(waveform)
        sample_rate = 16000
    if waveform.dtype != torch.float32:
        waveform = waveform.float()
    waveform = waveform.cpu()

    waveform, sample_rate = _maybe_crop_to_dominant_speaker(
        waveform, sample_rate, auth_token
    )

    try:
        try:
            embedding = inference({"waveform": waveform, "sample_rate": sample_rate})
        except Exception:
            try:
                embedding = inference(waveform)
            except Exception:
                embedding_model.eval()
                with torch.no_grad():
                    wf = waveform.unsqueeze(0) if len(waveform.shape) == 2 else waveform
                    embedding = embedding_model(wf)
    except Exception as e:
        print(f"Error generating embedding: {str(e)}", file=sys.stderr)
        raise

    if isinstance(embedding, torch.Tensor):
        embedding_np = embedding.cpu().detach().numpy()
    else:
        embedding_np = np.array(embedding)

    if len(embedding_np.shape) > 1:
        embedding_np = np.mean(embedding_np, axis=0)
    embedding_np = embedding_np.flatten()
    return embedding_np.tolist()


def _print_hf_help(error_lower):
    if "locate the file" in error_lower or "cannot find" in error_lower or "connection" in error_lower:
        print("Error: Network or download issue.", file=sys.stderr)
        print("The model files need to be downloaded from HuggingFace.", file=sys.stderr)
    elif "403" in error_lower or ("restricted" in error_lower and "authorized" in error_lower):
        print("Error: Access to pyannote/embedding is restricted.", file=sys.stderr)
        print("Accept terms at https://huggingface.co/pyannote/embedding", file=sys.stderr)
    elif "authentication" in error_lower or "token" in error_lower or "401" in error_lower:
        print("Error: HuggingFace authentication required.", file=sys.stderr)
        print("Set HF_TOKEN and accept pyannote model terms on Hugging Face.", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(
            "Usage: python3 voice_embedding.py <audio_file_path> [token]",
            file=sys.stderr,
        )
        sys.exit(1)

    audio_path = sys.argv[1]
    token_arg = sys.argv[2] if len(sys.argv) > 2 else None

    if token_arg:
        os.environ["HF_TOKEN"] = token_arg
        os.environ["HUGGINGFACE_TOKEN"] = token_arg
        try:
            from huggingface_hub import login

            login(token=token_arg, add_to_git_credential=False)
            print(
                f"✅ Logged in to HuggingFace with token (length: {len(token_arg)})",
                file=sys.stderr,
            )
        except Exception as login_error:
            print(f"⚠️  Could not login with token: {login_error}", file=sys.stderr)

    try:
        embedding = generate_embedding(audio_path, token=token_arg)
        print(json.dumps(embedding))
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)
