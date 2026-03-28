import React from 'react';
import { Activity, CheckCircle2 } from 'lucide-react';
import { getMeetingDisplayStatus } from '../utils/meetingDisplayStatus';
import './MeetingUiBadges.css';

export default function MeetingStatusBadge({ meeting, className = '' }) {
  const { label, variant } = getMeetingDisplayStatus(meeting);
  const Icon = variant === 'success' ? CheckCircle2 : Activity;
  return (
    <span className={`meeting-ui-badge meeting-ui-badge--${variant} ${className}`.trim()}>
      <Icon className="meeting-ui-badge__icon" size={12} strokeWidth={2} aria-hidden />
      {label}
    </span>
  );
}
