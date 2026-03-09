# 📱 Tablet Deployment Guide

This guide will help you deploy the Workplace Visitor Management system on a tablet for production use.

## 🎯 Deployment Options

### Option 1: Local Network Deployment (Recommended for Office/Workplace) ⭐

The tablet connects to a server on the same network (WiFi).

**Requirements:**
- Tablet and server on the same WiFi network
- Server running the backend
- Tablet accessing the frontend via browser

---

## 📋 Step-by-Step Deployment

### Step 1: Build the Frontend for Production

Build the React apps for production (optimized and faster):

```bash
cd "/Users/shloktheproducer/Desktop/Workplace Visitor Management"

# Build the kiosk client (tablet interface)
cd client
npm run build
cd ..

# Build the admin panel (optional, for admin access)
cd admin
npm run build
cd ..
```

This creates optimized production builds in:
- `client/build/` - Kiosk interface
- `admin/build/` - Admin panel

### Step 2: Configure Backend to Serve Static Files

The backend will serve the built React apps. Update `server/index.js` to serve static files:

```javascript
// Serve React apps
app.use(express.static(path.join(__dirname, '../client/build')));
app.use('/admin', express.static(path.join(__dirname, '../admin/build')));

// API routes should come before static file serving
app.use('/api', require('./routes/...'));
```

### Step 3: Set Up Environment Variables

Ensure your `.env` file has:

```env
# Server Configuration
PORT=5001
NODE_ENV=production

# MongoDB (use cloud MongoDB for production)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/workplace_visitor_management

# HuggingFace Token (for voice recognition)
HF_TOKEN=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

# Email Configuration
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=your-email@gmail.com
MAIL_PASS=your-app-password
MAIL_FROM="Meeting Assistant <your-email@gmail.com>"

# Other configurations...
```

### Step 4: Find Your Server's IP Address

On the server machine, find its local IP address:

**macOS/Linux:**
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
# Or
ipconfig getifaddr en0  # macOS
```

**Windows:**
```cmd
ipconfig
# Look for IPv4 Address under your network adapter
```

You'll get something like: `192.168.0.155` or `10.0.0.5`

### Step 5: Start the Backend Server

On the server machine:

```bash
cd "/Users/shloktheproducer/Desktop/Workplace Visitor Management"
npm start
```

The server should show:
```
🚀 Server running on 0.0.0.0:5001
📱 Access from tablet: http://192.168.0.155:5001
```

### Step 6: Access from Tablet

On the tablet:

1. **Connect to the same WiFi network** as the server
2. **Open a web browser** (Chrome, Safari, etc.)
3. **Navigate to:** `http://[SERVER_IP]:5001`
   - Example: `http://192.168.0.155:5001`
4. **For admin panel:** `http://[SERVER_IP]:5001/admin`
   - Example: `http://192.168.0.155:5001/admin`

---

## 🔧 Advanced Configuration

### Make Backend Run on Startup (macOS)

Create a launch daemon to auto-start the server:

1. Create a plist file:
```bash
sudo nano /Library/LaunchDaemons/com.workplace.visitor.plist
```

2. Add this content (adjust paths):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.workplace.visitor</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/shloktheproducer/Desktop/Workplace Visitor Management/server/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/shloktheproducer/Desktop/Workplace Visitor Management</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/workplace-visitor.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/workplace-visitor-error.log</string>
</dict>
</plist>
```

3. Load the service:
```bash
sudo launchctl load /Library/LaunchDaemons/com.workplace.visitor.plist
```

### Set Up Kiosk Mode on Tablet

**For iPad (iOS):**

1. Enable **Guided Access**:
   - Settings → Accessibility → Guided Access → ON
2. Open the app in Safari
3. Triple-click home button → Start Guided Access
4. This locks the tablet to the app

**For Android Tablet:**

1. Install a kiosk browser app (e.g., "Kiosk Browser Lock")
2. Set the app URL
3. Enable kiosk mode

**Alternative: Use Chrome Kiosk Mode**

1. Install Chrome on tablet
2. Add to home screen (creates app icon)
3. Use full-screen mode

---

## 🌐 Option 2: Cloud Deployment (For Remote Access)

If you want to access the system from anywhere:

### Using ngrok (Quick Testing)

```bash
# Install ngrok
brew install ngrok  # macOS
# Or download from https://ngrok.com

# Start your backend
npm start

# In another terminal, start ngrok
ngrok http 5001

# You'll get a public URL like: https://abc123.ngrok.io
# Access from tablet: https://abc123.ngrok.io
```

### Using a Cloud Service (Production)

Deploy to:
- **Heroku** (easy, free tier available)
- **DigitalOcean** (VPS)
- **AWS EC2** (scalable)
- **Railway** (simple deployment)

---

## ✅ Verification Checklist

- [ ] Frontend apps built (`npm run build`)
- [ ] Backend configured to serve static files
- [ ] `.env` file configured with all credentials
- [ ] Server IP address identified
- [ ] Backend server running
- [ ] Tablet connected to same WiFi
- [ ] Can access app from tablet browser
- [ ] Voice recording works (test it!)
- [ ] Meeting creation works
- [ ] Email notifications work

---

## 🐛 Troubleshooting

### "Cannot connect to server"

1. **Check WiFi:** Ensure tablet and server are on the same network
2. **Check firewall:** Server firewall might be blocking port 5001
   ```bash
   # macOS: Allow incoming connections
   # System Preferences → Security → Firewall → Allow incoming connections
   ```
3. **Check IP address:** Verify server IP hasn't changed
4. **Test from another device:** Try accessing from a phone/computer on the same network

### "CORS error"

- Backend CORS is already configured for local network IPs
- If you see CORS errors, check the server logs

### "Voice recognition not working"

- Ensure `HF_TOKEN` is set in `.env`
- Check Python dependencies are installed on the server
- Verify `pyannote.audio` model is downloaded

### "Port already in use"

```bash
# Find and kill process on port 5001
lsof -ti:5001 | xargs kill -9
```

---

## 📱 Quick Start Script

Create a startup script for easy deployment:

```bash
#!/bin/bash
# save as: start-tablet-server.sh

cd "/Users/shloktheproducer/Desktop/Workplace Visitor Management"

# Get local IP
IP=$(ipconfig getifaddr en0)
echo "🌐 Server will be accessible at: http://$IP:5001"

# Start server
npm start
```

Make it executable:
```bash
chmod +x start-tablet-server.sh
```

Run it:
```bash
./start-tablet-server.sh
```

---

## 🎉 You're Ready!

Once deployed, your tablet will have:
- ✅ Full meeting management interface
- ✅ Voice recognition for participants
- ✅ Meeting transcription and summaries
- ✅ Email notifications
- ✅ Admin panel access

**Access URLs:**
- **Kiosk (Tablet):** `http://[SERVER_IP]:5001`
- **Admin Panel:** `http://[SERVER_IP]:5001/admin`

Enjoy your deployed system! 🚀
