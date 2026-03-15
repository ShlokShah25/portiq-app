const express = require('express');
const router = express.Router();
const Meeting = require('../models/Meeting');
const VoiceProfile = require('../models/VoiceProfile');
const { transcribeAndSummarize, sendMeetingSummary, getMailTransporter } = require('../utils/meetingTranscription');
const { getPlanConstraints } = require('../utils/planConstraints');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const { generateVoiceEmbedding } = require('../utils/voiceRecognition');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for audio uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/meetings');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'meeting-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Configure multer for voice samples
const voiceStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/voice-samples');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const email = req.body.email || 'unknown';
    const sanitizedEmail = email.replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, `voice-${sanitizedEmail}-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/webm', 'audio/x-m4a', 'audio/mp4'];
    const allowedExtensions = ['.mp3', '.wav', '.m4a', '.webm', '.mp4', '.ogg', '.flac'];
    
    // Check MIME type first
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    
    // Fallback: check file extension
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
      return;
    }
    
    cb(new Error(`Only audio files are allowed. Received: ${file.mimetype || 'unknown'} (${ext || 'no extension'})`), false);
  }
});

const voiceUpload = multer({
  storage: voiceStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for voice samples
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/webm', 'audio/x-m4a', 'audio/mp4'];
    const allowedExtensions = ['.mp3', '.wav', '.m4a', '.webm', '.mp4', '.ogg'];
    
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
      return;
    }
    
    cb(new Error('Only audio files are allowed for voice samples'), false);
  }
});

// Helper to read admin (and thus plan) from bearer token, but keep routes usable
// even if called from unauthenticated contexts.
async function getAdminFromRequest(req) {
  try {
    const header = req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.replace('Bearer ', '') : null;
    if (!token) return null;
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key');
    if (!decoded.id) return null;
    const admin = await Admin.findById(decoded.id).select('-password');
    return admin;
  } catch {
    return null;
  }
}

function canAccessMeeting(meeting, admin) {
  if (!meeting) return false;
  if (!admin || admin.username === 'admin') return true;
  if (!meeting.adminId) return true;
  return String(meeting.adminId) === String(admin._id);
}

/**
 * Create new meeting
 */
router.post('/', async (req, res) => {
  try {
    const { meetingRoom, title, organizer, participants, startTime, scheduledTime, sendNotification, transcriptionEnabled, authorizedEditorEmail } = req.body;
    
    if (!meetingRoom || !title || !organizer) {
      return res.status(400).json({ error: 'Meeting room, title, and organizer are required' });
    }

    const admin = await getAdminFromRequest(req);
    // If authenticated, require active subscription to create meetings
    if (admin && admin.username !== 'admin' && !admin.hasActiveSubscription) {
      return res.status(403).json({
        error: 'No active subscription. Please purchase a plan to create meetings.',
        code: 'NO_SUBSCRIPTION',
      });
    }
    const planInfo = getPlanConstraints(admin);

    // Enforce max participants per plan
    if (
      planInfo.maxParticipants &&
      Array.isArray(participants) &&
      participants.length > planInfo.maxParticipants
    ) {
      return res.status(400).json({
        error: `Your ${planInfo.plan} plan allows up to ${planInfo.maxParticipants} participants per meeting.`,
      });
    }

    const meeting = new Meeting({
      adminId: admin ? admin._id : null,
      meetingRoom,
      title,
      organizer,
      participants: participants || [],
      startTime: null, // Set when user clicks "Start recording", not at creation
      scheduledTime: scheduledTime ? new Date(scheduledTime) : null,
      transcriptionEnabled: transcriptionEnabled === true,
      authorizedEditorEmail: authorizedEditorEmail || null
    });

    // Generate verification code for authorized editor if specified
    if (authorizedEditorEmail && transcriptionEnabled) {
      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      // Set expiry to 7 days from now (plenty of time for meeting to happen and be processed)
      meeting.editorVerificationCode = otp;
      meeting.editorVerificationExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }

    await meeting.save();

    // Send separate verification code email to authorized editor (if specified)
    if (authorizedEditorEmail && transcriptionEnabled && meeting.editorVerificationCode) {
      const transporter = getMailTransporter();
      if (transporter) {
        try {
          const logoUrl = process.env.COMPANY_LOGO_URL || 'https://portiqtechnologies.com/logo.png';
          
          // Send verification code in a separate email
          await transporter.sendMail({
            from: process.env.MAIL_FROM || process.env.MAIL_USER,
            to: authorizedEditorEmail,
            subject: `Verification Code - ${meeting.title} | PortIQ Meeting Assistant`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #111827; line-height: 1.6;">
                <div style="text-align: left; margin-bottom: 16px;">
                  <img src="${logoUrl}" alt="PortIQ Technologies" style="max-width: 160px; height: auto; display: block; margin-bottom: 12px;" />
                </div>
                <p>Hello,</p>
                <p>
                  You have been selected as the authorized editor for the meeting: <strong>${meeting.title}</strong>
                </p>
                <p>
                  <strong>Meeting Details:</strong><br/>
                  Title: ${meeting.title}<br/>
                  Location: ${meeting.meetingRoom}<br/>
                  ${meeting.scheduledTime ? `Scheduled Time: ${new Date(meeting.scheduledTime).toLocaleString()}<br/>` : ''}
                  Organizer: ${meeting.organizer}
                </p>
                <p>
                  Once the meeting is completed, an AI-generated summary will be created. You will be responsible for reviewing, proofreading, and editing the summary before it is distributed to all participants.
                </p>
                <p>
                  <strong>Your unique verification code is:</strong>
                </p>
                <div style="background: #f3f4f6; padding: 24px; border-radius: 8px; text-align: center; margin: 24px 0; border: 2px solid #2563eb;">
                  <p style="margin: 0 0 12px 0; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Verification Code</p>
                  <h1 style="margin: 0; font-size: 36px; letter-spacing: 6px; color: #2563eb; font-weight: 700;">${meeting.editorVerificationCode}</h1>
                </div>
                <p style="color: #6b7280; font-size: 13px; background: #fef3c7; padding: 12px; border-radius: 6px; border-left: 4px solid #f59e0b;">
                  <strong>Important:</strong> Please save this code securely. You will need it to access the summary review interface once the meeting is completed and the summary is generated. This code will expire in 7 days.
                </p>
                <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">
                  You will receive a notification when the summary is ready for your review. At that time, you can use this code to access the summary, make any necessary edits, and approve it for distribution to all meeting participants.
                </p>
                <br/>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                <p style="margin: 0;">
                  <strong>PortIQ Meeting Assistant</strong>
                </p>
                <p style="margin: 8px 0 0 0; font-size: 13px; color: #4b5563;">
                  This is an automated notification from the PortIQ Meeting Assistant.
                </p>
              </div>
            `
          });
          console.log('✅ Verification code sent separately to authorized editor:', authorizedEditorEmail);
        } catch (emailErr) {
          console.warn('⚠️  Failed to send verification code email to authorized editor:', emailErr.message);
        }
      }
    }

    // Send meeting notification email to participants (if configured and enabled)
    if (sendNotification === true) {
      try {
        const transporter = getMailTransporter();
      const participantEmails = (participants || [])
        .map(p => p.email)
        .filter(Boolean);

      if (sendNotification && transporter && participantEmails.length > 0) {
        const when = meeting.scheduledTime || meeting.startTime;
        const whenText = when ? new Date(when).toLocaleString() : 'Not specified';

        const logoUrl = process.env.COMPANY_LOGO_URL || 'https://portiqtechnologies.com/logo.png';

        await transporter.sendMail({
          from: process.env.MAIL_FROM || process.env.MAIL_USER,
          to: participantEmails.join(','),
          subject: `Meeting Scheduled – ${meeting.title} | PortIQ Meeting Assistant`,
          text: [
            'Hello,',
            '',
            'You have a meeting scheduled with the following details:',
            '',
            `Title: ${meeting.title}`,
            `Venue: ${meeting.meetingRoom}`,
            `Time: ${whenText}`,
            '',
            'Please arrive a few minutes early to ensure a prompt start.',
            '',
            'This is an automated notification from the PortIQ Meeting Assistant.',
            '',
            '---',
            'PortIQ Meeting Assistant'
          ].join('\n'),
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #111827; line-height: 1.6;">
              <div style="text-align: left; margin-bottom: 16px;">
                <img src="${logoUrl}" alt="PortIQ Technologies" style="max-width: 160px; height: auto; display: block; margin-bottom: 12px;" />
              </div>
              <p>Hello,</p>
              <p>You have a meeting scheduled with the following details:</p>
              <p>
                <strong>Title:</strong> ${meeting.title}<br/>
                <strong>Venue:</strong> ${meeting.meetingRoom}<br/>
                <strong>Time:</strong> ${whenText}
              </p>
              <p>Please arrive a few minutes early so that the discussion can start on time.</p>
              <br/>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
              <p style="margin: 0;">
                <strong>PortIQ Meeting Assistant</strong>
              </p>
              <p style="margin: 8px 0 0 0; font-size: 13px; color: #4b5563;">
                This is an automated notification from the PortIQ Meeting Assistant.
              </p>
            </div>
          `
        });
      }
      } catch (notifyErr) {
        console.warn('⚠️  Failed to send meeting notification email:', notifyErr.message);
      }
    }

    res.status(201).json({ success: true, meeting });
  } catch (error) {
    console.error('Error creating meeting:', error);
    const errorMessage = error.message || 'Failed to create meeting';
    const statusCode = error.name === 'ValidationError' ? 400 : 500;
    res.status(statusCode).json({ error: errorMessage, details: error.errors });
  }
});

/**
 * Start meeting (begin transcription)
 */
router.post('/:id/start', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });
    meeting.status = 'In Progress';
    // Do NOT set startTime here - it will be set when recording starts
    // Do NOT mark as 'Recording' here; actual recording is controlled by the client.
    // Keep transcriptionStatus as-is or 'Not Started' to avoid confusion.
    if (meeting.transcriptionEnabled && meeting.transcriptionStatus === 'Not Started') {
      meeting.transcriptionStatus = 'Not Started';
    }
    await meeting.save();

    res.json({ success: true, meeting });
  } catch (error) {
    console.error('Error starting meeting:', error);
    res.status(500).json({ error: 'Failed to start meeting' });
  }
});

/**
 * Start recording (sets actual start time)
 */
router.post('/:id/start-recording', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });
    // Set actual start time when recording begins
    if (!meeting.startTime) {
      meeting.startTime = new Date();
    }
    meeting.status = 'In Progress';
    if (meeting.transcriptionEnabled) {
      meeting.transcriptionStatus = 'Recording';
    }
    await meeting.save();

    res.json({ success: true, meeting });
  } catch (error) {
    console.error('Error starting recording:', error);
    res.status(500).json({ error: 'Failed to start recording' });
  }
});

/**
 * End meeting and process transcription
 */
router.post('/:id/end', upload.single('audio'), async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });
    meeting.status = 'Completed';
    meeting.endTime = new Date();
    meeting.transcriptionStatus = 'Processing';

    // Apply duration limit per plan (backend safety net).
    const { maxDurationMinutes, plan: planName } = getPlanConstraints(admin);
    if (maxDurationMinutes && meeting.startTime) {
      const started = new Date(meeting.startTime);
      const ended = new Date(meeting.endTime);
      const actualMinutes = Math.max(
        0,
        Math.round((ended.getTime() - started.getTime()) / 60000)
      );
      if (actualMinutes > maxDurationMinutes) {
        console.warn(
          `Meeting ${meeting._id} exceeded duration limit for plan ${planName}: ${actualMinutes}min > ${maxDurationMinutes}min`
        );
      }
    }

    // Helper to safely parse dates from AI output
    const safeParseDate = (value) => {
      if (!value) return undefined;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? undefined : d;
    };

    // Process transcription if audio file exists (either newly uploaded or existing)
    const audioFilePath = req.file 
      ? req.file.path 
      : (meeting.audioFile ? path.join(__dirname, '../..', meeting.audioFile) : null);

    if (audioFilePath && fs.existsSync(audioFilePath) && meeting.transcriptionEnabled) {
      // If new file uploaded, update the audioFile path
      if (req.file) {
        meeting.audioFile = `/uploads/meetings/${req.file.filename}`;
      }
      await meeting.save();

      // Process transcription asynchronously. Use findByIdAndUpdate instead of
      // saving the in-memory document to avoid VersionError on stale docs.
      transcribeAndSummarize(audioFilePath, meeting)
        .then(async (summaryData) => {
          const safeActionItems = (summaryData.actionItems || []).map((item) => ({
            task: item.task || '',
            assignee: item.assignee || '',
            dueDate: safeParseDate(item.dueDate)
          }));

          const update = {
            transcription: summaryData.transcription,
            summary: summaryData.summary,
            keyPoints: summaryData.keyPoints,
            actionItems: safeActionItems,
            decisions: summaryData.decisions || [],
            nextSteps: summaryData.nextSteps || [],
            importantNotes: summaryData.importantNotes || [],
            originalSummary: summaryData.summary,
            originalKeyPoints: summaryData.keyPoints || [],
            originalActionItems: safeActionItems,
            originalDecisions: summaryData.decisions || [],
            originalNextSteps: summaryData.nextSteps || [],
            originalImportantNotes: summaryData.importantNotes || [],
            pendingSummary: summaryData.summary,
            pendingKeyPoints: summaryData.keyPoints || [],
            pendingActionItems: safeActionItems,
            pendingDecisions: summaryData.decisions || [],
            pendingNextSteps: summaryData.nextSteps || [],
            pendingImportantNotes: summaryData.importantNotes || [],
            transcriptionStatus: 'Completed',
            summaryStatus: 'Pending Approval'
          };

          const updated = await Meeting.findByIdAndUpdate(
            meeting._id,
            { $set: update },
            { new: true }
          );

          // Send notification email to authorized editor if configured
          if (meeting.authorizedEditorEmail) {
            const transporter = getMailTransporter();
            if (transporter) {
              try {
                const logoUrl = process.env.COMPANY_LOGO_URL || 'https://portiqtechnologies.com/logo.png';
                await transporter.sendMail({
                  from: process.env.MAIL_FROM || process.env.MAIL_USER,
                  to: meeting.authorizedEditorEmail,
                  subject: `Meeting Summary Ready for Review - ${meeting.title} | PortIQ Meeting Assistant`,
                  html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #111827; line-height: 1.6;">
                      <div style="text-align: left; margin-bottom: 16px;">
                        <img src="${logoUrl}" alt="PortIQ Technologies" style="max-width: 160px; height: auto; display: block; margin-bottom: 12px;" />
                      </div>
                      <p>Hello,</p>
                      <p>
                        The meeting summary for <strong>${meeting.title}</strong> has been generated and is ready for your review.
                      </p>
                      <p>
                        Please log in to the meeting assistant to review, edit if needed, and approve the summary for distribution to all participants.
                      </p>
                      <p>
                        <strong>Meeting Details:</strong><br/>
                        Title: ${meeting.title}<br/>
                        Location: ${meeting.meetingRoom}<br/>
                        Date: ${new Date(meeting.startTime).toLocaleString()}
                      </p>
                      <br/>
                      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                      <p style="margin: 0;">
                        <strong>PortIQ Meeting Assistant</strong>
                      </p>
                      <p style="margin: 8px 0 0 0; font-size: 13px; color: #4b5563;">
                        This is an automated notification from the PortIQ Meeting Assistant.
                      </p>
                    </div>
                  `
                });
                console.log('✅ Notification sent to authorized editor:', meeting.authorizedEditorEmail);
              } catch (emailErr) {
                console.warn('⚠️  Failed to send notification to authorized editor:', emailErr.message);
              }
            }
          }

          // DO NOT auto-send emails - wait for approval
          console.log('✅ Transcription completed. Summary pending approval from authorized editor.');
        })
        .catch((error) => {
          console.error('Transcription processing error:', error);
          // Mark transcription as failed without relying on potentially stale doc
          Meeting.findByIdAndUpdate(
            meeting._id,
            { $set: { transcriptionStatus: 'Failed' } }
          ).catch((e) => {
            console.error('Failed to mark transcription as failed:', e);
          });
        });
    } else {
      meeting.transcriptionStatus = 'Not Started';
      await meeting.save();
    }

    res.json({ 
      success: true, 
      meeting,
      message: meeting.transcriptionEnabled ? 'Transcription processing started' : 'Meeting ended'
    });
  } catch (error) {
    console.error('Error ending meeting:', error);
    res.status(500).json({ error: 'Failed to end meeting' });
  }
});

