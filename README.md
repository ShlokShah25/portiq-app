# PortIQ

An AI meeting assistant that turns conversations into clear summaries and action items — with dedicated
product verticals for schools (Education mode) and clinics (Cura).

## Product verticals

The client is a single React app that renders differently based on `PRODUCT` (`workplace` | `education` |
`cura`, see `client/src/config/product.js`):

- **Workplace** (default) — meetings, participants, transcripts, insights, interview mode.
- **Education** — lectures instead of meetings, classrooms/students instead of participants, teacher and
  school-admin dashboards (`TeacherDashboard.js`, `EducationAdminDashboard.js`).
- **Cura** — a clinic vertical (patients, prescriptions, follow-ups, consultations) under `client/src/cura/`.

Product-specific copy is centralized in `client/src/config/terminology.js`.

## Features

### Meeting / Lecture capture
- ✅ Meeting/lecture room management
- ✅ Audio recording support
- ✅ **Automatic transcription** using OpenAI Whisper
- ✅ **AI-powered summaries** with key points and action items
- ✅ Automatic distribution to participants

### SaaS
- ✅ Signup, pricing, Razorpay billing
- ✅ Trial onboarding tutorial (product-aware — see `TrialExperienceProvider.js`)
- ✅ Admin panel (`/admin` route inside the client, backed by `/api/admin`)

## Tech Stack

- **Backend**: Node.js, Express, MongoDB, Mongoose
- **Frontend**: React, React Router
- **AI/ML**: OpenAI API (Whisper + GPT-4)
- **Billing**: Razorpay
- **Notifications**: Twilio (WhatsApp), Resend/Nodemailer (email)

## Setup Instructions

### 1. Prerequisites
- Node.js (v14 or higher)
- MongoDB (local or cloud)
- OpenAI API key (for meeting transcription)

### 2. Installation

```bash
npm run install-all
```

### 3. Environment Variables

Create a `.env` file in the root directory:

```env
# Server
PORT=5001
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/portiq

# JWT
JWT_SECRET=your_jwt_secret_key

# OpenAI (for meeting transcription)
OPENAI_API_KEY=sk-your-openai-api-key

# Default Admin
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=admin123
```

### 4. Start the Application

```bash
# Start server
npm start

# In a separate terminal
npm run client  # Start the React client
```

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

## Project Structure

```
portiq-app/
├── server/
│   ├── models/            # Meeting, Admin, Clinic/Patient (Cura), Config...
│   ├── routes/            # meetings, admin, cura, saas, billing, auth...
│   └── utils/              # transcription, email, PDF, voice recognition...
├── client/                # Main React app (workplace / education / cura)
├── admin/                 # Legacy standalone admin panel (meetings/config only)
└── uploads/
    └── meetings/           # Meeting audio + generated assets
```

## License

ISC
