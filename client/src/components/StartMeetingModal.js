import React from 'react';
import MeetingCreateForm from './MeetingCreateForm';
import './StartMeetingModal.css';

/** Modal shell for dashboard / quick entry — same fields as inline Meetings page form. */
export default function StartMeetingModal({
  open,
  onClose,
  companyName = 'Your Company',
  subscriptionGate,
  maxParticipantsPerMeeting = null,
}) {
  if (!open) return null;

  return (
    <div
      className="start-meeting-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="start-meeting-modal start-meeting-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-meeting-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <MeetingCreateForm
          inline={false}
          active={open}
          companyName={companyName}
          subscriptionGate={subscriptionGate}
          maxParticipantsPerMeeting={maxParticipantsPerMeeting}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