/**
 * Get all meetings (kiosk view - filters completed meetings based on config)
 */
router.get('/', async (req, res) => {
  try {
    const { status, meetingRoom, date } = req.query;
    const query = {};

    // If an authenticated admin is present, scope meetings to that admin/tenant.
    // This ensures one customer's meetings never appear in another's dashboard.
    const admin = await getAdminFromRequest(req);
    if (admin && admin.username !== 'admin') {
      query.adminId = admin._id;
    }

    if (status) query.status = status;
    if (meetingRoom) query.meetingRoom = meetingRoom;
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      query.startTime = { $gte: startDate, $lte: endDate };
    }

    // Filter completed meetings based on display duration config (only for kiosk view)
    // Admin panel uses /admin/meetings route which shows all meetings
    const Config = require('../models/Config');
    const config = await Config.getConfig();
    const displayHours = config.completedMeetingDisplayHours || 24;
    
    // Apply filter only if not specifically querying for a status
    // This ensures completed meetings older than displayHours are hidden from kiosk
    if (!query.status && displayHours > 0) {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - displayHours);
      
      query.$or = [
        { status: { $ne: 'Completed' } }, // Show all non-completed
        { 
          status: 'Completed',
          endTime: { $gte: cutoffTime } // Only completed within display window
        }
      ];
    }

    // By default, hide meetings explicitly marked as not for kiosk
    query.showOnKiosk = { $ne: false };

    const meetings = await Meeting.find(query)
      .sort({ startTime: -1 })
      .limit(100);

    res.json({ meetings });
  } catch (error) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
});

