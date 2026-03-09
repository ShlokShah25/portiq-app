# Voice Recognition Integration Guide

## Quick Start - Option 1: Python Script (Recommended)

This is the easiest approach using pyannote.audio for speaker embeddings.

### Step 1: Install Python Dependencies

```bash
# Install Python 3.8+ if not already installed
python3 --version

# Install required packages
pip3 install pyannote.audio torch torchaudio
pip3 install numpy scipy
```

### Step 2: Create Python Script

Create a file: `server/utils/voice_embedding.py`

```python
#!/usr/bin/env python3
import sys
import json
import torch
from pyannote.audio import Inference
import numpy as np

def generate_embedding(audio_path):
    """Generate voice embedding from audio file"""
    try:
        # Load the embedding model
        # You'll need to accept the terms at: https://huggingface.co/pyannote/embedding
        model = Inference("pyannote/embedding", device="cpu")
        
        # Generate embedding
        embedding = model({"audio": audio_path})
        
        # Convert to list for JSON serialization
        embedding_list = embedding.cpu().numpy().tolist()
        
        # Average if multiple segments (for single speaker sample)
        if isinstance(embedding_list[0], list):
            embedding_list = np.mean(embedding_list, axis=0).tolist()
        
        return embedding_list
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 voice_embedding.py <audio_file_path>", file=sys.stderr)
        sys.exit(1)
    
    audio_path = sys.argv[1]
    embedding = generate_embedding(audio_path)
    print(json.dumps(embedding))
```

### Step 3: Get HuggingFace Token

1. Go to https://huggingface.co/pyannote/embedding
2. Accept the terms and conditions
3. Get your access token from https://huggingface.co/settings/tokens
4. Run: `huggingface-cli login` and enter your token

### Step 4: Update Node.js Code

Update `server/utils/voiceRecognition.js`:

```javascript
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function generateVoiceEmbedding(audioFilePath) {
  try {
    if (!fs.existsSync(audioFilePath)) {
      throw new Error('Audio file not found');
    }

    // Call Python script
    const pythonScript = path.join(__dirname, 'voice_embedding.py');
    const { stdout, stderr } = await execPromise(`python3 "${pythonScript}" "${audioFilePath}"`);
    
    if (stderr && !stderr.includes('Warning')) {
      console.warn('Python script warning:', stderr);
    }
    
    const embedding = JSON.parse(stdout.trim());
    
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Invalid embedding format');
    }
    
    return embedding;
  } catch (error) {
    console.error('Error generating voice embedding:', error);
    throw error;
  }
}
```

---

## Option 2: TensorFlow.js (Pure JavaScript)

### Step 1: Install Dependencies

```bash
npm install @tensorflow/tfjs-node @tensorflow/tfjs
```

### Step 2: Download Pre-trained Model

You'll need a speaker embedding model. One option is to use a TensorFlow.js compatible model.

### Step 3: Update voiceRecognition.js

```javascript
const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');

let model = null;

async function loadModel() {
  if (!model) {
    // Load your pre-trained speaker embedding model
    model = await tf.loadLayersModel('path/to/speaker-model/model.json');
  }
  return model;
}

async function generateVoiceEmbedding(audioFilePath) {
  try {
    // Load audio file and preprocess
    const audioBuffer = fs.readFileSync(audioFilePath);
    const audioData = await preprocessAudio(audioBuffer);
    
    // Load model
    const embeddingModel = await loadModel();
    
    // Generate embedding
    const prediction = embeddingModel.predict(audioData);
    const embedding = await prediction.data();
    
    return Array.from(embedding);
  } catch (error) {
    console.error('Error generating voice embedding:', error);
    throw error;
  }
}

async function preprocessAudio(audioBuffer) {
  // Convert audio buffer to tensor
  // This is a simplified example - you'll need proper audio preprocessing
  const audioArray = new Float32Array(audioBuffer);
  return tf.tensor2d([Array.from(audioArray)]);
}
```

---

## Option 3: Use OpenAI Audio Embeddings (If Available)

If OpenAI releases audio embedding API:

```javascript
async function generateVoiceEmbedding(audioFilePath) {
  try {
    const audioFile = fs.createReadStream(audioFilePath);
    
    const response = await openai.audio.embeddings.create({
      file: audioFile,
      model: 'audio-embedding-model' // When available
    });
    
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating voice embedding:', error);
    throw error;
  }
}
```

---

## Option 4: Simple Audio Feature Extraction (Quick Start)

For a quick start without external dependencies, you can extract basic audio features:

```javascript
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function generateVoiceEmbedding(audioFilePath) {
  try {
    // Use ffmpeg to extract audio features
    // This is a simplified approach - not as accurate as ML models
    
    const command = `ffmpeg -i "${audioFilePath}" -af "astats=metadata=1:reset=1" -f null - 2>&1 | grep -E "RMS|Peak|Mean" | head -20`;
    
    const { stdout } = await execPromise(command);
    
    // Parse features and create embedding
    const features = parseAudioFeatures(stdout);
    const embedding = createEmbeddingFromFeatures(features);
    
    return embedding;
  } catch (error) {
    console.error('Error generating voice embedding:', error);
    throw error;
  }
}

function parseAudioFeatures(ffmpegOutput) {
  // Parse RMS, Peak, Mean values from ffmpeg output
  // This is a placeholder - implement actual parsing
  return {
    rms: 0.5,
    peak: 0.8,
    mean: 0.6
    // ... more features
  };
}

function createEmbeddingFromFeatures(features) {
  // Create 128-dimensional embedding from features
  const embedding = new Array(128).fill(0);
  // Map features to embedding dimensions
  // This is simplified - use proper feature engineering
  return embedding;
}
```

---

## Recommended: Full Implementation with pyannote.audio

### Complete Setup Steps:

1. **Install Python and dependencies:**
```bash
brew install python3  # macOS
# or
sudo apt-get install python3 python3-pip  # Linux

pip3 install pyannote.audio torch torchaudio numpy scipy
```

2. **Create the Python script** (as shown in Option 1)

3. **Get HuggingFace access:**
```bash
pip3 install huggingface_hub
huggingface-cli login
# Enter your token from https://huggingface.co/settings/tokens
```

4. **Update voiceRecognition.js** with the Python script call

5. **Test it:**
```bash
# Test Python script directly
python3 server/utils/voice_embedding.py path/to/audio.wav

# Should output JSON array of numbers
```

6. **Update the Node.js code** to call the Python script

---

## Speaker Identification During Meeting

To identify speakers during the actual meeting transcription, you'll need to:

1. **Segment the audio** into chunks (e.g., 5-10 second segments)
2. **Generate embeddings** for each segment
3. **Compare** with stored voice profiles
4. **Label** the transcript with speaker names

This requires additional processing but can be added incrementally.

---

## Quick Test

After integration, test with:

```bash
# In Node.js
node -e "
const { generateVoiceEmbedding } = require('./server/utils/voiceRecognition');
generateVoiceEmbedding('path/to/test-audio.wav')
  .then(embedding => console.log('Embedding length:', embedding.length))
  .catch(err => console.error('Error:', err));
"
```

---

## Troubleshooting

- **Python not found**: Make sure `python3` is in your PATH
- **Module not found**: Run `pip3 install` for missing packages
- **HuggingFace error**: Make sure you've accepted terms and logged in
- **Embedding too short/long**: Check the model output format
