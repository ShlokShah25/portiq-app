const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { sendEmail, isEmailConfigured, getDefaultFrom } = require('./emailService');
const VoiceProfile = require('../models/VoiceProfile');
let ffmpeg = null;
try {
  ffmpeg = require('fluent-ffmpeg');
} catch (e) {
  console.warn('⚠️  fluent-ffmpeg not installed. Audio compression will be skipped. Install ffmpeg system package for automatic compression.');
}

// Initialize OpenAI client
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  console.log('✅ OpenAI client initialized for meeting transcription');
} else {
  console.warn('⚠️  OPENAI_API_KEY not set. Meeting transcription will not work.');
}

// Email is sent via shared emailService (Resend or SMTP)

/**
 * Transcribe audio file and generate meeting summary
 * NOTE: This version is intentionally STRICT to the current meeting only.
 * It does NOT use any past-meeting \"learning\" context so it stays on-point.
 */
async function transcribeAndSummarize(audioFilePath, meeting) {
  if (!openai) {
    throw new Error('OpenAI API key not configured');
  }

  if (!fs.existsSync(audioFilePath)) {
    throw new Error('Audio file not found');
  }

  // Handle both old signature (audioFilePath, meetingTitle) and new (audioFilePath, meeting object)
  const meetingObj = typeof meeting === 'string' 
    ? { _id: null, title: meeting, participants: [] }
    : meeting;
  const meetingTitle = meetingObj.title || 'Meeting';

  // Helper function to compress audio file if needed
  const compressAudioIfNeeded = async (inputPath) => {
    const stats = fs.statSync(inputPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    
    // If file is under 25MB, no compression needed
    if (fileSizeMB <= 25) {
      return inputPath;
    }
    
    // If ffmpeg not available, throw error with instructions
    if (!ffmpeg) {
      throw new Error(
        `Audio file too large: ${fileSizeMB.toFixed(2)} MB (max 25 MB for Whisper API). ` +
        `Please install ffmpeg for automatic compression: brew install ffmpeg (macOS) or apt-get install ffmpeg (Linux). ` +
        `Alternatively, compress manually using CloudConvert or Audacity.`
      );
    }
    
    console.log(`📦 Compressing audio file (${fileSizeMB.toFixed(2)} MB → target: <25 MB)...`);
    
    const outputPath = inputPath.replace(/\.[^.]+$/, '_compressed.mp3');
    
    return new Promise((resolve, reject) => {
      // Calculate target bitrate to get under 25MB
      // Rough estimate: for a 1-hour meeting, 64kbps ≈ 30MB, so we'll use 48kbps for safety
      const targetBitrate = '48k';
      
      ffmpeg(inputPath)
        .audioBitrate(targetBitrate)
        .audioCodec('libmp3lame')
        .format('mp3')
        .on('end', () => {
          const compressedStats = fs.statSync(outputPath);
          const compressedSizeMB = compressedStats.size / (1024 * 1024);
          console.log(`✅ Compression complete: ${compressedSizeMB.toFixed(2)} MB`);
          
          if (compressedSizeMB > 25) {
            // Still too large, try even lower bitrate
            console.log(`⚠️  Still too large, trying lower bitrate...`);
            const lowerBitrate = '32k';
            const finalPath = inputPath.replace(/\.[^.]+$/, '_compressed_final.mp3');
            
            ffmpeg(inputPath)
              .audioBitrate(lowerBitrate)
              .audioCodec('libmp3lame')
              .format('mp3')
              .on('end', () => {
                const finalStats = fs.statSync(finalPath);
                const finalSizeMB = finalStats.size / (1024 * 1024);
                console.log(`✅ Final compression: ${finalSizeMB.toFixed(2)} MB`);
                resolve(finalPath);
              })
              .on('error', (err) => {
                console.error('❌ Compression error:', err);
                reject(new Error(`Failed to compress audio: ${err.message}`));
              })
              .save(finalPath);
          } else {
            resolve(outputPath);
          }
        })
        .on('error', (err) => {
          console.error('❌ Compression error:', err);
          reject(new Error(`Failed to compress audio: ${err.message}. Please compress manually.`));
        })
        .save(outputPath);
    });
  };

  try {
    // Validate file before processing
    const stats = fs.statSync(audioFilePath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`🎙️  Starting transcription...`);
    console.log(`   File: ${audioFilePath}`);
    console.log(`   Size: ${fileSizeMB} MB`);
    
    if (stats.size === 0) {
      throw new Error('Audio file is empty (0 bytes)');
    }
    
    // Compress if needed
    let finalAudioPath = audioFilePath;
    if (stats.size > 25 * 1024 * 1024) {
      try {
        finalAudioPath = await compressAudioIfNeeded(audioFilePath);
      } catch (compressError) {
        throw compressError; // Re-throw compression errors
      }
    }

    // Retry logic for OpenAI API calls (handles 500 errors)
    const maxRetries = 3;
    let transcription = null;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`   Attempt ${attempt}/${maxRetries}...`);
        
        // Step 1: Transcribe audio (multilingual: English, Hindi, Gujarati, etc.)
        // Leaving language undefined lets Whisper auto-detect and handle multiple languages.
        transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(finalAudioPath),
          model: 'whisper-1',
          // language: undefined, // auto-detects; supports Hindi, Gujarati, and many others
          response_format: 'verbose_json'
        });
        
        console.log('✅ Transcription completed successfully');
        break; // Success, exit retry loop
      } catch (apiError) {
        lastError = apiError;
        const isRetryable = apiError.status === 500 || apiError.status === 503 || apiError.status === 429;
        
        if (isRetryable && attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
          console.warn(`⚠️  OpenAI API error (${apiError.status}), retrying in ${waitTime/1000}s...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        } else {
          // Not retryable or max retries reached
          throw apiError;
        }
      }
    }
    
    if (!transcription) {
      throw lastError || new Error('Transcription failed after all retries');
    }

    let transcriptText = transcription.text;
    
    if (!transcriptText || transcriptText.trim().length === 0) {
      throw new Error('Transcription returned empty text - audio may be silent or corrupted');
    }
    
    console.log(`✅ Transcription text length: ${transcriptText.length} characters`);

    // Step 1.5: Add speaker identification context to transcript if voice profiles exist
    let transcriptWithSpeakers = transcriptText;
    if (meetingObj && meetingObj.participants && meetingObj.participants.length > 0) {
      try {
        // Get voice profiles for all participants
        const participantEmails = meetingObj.participants
          .filter(p => p.email)
          .map(p => p.email.toLowerCase());
        
        if (participantEmails.length > 0) {
          const voiceProfiles = await VoiceProfile.find({
            email: { $in: participantEmails }
          });

          if (voiceProfiles.length > 0) {
            console.log(`✅ Found ${voiceProfiles.length} voice profile(s) for speaker identification`);
            
            // Add participant context to transcript for better speaker attribution
            const participantList = meetingObj.participants
              .map(p => `${p.name || p.email} (${p.email})`)
              .join(', ');
            
            transcriptWithSpeakers = `Participants in this meeting: ${participantList}\n\n` +
              `[Note: The following transcript may contain speech from multiple participants. ` +
              `When identifying who said what, match the speaker to the participant list above based on context, names mentioned, and speech patterns.]\n\n` +
              transcriptText;
          }
        }
      } catch (speakerErr) {
        console.warn('⚠️  Error processing speaker identification:', speakerErr.message);
        // Continue without speaker identification if it fails
        transcriptWithSpeakers = transcriptText;
      }
    }

    // Compute meeting duration in minutes if start/end times are available
    let durationMinutes = null;
    if (meetingObj && meetingObj.startTime && meetingObj.endTime) {
      const start = new Date(meetingObj.startTime);
      const end = new Date(meetingObj.endTime);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) {
        durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
      }
    }

    // Step 2: Generate summary using ONLY this meeting's transcript (no external context)
    // Retry logic for summary generation too
    let summaryResponse = null;
    let summaryError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`   Generating summary (attempt ${attempt}/${maxRetries})...`);
        summaryResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini', // or 'gpt-3.5-turbo' for cost savings
          messages: [
        {
          role: 'system',
          content:
            'You are an AI meeting assistant for a professional workplace environment. ' +
            'The transcript may contain multiple languages including English, Hindi, and Gujarati. ' +
            'Accurately understand all languages present, but provide your output only in professional English. ' +
            'Be concise but clear, use professional business language, do not invent information, and only include ' +
            'decisions or actions that are clearly mentioned. Output must follow the requested JSON structure only. ' +
            'CRITICAL: Base your summary ONLY on the current transcript. Do NOT bring in information or topics from any past meetings. ' +
            'The executive summary must capture ALL the major themes of the meeting (projects, planning, issues, risks, feedback, next steps), ' +
            'and highlight the most important concrete points such as names, topics, numbers, and deadlines. ' +
            'IMPORTANT: When possible, identify and attribute statements to specific participants. Include speaker names in key points, decisions, and action items when you can determine who said what.'
        },
        {
          role: 'user',
          content:
            `Analyze the following SINGLE meeting transcript and generate a structured summary strictly about this meeting only.\n\n` +
            `Meeting title (for reference): ${meetingTitle}\n\n` +
            (durationMinutes
              ? `Approximate meeting duration: ${durationMinutes} minutes.\n\n`
              : '') +
            // Add participant names to help Whisper recognize them
            (meetingObj.participants && meetingObj.participants.length > 0
              ? `IMPORTANT: The following people are participants in this meeting. When you see their names mentioned in the transcript, use the EXACT spelling provided here:\n` +
                meetingObj.participants
                  .map(p => `- ${p.name || p.email || 'Unknown'}`)
                  .join('\n') +
                `\n\nPlease ensure all participant names in the summary, action items, and decisions match the exact spelling above.\n\n`
              : '') +
            `Transcript:\n\n${transcriptWithSpeakers}\n\n` +
            `Follow these rules strictly:\n` +
            `- Focus ONLY on what is actually discussed in this transcript.\n` +
            `- Do NOT talk about the AI or summarization itself unless it is explicitly discussed.\n` +
            `- The executive summary must cover the full picture of the meeting: why it was held, what was discussed across all topics, key concerns, and overall outcome.\n` +
            `- Explicitly mention important specifics such as names, topics, projects, events, numbers, dates, and deadlines when they are clearly mentioned.\n` +
            `- CRITICAL: In keyPoints, ALWAYS include who said what when you can identify the speaker. Format as: "[Speaker Name]: [what they said]" or "[Speaker Name] mentioned/noted/stated: [key point]". If speaker cannot be identified, just state the point.\n` +
            `- In actionItems, each task must be a specific, actionable task tied to what people actually said (no generic or invented tasks). Include the assignee name if mentioned.\n` +
            `- In decisions, include who made or proposed the decision when identifiable. Format as: "[Speaker Name] decided: [decision]" or just "[decision]" if speaker unknown.\n` +
            `- Do not hallucinate information that was not discussed.\n` +
            `- Only include decisions or actions that are clearly mentioned.\n` +
            `- If a section has no information, set it to "Not specified".\n` +
            `- When participant names are mentioned in the transcript, use them to attribute statements. Match names from the participant list provided.\n\n` +
            `Return ONLY a JSON object with the following structure:\n` +
            `{\n` +
            `  "summary": "3–5 sentence executive summary of the meeting (in English). Include speaker attribution when possible, e.g., '[Name] discussed...' or '[Name] mentioned that...'",\n` +
            `  "keyPoints": ["[Speaker Name]: major discussion point 1", "[Speaker Name]: major discussion point 2", "point 3 (if speaker unknown)"],\n` +
            `  "actionItems": [\n` +
            `    {"task": "task description", "assignee": "person name if mentioned", "dueDate": "deadline if mentioned", "notes": "extra detail if needed"}\n` +
            `  ],\n` +
            `  "decisions": ["[Speaker Name] decided: decision1", "decision2 (if speaker unknown)"],\n` +
            `  "nextSteps": ["next step 1", "next step 2"],\n` +
            `  "importantNotes": ["risk, concern, or notable observation 1", "item 2"]\n` +
            `}`
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
        });
        console.log('✅ Summary generation completed successfully');
        break; // Success, exit retry loop
      } catch (apiError) {
        summaryError = apiError;
        const isRetryable = apiError.status === 500 || apiError.status === 503 || apiError.status === 429;
        
        if (isRetryable && attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000;
          console.warn(`⚠️  OpenAI API error during summary (${apiError.status}), retrying in ${waitTime/1000}s...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        } else {
          throw apiError;
        }
      }
    }
    
    if (!summaryResponse) {
      throw summaryError || new Error('Summary generation failed after all retries');
    }

    let summaryData;
    try {
      summaryData = JSON.parse(summaryResponse.choices[0].message.content || '{}');
    } catch (parseErr) {
      console.error('❌ Failed to parse summary JSON, falling back to minimal structure:', parseErr);
      summaryData = {};
    }

    // Defensive normalization so downstream code never explodes
    if (typeof summaryData.summary !== 'string') summaryData.summary = '';
    if (!Array.isArray(summaryData.keyPoints)) summaryData.keyPoints = [];
    if (!Array.isArray(summaryData.actionItems)) summaryData.actionItems = [];
    if (!Array.isArray(summaryData.decisions)) summaryData.decisions = [];
    if (!Array.isArray(summaryData.nextSteps)) summaryData.nextSteps = [];
    if (!Array.isArray(summaryData.importantNotes)) summaryData.importantNotes = [];

    console.log('✅ Summary generated');

    // Clean up compressed file if it was created
    if (finalAudioPath !== audioFilePath && fs.existsSync(finalAudioPath)) {
      try {
        fs.unlinkSync(finalAudioPath);
        console.log('🧹 Cleaned up compressed audio file');
      } catch (cleanupErr) {
        console.warn('⚠️  Failed to cleanup compressed file:', cleanupErr.message);
      }
    }

    return {
      transcription: transcriptText,
      summary: summaryData.summary || '',
      keyPoints: summaryData.keyPoints || [],
      actionItems: summaryData.actionItems || [],
      decisions: summaryData.decisions || [],
      nextSteps: summaryData.nextSteps || [],
      importantNotes: summaryData.importantNotes || []
    };
  } catch (error) {
    console.error('❌ Transcription error:', error);
    console.error('   Error status:', error.status);
    console.error('   Error message:', error.message);
    console.error('   Error type:', error.type);
    
    // Provide helpful error messages
    if (error.status === 500 || error.status === 503) {
      throw new Error(`OpenAI API server error (${error.status}). This is usually temporary - please try again in a few moments. If the issue persists, check your OpenAI API key and account status.`);
    } else if (error.status === 401) {
      throw new Error('OpenAI API authentication failed. Please check your OPENAI_API_KEY in .env file.');
    } else if (error.status === 429) {
      throw new Error('OpenAI API rate limit exceeded. Please wait a moment and try again.');
    } else if (error.message && error.message.includes('file')) {
      throw new Error(`Audio file error: ${error.message}. Please ensure the file is a valid audio format (mp3, wav, m4a, webm).`);
    }
    
    throw error;
  }
}

