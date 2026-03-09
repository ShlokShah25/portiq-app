import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import TopNav from './TopNav';
import './Transcripts.css';

const Transcripts = () => {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMeeting, setSelectedMeeting] = useState(null);

  useEffect(() => {
    fetchMeetings();
  }, []);

  const fetchMeetings = async () => {
    try {
      const res = await axios.get('/meetings?limit=50');
      const completedMeetings = (res.data.meetings || []).filter(
        m => m.transcriptionStatus === 'Completed' && m.summary
      );
      setMeetings(completedMeetings);
    } catch (error) {
      console.error('Error fetching meetings:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="transcripts-screen">
        <TopNav />
        <div className="transcripts-wrapper">
          <div className="transcripts-content">
            <div className="loading">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="transcripts-screen">
      <TopNav />
      <div className="transcripts-wrapper">
        <div className="transcripts-top-bar">
          <h1 className="transcripts-title">Transcripts</h1>
        </div>
        
        <div className="transcripts-content">
          {meetings.length === 0 ? (
            <div className="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: '#A1A1A6', marginBottom: '16px' }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              <p>No transcripts available</p>
            </div>
          ) : (
            <div className="transcripts-list">
              {meetings.map(meeting => (
                <div 
                  key={meeting._id} 
                  className="transcript-item"
                  onClick={() => setSelectedMeeting(selectedMeeting?._id === meeting._id ? null : meeting)}
                >
                  <div className="transcript-header">
                    <div className="transcript-title">{meeting.title || 'Untitled Meeting'}</div>
                    <div className="transcript-date">
                      {new Date(meeting.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  {selectedMeeting?._id === meeting._id && (
                    <div className="transcript-content">
                      <div className="transcript-summary">
                        <h3>Summary</h3>
                        <p>{meeting.summary?.executiveSummary || 'No summary available'}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Transcripts;
