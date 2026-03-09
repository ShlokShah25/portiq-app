const mongoose = require('mongoose');

// Visitor categories with pastel colors
const VISITOR_CATEGORIES = {
  'Client': {
    label: 'Client',
    color: '#FFB6C1', // Light Pink
    borderColor: '#FF69B4'
  },
  'Interview Candidate': {
    label: 'Interview Candidate',
    color: '#B0E0E6', // Powder Blue
    borderColor: '#4682B4'
  },
  'Vendor': {
    label: 'Vendor',
    color: '#DDA0DD', // Plum
    borderColor: '#9370DB'
  },
  'Delivery': {
    label: 'Delivery',
    color: '#98FB98', // Pale Green
    borderColor: '#32CD32'
  },
  'Contractor': {
    label: 'Contractor',
    color: '#F0E68C', // Khaki
    borderColor: '#DAA520'
  },
  'Others': {
    label: 'Others',
    color: '#FFE4B5', // Pastel orange
    borderColor: '#CD853F'
  }
};

const visitorSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    default: ''
  },
  company: {
    type: String,
    trim: true,
    default: ''
  },
  employeeToMeet: {
    type: String,
    required: true,
    trim: true
  },
  department: {
    type: String,
    trim: true,
    default: ''
  },
  purpose: {
    type: String,
    required: true,
    trim: true
  },
  visitorCategory: {
    type: String,
    enum: Object.keys(VISITOR_CATEGORIES),
    required: true,
    default: 'Client'
  },
  visitorCategoryDetail: {
    type: String,
    trim: true,
    default: ''
  },
  vehicleNumber: {
    type: String,
    trim: true,
    default: ''
  },
  itemCarried: {
    type: String,
    trim: true,
    default: ''
  },
  photograph: {
    type: String, // URL or path to stored image
    required: true
  },
  checkInTime: {
    type: Date,
    default: Date.now,
    required: true
  },
  checkOutTime: {
    type: Date,
    default: null
  },
  manualCheckout: {
    type: Boolean,
    default: false
  },
  qrToken: {
    type: String,
    required: true,
    unique: true,
    minlength: 4,
    maxlength: 4
  },
  visitorId: {
    type: String, // B03D7282 format
    unique: true
  },
  status: {
    type: String,
    enum: ['Inside', 'Exited'],
    default: 'Inside'
  },
  badgePrinted: {
    type: Boolean,
    default: false
  },
  meetingRoom: {
    type: String,
    trim: true,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
visitorSchema.index({ qrToken: 1 });
visitorSchema.index({ status: 1 });
visitorSchema.index({ checkInTime: -1 });
visitorSchema.index({ visitorCategory: 1 });
visitorSchema.index({ visitorId: 1 });

// Virtual for category color
visitorSchema.virtual('categoryColor').get(function() {
  return VISITOR_CATEGORIES[this.visitorCategory]?.color || '#E0E0E0';
});

// Virtual for category border color
visitorSchema.virtual('categoryBorderColor').get(function() {
  return VISITOR_CATEGORIES[this.visitorCategory]?.borderColor || '#9E9E9E';
});

// Generate visitor ID before saving
visitorSchema.pre('save', async function(next) {
  if (!this.visitorId) {
    // Generate format: B03D7282 (letter + 2 digits + 6 alphanumeric)
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const letter = letters[Math.floor(Math.random() * letters.length)];
    const digits = String(Math.floor(Math.random() * 100)).padStart(2, '0');
    const alphanumeric = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.visitorId = `${letter}${digits}${alphanumeric}`;
  }
  next();
});

module.exports = mongoose.model('Visitor', visitorSchema);
module.exports.VISITOR_CATEGORIES = VISITOR_CATEGORIES;
