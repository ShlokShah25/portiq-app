#!/bin/bash

# Voice Recognition Setup Script
# This script sets up pyannote.audio for accurate voice recognition

echo "🎤 Setting up Voice Recognition (pyannote.audio)"
echo "================================================"
echo ""

# Step 1: Check Python
echo "📋 Step 1: Checking Python installation..."
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install it first:"
    echo "   macOS: brew install python3"
    echo "   Linux: sudo apt-get install python3 python3-pip"
    exit 1
fi
echo "✅ Python 3 found: $(python3 --version)"
echo ""

# Step 2: Install Python dependencies
echo "📦 Step 2: Installing Python dependencies..."
echo "This may take a few minutes..."
pip3 install pyannote.audio torch torchaudio numpy scipy huggingface_hub
if [ $? -ne 0 ]; then
    echo "❌ Failed to install Python dependencies"
    exit 1
fi
echo "✅ Python dependencies installed"
echo ""

# Step 3: HuggingFace setup
echo "🔐 Step 3: HuggingFace Authentication"
echo "======================================"
echo ""
echo "You need to:"
echo "1. Go to https://huggingface.co/pyannote/embedding"
echo "2. Click 'Accept' to accept the terms"
echo "3. Go to https://huggingface.co/settings/tokens"
echo "4. Create a new token (read access is enough)"
echo "5. Copy the token"
echo ""
read -p "Press Enter when you have your HuggingFace token ready..."
echo ""
echo "Now logging in to HuggingFace..."
huggingface-cli login
if [ $? -ne 0 ]; then
    echo "❌ HuggingFace login failed"
    echo "You can also set the token manually:"
    echo "   export HF_TOKEN=your_token_here"
    exit 1
fi
echo "✅ HuggingFace authentication complete"
echo ""

# Step 4: Verify setup
echo "🧪 Step 4: Testing setup..."
cd server/utils
if [ -f "voice_embedding.py" ]; then
    echo "✅ voice_embedding.py found"
else
    echo "❌ voice_embedding.py not found"
    exit 1
fi

# Make script executable
chmod +x voice_embedding.py
echo "✅ Script is executable"
echo ""

echo "================================================"
echo "✅ Setup Complete!"
echo "================================================"
echo ""
echo "The system will now use pyannote.audio for voice recognition."
echo "Expected accuracy: 85-95% in ideal conditions, 70-90% in real-world."
echo ""
echo "To test, restart your backend server and check the logs when"
echo "someone records their voice. You should see:"
echo "  '🎤 Generating voice embedding using pyannote.audio...'"
echo ""
