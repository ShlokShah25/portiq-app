const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const Config = require('../models/Config');
const Visitor = require('../models/Visitor');
const Meeting = require('../models/Meeting');
const jwt = require('jsonwebtoken');
const { authenticateAdmin, requireSubscription } = require('../middleware/auth');
const { getMeetingContext } = require('../utils/meetingContext');
const { getPlanConstraints } = require('../utils/planConstraints');

/**
 * Admin login (supports both username/password and password-only for client admin)
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // If only password is provided, try to find admin with default username 'admin'
    let admin;
    if (!username && password) {
      admin = await Admin.findOne({ username: 'admin' });
    } else if (username && password) {
      // Email is not unique in schema — multiple Admin docs can share one email (e.g. legacy +
      // Google). Try password against EVERY match so we log into the account that actually owns
      // this password (usually the one where the user reset password).
      const key = String(username).trim();
      const candidates = await Admin.find({
        $or: [{ username: key }, { email: key.toLowerCase() }]
      }).sort({ hasActiveSubscription: -1, updatedAt: -1 });
      admin = null;
      for (const c of candidates) {
        if (await c.comparePassword(password)) {
          admin = c;
          break;
        }
      }
    } else {
      return res.status(400).json({ error: 'Password is required' });
    }

    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!username) {
      // password-only path: verify password for default admin user
      const isMatch = await admin.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    }

    // After password is verified: gate dashboard access by subscription (except legacy 'admin').
    // Checking subscription *after* password avoids the confusing case where a correct new password
    // still returns 403 and feels like "login/password is broken".
    if (!admin.hasActiveSubscription && admin.username !== 'admin') {
      return res.status(403).json({
        error:
          'No active subscription. Please purchase a plan from the website to access the dashboard.',
        code: 'NO_SUBSCRIPTION',
      });
    }

    admin.lastLogin = new Date();
    await admin.save();

    const token = jwt.sign(
      {
        id: admin._id.toString(),
        username: admin.username,
        role: admin.role,
        productType: admin.productType,
        plan: admin.plan,
      },
      process.env.JWT_SECRET || 'your_secret_key',
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      admin: {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        productType: admin.productType || 'workplace',
        plan: admin.plan || 'starter',
        hasActiveSubscription: !!admin.hasActiveSubscription,
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * Get admin profile (auth only — do not require active subscription).
 * Needs to work right after login and for Google users syncing session; subscription
 * status is included so the client can show gating without a catch-22.
 */
router.get('/profile', authenticateAdmin, async (req, res) => {
  const admin = await Admin.findById(req.admin._id).lean();
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  res.json({
    admin: {
      id: req.admin._id,
      username: req.admin.username,
      email: req.admin.email,
      role: req.admin.role,
      lastLogin: req.admin.lastLogin,
      productType: req.admin.productType,
      plan: req.admin.plan,
      hasActiveSubscription: !!admin.hasActiveSubscription,
      subscriptionPaymentPending:
        !!admin.razorpaySubscriptionId && !admin.hasActiveSubscription,
    }
  });
});

/**
 * Get participant book (saved participants) for the current admin
 */
router.get('/participant-book', authenticateAdmin, requireSubscription, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin._id).select('savedParticipants').lean();
    const raw = admin && admin.savedParticipants ? admin.savedParticipants : [];
    const participants = raw.map((p) => ({
      name: p && p.name != null ? String(p.name).trim() : '',
      email: p && p.email != null ? String(p.email).trim().toLowerCase() : '',
    })).filter((p) => p.name || p.email);
    res.json({ participants });
  } catch (e) {
    console.error('Error fetching participant book:', e);
    res.status(500).json({ error: 'Failed to load participant book' });
  }
});

/**
 * Save participant book (enforces plan limit maxParticipantsInBook)
 */
