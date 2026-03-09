#!/bin/bash

echo "🚀 Deploying Workplace Visitor Management for Tablet..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the project directory
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$PROJECT_DIR"

echo -e "${YELLOW}Step 1: Building frontend apps...${NC}"
echo ""

# Build client (kiosk/tablet interface)
echo "📱 Building kiosk client..."
cd client
if npm run build; then
    echo -e "${GREEN}✅ Client built successfully${NC}"
else
    echo "❌ Client build failed"
    exit 1
fi
cd ..

# Build admin panel
echo ""
echo "🔧 Building admin panel..."
cd admin
if npm run build; then
    echo -e "${GREEN}✅ Admin panel built successfully${NC}"
else
    echo "❌ Admin panel build failed"
    exit 1
fi
cd ..

echo ""
echo -e "${YELLOW}Step 2: Getting server IP address...${NC}"
# Get local IP address
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    IP=$(hostname -I | awk '{print $1}')
else
    IP="localhost"
fi

echo ""
echo -e "${GREEN}✅ Build complete!${NC}"
echo ""
echo "📋 Next steps:"
echo "   1. Start the server: npm start"
echo "   2. Access from tablet: http://$IP:5001"
echo "   3. Admin panel: http://$IP:5001/admin"
echo ""
echo "💡 Make sure:"
echo "   - Tablet is on the same WiFi network"
echo "   - Server firewall allows port 5001"
echo "   - .env file is configured correctly"
echo ""
