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

# Speaker-embedding models, loaded lazily and cached per key.
#   wespeaker — pyannote/wespeaker-voxceleb-resnet34-LM (256-dim). The ResNet34 speaker model used by
#               pyannote's own speaker-diarization-3.1; markedly lower verification error than the
#               older model and more robust on short, noisy meeting audio. Default.
#   pyannote  — pyannote/embedding (512-dim). Legacy: kept so voiceprints enrolled before the switch
#               keep matching until they are re-embedded.
MODEL_IDS = {
    "wespeaker": "pyannote/wespeaker-voxceleb-resnet34-LM",
    "pyannote": "pyannote/embedding",
}
_MODELS = {}
_DIARIZATION_PIPELINE = None
_DIARIZATION_LOAD_FAILED = False


def _resolve_token(token):
    if token:
        return str(token).strip() or None
    t = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if t:
        return str(t).strip() or None
    try:
        from huggingface_hub import HfFolder

        x = HfFolder.get_token()
        return str(x).strip() if x else None
    except Exception:
        return None


def _from_pretrained_hf(callable_cls, model_id, auth_token, **kwargs):
    """
    huggingface_hub >= 0.20 prefers `token=`; older pyannote stacks used `use_auth_token=`.
    """
    if auth_token:
        try:
            return callable_cls.from_pretrained(model_id, token=auth_token, **kwargs)
        except TypeError:
            return callable_cls.from_pretrained(model_id, use_auth_token=auth_token, **kwargs)
    try:
        return callable_cls.from_pretrained(model_id, token=True, **kwargs)
    except TypeError:
        return callable_cls.from_pretrained(model_id, use_auth_token=True, **kwargs)


def _default_model_key():
    key = os.environ.get("VOICE_EMBEDDING_MODEL", "wespeaker").strip().lower()
    return key if key in MODEL_IDS else "wespeaker"


