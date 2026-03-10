const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  /**
   * Optional reference to the Organization that owns this meeting.
   * Used for multi-tenant data isolation so meetings are only visible
   * to users within the same organization.
   */
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    default: null
  },
  meetingRoom: {
    type: String,
    required: true,
    trim: true
  },
  title: {
    type: String,
    required: true,
    trim: true
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
    required: true,
    default: Date.now
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
  transcriptionEnabled: {
    type: Boolean,
    default: false
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
    dueDate: Date
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
    dueDate: Date
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
    dueDate: Date
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
  editorVerificationCode: {
    type: String,
    default: null
  },
  editorVerificationExpiry: {
    type: Date,
    default: null
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
meetingSchema.index({ status: 1 });
meetingSchema.index({ startTime: -1 });

module.exports = mongoose.model('Meeting', meetingSchema);
