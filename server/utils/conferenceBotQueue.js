/**
 * Placeholder for dispatching “join meeting” jobs to a bot worker.
 * The API process should stay stateless; a worker (Docker + Zoom Linux SDK / Teams media)
 * consumes jobs from Redis/SQS and updates Meeting.conferenceBotStatus + audio path.
 */

function enqueueJoinMeeting(_job) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      '[conferenceBotQueue] enqueueJoinMeeting (stub) — set up worker + queue to enable:',
      _job?.meetingId
    );
  }
  return Promise.resolve({ queued: false, reason: 'worker_not_configured' });
}

module.exports = {
  enqueueJoinMeeting,
};
