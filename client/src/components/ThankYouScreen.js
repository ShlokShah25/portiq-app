import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import './ThankYouScreen.css';

const ThankYouScreen = ({ config }) => {
  const navigate = useNavigate();
  const [visitorData, setVisitorData] = useState(null);
  const [countdown, setCountdown] = useState(8);

  useEffect(() => {
    const timer = setTimeout(() => {
      const data = localStorage.getItem('visitorData');
      if (data) {
        try {
          const parsed = JSON.parse(data);
          if (parsed.qrToken) {
            setVisitorData(parsed);
            setTimeout(() => {
              localStorage.removeItem('visitorData');
            }, 2000);
          } else {
            navigate('/');
          }
        } catch (err) {
          navigate('/');
        }
      } else {
        setTimeout(() => {
          navigate('/');
        }, 500);
      }
    }, 200);
    
    return () => clearTimeout(timer);
  }, [navigate]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      navigate('/');
    }
  }, [countdown, navigate]);

  if (!visitorData) {
    return (
      <div className="thank-you-screen">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  const companyName = config?.companyName || 'Your Company';

  return (
    <div className="thank-you-screen">
      <div className="thank-you-container">
        <div className="success-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        </div>
        <h1 className="thank-you-title">Registration Successful</h1>
        <p className="thank-you-message">
          Thank you for visiting {companyName}
        </p>

        <div className="visitor-info-card">
          <div className="info-row">
            <span className="info-label">Visitor ID:</span>
            <span className="info-value">{visitorData.visitorId || 'N/A'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Name:</span>
            <span className="info-value">{visitorData.name}</span>
          </div>
          {visitorData.category && (
            <div className="info-row">
              <span className="info-label">Category:</span>
              <span className="info-value category-badge" style={{ 
                backgroundColor: visitorData.categoryColor || '#E0E0E0' 
              }}>
                {visitorData.category === 'Others' && visitorData.categoryDetail
                  ? visitorData.categoryDetail
                  : visitorData.category}
              </span>
            </div>
          )}
        </div>

        {visitorData.qrToken && (
          <div className="qr-section">
            <p className="qr-label">Your Exit Code</p>
            <div className="qr-code-container">
              <QRCodeSVG value={visitorData.qrToken} size={200} />
            </div>
            <p className="qr-token">{visitorData.qrToken}</p>
            <p className="qr-instruction">
              Use this code or scan the QR code at checkout
            </p>
          </div>
        )}

        <p className="redirect-message">
          Redirecting to home in {countdown} {countdown === 1 ? 'second' : 'seconds'}...
        </p>
      </div>

      <div className="branding-footer">
        Workplace Visitor Management System
      </div>
    </div>
  );
};

export default ThankYouScreen;
