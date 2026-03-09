#!/usr/bin/env python3
"""
Voice Embedding Generator using pyannote.audio
Generates speaker embeddings from audio files for voice recognition.
"""
import sys
import json
import os

try:
    import torch
    from pyannote.audio import Model
    from pyannote.core import Segment
    import numpy as np
except ImportError as e:
    print(f"Error: Missing required package. Install with: pip3 install pyannote.audio torch torchaudio numpy", file=sys.stderr)
    sys.exit(1)

def generate_embedding(audio_path, token=None):
    """Generate voice embedding from audio file using pyannote.audio"""
    try:
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")
        
        # Load the embedding model using Model class directly
        # Note: First time use requires accepting terms at:
        # https://huggingface.co/pyannote/embedding
        # And running: huggingface-cli login
        try:
            from pyannote.audio import Model
            from pyannote.core import Segment
            
            # Make sure audio path is absolute
            audio_path_abs = os.path.abspath(audio_path)
            
            # Get token from parameter, environment, or HuggingFace cache
            if not token:
                # First check environment variables (highest priority)
                token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
            
            # If not in env, try HuggingFace cache
            if not token:
                try:
                    from huggingface_hub import HfFolder
                    token = HfFolder.get_token()
                except:
                    pass
            
            # Load the embedding model with authentication
            # Try with retries for network issues
            max_retries = 3
            retry_count = 0
            embedding_model = None
            
            while retry_count < max_retries and embedding_model is None:
                try:
                    if token:
                        print(f"Using HuggingFace token (length: {len(token)})", file=sys.stderr)
                        print(f"Downloading model (attempt {retry_count + 1}/{max_retries})...", file=sys.stderr)
                        embedding_model = Model.from_pretrained(
                            "pyannote/embedding", 
                            use_auth_token=token,
                            cache_dir=None,  # Use default cache
                            strict=False  # Avoid loss function warnings
                        )
                    else:
                        print("No token found, trying cached token...", file=sys.stderr)
                        embedding_model = Model.from_pretrained("pyannote/embedding", use_auth_token=True, strict=False)
                    print("✅ Model loaded successfully", file=sys.stderr)
                except Exception as model_error:
                    retry_count += 1
                    error_str = str(model_error).lower()
                    if "locate the file" in error_str or "cannot find" in error_str or "connection" in error_str:
                        if retry_count < max_retries:
                            print(f"⚠️  Network/download issue, retrying ({retry_count}/{max_retries})...", file=sys.stderr)
                            import time
                            time.sleep(2)  # Wait 2 seconds before retry
                        else:
                            raise model_error
                    else:
                        raise model_error
            
            # Load audio and generate embedding
            import torchaudio
            import torch
            
            # Load audio file using torchaudio
            waveform, sample_rate = torchaudio.load(audio_path_abs)
            
            # Convert to mono if stereo
            if waveform.shape[0] > 1:
                waveform = torch.mean(waveform, dim=0, keepdim=True)
            
            # Resample to 16kHz if needed
            if sample_rate != 16000:
                resampler = torchaudio.transforms.Resample(sample_rate, 16000)
                waveform = resampler(waveform)
                sample_rate = 16000
            
            # Ensure waveform is float32 and on CPU
            if waveform.dtype != torch.float32:
                waveform = waveform.float()
            waveform = waveform.cpu()
            
            # Use Inference class - it should handle the waveform directly
            from pyannote.audio import Inference
            inference = Inference(embedding_model, device="cpu")
            
            # Ensure waveform has correct shape for pyannote.audio
            # Shape should be [channels, samples] or [batch, channels, samples]
            # Current shape after loading: [channels, samples]
            
            # Use Inference class - it handles the audio processing
            from pyannote.audio import Inference
            inference = Inference(embedding_model, device="cpu")
            
            # Try Inference with dict format (most common for pyannote.audio v4)
            # The dict should have 'waveform' and 'sample_rate'
            try:
                embedding = inference({"waveform": waveform, "sample_rate": sample_rate})
            except Exception as e1:
                # If dict format fails, try passing waveform directly
                # Inference might handle it internally
                try:
                    embedding = inference(waveform)
                except Exception as e2:
                    # Last resort: use model's forward method
                    # But we need to ensure proper shape: [batch, channels, samples]
                    embedding_model.eval()
                    with torch.no_grad():
                        # Add batch dimension if missing: [1, channels, samples]
                        if len(waveform.shape) == 2:
                            waveform_batched = waveform.unsqueeze(0)  # [1, channels, samples]
                        else:
                            waveform_batched = waveform
                        # Model's forward expects tensor directly, not dict
                        embedding = embedding_model(waveform_batched)
                
        except Exception as e:
            error_str = str(e).lower()
            if "locate the file" in error_str or "cannot find" in error_str or "connection" in error_str:
                print("Error: Network or download issue.", file=sys.stderr)
                print("The model files need to be downloaded from HuggingFace.", file=sys.stderr)
                print("Possible solutions:", file=sys.stderr)
                print("1. Check your internet connection", file=sys.stderr)
                print("2. Try again - the model will download on first use", file=sys.stderr)
                print("3. Manually download: python3 -c \"from pyannote.audio import Model; Model.from_pretrained('pyannote/embedding', use_auth_token='YOUR_TOKEN')\"", file=sys.stderr)
            elif "403" in error_str or ("restricted" in error_str and "authorized" in error_str):
                print("Error: Access to pyannote/embedding model is restricted.", file=sys.stderr)
                print("You need to request access to the gated repository.", file=sys.stderr)
                print("1. Visit: https://huggingface.co/pyannote/embedding", file=sys.stderr)
                print("2. Click 'Agree and access repository' or 'Request access'", file=sys.stderr)
                print("3. Accept the terms of use", file=sys.stderr)
                print("4. Wait for approval (usually instant)", file=sys.stderr)
                print("5. Then try again", file=sys.stderr)
            elif "authentication" in error_str or "token" in error_str or "401" in error_str or "restricted" in error_str:
                print("Error: HuggingFace authentication required.", file=sys.stderr)
                print("1. Go to https://huggingface.co/pyannote/embedding and accept terms", file=sys.stderr)
                print("2. Get token from https://huggingface.co/settings/tokens", file=sys.stderr)
                print("3. Set token: export HF_TOKEN=your_token_here", file=sys.stderr)
                print("4. Or run: python3 -c \"from huggingface_hub import login; login(token='YOUR_TOKEN')\"", file=sys.stderr)
            raise e
        
        # Convert to numpy array
        if isinstance(embedding, torch.Tensor):
            embedding_np = embedding.cpu().detach().numpy()
        else:
            embedding_np = np.array(embedding)
        
        # Handle multi-segment embeddings (average them for single speaker)
        if len(embedding_np.shape) > 1:
            embedding_np = np.mean(embedding_np, axis=0)
        
        # Ensure it's 1D
        embedding_np = embedding_np.flatten()
        
        # Convert to list for JSON serialization
        embedding_list = embedding_np.tolist()
        
        return embedding_list
    except Exception as e:
        print(f"Error generating embedding: {str(e)}", file=sys.stderr)
        raise e

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 voice_embedding.py <audio_file_path> [token]", file=sys.stderr)
        sys.exit(1)
    
    audio_path = sys.argv[1]
    token_arg = sys.argv[2] if len(sys.argv) > 2 else None
    
    # If token provided as argument, set it in environment and use Python login
    if token_arg:
        os.environ["HF_TOKEN"] = token_arg
        os.environ["HUGGINGFACE_TOKEN"] = token_arg
        # Also login directly using huggingface_hub
        try:
            from huggingface_hub import login
            login(token=token_arg, add_to_git_credential=False)
            print(f"✅ Logged in to HuggingFace with token (length: {len(token_arg)})", file=sys.stderr)
        except Exception as login_error:
            print(f"⚠️  Could not login with token: {login_error}", file=sys.stderr)
    
    try:
        embedding = generate_embedding(audio_path, token=token_arg)
        # Output JSON to stdout
        print(json.dumps(embedding))
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)
