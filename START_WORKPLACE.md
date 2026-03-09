# Starting the Workplace Visitor Management System

## Two Separate Projects

### School System (Port 3000 & 5000)
- **Location**: `/Users/shloktheproducer/Desktop/Kiosk Managegement`
- **Client**: Port 3000
- **Server**: Port 5000
- **Database**: `kiosk_management`

### Workplace System (Port 3002 & 5001)
- **Location**: `/Users/shloktheproducer/Desktop/Workplace Visitor Management`
- **Client**: Port 3002
- **Server**: Port 5001
- **Database**: `workplace_visitor_management`

## How to Run Both Systems

### Terminal 1: School Server
```bash
cd "/Users/shloktheproducer/Desktop/Kiosk Managegement"
npm start
```
Runs on **port 5000**

### Terminal 2: School Client
```bash
cd "/Users/shloktheproducer/Desktop/Kiosk Managegement/client"
npm start
```
Opens on **http://localhost:3000**

### Terminal 3: Workplace Server
```bash
cd "/Users/shloktheproducer/Desktop/Workplace Visitor Management"
npm start
```
Runs on **port 5001**

### Terminal 4: Workplace Client
```bash
cd "/Users/shloktheproducer/Desktop/Workplace Visitor Management/client"
npm start
```
Opens on **http://localhost:3002**

## Quick Test

1. **School System**: http://localhost:3000
2. **Workplace System**: http://localhost:3002

Both systems are completely independent and can run simultaneously!

## Workplace Features

✅ **Visitor Categories** with pastel colors:
- Client (Light Pink)
- Interview Candidate (Powder Blue)
- Vendor (Plum)
- Delivery (Pale Green)
- Contractor (Khaki)

✅ **Formal, Professional UI**
✅ **Visitor Pass Generation** (with category colors)
✅ **Meeting Transcription** (when enabled)
✅ **All workplace-specific fields** (company, email, department, meeting room)

## Notes

- School system uses port 5000/3000
- Workplace system uses port 5001/3002
- They use different databases
- They are completely separate projects