async function translateSummaryForEmail(summaryData, language) {
  if (!openai) {
    console.warn('⚠️  OpenAI not configured; cannot generate translated summary.');
    return null;
  }

  const targetLanguage = language.trim();
  const baseTextParts = [];
  if (summaryData.summary) {
    baseTextParts.push(`Executive summary:\n${summaryData.summary}`);
  }
  if ((summaryData.keyPoints || []).length) {
    baseTextParts.push(
      'Key points:\n' + summaryData.keyPoints.map((p, idx) => `${idx + 1}. ${p}`).join('\n')
    );
  }
  if ((summaryData.decisions || []).length) {
    baseTextParts.push(
      'Decisions:\n' + summaryData.decisions.map((d, idx) => `${idx + 1}. ${d}`).join('\n')
    );
  }
  if ((summaryData.nextSteps || []).length) {
    baseTextParts.push(
      'Next steps:\n' + summaryData.nextSteps.map((s, idx) => `${idx + 1}. ${s}`).join('\n')
    );
  }
  if ((summaryData.importantNotes || []).length) {
    baseTextParts.push(
      'Important notes:\n' + summaryData.importantNotes.map((n, idx) => `${idx + 1}. ${n}`).join('\n')
    );
  }

  const baseText = baseTextParts.join('\n\n').trim();
  if (!baseText) return null;

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            `You are a professional translator. Translate the following meeting summary content from English into ${targetLanguage}. ` +
            'Keep the structure readable but concise. Do NOT include any English in the translated output.',
        },
        {
          role: 'user',
          content: baseText,
        },
      ],
      temperature: 0.2,
    });

    const translated = response.choices?.[0]?.message?.content?.trim();
    if (!translated) return null;

    return translated;
  } catch (err) {
    console.error('❌ Failed to translate summary for email:', err.message);
    return null;
  }
}

