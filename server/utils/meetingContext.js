const Meeting = require('../models/Meeting');

/**
 * Get relevant past meetings for context learning
 * This helps the AI understand company patterns, recurring topics, and continuity
 */
async function getMeetingContext(currentMeeting, limit = 10) {
  try {
    const context = {
      similarMeetings: [],
      participantHistory: [],
      recentMeetings: [],
      recurringTopics: [],
      pastActionItems: []
    };

    // Get participant emails for matching
    const participantEmails = (currentMeeting.participants || [])
      .map(p => p.email)
      .filter(Boolean);

    // 1. Find meetings with overlapping participants (most relevant)
    if (participantEmails.length > 0) {
      const participantMeetings = await Meeting.find({
        _id: { $ne: currentMeeting._id },
        status: 'Completed',
        transcriptionStatus: 'Completed',
        'participants.email': { $in: participantEmails },
        endTime: { $exists: true }
      })
        .sort({ endTime: -1 })
        .limit(limit)
        .select('title meetingRoom organizer participants summary keyPoints actionItems decisions endTime');

      context.similarMeetings = participantMeetings.map(m => ({
        title: m.title,
        date: m.endTime,
        room: m.meetingRoom,
        summary: m.summary?.substring(0, 200) || '', // First 200 chars
        keyPoints: m.keyPoints || [],
        actionItems: m.actionItems || [],
        decisions: m.decisions || []
      }));
    }

    // 2. Find recent meetings (last 90 days) for general company context
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const recentMeetings = await Meeting.find({
      _id: { $ne: currentMeeting._id },
      status: 'Completed',
      transcriptionStatus: 'Completed',
      endTime: { $exists: true, $gte: ninetyDaysAgo }
    })
      .sort({ endTime: -1 })
      .limit(5)
      .select('title keyPoints actionItems');

    context.recentMeetings = recentMeetings.map(m => ({
      title: m.title,
      keyPoints: m.keyPoints || [],
      actionItems: (m.actionItems || []).map(ai => ai.task || '').filter(Boolean)
    }));

    // 3. Extract recurring topics from all past meetings
    const allPastMeetings = await Meeting.find({
      _id: { $ne: currentMeeting._id },
      status: 'Completed',
      transcriptionStatus: 'Completed',
      keyPoints: { $exists: true, $ne: [] }
    })
      .select('keyPoints')
      .limit(50);

    // Count topic frequency
    const topicFrequency = {};
    allPastMeetings.forEach(m => {
      (m.keyPoints || []).forEach(topic => {
        const normalized = topic.toLowerCase().trim();
        if (normalized.length > 10) { // Only meaningful topics
          topicFrequency[normalized] = (topicFrequency[normalized] || 0) + 1;
        }
      });
    });

    // Get top 5 recurring topics
    context.recurringTopics = Object.entries(topicFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic]) => topic);

    // 4. Extract past action items (especially incomplete ones)
    const pastActionItems = await Meeting.find({
      _id: { $ne: currentMeeting._id },
      status: 'Completed',
      transcriptionStatus: 'Completed',
      actionItems: { $exists: true, $ne: [] }
    })
      .select('actionItems title endTime')
      .sort({ endTime: -1 })
      .limit(20);

    context.pastActionItems = pastActionItems
      .flatMap(m => (m.actionItems || []).map(ai => ({
        task: ai.task || '',
        assignee: ai.assignee || '',
        meeting: m.title,
        date: m.endTime
      })))
      .filter(ai => ai.task.length > 0)
      .slice(0, 10);

    return context;
  } catch (error) {
    console.error('❌ Error fetching meeting context:', error);
    // Return empty context on error (fail gracefully)
    return {
      similarMeetings: [],
      participantHistory: [],
      recentMeetings: [],
      recurringTopics: [],
      pastActionItems: []
    };
  }
}

/**
 * Build context-aware prompt for AI summarization
 */
function buildContextualPrompt(transcriptText, meetingTitle, context) {
  let contextSection = '';

  // Add similar meetings context
  if (context.similarMeetings.length > 0) {
    contextSection += '\n\n--- CONTEXT FROM PAST MEETINGS WITH SAME PARTICIPANTS ---\n';
    context.similarMeetings.slice(0, 3).forEach((m, idx) => {
      contextSection += `\nPast Meeting ${idx + 1}: "${m.title}" (${m.date ? new Date(m.date).toLocaleDateString() : 'Date unknown'})\n`;
      if (m.summary) contextSection += `Summary: ${m.summary}\n`;
      if (m.keyPoints.length > 0) {
        contextSection += `Key Points: ${m.keyPoints.slice(0, 3).join(', ')}\n`;
      }
      if (m.decisions.length > 0) {
        contextSection += `Decisions: ${m.decisions.slice(0, 2).join(', ')}\n`;
      }
    });
    contextSection += '\nUse this context to understand continuity, recurring topics, and follow-ups from previous discussions.\n';
  }

  // Add recurring topics
  if (context.recurringTopics.length > 0) {
    contextSection += `\n--- RECURRING COMPANY TOPICS ---\n`;
    contextSection += `These topics frequently appear in company meetings: ${context.recurringTopics.join(', ')}\n`;
    contextSection += `If these topics appear in the current transcript, ensure they are properly identified and contextualized.\n`;
  }

  // Add recent action items for continuity
  if (context.pastActionItems.length > 0) {
    contextSection += `\n--- RECENT ACTION ITEMS FROM PAST MEETINGS ---\n`;
    context.pastActionItems.slice(0, 5).forEach(ai => {
      contextSection += `- ${ai.task}${ai.assignee ? ` (${ai.assignee})` : ''} - from "${ai.meeting}"\n`;
    });
    contextSection += `\nIf the transcript references these past action items or their completion, note it in the summary.\n`;
  }

  const fullPrompt = `Analyze the following meeting transcript and generate a structured summary suitable for executives and team members.

${contextSection ? `\n${contextSection}\n` : ''}--- CURRENT MEETING TRANSCRIPT ---

Transcript:\n\n${transcriptText}\n\nFollow these rules strictly:
- Be concise but clear.
- Use professional business language.
- Do not hallucinate information that was not discussed.
- Only include decisions or actions that are clearly mentioned.
- If a section has no information, set it to "Not specified".
${context.similarMeetings.length > 0 ? '- Reference continuity from past meetings when relevant (e.g., "As discussed in previous meetings...").' : ''}
${context.recurringTopics.length > 0 ? '- Recognize and properly contextualize recurring company topics mentioned above.' : ''}

Return ONLY a JSON object with the following structure:
{
  "summary": "3–5 sentence executive summary of the meeting (in English)",
  "keyPoints": ["major discussion point 1", "major discussion point 2"],
  "actionItems": [
    {"task": "task description", "assignee": "person name if mentioned", "dueDate": "deadline if mentioned", "notes": "extra detail if needed"}
  ],
  "decisions": ["decision1", "decision2"],
  "nextSteps": ["next step 1", "next step 2"],
  "importantNotes": ["risk, concern, or notable observation 1", "item 2"]
}`;

  return fullPrompt;
}

module.exports = {
  getMeetingContext,
  buildContextualPrompt
};
