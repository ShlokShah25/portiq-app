#!/bin/bash

echo "🎤 Voice Recognition Setup Script"
echo "=================================="
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.8+ first."
    echo "   macOS: brew install python3"
    echo "   Linux: sudo apt-get install python3 python3-pip"
    exit 1
fi

echo "✅ Python 3 found: $(python3 --version)"
echo ""

# Install Python packages
echo "📦 Installing Python packages..."
pip3 install pyannote.audio torch torchaudio numpy scipy huggingface_hub

if [ $? -ne 0 ]; then
    echo "❌ Failed to install Python packages"
    exit 1
fi

echo "✅ Python packages installed"
echo ""

# Check HuggingFace CLI
echo "🔐 Setting up HuggingFace authentication..."
echo ""
echo "To use pyannote.audio, you need to:"
echo "1. Go to https://huggingface.co/pyannote/embedding"
echo "2. Accept the terms and conditions"
echo "3. Get your access token from https://huggingface.co/settings/tokens"
echo "4. Run: huggingface-cli login"
echo ""

read -p "Have you already set up HuggingFace? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Please set up HuggingFace first, then run this script again."
    exit 0
fi

# Test the Python script
echo "🧪 Testing voice embedding script..."
PYTHON_SCRIPT="server/utils/voice_embedding.py"

if [ ! -f "$PYTHON_SCRIPT" ]; then
    echo "❌ Python script not found at $PYTHON_SCRIPT"
    exit 1
fi

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Make sure you've run: huggingface-cli login"
echo "2. Test with a sample audio file:"
echo "   python3 server/utils/voice_embedding.py path/to/audio.wav"
echo "3. The system will automatically use pyannote.audio when available"
echo ""
