/**
 * Shared voice enrollment phrase for API registration (literal [Your Name] for matching).
 */
export const VOICE_ENROLLMENT_API_TEMPLATE =
  'Hello, my name is [Your Name]. This is my sample voice for PortIQ so the system can recognize me clearly in future meetings.';

/** Same line as shown in the participant book (curly placeholder for display). */
export const VOICE_ENROLLMENT_BOOK_PHRASE =
  'Hello, my name is {Your name}. This is my sample voice for PortIQ so the system can recognize me clearly in future meetings.';

/**
 * Full sentence for a specific participant while recording / hints.
 */
export function voiceEnrollmentSentenceForParticipant(displayName) {
  const n = String(displayName || '').trim() || 'this participant';
  return `Hello, my name is ${n}. This is my sample voice for PortIQ so the system can recognize me clearly in future meetings.`;
}