/**
 * Send meeting summary to participants via email/WhatsApp
 */
async function sendMeetingSummary(meeting, summaryData, options = {}) {
  let participantEmails = (meeting.participants || [])
    .map(p => p.email)
    .filter(Boolean);

  // If no explicit participant emails were captured, fall back to organizer email
  if ((!participantEmails || participantEmails.length === 0) && meeting.organizer) {
    const organizerEmail = typeof meeting.organizer === 'string'
      ? meeting.organizer
      : meeting.organizer.email || meeting.organizer.name || null;

    if (organizerEmail && String(organizerEmail).includes('@')) {
      participantEmails = [organizerEmail];
      console.log('📧 No participant emails found; falling back to organizer for summary email');
    }
  }

  // Compute duration for email/PDF display
  let durationMinutes = null;
  if (meeting.startTime && meeting.endTime) {
    const start = new Date(meeting.startTime);
    const end = new Date(meeting.endTime);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) {
      durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    }
  }

  console.log('📧 Meeting summary ready to send:');
  console.log(`   Meeting: ${meeting.title}`);
  console.log(`   Participants: ${participantEmails.join(', ')}`);
  console.log(`   Summary: ${summaryData.summary.substring(0, 100)}...`);

  if (!isEmailConfigured() || participantEmails.length === 0) {
    console.warn('⚠️  Email not configured (set RESEND_API_KEY or MAIL_*) or no participant emails. Summary will not be emailed.');
    return { success: true, message: 'Summary prepared (email not sent - not configured or no emails)' };
  }

  const subject = `Meeting Summary \u2013 ${meeting.title} | PortIQ Meeting Assistant`;
  const textLines = [
    'Hello,',
    '',
    `Please find attached the automatically generated summary for the meeting titled "${meeting.title}".`,
    '',
    'The attached document contains the executive summary, key discussion points, decisions made, and action items identified during the meeting.',
    '',
    'If you have any feedback regarding the accuracy or structure of the summary, please feel free to reply to this email.',
    '',
    '---',
    'PortIQ Technologies',
    'Meeting Intelligence Platform',
    '',
    'This summary was automatically generated by the PortIQ Meeting Assistant.',
    '',
    'For any concerns please contact',
    'help@portiqtechnologies.com'
  ];

  // Build formal PDF minutes
  const pdfBuffers = [];
  const doc = new PDFDocument({ margin: 50 });
  doc.on('data', chunk => pdfBuffers.push(chunk));

  const companyName = process.env.COMPANY_NAME || 'Your Company';
  const logoPath = process.env.COMPANY_LOGO_PATH;

  // Header with company name and logo
  if (logoPath && fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, { fit: [100, 40], align: 'left' });
    } catch (e) {
      console.warn('⚠️  Failed to load company logo for PDF:', e.message);
    }
    doc.moveDown();
  }

  doc
    .fontSize(18)
    .text(companyName, { align: 'left' })
    .moveDown(0.5);

  doc
    .fontSize(16)
    .text('Minutes of Meeting', { align: 'left' })
    .moveDown();

  // Meeting details
  const meetingDate = meeting.startTime ? new Date(meeting.startTime) : new Date();
  const dateStamp = meetingDate.toISOString().split('T')[0]; // YYYY-MM-DD
  const safeTitleForFile = (meeting.title || 'Meeting')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  doc
    .fontSize(12)
    .text(`Title: ${meeting.title}`)
    .text(`Room: ${meeting.meetingRoom}`)
    .text(`Organizer: ${meeting.organizer || ''}`)
    .text(`Date: ${meetingDate.toLocaleString()}`);

  if (durationMinutes) {
    doc.text(`Duration: ${durationMinutes} minutes`);
  }

  doc.moveDown();

  // Summary
  doc
    .fontSize(13)
    .text('Summary', { underline: true })
    .moveDown(0.5)
    .fontSize(12)
    .text(summaryData.summary || 'No summary provided.')
    .moveDown();

  // Key Points
  if ((summaryData.keyPoints || []).length) {
    doc
      .fontSize(13)
      .text('Key Points', { underline: true })
      .moveDown(0.5)
      .fontSize(12);
    (summaryData.keyPoints || []).forEach(p => {
      doc.text(`• ${p}`);
    });
    doc.moveDown();
  }

  // Action Items
  if ((summaryData.actionItems || []).length) {
    doc
      .fontSize(13)
      .text('Action Items', { underline: true })
      .moveDown(0.5)
      .fontSize(12);
    (summaryData.actionItems || []).forEach(a => {
      const task = a.task || a.toString();
      const assignee = a.assignee ? `Owner: ${a.assignee}` : '';
      const due = a.dueDate ? `Deadline: ${a.dueDate}` : '';
      const notes = a.notes ? `Notes: ${a.notes}` : '';
      doc.text(`• Task: ${task}`);
      if (assignee) doc.text(`  ${assignee}`);
      if (due) doc.text(`  ${due}`);
      if (notes) doc.text(`  ${notes}`);
      doc.moveDown(0.3);
    });
    doc.moveDown();
  }

  // Decisions
  if ((summaryData.decisions || []).length) {
    doc
      .fontSize(13)
      .text('Decisions', { underline: true })
      .moveDown(0.5)
      .fontSize(12);
    (summaryData.decisions || []).forEach(d => {
      doc.text(`• ${d}`);
    });
    doc.moveDown();
  }

  // Important Notes
  if ((summaryData.importantNotes || []).length) {
    doc
      .fontSize(13)
      .text('Important Notes', { underline: true })
      .moveDown(0.5)
      .fontSize(12);
    (summaryData.importantNotes || []).forEach(n => {
      doc.text(`• ${n}`);
    });
    doc.moveDown();
  }

  // Next Steps
  if ((summaryData.nextSteps || []).length) {
    doc
      .fontSize(13)
      .text('Next Steps', { underline: true })
      .moveDown(0.5)
      .fontSize(12);
    (summaryData.nextSteps || []).forEach(s => {
      doc.text(`• ${s}`);
    });
  }

  doc.end();
  const pdfBuffer = await new Promise(resolve => {
    doc.on('end', () => resolve(Buffer.concat(pdfBuffers)));
  });

  const logoUrl = process.env.COMPANY_LOGO_URL || 'https://portiqtechnologies.com/logo.png';

  const baseUrl =
    process.env.MEETING_SUMMARY_BASE_URL ||
    process.env.CLIENT_BASE_URL ||
    'https://meetingassistant.portiqtechnologies.com';
  const summaryUrl = `${String(baseUrl).replace(/\/+$/, '')}/meetings/${meeting._id}/summary`;

  const toGoogleDateTimeUtc = (d) => {
    const iso = new Date(d).toISOString(); // UTC
    return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  };

  const buildGoogleCalendarUrlForMeeting = ({ title, details, location, startDate, endDate }) => {
    if (!startDate || !endDate) return null;
    const start = toGoogleDateTimeUtc(startDate);
    const end = toGoogleDateTimeUtc(endDate);
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: title || 'Meeting',
      details: details || '',
      location: location || '',
      dates: `${start}/${end}`,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  };

  const buildOutlookCalendarUrlForMeeting = ({ title, details, location, startDate, endDate }) => {
    if (!startDate || !endDate) return null;
    const startdt = new Date(startDate).toISOString();
    const enddt = new Date(endDate).toISOString();
    const params = new URLSearchParams({
      path: '/calendar/action/compose',
      subject: title || 'Meeting',
      body: details || '',
      location: location || '',
      startdt,
      enddt,
    });
    return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
  };

  const buildMeetingIcs = ({ title, description, location, startDate, endDate }) => {
    if (!startDate || !endDate) return null;
    const uid = `${meeting._id}-${Date.now()}@portiq`;
    const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const toUtc = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const esc = (s) =>
      String(s || '')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//PortIQ//Meeting Assistant//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${toUtc(startDate)}`,
      `DTEND:${toUtc(endDate)}`,
      `SUMMARY:${esc(title || 'Meeting')}`,
      location ? `LOCATION:${esc(location)}` : null,
      description ? `DESCRIPTION:${esc(description)}` : null,
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .filter(Boolean)
      .join('\r\n');
  };

  const toAllDayDate = (value) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return { y, m, day, date: `${y}-${m}-${day}`, compact: `${y}${m}${day}` };
  };

  const buildGoogleCalendarUrlForTask = (taskTitle, details, dueDate) => {
    const parts = toAllDayDate(dueDate);
    if (!parts) return null;
    const start = parts.compact;
    const endD = new Date(new Date(dueDate).getTime() + 24 * 60 * 60 * 1000);
    const endParts = toAllDayDate(endD);
    const end = endParts ? endParts.compact : start;
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: taskTitle || 'Action item',
      details: details || '',
      dates: `${start}/${end}`,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  };

  const buildOutlookCalendarUrlForTask = (taskTitle, details, dueDate) => {
    const parts = toAllDayDate(dueDate);
    if (!parts) return null;
    const startdt = parts.date;
    const endD = new Date(new Date(dueDate).getTime() + 24 * 60 * 60 * 1000);
    const endParts = toAllDayDate(endD);
    const enddt = endParts ? endParts.date : parts.date;
    const params = new URLSearchParams({
      path: '/calendar/action/compose',
      subject: taskTitle || 'Action item',
      body: details || '',
      startdt,
      enddt,
      allday: 'true',
    });
    return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
  };

  const buildActionItemsIcs = (items) => {
    const esc = (s) =>
      String(s || '')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');

    const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//PortIQ//Meeting Assistant//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];

    (items || []).forEach((a, idx) => {
      if (!a || !a.dueDate) return;
      const dueParts = toAllDayDate(a.dueDate);
      if (!dueParts) return;
      const endD = new Date(new Date(a.dueDate).getTime() + 24 * 60 * 60 * 1000);
      const endParts = toAllDayDate(endD);
      const uid = `${meeting._id}-${idx}-${Date.now()}@portiq`;
      const summary = a.task ? `Action: ${a.task}` : 'Action item';
      const desc = [
        meeting.title ? `Meeting: ${meeting.title}` : null,
        a.assignee ? `Assignee: ${a.assignee}` : null,
        'Created via PortIQ Meeting Assistant.',
        summaryUrl ? `Summary: ${summaryUrl}` : null,
      ]
        .filter(Boolean)
        .join('\\n');

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${dtStamp}`);
      lines.push(`DTSTART;VALUE=DATE:${dueParts.compact}`);
      lines.push(`DTEND;VALUE=DATE:${endParts ? endParts.compact : dueParts.compact}`);
      lines.push(`SUMMARY:${esc(summary)}`);
      lines.push(`DESCRIPTION:${esc(desc)}`);
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  };

  const actionItemsForEmail = (summaryData.actionItems || [])
    .map((a) => ({
      task: a?.task || (typeof a === 'string' ? a : ''),
      assignee: a?.assignee || '',
      dueDate: a?.dueDate || null,
    }))
    .filter((a) => a.task);

  const actionItemsWithDates = actionItemsForEmail.filter((a) => a.dueDate && toAllDayDate(a.dueDate));

  const actionItemsBlock = actionItemsWithDates.length
    ? `
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="margin: 0 0 10px 0; font-size: 13px; color: #4b5563;">
        <strong>Action items (add to your calendar):</strong>
      </p>
      <div style="font-size: 13px; color: #111827;">
        ${actionItemsWithDates.map((a) => {
          const due = new Date(a.dueDate);
          const dueText = Number.isNaN(due.getTime()) ? '' : due.toLocaleDateString();
          const details = [
            meeting.title ? `Meeting: ${meeting.title}` : null,
            a.assignee ? `Assignee: ${a.assignee}` : null,
            summaryUrl ? `Summary: ${summaryUrl}` : null,
          ].filter(Boolean).join('\\n');
          const gcal = buildGoogleCalendarUrlForTask(a.task, details, a.dueDate);
          const outlook = buildOutlookCalendarUrlForTask(a.task, details, a.dueDate);
          const safeTask = String(a.task).replace(/</g, '&lt;');
          return `
            <div style="border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; background: #f9fafb;">
              <div style="font-weight: 700; margin-bottom: 4px;">${safeTask}</div>
              <div style="color: #4b5563; margin-bottom: 8px;">
                ${a.assignee ? `<span>Assignee: ${String(a.assignee).replace(/</g, '&lt;')}</span><br/>` : ''}
                ${dueText ? `<span>Due: ${dueText}</span>` : ''}
              </div>
              <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                ${gcal ? `<a href="${gcal}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;font-weight:600;">Add to Google Calendar</a>` : ''}
                ${outlook ? `<a href="${outlook}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;font-weight:600;">Add to Outlook</a>` : ''}
              </div>
            </div>
          `;
        }).join('')}
        <p style="margin: 8px 0 0 0; color: #6b7280;">
          Tip: You can also import the attached <strong>.ics</strong> file to add all action items at once.
        </p>
      </div>
    `
    : '';

  const meetingStart = meeting.startTime || meeting.scheduledTime;
  const meetingEnd = meeting.endTime || (meetingStart ? new Date(new Date(meetingStart).getTime() + 60 * 60 * 1000) : null);
  const meetingDetailsForCalendar = [
    meeting.organizer ? `Organizer: ${meeting.organizer}` : null,
    (meeting.participants || []).length
      ? `Participants:\n${(meeting.participants || [])
          .map(p => (p?.email ? `${p.name || p.email} (${p.email})` : (p?.name || '')))
          .filter(Boolean)
          .map(x => `- ${x}`)
          .join('\n')}`
      : null,
    summaryUrl ? `Summary: ${summaryUrl}` : null,
    'Created via PortIQ Meeting Assistant.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const meetingCalendarGoogle = meetingStart && meetingEnd
    ? buildGoogleCalendarUrlForMeeting({
        title: meeting.title || 'Meeting',
        details: meetingDetailsForCalendar,
        location: meeting.meetingRoom || '',
        startDate: meetingStart,
        endDate: meetingEnd,
      })
    : null;

  const meetingCalendarOutlook = meetingStart && meetingEnd
    ? buildOutlookCalendarUrlForMeeting({
        title: meeting.title || 'Meeting',
        details: meetingDetailsForCalendar,
        location: meeting.meetingRoom || '',
        startDate: meetingStart,
        endDate: meetingEnd,
      })
    : null;

  const meetingIcs = meetingStart && meetingEnd
    ? buildMeetingIcs({
        title: meeting.title || 'Meeting',
        description: meetingDetailsForCalendar,
        location: meeting.meetingRoom || '',
        startDate: meetingStart,
        endDate: meetingEnd,
      })
    : null;

  const meetingCalendarBlock = (meetingCalendarGoogle || meetingCalendarOutlook)
    ? `
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="margin: 0 0 10px 0; font-size: 13px; color: #4b5563;">
        <strong>Add this meeting to your calendar:</strong>
      </p>
      <div style="display: flex; gap: 12px; flex-wrap: wrap; font-size: 13px;">
        ${meetingCalendarGoogle ? `<a href="${meetingCalendarGoogle}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;font-weight:600;">Add to Google Calendar</a>` : ''}
        ${meetingCalendarOutlook ? `<a href="${meetingCalendarOutlook}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;font-weight:600;">Add to Outlook</a>` : ''}
      </div>
      <p style="margin: 10px 0 0 0; font-size: 12px; color: #6b7280;">
        Tip: You can also import the attached <strong>Meeting .ics</strong> file.
      </p>
    `
    : '';

  let translatedBlock = '';
  if (options.translationLanguage) {
    const translated = await translateSummaryForEmail(summaryData, options.translationLanguage);
    if (translated) {
      translatedBlock = `
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="margin: 0 0 8px 0; font-size: 13px; color: #4b5563;">
        Translated summary (<strong>${options.translationLanguage}</strong>):
      </p>
      <div style="white-space: pre-wrap; font-size: 13px; color: #111827; background: #f9fafb; padding: 12px 14px; border-radius: 8px; border: 1px solid #e5e7eb;">
        ${translated.replace(/</g, '&lt;')}
      </div>`;
    }
  }

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #111827; line-height: 1.6;">
      <div style="text-align: left; margin-bottom: 16px;">
        <img src="${logoUrl}" alt="PortIQ Technologies" style="max-width: 160px; height: auto; display: block; margin-bottom: 12px;" />
      </div>
      <p>Hello,</p>
      <p>
        Please find attached the automatically generated summary for the meeting titled
        "<strong>${meeting.title}</strong>".
      </p>
      <p>
        The attached document contains the executive summary, key discussion points, decisions made,
        and action items identified during the meeting.
      </p>
      <p>
        If you have any feedback regarding the accuracy or structure of the summary,
        please feel free to reply to this email.
      </p>
      <p>
        View the meeting summary online:<br/>
        <a href="${summaryUrl}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: none;">
          ${summaryUrl}
        </a>
      </p>
      ${meetingCalendarBlock}
      ${actionItemsBlock}
      <br/>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="margin: 0;">
        <strong>PortIQ Technologies</strong><br/>
        Meeting Intelligence Platform
      </p>
      <p style="margin: 12px 0 0 0; font-size: 13px; color: #4b5563;">
        This summary was automatically generated by the PortIQ Meeting Assistant.
      </p>
      <p style="margin: 8px 0 0 0; font-size: 13px; color: #4b5563;">
        For any concerns please contact<br/>
        <a href="mailto:help@portiqtechnologies.com" style="color: #2563eb; text-decoration: none;">
          help@portiqtechnologies.com
        </a>
      </p>
      ${translatedBlock}
    </div>
  `;

  const result = await sendEmail({
    from: getDefaultFrom(),
    to: participantEmails,
    subject,
    text: textLines.join('\n'),
    html: htmlBody,
    attachments: [
      {
        filename: `Meeting-Summary-${safeTitleForFile}-${dateStamp}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
      ...(meetingIcs
        ? [{
            filename: `Meeting-${safeTitleForFile}-${dateStamp}.ics`,
            content: Buffer.from(meetingIcs, 'utf8'),
            contentType: 'text/calendar; charset=utf-8',
          }]
        : []),
      ...(actionItemsWithDates.length > 0
        ? [{
            filename: `Action-Items-${safeTitleForFile}-${dateStamp}.ics`,
            content: Buffer.from(buildActionItemsIcs(actionItemsWithDates), 'utf8'),
            contentType: 'text/calendar; charset=utf-8',
          }]
        : []),
    ],
  });

  if (result.success) {
    console.log('✅ Meeting summary email sent');
    return { success: true, message: 'Summary emailed to participants' };
  }
  console.error('❌ Failed to send meeting summary email:', result.error);
  return { success: false, message: 'Summary generated but email failed to send', error: result.error };
}

function getMailTransporter() {
  const { getMailTransporter: getTransporter } = require('./emailService');
  return getTransporter();
}

module.exports = {
  transcribeAndSummarize,
  sendMeetingSummary,
  getMailTransporter
};