/**
 * Get meeting by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });
    res.json({ meeting });
  } catch (error) {
    console.error('Error fetching meeting:', error);
    res.status(500).json({ error: 'Failed to fetch meeting' });
  }
});

/**
 * Request OTP for authorized editor verification
 */
router.post('/:id/request-verification', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if email matches authorized editor
    if (meeting.authorizedEditorEmail && meeting.authorizedEditorEmail.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ error: 'This email is not authorized to edit this meeting summary' });
    }

    // Use existing code if valid, otherwise generate new one
    let otp = meeting.editorVerificationCode;
    const now = new Date();
    const isCodeValid = otp && meeting.editorVerificationExpiry && now < meeting.editorVerificationExpiry;
    
    if (!isCodeValid) {
      // Generate new 6-digit OTP
      otp = Math.floor(100000 + Math.random() * 900000).toString();
      meeting.editorVerificationCode = otp;
      meeting.editorVerificationExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await meeting.save();
    }

    // Send OTP via email
    const transporter = getMailTransporter();
    
    if (transporter) {
      const logoUrl = process.env.COMPANY_LOGO_URL || 'https://portiqtechnologies.com/logo.png';
      const isResend = isCodeValid;
      
      await transporter.sendMail({
        from: process.env.MAIL_FROM || process.env.MAIL_USER,
        to: email,
        subject: `${isResend ? 'Resending: ' : ''}Verification Code for Meeting Summary - ${meeting.title} | PortIQ Meeting Assistant`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #111827; line-height: 1.6;">
            <div style="text-align: left; margin-bottom: 16px;">
              <img src="${logoUrl}" alt="PortIQ Technologies" style="max-width: 160px; height: auto; display: block; margin-bottom: 12px;" />
            </div>
            <p>Hello,</p>
            ${isResend 
              ? '<p>You have requested to resend your verification code for the meeting summary of: <strong>' + meeting.title + '</strong></p>'
              : '<p>You have requested a verification code to edit the meeting summary for: <strong>' + meeting.title + '</strong></p>'
            }
            <p><strong>Your verification code is:</strong></p>
            <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
              <h1 style="margin: 0; font-size: 32px; letter-spacing: 4px; color: #2563eb;">${otp}</h1>
            </div>
            <p style="color: #6b7280; font-size: 12px;">This code will expire ${isResend ? 'on ' + new Date(meeting.editorVerificationExpiry).toLocaleString() : 'in 7 days'}.</p>
            ${isResend 
              ? '<p style="color: #6b7280; font-size: 12px;"><strong>Note:</strong> This is the same code that was sent to you when the meeting was created. Please check your earlier emails if you have it saved.</p>'
              : '<p style="color: #6b7280; font-size: 12px;">If you did not request this code, please ignore this email.</p>'
            }
            <br/>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="margin: 0;">
              <strong>PortIQ Meeting Assistant</strong>
            </p>
            <p style="margin: 8px 0 0 0; font-size: 13px; color: #4b5563;">
              This is an automated notification from the PortIQ Meeting Assistant.
            </p>
          </div>
        `
      });
    }

    res.json({ success: true, message: 'Verification code sent to your email' });
  } catch (error) {
    console.error('Error requesting verification:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

/**
 * Verify OTP and get pending summary for editing
 */
router.post('/:id/verify-and-get-summary', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }

    // Check if email matches authorized editor
    if (meeting.authorizedEditorEmail && meeting.authorizedEditorEmail.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ error: 'This email is not authorized to edit this meeting summary' });
    }

    // Verify OTP
    if (!meeting.editorVerificationCode || meeting.editorVerificationCode !== code) {
      return res.status(401).json({ error: 'Invalid verification code' });
    }

    if (!meeting.editorVerificationExpiry || new Date() > meeting.editorVerificationExpiry) {
      return res.status(401).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    // Return pending summary data
    res.json({
      success: true,
      verified: true,
      summary: {
        summary: meeting.pendingSummary || meeting.summary,
        keyPoints: meeting.pendingKeyPoints.length > 0 ? meeting.pendingKeyPoints : meeting.keyPoints,
        actionItems: meeting.pendingActionItems.length > 0 ? meeting.pendingActionItems : meeting.actionItems,
        decisions: meeting.pendingDecisions.length > 0 ? meeting.pendingDecisions : (meeting.decisions || []),
        nextSteps: meeting.pendingNextSteps.length > 0 ? meeting.pendingNextSteps : (meeting.nextSteps || []),
        importantNotes: meeting.pendingImportantNotes.length > 0 ? meeting.pendingImportantNotes : (meeting.importantNotes || [])
      }
    });
  } catch (error) {
    console.error('Error verifying code:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

/**
 * Update pending summary (after editing)
 */
router.put('/:id/pending-summary', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });
    const { summary, keyPoints, actionItems, decisions, nextSteps, importantNotes } = req.body;

    // Update pending summary (no verification / code required anymore)
    if (summary !== undefined) meeting.pendingSummary = summary;
    if (keyPoints !== undefined) meeting.pendingKeyPoints = keyPoints;
    if (actionItems !== undefined) {
      const safeParseDate = (value) => {
        if (!value) return undefined;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? undefined : d;
      };
      meeting.pendingActionItems = (actionItems || []).map((item) => ({
        task: item.task || '',
        assignee: item.assignee || '',
        dueDate: safeParseDate(item.dueDate)
      }));
    }
    if (decisions !== undefined) meeting.pendingDecisions = decisions;
    if (nextSteps !== undefined) meeting.pendingNextSteps = nextSteps;
    if (importantNotes !== undefined) meeting.pendingImportantNotes = importantNotes;

    await meeting.save();

    res.json({ success: true, meeting });
  } catch (error) {
    console.error('Error updating pending summary:', error);
    res.status(500).json({ error: 'Failed to update summary' });
  }
});

/**
 * Approve and send summary (after editing/approval)
 */
router.post('/:id/approve-and-send', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });
    const { additionalParticipants } = req.body;

    // Add additional participants if provided (no verification / code required anymore)
    if (additionalParticipants && Array.isArray(additionalParticipants) && additionalParticipants.length > 0) {
      const existingEmails = (meeting.participants || []).map(p => p.email?.toLowerCase()).filter(Boolean);
      const newParticipants = additionalParticipants
        .filter(p => p.email && p.email.trim())
        .filter(p => !existingEmails.includes(p.email.toLowerCase()))
        .map(p => ({
          name: p.name?.trim() || '',
          email: p.email.trim(),
          role: p.role || 'participant'
        }));
      
      if (newParticipants.length > 0) {
        meeting.participants = [...(meeting.participants || []), ...newParticipants];
        console.log(`✅ Added ${newParticipants.length} additional participant(s) to meeting: ${meeting.title}`);
      }
    }

    // Copy pending summary to final summary
    meeting.summary = meeting.pendingSummary || meeting.summary;
    meeting.keyPoints = meeting.pendingKeyPoints.length > 0 ? meeting.pendingKeyPoints : meeting.keyPoints;
    meeting.actionItems = meeting.pendingActionItems.length > 0 ? meeting.pendingActionItems : meeting.actionItems;
    meeting.decisions = meeting.pendingDecisions.length > 0 ? meeting.pendingDecisions : (meeting.decisions || []);
    meeting.nextSteps = meeting.pendingNextSteps.length > 0 ? meeting.pendingNextSteps : (meeting.nextSteps || []);
    meeting.importantNotes = meeting.pendingImportantNotes.length > 0 ? meeting.pendingImportantNotes : (meeting.importantNotes || []);

    meeting.summaryStatus = 'Sent';
    meeting.editorVerificationCode = null; // Clear code after use
    meeting.editorVerificationExpiry = null;
    await meeting.save();

    // Try to send summary to participants; do not fail the request if email fails
    const summaryData = {
      summary: meeting.summary,
      keyPoints: meeting.keyPoints,
      actionItems: meeting.actionItems,
      decisions: meeting.decisions,
      nextSteps: meeting.nextSteps,
      importantNotes: meeting.importantNotes
    };

    let emailSent = false;
    try {
      const result = await sendMeetingSummary(meeting, summaryData);
      emailSent = !!(result && result.success);
    } catch (err) {
      console.error('Error sending summary email (summary still saved):', err.message);
    }

    res.json({
      success: true,
      meeting,
      emailSent,
      message: emailSent
        ? 'Summary approved and sent to participants'
        : 'Summary approved and saved. Emails could not be sent to participants (check mail configuration).'
    });
  } catch (error) {
    console.error('Error approving and sending summary:', error);
    res.status(500).json({ error: 'Failed to save summary' });
  }
});

/**
 * Register voice profile for a participant
 */
router.post('/voice/register', voiceUpload.single('audio'), async (req, res) => {
  try {
    let { email, name, standardSentence, participants } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    // If email/name not provided, try to detect from audio
    if (!email || !name) {
      try {
        // Transcribe the audio to extract the name
        const { transcribeAndSummarize } = require('../utils/meetingTranscription');
        const OpenAI = require('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(req.file.path),
          model: 'whisper-1',
          prompt: 'This is a voice sample. The speaker will say: "Hello, my name is [Name] and I am ready for the meeting." Extract the name from the audio.'
        });
        
        const transcriptText = transcription.text || '';
        
        // Extract name from transcript using pattern matching
        const nameMatch = transcriptText.match(/my name is ([A-Za-z\s]+?)(?:\s+and|\s+I|$)/i) || 
                         transcriptText.match(/name is ([A-Za-z\s]+?)(?:\s+and|\s+I|$)/i) ||
                         transcriptText.match(/I am ([A-Za-z\s]+?)(?:\s+and|\s+ready|$)/i);
        
        if (nameMatch && nameMatch[1]) {
          const detectedName = nameMatch[1].trim();
          
          // Parse participants if provided as JSON string
          let participantList = [];
          if (participants) {
            try {
              participantList = typeof participants === 'string' ? JSON.parse(participants) : participants;
            } catch (e) {
              participantList = [];
            }
          }
          
          // Try to match detected name to participant list
          if (participantList.length > 0) {
            const matchedParticipant = participantList.find(p => {
              const pName = (p.name || '').toLowerCase().trim();
              const pEmail = (p.email || '').toLowerCase().trim();
              const detected = detectedName.toLowerCase().trim();
              
              // Check if name matches or is similar
              return pName === detected || 
                     pName.includes(detected) || 
                     detected.includes(pName) ||
                     pEmail.includes(detected) ||
                     detected.includes(pEmail.split('@')[0]);
            });
            
            if (matchedParticipant) {
              name = matchedParticipant.name || matchedParticipant.email;
              email = matchedParticipant.email;
              console.log(`✅ Auto-matched voice to participant: ${name} (${email})`);
            } else {
              // Use detected name but still need email
              name = detectedName;
              console.log(`⚠️  Detected name "${detectedName}" but couldn't match to participant list`);
            }
          } else {
            // No participant list, use detected name
            name = detectedName;
            console.log(`✅ Detected name from audio: ${detectedName}`);
          }
        }
      } catch (detectionError) {
        console.warn('⚠️  Could not detect name from audio:', detectionError.message);
        // Continue with manual assignment if detection fails
      }
    }
    
    // Final validation
    if (!email || !name) {
      return res.status(400).json({ 
        error: 'Could not determine participant. Please ensure the audio contains "Hello, my name is [Name]" or provide email/name manually.' 
      });
    }

    // Generate voice embedding
    const voiceVector = await generateVoiceEmbedding(req.file.path);

    // Check if profile already exists
    let voiceProfile = await VoiceProfile.findOne({ email: email.toLowerCase() });
    
    if (voiceProfile) {
      // Update existing profile with new voice sample
      voiceProfile.voiceVector = voiceVector;
      voiceProfile.voiceSampleFile = `/uploads/voice-samples/${req.file.filename}`;
      voiceProfile.standardSentence = standardSentence || voiceProfile.standardSentence;
      voiceProfile.name = name; // Update name in case it changed
      voiceProfile.lastUsed = new Date();
      voiceProfile.updatedAt = new Date();
      
      // Delete old voice sample file if exists
      if (voiceProfile.voiceSampleFile && voiceProfile.voiceSampleFile !== `/uploads/voice-samples/${req.file.filename}`) {
        const oldPath = path.join(__dirname, '../..', voiceProfile.voiceSampleFile);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
    } else {
      // Create new profile
      voiceProfile = new VoiceProfile({
        email: email.toLowerCase(),
        name,
        voiceVector,
        voiceSampleFile: `/uploads/voice-samples/${req.file.filename}`,
        standardSentence: standardSentence || `Hello, my name is ${name} and I am ready for the meeting.`
      });
    }

    await voiceProfile.save();

    res.json({
      success: true,
      message: `Voice profile registered successfully for ${voiceProfile.name}`,
      voiceProfile: {
        email: voiceProfile.email,
        name: voiceProfile.name,
        hasProfile: true
      },
      autoMatched: !req.body.email || !req.body.name // Indicates if name was auto-detected
    });
  } catch (error) {
    console.error('Error registering voice profile:', error);
    res.status(500).json({ error: 'Failed to register voice profile' });
  }
});

/**
 * Get voice profiles for meeting participants
 */
router.get('/voice/profiles', async (req, res) => {
  try {
    const { emails } = req.query;
    
    if (!emails) {
      return res.status(400).json({ error: 'Emails parameter is required' });
    }

    const emailList = Array.isArray(emails) ? emails : emails.split(',');
    const profiles = await VoiceProfile.find({
      email: { $in: emailList.map(e => e.toLowerCase()) }
    });

    res.json({
      success: true,
      profiles: profiles.map(p => ({
        email: p.email,
        name: p.name,
        hasProfile: true,
        lastUsed: p.lastUsed
      }))
    });
  } catch (error) {
    console.error('Error fetching voice profiles:', error);
    res.status(500).json({ error: 'Failed to fetch voice profiles' });
  }
});

/**
 * Check if participant has voice profile
 */
router.get('/voice/check/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const profile = await VoiceProfile.findOne({ email });

    res.json({
      success: true,
      hasProfile: !!profile,
      profile: profile ? {
        email: profile.email,
        name: profile.name,
        lastUsed: profile.lastUsed
      } : null
    });
  } catch (error) {
    console.error('Error checking voice profile:', error);
    res.status(500).json({ error: 'Failed to check voice profile' });
  }
});

module.exports = router;
