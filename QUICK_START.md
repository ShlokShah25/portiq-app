# Quick Start Guide

## Step 1: Install Dependencies

```bash
cd "/Users/shloktheproducer/Desktop/Workplace Visitor Management"
npm install
```

This will install all server dependencies.

## Step 2: Create .env File

```bash
# Copy the example file
cp .env.example .env

# Then edit .env with your credentials:
# - MONGODB_URI (your MongoDB connection string)
# - OPENAI_API_KEY (for meeting transcription)
# - TWILIO credentials (optional, for WhatsApp)
```

## Step 3: Start the Server

```bash
npm start
```

You should see:
```
✅ Connected to MongoDB
✅ Default admin user created
🚀 Server running on port 5001
```

## Step 4: Test the API

Open your browser and go to:
```
http://localhost:5001/api/health
```

You should see:
```json
{
  "status": "OK",
  "message": "Workplace Visitor Management System API",
  "version": "1.0.0"
}
```

## Common Issues

### "No such file or directory"
- Make sure you're in the correct directory: `cd "/Users/shloktheproducer/Desktop/Workplace Visitor Management"`
- Run `npm install` first to create node_modules

### "Cannot find module"
- Run `npm install` to install dependencies
- Make sure all files are in the correct locations

### MongoDB connection error
- Check your MONGODB_URI in .env file
- Make sure MongoDB is running/accessible

## Next Steps

1. Install client and admin frontends (copy from school project)
2. Customize for workplace use
3. Set up OpenAI API key for meeting transcription
