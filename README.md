# Workplace Visitor Management System

A comprehensive visitor management system for workplaces with meeting transcription capabilities.

## Features

### Visitor Management
- ✅ Visitor entry with photo capture
- ✅ **Visitor Categories** with pastel-colored badges:
  - Client (Light Pink)
  - Interview Candidate (Powder Blue)
  - Vendor (Plum)
  - Delivery (Pale Green)
  - Contractor (Khaki)
- ✅ **Visitor Pass Generation** - Professional badge with photo, details, QR code, and logo
- ✅ QR code generation and WhatsApp delivery
- ✅ QR-based and manual checkout
- ✅ Visitor ID generation (format: B03D7282)
- ✅ Meeting room assignment

### Meeting Transcription
- ✅ Meeting room management
- ✅ Audio recording support
- ✅ **Automatic transcription** using OpenAI Whisper
- ✅ **AI-powered summaries** with key points and action items
- ✅ Automatic distribution to meeting participants

### Admin Panel
- ✅ Visitor management dashboard
- ✅ Category-based filtering and analytics
- ✅ Meeting management
- ✅ Reports and statistics

## Tech Stack

- **Backend**: Node.js, Express, MongoDB, Mongoose
- **Frontend**: React, React Router
- **AI/ML**: OpenAI API (Whisper + GPT-4)
- **QR Codes**: qrcode library
- **Badge Generation**: Canvas (node-canvas)
- **Notifications**: Twilio (WhatsApp)

## Setup Instructions

### 1. Prerequisites
- Node.js (v14 or higher)
- MongoDB (local or cloud)
- OpenAI API key (for meeting transcription)
- Twilio account (optional, for WhatsApp)

### 2. Installation

```bash
# Navigate to project directory
cd "Workplace Visitor Management"

# Install dependencies
npm run install-all
```

### 3. Environment Variables

Create a `.env` file in the root directory:

```env
# Server
PORT=5001
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/workplace_visitor_management

# JWT
JWT_SECRET=your_jwt_secret_key

# OpenAI (for meeting transcription)
OPENAI_API_KEY=sk-your-openai-api-key

# Twilio (optional, for WhatsApp)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# Default Admin
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=admin123
```

### 4. Start the Application

```bash
# Start server
npm start

# In separate terminals:
npm run client  # Start kiosk interface
npm run admin   # Start admin panel
```

## Visitor Categories

Each category has a unique pastel color for easy identification:

| Category | Color | Use Case |
|----------|-------|----------|
| Client | Light Pink (#FFB6C1) | Business clients and partners |
| Interview Candidate | Powder Blue (#B0E0E6) | Job candidates |
| Vendor | Plum (#DDA0DD) | Suppliers and vendors |
| Delivery | Pale Green (#98FB98) | Package deliveries |
| Contractor | Khaki (#F0E68C) | External contractors |

## Meeting Transcription

### How It Works

1. **Create Meeting**: Admin creates a meeting with transcription enabled
2. **Start Meeting**: Meeting status changes to "In Progress"
3. **Record Audio**: Upload audio file when meeting ends
4. **Automatic Processing**:
   - Audio transcribed using OpenAI Whisper
   - Summary generated using GPT-4
   - Key points and action items extracted
5. **Distribution**: Summary sent to all participants

### API Endpoints

- `POST /api/meetings` - Create meeting
- `POST /api/meetings/:id/start` - Start meeting
- `POST /api/meetings/:id/end` - End meeting and upload audio
- `GET /api/meetings` - Get all meetings

## Visitor Pass Template

The visitor pass includes:
- **Circular photo** (top left)
- **Visitor name** (bold)
- **Company name** (if provided)
- **Employee to meet**
- **Date and time**
- **Visitor ID** (B03D7282 format)
- **Category badge** (colored)
- **QR code** (bottom right)
- **Company logo** (top right)

## Project Structure

```
Workplace Visitor Management/
├── server/
│   ├── models/
│   │   ├── Visitor.js          # Visitor model with categories
│   │   └── Meeting.js          # Meeting model
│   ├── routes/
│   │   ├── visitors.js          # Visitor routes
│   │   └── meetings.js          # Meeting routes
│   └── utils/
│       ├── visitorPassGenerator.js  # Badge generation
│       └── meetingTranscription.js  # AI transcription
├── client/                      # Kiosk interface
├── admin/                       # Admin panel
└── uploads/
    ├── visitors/               # Visitor photos
    ├── visitor-passes/         # Generated badges
    └── meetings/               # Meeting audio files
```

## Next Steps

1. **Customize Colors**: Edit `VISITOR_CATEGORIES` in `server/models/Visitor.js`
2. **Add Company Logo**: Place logo in `client/public/assets/logo.png`
3. **Configure Meeting Rooms**: Add meeting rooms in admin panel
4. **Set Up Email**: Integrate email service for meeting summaries

## Development Status

- ✅ Core visitor management
- ✅ Category system with colors
- ✅ Visitor pass generation
- ✅ Meeting transcription structure
- ⏳ Frontend components (in progress)
- ⏳ Admin panel customization (in progress)

## License

ISC
