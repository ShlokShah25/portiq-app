const mongoose = require('mongoose');

const voiceProfileSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  voiceVector: {
    type: [Number], // Array of numbers representing the voice embedding
    required: true
  },
  /**
   * Embedding family of voiceVector: 'pyannote' (speaker model) or 'fft' (basic fallback used when
   * pyannote/HF was unavailable at enrollment). Vectors only compare within the same family.
   * Older rows have no value — derived from vector length (128 → fft).
   */
  embeddingKind: {
    type: String,
    enum: ['wespeaker', 'pyannote', 'fft', null],
    default: null,
  },
  /**
   * Extra voiceprints matched alongside voiceVector (score = best template):
   *  - source 'meeting': learned from a past meeting where this person was named with high
   *    confidence — captures their voice through real room mics, not just the enrollment mic.
   *  - source 'legacy': the previous-model vector kept after re-embedding with a newer model.
   */
  voiceEmbeddings: {
    type: [
      {
        _id: false,
        kind: { type: String, enum: ['wespeaker', 'pyannote', 'fft'] },
        vector: [Number],
        source: { type: String, enum: ['meeting', 'legacy', 'enrollment'], default: 'meeting' },
        meetingId: { type: String, default: null },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  },
  /** Self-consistency of the enrollment sample (cosine between its two halves); low = noisy sample. */
  enrollmentConsistency: {
    type: Number,
    default: null,
  },
  voiceSampleFile: {
    type: String, // Path to the recorded voice sample
    default: null
  },
  standardSentence: {
    type: String,
    default:
      'Hello, my name is {name}. This is my sample voice for PortIQ so the system can recognize me clearly in future meetings. I usually speak like this when I share updates with my team.'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  lastUsed: {
    type: Date,
    default: Date.now
  },
  /** Last time the user confirmed this profile in a Name1/Name2 speaker pick (UI); reserved for future attribution weighting. */
  lastDisambiguationAt: {
    type: Date,
    default: null,
  },
  /** Other participant email from the last Name1/Name2 pick (for future matcher hints). */
  lastDisambiguationPeerEmail: {
    type: String,
    default: null,
    trim: true,
    lowercase: true,
  }
});

// Update updatedAt before saving
voiceProfileSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for faster lookups
voiceProfileSchema.index({ email: 1 });
voiceProfileSchema.index({ name: 1 });

module.exports = mongoose.model('VoiceProfile', voiceProfileSchema);