def _load_embedding_inference(auth_token, model_key=None):
    model_key = model_key or _default_model_key()
    if model_key not in MODEL_IDS:
        raise ValueError(f"Unknown embedding model: {model_key}")
    if model_key in _MODELS:
        return _MODELS[model_key]

    from pyannote.audio import Inference, Model

    model_id = MODEL_IDS[model_key]
    max_retries = 5
    last_err = None
    for attempt in range(max_retries):
        try:
            print(f"Loading {model_id} (attempt {attempt + 1}/{max_retries})...", file=sys.stderr)
            model = _from_pretrained_hf(Model, model_id, auth_token, cache_dir=None, strict=False)
            if model is None:
                raise RuntimeError(f"Could not load {model_id} (check HF_TOKEN / model terms)")
            if model_key == "wespeaker":
                # One embedding for the whole clip (the model pools over time itself).
                inference = Inference(model, window="whole", device=torch.device("cpu"))
            else:
                # Legacy behaviour kept byte-for-byte so stored 512-dim voiceprints stay comparable.
                inference = Inference(model, device="cpu")
            _MODELS[model_key] = (model, inference)
            print(f"✅ Embedding model loaded: {model_id}", file=sys.stderr)
            return _MODELS[model_key]
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
            _DIARIZATION_PIPELINE = _from_pretrained_hf(
                Pipeline,
                "pyannote/speaker-diarization-3.1",
                auth_token,
            )
        else:
            _DIARIZATION_PIPELINE = _from_pretrained_hf(
                Pipeline,
                "pyannote/speaker-diarization-3.1",
                None,
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


def _diarization_enabled():
    # Off by default: the crop keeps only the longest single segment (discarding most of a short
    # enrollment / live utterance) and loads a second heavy pipeline. Live utterances are VAD-split
    # per speaker turn and the final transcript is attributed per Whisper segment, so it is not needed.
    flag = os.environ.get("VOICE_PYANNOTE_DIARIZATION", "false").lower()
    return flag in ("1", "true", "yes", "on")


def _maybe_crop_to_dominant_speaker(waveform, sample_rate, auth_token, diarize=None):
    """Pick the speaker with the most time; embed their longest single segment."""
    if diarize is None:
        diarize = _diarization_enabled()
    if not diarize:
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


def _load_waveform_16k(audio_path):
    import torchaudio

    waveform, sample_rate = torchaudio.load(os.path.abspath(audio_path))
    if waveform.shape[0] > 1:
        waveform = torch.mean(waveform, dim=0, keepdim=True)
    if sample_rate != 16000:
        resampler = torchaudio.transforms.Resample(sample_rate, 16000)
        waveform = resampler(waveform)
        sample_rate = 16000
    if waveform.dtype != torch.float32:
        waveform = waveform.float()
    return waveform.cpu(), sample_rate


def _embed_waveform(embedding_model, inference, waveform, sample_rate):
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


def _load_models_or_explain(auth_token, model_key=None):
    try:
        return _load_embedding_inference(auth_token, model_key)
    except Exception as e:
        _print_hf_help(str(e).lower())
        raise


def generate_embedding(audio_path, token=None, diarize=None, model_key=None):
    """Load audio → optional diarization crop → speaker embedding."""
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    auth_token = _resolve_token(token)
    embedding_model, inference = _load_models_or_explain(auth_token, model_key)
    waveform, sample_rate = _load_waveform_16k(audio_path)
    waveform, sample_rate = _maybe_crop_to_dominant_speaker(
        waveform, sample_rate, auth_token, diarize=diarize
    )
    return _embed_waveform(embedding_model, inference, waveform, sample_rate)


def generate_window_embeddings(audio_path, windows, token=None, min_sec=0.6, model_key=None):
    """
    Embed many [start, end] second windows of ONE file with a single load — used to attribute
    every Whisper segment of a recording to a speaker. Windows shorter than min_sec return None.
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")
    auth_token = _resolve_token(token)
    embedding_model, inference = _load_models_or_explain(auth_token, model_key)
    waveform, sample_rate = _load_waveform_16k(audio_path)
    total = waveform.shape[1]
    out = []
    for w in windows or []:
        try:
            start = max(0, int(float(w[0]) * sample_rate))
            end = min(total, int(float(w[1]) * sample_rate))
        except Exception:
            out.append(None)
            continue
        if end - start < int(min_sec * sample_rate):
            out.append(None)
            continue
        try:
            out.append(
                _embed_waveform(embedding_model, inference, waveform[:, start:end], sample_rate)
            )
        except Exception as e:
            print(f"⚠️  Window embedding failed ({w}): {e}", file=sys.stderr)
            out.append(None)
    return out


def serve():
    """
    Long-lived worker: one JSON request per stdin line, one JSON response per stdout line.
    Keeps torch + pyannote loaded so a live utterance costs ~a few hundred ms instead of a
    fresh interpreter + model load (10s+) per call.
      {"id": 1, "cmd": "embed", "path": "...", "diarize": false}
      {"id": 2, "cmd": "embed_windows", "path": "...", "windows": [[0.0, 2.1], ...]}
      {"id": 3, "cmd": "ping"}
    """
    # Responses go to the real stdout; anything a library prints is routed to stderr so it cannot
    # corrupt the line protocol.
    protocol_out = sys.stdout
    sys.stdout = sys.stderr

    def respond(obj):
        protocol_out.write(json.dumps(obj) + "\n")
        protocol_out.flush()

    token = _resolve_token(None)
    loaded = []
    errors = []
    # Load the default model; fall back to the legacy one so speaker naming degrades, not dies.
    for key in dict.fromkeys([_default_model_key(), "pyannote"]):
        try:
            _load_models_or_explain(token, key)
            loaded.append(key)
            break
        except Exception as e:
            errors.append(f"{key}: {str(e)[:800]}")
    if loaded:
        respond({"id": 0, "ok": True, "ready": True, "models": loaded, "errors": errors})
    else:
        respond({"id": 0, "ok": False, "error": " | ".join(errors)[:2000]})
        sys.exit(1)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            cmd = req.get("cmd", "embed")
            if cmd == "ping":
                resp = {"id": req_id, "ok": True}
            elif cmd == "embed_windows":
                resp = {
                    "id": req_id,
                    "ok": True,
                    "embeddings": generate_window_embeddings(
                        req["path"], req.get("windows") or [], token=token,
                        min_sec=float(req.get("minSec", 0.6)),
                        model_key=req.get("model"),
                    ),
                }
            else:
                resp = {
                    "id": req_id,
                    "ok": True,
                    "embedding": generate_embedding(
                        req["path"], token=token, diarize=req.get("diarize"),
                        model_key=req.get("model"),
                    ),
                }
        except Exception as e:
            resp = {"id": req_id, "ok": False, "error": str(e)[:2000]}
        respond(resp)


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
            "Usage: python3 voice_embedding.py <audio_file_path> [token] [--model=wespeaker|pyannote] | --serve",
            file=sys.stderr,
        )
        sys.exit(1)

    if sys.argv[1] == "--serve":
        serve()
        sys.exit(0)

    model_arg = None
    positional = []
    for arg in sys.argv[1:]:
        if arg.startswith("--model="):
            model_arg = arg.split("=", 1)[1].strip().lower() or None
        else:
            positional.append(arg)
    audio_path = positional[0]
    token_arg = positional[1] if len(positional) > 1 else None
    if not token_arg:
        token_arg = _resolve_token(None)

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
        embedding = generate_embedding(audio_path, token=token_arg, model_key=model_arg)
        print(json.dumps(embedding))
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)
