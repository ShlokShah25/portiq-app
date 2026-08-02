const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  // Owning admin/tenant. New meetings are always associated with the
  // currently authenticated admin; older meetings may have this unset.
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    index: true,
    default: null
  },
  meetingRoom: {
    type: String,
    required: true,
    trim: true
  },
  /** zoom | teams | google_meet | other | '' — join link for online rooms */
  conferenceProvider: {
    type: String,
    default: '',
    trim: true,
  },
  conferenceJoinUrl: {
    type: String,
    default: '',
    trim: true,
  },
  /** Platform meeting id (Zoom numeric id, Teams thread id, etc.) for webhooks */
  externalMeetingId: {
    type: String,
    default: null,
    trim: true,
  },
  /** queued | joining | in_meeting | ended | failed | '' — set by bot worker */
  conferenceBotStatus: {
    type: String,
    default: '',
    trim: true,
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  agenda: {
    type: String,
    default: '',
    trim: true,
  },
  organizer: {
    type: String,
    required: true,
    trim: true
  },
  participants: [{
    name: String,
    email: String,
    role: String
  }],
  scheduledTime: {
    type: Date,
    default: null
  },
  startTime: {
    type: Date,
    required: false,
    default: null
  },
  endTime: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['Scheduled', 'In Progress', 'Completed', 'Cancelled'],
    default: 'Scheduled'
  },
  /** Once true, this meeting no longer increments admin.trialMeetingsUsed. */
  trialUsageCounted: {
    type: Boolean,
    default: false,
  },
  /** standard | interview | clinical — switches LLM prompt/output shape; same pipeline otherwise */
  summaryMode: {
    type: String,
    enum: ['standard', 'interview', 'clinical'],
    default: 'standard',
  },
  interviewCandidateName: {
    type: String,
    default: '',
    trim: true,
  },
  interviewRole: {
    type: String,
    default: '',
    trim: true,
  },
  /** Interviewer = one of participants (participant book); used for voice + summary hints */
  interviewInterviewerEmail: {
    type: String,
    default: '',
    trim: true,
  },
  interviewInterviewerEmails: [
    {
      type: String,
      default: '',
      trim: true,
    },
  ],
  /** Candidates are not added to participants; voiceEmail is synthetic for VoiceProfile only */
  interviewCandidates: [
    {
      name: { type: String, default: '', trim: true },
      role: { type: String, default: '', trim: true },
      voiceEmail: { type: String, default: '', trim: true },
    },
  ],
  /** Set when interview summary is approved & sent (hiring decision finalized for pipeline UX) */
  interviewDecisionAt: {
    type: Date,
    default: null,
  },
  hiringRecommendation: {
    type: String,
    default: '',
    trim: true,
  },
  hiringRecommendationReason: {
    type: String,
    default: '',
    trim: true,
  },
  evaluationSignals: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  /** DISC behavioral style from interview transcript (e.g. "Di", "SC") */
  discProfile: {
    type: String,
    default: '',
    trim: true,
  },
  discScores: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  discSummary: {
    type: String,
    default: '',
    trim: true,
  },
  pendingHiringRecommendation: {
    type: String,
    default: '',
    trim: true,
  },
  pendingHiringRecommendationReason: {
    type: String,
    default: '',
    trim: true,
  },
  pendingEvaluationSignals: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  pendingDiscProfile: {
    type: String,
    default: '',
    trim: true,
  },
  pendingDiscScores: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  pendingDiscSummary: {
    type: String,
    default: '',
    trim: true,
  },
  originalHiringRecommendation: {
    type: String,
    default: '',
    trim: true,
  },
  originalHiringRecommendationReason: {
    type: String,
    default: '',
    trim: true,
  },
  originalEvaluationSignals: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  originalDiscProfile: {
    type: String,
    default: '',
    trim: true,
  },
  originalDiscScores: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  originalDiscSummary: {
    type: String,
    default: '',
    trim: true,
  },
  transcriptionEnabled: {
    type: Boolean,
    default: true
  },
  audioFile: {
    type: String, // Path to recorded audio
    default: null
  },
  transcription: {
    type: String,
    default: ''
  },
  summary: {
    type: String,
    default: ''
  },
  originalSummary: {
    type: String,
    default: ''
  },
  originalKeyPoints: [{
    type: String
  }],
  originalActionItems: [{
    task: String,
    assignee: String,
    dueDate: Date,
    status: {
      type: String,
      enum: ['not_started', 'in_progress', 'done'],
      default: 'not_started'
    },
    reviewReminderSent: {
      type: Boolean,
      default: false
    },
    reviewReminderSentAt: {
      type: Date,
      default: null
    },
    overdueReminderSent: {
      type: Boolean,
      default: false
    },
    overdueReminderSentAt: {
      type: Date,
      default: null
    }
  }],
  originalDecisions: [{
    type: String
  }],
  originalNextSteps: [{
    type: String
  }],
  originalImportantNotes: [{
    type: String
  }],
  keyPoints: [{
    type: String
  }],
  actionItems: [{
    task: String,
    assignee: String,
    dueDate: Date,
    status: {
      type: String,
      enum: ['not_started', 'in_progress', 'done'],
      default: 'not_started'
    },
    reviewReminderSent: {
      type: Boolean,
      default: false
    },
    reviewReminderSentAt: {
      type: Date,
      default: null
    },
    overdueReminderSent: {
      type: Boolean,
      default: false
    },
    overdueReminderSentAt: {
      type: Date,
      default: null
    }
  }],
  showOnKiosk: {
    type: Boolean,
    default: true
  },
  transcriptionStatus: {
    type: String,
    enum: ['Not Started', 'Recording', 'Processing', 'Completed', 'Failed'],
    default: 'Not Started'
  },
  /** Set when transcriptionStatus becomes Failed — for user-facing copy (e.g. AI outage vs input). */
  transcriptionFailureCode: {
    type: String,
    default: null,
    trim: true,
  },
  transcriptionFailureAt: {
    type: Date,
    default: null,
  },
  /** Sanitized provider/server message for support (not shown as primary user copy). */
  transcriptionFailureDetail: {
    type: String,
    default: null,
    maxlength: 2000,
  },
  authorizedEditorEmail: {
    type: String,
    default: null,
    trim: true
  },
  summaryStatus: {
    type: String,
    enum: {
      values: ['Pending Approval', 'Approved', 'Sent'],
      message: '{VALUE} is not a valid summary status'
    },
    required: false,
    default: undefined
  },
  pendingSummary: {
    type: String,
    default: ''
  },
  pendingKeyPoints: [{
    type: String
  }],
  pendingActionItems: [{
    task: String,
    assignee: String,
    dueDate: Date,
    status: {
      type: String,
      enum: ['not_started', 'in_progress', 'done'],
      default: 'not_started'
    },
    reviewReminderSent: {
      type: Boolean,
      default: false
    },
    reviewReminderSentAt: {
      type: Date,
      default: null
    },
    overdueReminderSent: {
      type: Boolean,
      default: false
    },
    overdueReminderSentAt: {
      type: Date,
      default: null
    }
  }],
  pendingDecisions: [{
    type: String
  }],
  pendingNextSteps: [{
    type: String
  }],
  pendingImportantNotes: [{
    type: String
  }],
  /** Education: revision / study questions (stored separately so UI can show them; long-audio merge keeps them). */
  revisionQuestions: {
    type: String,
    default: '',
  },
  pendingRevisionQuestions: {
    type: String,
    default: '',
  },
  originalRevisionQuestions: {
    type: String,
    default: '',
  },
  editorVerificationCode: {
    type: String,
    default: null
  },
  editorVerificationExpiry: {
    type: Date,
    default: null
  },
  /** Set on a follow-up meeting — links back to the prior session */
  parentMeetingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meeting',
    default: null,
    index: true,
  },
  /** Latest scheduled follow-up created from this meeting */
  followUpMeetingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meeting',
    default: null,
  },
  /** What was covered before pausing / scheduling a follow-up (shown to participants) */
  sessionCheckpointSummary: {
    type: String,
    default: '',
  },
  sessionCheckpointAt: {
    type: Date,
    default: null,
  },
  /** User resolved "[Name1 / Name2]" pooled speaker label to one participant (see POST …/resolve-speaker-pool). */
  speakerPoolResolution: {
    poolBracket: { type: String, default: '' },
    chosenDisplayName: { type: String, default: '' },
    chosenParticipantEmail: { type: String, default: '' },
    resolvedAt: { type: Date, default: null },
  },
  /** Education tenant: classroom + subject metadata (lecture scheduling). */
  educationClassroomId: {
    type: String,
    default: '',
    trim: true,
  },
  educationClassroomName: {
    type: String,
    default: '',
    trim: true,
  },
  educationSubject: {
    type: String,
    default: '',
    trim: true,
  },
  educationTeacherName: {
    type: String,
    default: '',
    trim: true,
  },
  educationTeacherEmail: {
    type: String,
    default: '',
    trim: true,
  },
  /** Set when teacher saves review (cleared when pending summary is replaced or edits resume). */
  educationSummaryTeacherReviewedAt: {
    type: Date,
    default: null,
  },
  /** Set when clinician approves clinical summary before patient send */
  clinicalSummaryReviewedAt: {
    type: Date,
    default: null,
  },
  /** Cura SOAP note — subjective / objective / assessment / plan */
  clinicalNote: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  pendingClinicalNote: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  originalClinicalNote: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  /** Cura: linked patient for this consultation */
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    default: null,
    index: true,
  },
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    default: null,
    index: true,
  },
  chiefComplaint: {
    type: String,
    default: '',
    trim: true,
  },
  visitType: {
    type: String,
    default: 'general',
    trim: true,
  },
  followUpPlan: {
    type: String,
    default: '',
    trim: true,
  },
  /** Pre-visit notes captured via WhatsApp clinical prelude */
  preVisitNotes: {
    type: String,
    default: '',
    trim: true,
  },
  clinicalPrepStatus: {
    type: String,
    enum: ['pending', 'pre_notes_provided', 'prep_sent', 'not_required'],
    default: 'pending',
  },
  bookingSource: {
    type: String,
    enum: ['clinician', 'whatsapp', 'calendar'],
    default: 'clinician',
  },
  preVisitPrepSentAt: {
    type: Date,
    default: null,
  },
  whatsappSessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppSession',
    default: null,
  },
  triageLevel: {
    type: String,
    enum: ['NORMAL', 'URGENT', 'EMERGENCY'],
    default: 'NORMAL',
    index: true,
  },
  urgentTriage: {
    type: Boolean,
    default: false,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update updatedAt before saving and handle null enum values
meetingSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  // Remove null values for optional enum fields to prevent validation errors
  if (this.summaryStatus === null) {
    this.summaryStatus = undefined;
  }
  next();
});

meetingSchema.index({ meetingRoom: 1 });
meetingSchema.index({ conferenceProvider: 1, externalMeetingId: 1 });
meetingSchema.index({ status: 1 });
meetingSchema.index({ startTime: -1 });
meetingSchema.index({ parentMeetingId: 1 });

module.exports = mongoose.model('Meeting', meetingSchema);
