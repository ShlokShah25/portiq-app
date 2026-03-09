#!/bin/bash

echo "🌐 Finding your server IP address..."
echo ""

# Try different methods to get IP
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    echo "📱 Your server IP addresses:"
    echo ""
    
    # Method 1: Using ipconfig (most reliable on macOS)
    IP1=$(ipconfig getifaddr en0 2>/dev/null)
    if [ ! -z "$IP1" ]; then
        echo "   WiFi (en0): $IP1"
    fi
    
    IP2=$(ipconfig getifaddr en1 2>/dev/null)
    if [ ! -z "$IP2" ]; then
        echo "   Ethernet (en1): $IP2"
    fi
    
    # Method 2: Using ifconfig
    echo ""
    echo "   All network interfaces:"
    ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print "   - " $2}'
    
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    echo "📱 Your server IP address:"
    hostname -I | awk '{print "   " $1}'
    
else
    echo "❌ Unsupported OS"
fi

echo ""
echo "💡 Use the IP address that matches your WiFi network"
echo "   (Usually starts with 192.168.x.x or 10.x.x.x)"
echo ""
echo "📱 Access from tablet: http://[IP]:5001"
echo ""
