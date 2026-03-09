# Voice Recognition Setup Guide

## Overview

The voice recognition feature allows the system to identify who is speaking during meetings by matching their voice to pre-recorded voice samples. This enables speaker identification in meeting transcriptions.

## Current Implementation

### ✅ Completed Features

1. **Voice Profile Model** - Stores voice vectors for each participant
2. **API Endpoints** - Register, check, and retrieve voice profiles
3. **Frontend UI** - Voice configuration interface before meetings
4. **Voice Recording** - Browser-based audio recording for voice samples

### ⚠️ Production Requirements

The current voice embedding generation is a **placeholder**. For production use, you need to integrate a proper voice embedding model.

## Recommended Voice Embedding Solutions

### Option 1: pyannote.audio (Python) - Recommended
- **Best for**: High accuracy speaker diarization
- **Setup**: Requires Python environment
- **Integration**: Call Python script from Node.js via subprocess

```python
# Example: voice_embedding.py
from pyannote.audio import Inference
import torch

model = Inference("pyannote/embedding", device="cpu")
embedding = model({"audio": "path/to/audio.wav"})
```

### Option 2: speechbrain (Python)
- **Best for**: Voice embeddings and speaker verification
- **Setup**: Requires Python environment
- **Integration**: Call Python script from Node.js

### Option 3: TensorFlow.js (JavaScript)
- **Best for**: Browser-based or Node.js native solution
- **Setup**: npm install @tensorflow/tfjs-node
- **Integration**: Direct JavaScript implementation

### Option 4: OpenAI Audio Embeddings (if available)
- **Best for**: Cloud-based solution
- **Setup**: Requires OpenAI API access
- **Integration**: Direct API calls

## Implementation Steps

### Step 1: Choose Your Solution

For a production system, we recommend **pyannote.audio** for best accuracy.

### Step 2: Update `server/utils/voiceRecognition.js`

Replace the placeholder `generateVoiceEmbedding` function with your chosen solution:

```javascript
async function generateVoiceEmbedding(audioFilePath) {
  // Option 1: Call Python script
  const { exec } = require('child_process');
  return new Promise((resolve, reject) => {
    exec(`python3 voice_embedding.py ${audioFilePath}`, (error, stdout) => {
      if (error) reject(error);
      else resolve(JSON.parse(stdout));
    });
  });
  
  // Option 2: Use TensorFlow.js
  // const tf = require('@tensorflow/tfjs-node');
  // const model = await tf.loadLayersModel('path/to/model');
  // const embedding = await model.predict(audioData);
}
```

### Step 3: Update Speaker Identification

In `server/utils/meetingTranscription.js`, integrate speaker identification:

```javascript
// After transcription, identify speakers
const VoiceProfile = require('../models/VoiceProfile');
const { identifySpeaker } = require('./voiceRecognition');

// For each audio segment, identify the speaker
const speaker = await identifySpeaker(segmentPath, voiceProfiles);
```

## Current Workflow

1. **Before Meeting**: Participants record voice samples saying: "Hello, my name is [Name] and I am ready for the meeting."
2. **Voice Embedding**: System generates a voice vector from the sample
3. **Storage**: Voice profile stored in database with email as key
4. **During Meeting**: Audio is recorded and transcribed
5. **Speaker ID**: (To be implemented) Match audio segments to voice profiles
6. **Transcription**: Include speaker labels in transcription

## API Endpoints

- `POST /api/meetings/voice/register` - Register voice profile
- `GET /api/meetings/voice/profiles?emails=email1,email2` - Get voice profiles
- `GET /api/meetings/voice/check/:email` - Check if participant has voice profile

## Frontend Features

- ✅ Checkbox to enable voice recognition
- ✅ Voice configuration UI showing all participants
- ✅ Record voice sample button for each participant
- ✅ Visual indicators for configured/unconfigured participants
- ✅ Re-record option for existing profiles

## Next Steps

1. **Integrate proper voice embedding model** (see options above)
2. **Add speaker diarization** to transcription process
3. **Update transcription output** to include speaker labels
4. **Test with multiple participants** to verify accuracy

## Notes

- Voice profiles are stored per email address
- Once configured, participants don't need to re-record unless they want to update
- Voice samples are stored in `/uploads/voice-samples/`
- Similarity threshold is set to 0.7 (adjustable in `voiceRecognition.js`)
