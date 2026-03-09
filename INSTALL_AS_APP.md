# 📱 Install as App on Tablet

This guide shows you how to install the Meeting Assistant as a native-like app on your tablet.

## 🎯 Quick Steps

### For iPad (iOS)

1. **Open Safari** on your iPad (not Chrome - Safari is required for "Add to Home Screen")

2. **Navigate to the app:**
   ```
   http://192.168.0.155:5001
   ```

3. **Tap the Share button** (square with arrow pointing up) at the bottom

4. **Scroll down and tap "Add to Home Screen"**

5. **Edit the name** (optional) - it will say "Meeting Assistant"

6. **Tap "Add"** in the top right

7. **Done!** You'll see the app icon on your home screen

8. **Open it like a regular app** - it will run in full-screen mode!

---

### For Android Tablet

1. **Open Chrome** on your Android tablet

2. **Navigate to the app:**
   ```
   http://192.168.0.155:5001
   ```

3. **Tap the menu** (three dots) in the top right

4. **Tap "Add to Home screen"** or "Install app"

5. **Tap "Add"** or "Install"

6. **Done!** The app icon will appear on your home screen

7. **Open it like a regular app**

---

## ✅ After Installation

- The app will open in **full-screen mode** (no browser bars)
- It will look and feel like a **native app**
- You can **pin it to your home screen** for easy access
- It will **remember your login** (if applicable)

---

## 🔧 Troubleshooting

### "Add to Home Screen" option not showing?

**iPad:**
- Make sure you're using **Safari** (not Chrome)
- Make sure the site is fully loaded
- Try refreshing the page

**Android:**
- Make sure you're using **Chrome**
- The site must be served over HTTPS (or local network)
- Try refreshing the page

### App opens in browser instead of standalone?

- Make sure you installed it correctly
- Delete the shortcut and re-add it
- On Android, check if "Open in Chrome" is enabled in app settings

### Can't connect to server?

- Make sure tablet and server are on **same WiFi network**
- Check server IP hasn't changed: `ipconfig getifaddr en0`
- Make sure server is running: `npm start`

---

## 🎨 Customize App Icon

To change the app icon:

1. Replace `client/public/assets/portiq-logo.png` with your icon
2. Icon should be:
   - **512x512 pixels** (recommended)
   - **PNG format**
   - **Square** (will be rounded automatically)

3. Rebuild the app:
   ```bash
   cd client
   npm run build
   cd ..
   ```

4. Restart server and reinstall on tablet

---

## 🚀 Benefits of Installing as App

✅ **No browser address bar** - cleaner interface  
✅ **Full-screen experience** - looks like native app  
✅ **Quick access** - tap icon to open  
✅ **Works offline** - basic functionality cached  
✅ **No WiFi portal issues** - app bypasses browser redirects  

---

## 📝 Notes

- The app will still need internet connection for API calls
- First time opening might take a moment to load
- Updates require rebuilding and reinstalling (or clearing cache)

Enjoy your native-like app experience! 🎉