router.put('/participant-book', authenticateAdmin, requireSubscription, async (req, res) => {
  try {
    const list = req.body.participants;
    if (!Array.isArray(list)) {
      return res.status(400).json({ error: 'participants must be an array' });
    }
    const constraints = getPlanConstraints(req.admin);
    const maxInBook = constraints.maxParticipantsInBook;
    if (maxInBook != null && list.length > maxInBook) {
      return res.status(400).json({
        error: `Your plan allows up to ${maxInBook} participants in the participant book.`,
      });
    }
    const normalized = list
      .map((p) => ({
        name: p && p.name ? String(p.name).trim() : '',
        email: p && p.email ? String(p.email).trim().toLowerCase() : '',
      }))
      .filter((p) => p.name || p.email);
    const admin = await Admin.findByIdAndUpdate(
      req.admin._id,
      { savedParticipants: normalized },
      { new: true }
    ).select('savedParticipants');
    res.json({ participants: admin.savedParticipants || [] });
  } catch (e) {
    console.error('Error saving participant book:', e);
    res.status(500).json({ error: 'Failed to save participant book' });
  }
});

/**
 * Change password (in-app profile)
 */
router.put('/password', authenticateAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: 'Current password and new password are required.' });
    }

    const admin = await Admin.findById(req.admin._id);
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found.' });
    }

    const isMatch = await admin.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    admin.password = newPassword;
    await admin.save();

    return res.json({ success: true, message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: 'Failed to change password.' });
  }
});

/**
 * Get dashboard stats
 */
