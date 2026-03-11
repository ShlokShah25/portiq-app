import { isEducation } from './product';

export const T = {
  meeting: () => (isEducation ? 'Lecture' : 'Meeting'),
  meetings: () => (isEducation ? 'Lectures' : 'Meetings'),
  participants: () => (isEducation ? 'Class' : 'Participants'),
  meetingSummary: () => (isEducation ? 'Lecture Notes' : 'Meeting Summary'),
  team: () => (isEducation ? 'Teachers' : 'Team'),
  rescheduleMeeting: () => (isEducation ? 'Reschedule Lecture' : 'Reschedule Meeting'),
  startMeeting: () => (isEducation ? 'Start Lecture' : 'Start Meeting'),
  endMeeting: () => (isEducation ? 'End Lecture' : 'End Meeting'),
  newMeeting: () => (isEducation ? 'New Lecture' : 'New Meeting'),
  welcomeTitle: () => (isEducation ? 'Welcome to Portiq Education' : 'Welcome'),
  companyName: () => (isEducation ? 'School Name' : 'Company Name'),
  companyLogo: () => (isEducation ? 'School Logo' : 'Company Logo'),
};
