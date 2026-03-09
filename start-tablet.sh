#!/bin/bash

# Script to start the Workplace Visitor Management system for tablet access

echo "🚀 Starting Workplace Visitor Management System for Tablet Access"
echo ""

# Get local IP address
IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)

if [ -z "$IP" ]; then
  IP=$(hostname -I | awk '{print $1}')
fi

echo "📱 Your computer's IP address: $IP"
echo ""
echo "📋 Access URLs:"
echo "   Kiosk:  http://$IP:3002"
echo "   Admin:  http://$IP:3003"
echo ""
echo "💡 Make sure your tablet is on the same Wi-Fi network!"
echo ""

# Start backend
echo "🔧 Starting backend server..."
cd "$(dirname "$0")"
HOST=0.0.0.0 PORT=5001 npm start &
BACKEND_PID=$!

# Wait a bit for backend to start
sleep 3

# Start client (kiosk)
echo "🖥️  Starting kiosk client..."
cd client
BROWSER=none HOST=0.0.0.0 PORT=3002 npm start &
CLIENT_PID=$!

# Start admin
echo "⚙️  Starting admin panel..."
cd ../admin
BROWSER=none HOST=0.0.0.0 PORT=3003 npm start &
ADMIN_PID=$!

echo ""
echo "✅ All services started!"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for user interrupt
trap "kill $BACKEND_PID $CLIENT_PID $ADMIN_PID 2>/dev/null; exit" INT TERM
wait