router.get('/stats', authenticateAdmin, requireSubscription, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const visitorsToday = await Visitor.countDocuments({
      checkInTime: { $gte: today, $lt: tomorrow }
    });

    const visitorsInside = await Visitor.countDocuments({ status: 'Inside' });

    const meetingFilter = (req.admin && req.admin.username !== 'admin')
      ? { adminId: req.admin._id }
      : {};
    const meetingsToday = await Meeting.countDocuments({
      ...meetingFilter,
      startTime: { $gte: today, $lt: tomorrow }
    });
    const meetingsCompleted = await Meeting.countDocuments({
      ...meetingFilter,
      status: 'Completed'
    });
    const meetingsScheduled = await Meeting.countDocuments({
      ...meetingFilter,
      status: 'Scheduled'
    });
    const totalMeetings = await Meeting.countDocuments(meetingFilter);

    res.json({
      visitorsToday,
      visitorsInside,
      meetingsToday,
      meetingsCompleted,
      scheduledMeetings: meetingsScheduled,
      totalVisitors: await Visitor.countDocuments(),
      totalMeetings
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * Get configuration
 */
router.get('/config', authenticateAdmin, requireSubscription, async (req, res) => {
  try {
    const config = await Config.getConfig();
    res.json({ config });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

/**
 * Update configuration
 */
router.put('/config', authenticateAdmin, requireSubscription, async (req, res) => {
  try {
    const { companyName, completedMeetingDisplayHours } = req.body;
    const config = await Config.getConfig();

    if (companyName !== undefined) config.companyName = companyName;
    if (completedMeetingDisplayHours !== undefined) {
      config.completedMeetingDisplayHours = Math.max(0, Math.min(168, completedMeetingDisplayHours));
    }

    await config.save();
    res.json({ success: true, config });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

/**
 * Get all meetings (admin view - shows all regardless of completion time)
 */
function canAccessMeeting(meeting, admin) {
  if (!meeting) return false;
  if (!admin || admin.username === 'admin') return true;
  if (!meeting.adminId) return true;
  return String(meeting.adminId) === String(admin._id);
}

router.get('/meetings', authenticateAdmin, requireSubscription, async (req, res) => {
  try {
    const { status, meetingRoom, date, limit = 100 } = req.query;
    const query = {};
    if (req.admin && req.admin.username !== 'admin') {
      query.adminId = req.admin._id;
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

    const meetings = await Meeting.find(query)
      .sort({ startTime: -1 })
      .limit(parseInt(limit, 10));

    res.json({ meetings });
  } catch (error) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
});

/**
 * Get meeting by ID (admin view)
 */
router.get('/meetings/:id', authenticateAdmin, requireSubscription, async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (!canAccessMeeting(meeting, req.admin)) return res.status(404).json({ error: 'Meeting not found' });
    res.json({ meeting });
  } catch (error) {
    console.error('Error fetching meeting:', error);
    res.status(500).json({ error: 'Failed to fetch meeting' });
  }
});

/**
 * Update meeting (admin view - for renaming)
 */
router.put('/meetings/:id', authenticateAdmin, requireSubscription, async (req, res) => {
  try {
    const { title, meetingRoom, organizer, showOnKiosk, scheduledTime } = req.body;
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (!canAccessMeeting(meeting, req.admin)) return res.status(404).json({ error: 'Meeting not found' });
    if (title !== undefined) meeting.title = title;
    if (meetingRoom !== undefined) meeting.meetingRoom = meetingRoom;
    if (organizer !== undefined) meeting.organizer = organizer;
    if (showOnKiosk !== undefined) meeting.showOnKiosk = !!showOnKiosk;
    if (scheduledTime !== undefined) {
      meeting.scheduledTime = new Date(scheduledTime);
    }

    await meeting.save();
    res.json({ success: true, meeting });
  } catch (error) {
    console.error('Error updating meeting:', error);
    res.status(500).json({ error: 'Failed to update meeting' });
  }
});

/**
 * Retry transcription for a failed meeting
 */
router.post('/meetings/:id/retry-transcription', authenticateAdmin, requireSubscription, async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (!canAccessMeeting(meeting, req.admin)) return res.status(404).json({ error: 'Meeting not found' });
    if (!meeting.audioFile) {
      return res.status(400).json({ error: 'No audio file found for this meeting' });
    }

    // Get full path to audio file
    const path = require('path');
    const audioFilePath = path.join(__dirname, '../..', meeting.audioFile);
    const fs = require('fs');
    
    if (!fs.existsSync(audioFilePath)) {
      return res.status(404).json({ error: 'Audio file not found on server' });
    }

    // Reset status and retry transcription
    meeting.transcriptionStatus = 'Processing';
    await meeting.save();

    const { transcribeAndSummarize, sendMeetingSummary } = require('../utils/meetingTranscription');

    // Process transcription asynchronously
    transcribeAndSummarize(audioFilePath, meeting)
      .then(async (summaryData) => {
        const safeParseDate = (value) => {
          if (!value) return undefined;
          const d = new Date(value);
          return Number.isNaN(d.getTime()) ? undefined : d;
        };

        meeting.transcription = summaryData.transcription;
        meeting.summary = summaryData.summary;
        meeting.keyPoints = summaryData.keyPoints;
        meeting.actionItems = (summaryData.actionItems || []).map((item) => ({
          task: item.task || '',
          assignee: item.assignee || '',
          dueDate: safeParseDate(item.dueDate),
          status: 'not_started',
          reviewReminderSent: false,
          reviewReminderSentAt: null
        }));
        meeting.decisions = summaryData.decisions || [];
        meeting.nextSteps = summaryData.nextSteps || [];
        meeting.importantNotes = summaryData.importantNotes || [];
        
        // Store ORIGINAL summary (before any editor edits) for audit trail
        meeting.originalSummary = summaryData.summary;
        meeting.originalKeyPoints = summaryData.keyPoints || [];
        meeting.originalActionItems = (summaryData.actionItems || []).map((item) => ({
          task: item.task || '',
          assignee: item.assignee || '',
          dueDate: safeParseDate(item.dueDate),
          status: 'not_started',
          reviewReminderSent: false,
          reviewReminderSentAt: null
        }));
        meeting.originalDecisions = summaryData.decisions || [];
        meeting.originalNextSteps = summaryData.nextSteps || [];
        meeting.originalImportantNotes = summaryData.importantNotes || [];
        
        // Copy to pending fields for approval workflow
        meeting.pendingSummary = summaryData.summary;
        meeting.pendingKeyPoints = summaryData.keyPoints || [];
        meeting.pendingActionItems = (summaryData.actionItems || []).map((item) => ({
          task: item.task || '',
          assignee: item.assignee || '',
          dueDate: safeParseDate(item.dueDate),
          status: 'not_started',
          reviewReminderSent: false,
          reviewReminderSentAt: null
        }));
        meeting.pendingDecisions = summaryData.decisions || [];
        meeting.pendingNextSteps = summaryData.nextSteps || [];
        meeting.pendingImportantNotes = summaryData.importantNotes || [];
        
        meeting.transcriptionStatus = 'Completed';
        meeting.summaryStatus = 'Pending Approval';
        await meeting.save();

        // DO NOT auto-send - wait for approval
        console.log('✅ Transcription completed. Summary pending approval from authorized editor.');
      })
      .catch((error) => {
        console.error('Transcription retry error:', error);
        meeting.transcriptionStatus = 'Failed';
        meeting.save();
      });

    res.json({ 
      success: true, 
      message: 'Transcription retry started',
      meeting 
    });
  } catch (error) {
    console.error('Error retrying transcription:', error);
    res.status(500).json({ error: 'Failed to retry transcription' });
  }
});

/**
 * Get AI learning analytics - shows how the system learns from past meetings
 */
router.get('/ai-learning', authenticateAdmin, requireSubscription, async (req, res) => {
  try {
    // Get a recent completed meeting to analyze context
    const recentMeeting = await Meeting.findOne({
      status: 'Completed',
      transcriptionStatus: 'Completed'
    })
      .sort({ endTime: -1 });

    let learningStats = {
      totalMeetings: await Meeting.countDocuments({ status: 'Completed', transcriptionStatus: 'Completed' }),
      meetingsWithContext: 0,
      averageContextMeetings: 0,
      topRecurringTopics: [],
      commonParticipants: [],
      learningProgress: 'Initializing'
    };

    if (recentMeeting) {
      const context = await getMeetingContext(recentMeeting);
      
      learningStats.meetingsWithContext = context.similarMeetings.length;
      learningStats.topRecurringTopics = context.recurringTopics;
      
      // Calculate average context meetings across all recent meetings
      const sampleMeetings = await Meeting.find({
        status: 'Completed',
        transcriptionStatus: 'Completed'
      })
        .sort({ endTime: -1 })
        .limit(10);
      
      let totalContext = 0;
      for (const meeting of sampleMeetings) {
        const ctx = await getMeetingContext(meeting);
        totalContext += ctx.similarMeetings.length;
      }
      learningStats.averageContextMeetings = sampleMeetings.length > 0 
        ? Math.round(totalContext / sampleMeetings.length) 
        : 0;

      // Find most common participants
      const allMeetings = await Meeting.find({
        status: 'Completed',
        transcriptionStatus: 'Completed',
        participants: { $exists: true, $ne: [] }
      })
        .select('participants')
        .limit(50);

      const participantCounts = {};
      allMeetings.forEach(m => {
        (m.participants || []).forEach(p => {
          const key = p.email || p.name;
          if (key) {
            participantCounts[key] = (participantCounts[key] || 0) + 1;
          }
        });
      });

      learningStats.commonParticipants = Object.entries(participantCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([email, count]) => ({ email, meetingCount: count }));

      // Determine learning progress
      if (learningStats.totalMeetings === 0) {
        learningStats.learningProgress = 'No meetings yet';
      } else if (learningStats.totalMeetings < 5) {
        learningStats.learningProgress = 'Learning basics';
      } else if (learningStats.totalMeetings < 20) {
        learningStats.learningProgress = 'Building context';
      } else if (learningStats.averageContextMeetings < 2) {
        learningStats.learningProgress = 'Gathering patterns';
      } else {
        learningStats.learningProgress = 'Intelligent - Using full context';
      }
    }

    res.json({ success: true, learningStats });
  } catch (error) {
    console.error('Error fetching AI learning analytics:', error);
    res.status(500).json({ error: 'Failed to fetch learning analytics' });
  }
});

/**
 * Download original summary (before editor edits) as PDF
 */
router.get('/meetings/:id/original-summary', authenticateAdmin, requireSubscription, async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (!canAccessMeeting(meeting, req.admin)) return res.status(404).json({ error: 'Meeting not found' });
    if (!meeting.originalSummary) {
      return res.status(404).json({ error: 'Original summary not available' });
    }

    const PDFDocument = require('pdfkit');
    const fs = require('fs');
    const path = require('path');

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Original-Summary-${meeting.title.replace(/[^a-z0-9]/gi, '_')}-${new Date(meeting.endTime || meeting.startTime).toISOString().split('T')[0]}.pdf"`);

    doc.pipe(res);

    // Company name and logo
    const companyName = process.env.COMPANY_NAME || 'PortIQ Technologies';
    doc.fontSize(20).text(companyName, { align: 'center' });
    doc.moveDown();

    // Meeting details
    doc.fontSize(16).text('ORIGINAL MEETING SUMMARY (Before Editor Edits)', { align: 'center', underline: true });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Title: ${meeting.title}`);
    doc.text(`Room: ${meeting.meetingRoom}`);
    doc.text(`Organizer: ${meeting.organizer}`);
    doc.text(`Date: ${new Date(meeting.startTime).toLocaleDateString()}`);
    if (meeting.endTime) {
      const duration = Math.round((new Date(meeting.endTime) - new Date(meeting.startTime)) / 60000);
      doc.text(`Duration: ${duration} minutes`);
    }
    doc.moveDown();

    // Original Summary
    doc.fontSize(14).text('EXECUTIVE SUMMARY', { underline: true });
    doc.fontSize(11);
    doc.text(meeting.originalSummary || 'Not specified', { align: 'justify' });
    doc.moveDown();

    // Original Key Points
    if (meeting.originalKeyPoints && meeting.originalKeyPoints.length > 0) {
      doc.fontSize(14).text('KEY DISCUSSION POINTS', { underline: true });
      doc.fontSize(11);
      meeting.originalKeyPoints.forEach(point => {
        doc.text(`• ${point}`, { indent: 20 });
      });
      doc.moveDown();
    }

    // Original Action Items
    if (meeting.originalActionItems && meeting.originalActionItems.length > 0) {
      doc.fontSize(14).text('ACTION ITEMS', { underline: true });
      doc.fontSize(11);
      meeting.originalActionItems.forEach(item => {
        doc.text(`Task: ${item.task || 'Not specified'}`);
        if (item.assignee) doc.text(`Responsible: ${item.assignee}`, { indent: 20 });
        if (item.dueDate) doc.text(`Due Date: ${new Date(item.dueDate).toLocaleDateString()}`, { indent: 20 });
        doc.moveDown(0.5);
      });
      doc.moveDown();
    }

    // Original Decisions
    if (meeting.originalDecisions && meeting.originalDecisions.length > 0) {
      doc.fontSize(14).text('DECISIONS MADE', { underline: true });
      doc.fontSize(11);
      meeting.originalDecisions.forEach(decision => {
        doc.text(`• ${decision}`, { indent: 20 });
      });
      doc.moveDown();
    }

    // Original Next Steps
    if (meeting.originalNextSteps && meeting.originalNextSteps.length > 0) {
      doc.fontSize(14).text('NEXT STEPS', { underline: true });
      doc.fontSize(11);
      meeting.originalNextSteps.forEach(step => {
        doc.text(`• ${step}`, { indent: 20 });
      });
      doc.moveDown();
    }

    // Original Important Notes
    if (meeting.originalImportantNotes && meeting.originalImportantNotes.length > 0) {
      doc.fontSize(14).text('IMPORTANT NOTES', { underline: true });
      doc.fontSize(11);
      meeting.originalImportantNotes.forEach(note => {
        doc.text(`• ${note}`, { indent: 20 });
      });
      doc.moveDown();
    }

    doc.fontSize(8).text('Generated automatically by PortIQ Meeting Assistant', { align: 'center' });
    doc.end();
  } catch (error) {
    console.error('Error generating original summary PDF:', error);
    res.status(500).json({ error: 'Failed to generate original summary PDF' });
  }
});

/**
 * Download meeting audio recording
 */
router.get('/meetings/:id/audio', authenticateAdmin, requireSubscription, async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (!canAccessMeeting(meeting, req.admin)) return res.status(404).json({ error: 'Meeting not found' });
    if (!meeting.audioFile) {
      return res.status(404).json({ error: 'Audio file not available' });
    }

    const path = require('path');
    const fs = require('fs');
    const audioFilePath = path.join(__dirname, '../..', meeting.audioFile);

    if (!fs.existsSync(audioFilePath)) {
      return res.status(404).json({ error: 'Audio file not found on server' });
    }

    const fileExtension = path.extname(meeting.audioFile) || '.mp3';
    const safeTitle = meeting.title.replace(/[^a-z0-9]/gi, '_');
    const filename = `Meeting-Audio-${safeTitle}-${new Date(meeting.endTime || meeting.startTime).toISOString().split('T')[0]}${fileExtension}`;

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    const fileStream = fs.createReadStream(audioFilePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Error downloading audio:', error);
    res.status(500).json({ error: 'Failed to download audio file' });
  }
});

module.exports = router;
