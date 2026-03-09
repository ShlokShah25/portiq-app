import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Html5Qrcode } from 'html5-qrcode';
import './CheckoutScreen.css';

const CheckoutScreen = ({ config }) => {
  const navigate = useNavigate();
  const [mode, setMode] = useState('enter');
  const [qrToken, setQrToken] = useState('');
  const [manualData, setManualData] = useState({ name: '', phoneNumber: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [countdown, setCountdown] = useState(5);
  const [scanning, setScanning] = useState(false);
  const html5QrCodeRef = useRef(null);

  const companyName = config?.companyName || 'Your Company';

  useEffect(() => {
    return () => {
      if (html5QrCodeRef.current && scanning) {
        html5QrCodeRef.current.stop().catch(() => {});
      }
    };
  }, [scanning]);

  const startScanner = async () => {
    try {
      setError('');
      setScanning(true);
      
      const html5QrCode = new Html5Qrcode("qr-reader");
      html5QrCodeRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 }
        },
        (decodedText) => {
          handleScannedCode(decodedText);
        },
        () => {}
      );
    } catch (err) {
      console.error('Scanner error:', err);
      setError('Failed to start camera. Please check permissions.');
      setScanning(false);
    }
  };

  const stopScanner = async () => {
    try {
      if (html5QrCodeRef.current) {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
        html5QrCodeRef.current = null;
      }
      setScanning(false);
    } catch (err) {
      console.error('Stop scanner error:', err);
    }
  };

  const handleScannedCode = async (scannedText) => {
    const code = scannedText.toUpperCase().trim().slice(0, 4);
    if (code.length === 4) {
      setQrToken(code);
      await stopScanner();
      handleCheckout(code);
    }
  };

  const handleCheckout = async (token = null) => {
    const codeToUse = token || qrToken.trim().toUpperCase();
    
    if (!codeToUse || codeToUse.length !== 4) {
      setError('Please enter a valid 4-character code');
      return;
    }

    setError('');
    setSuccess('');
    setLoading(true);

    try {
      await axios.post('/visitors/checkout', { 
        qrToken: codeToUse 
      }, {
        timeout: 10000
      });
      setSuccess(`Thank you for visiting ${companyName}`);
      setQrToken('');
      setCountdown(5);
    } catch (err) {
      console.error('Checkout error:', err);
      setError(err.response?.data?.error || err.message || 'Checkout failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleQRSubmit = async (e) => {
    e.preventDefault();
    await handleCheckout();
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (!manualData.name.trim() || !manualData.phoneNumber.trim()) {
        setError('Please fill in all fields');
        setLoading(false);
        return;
      }
      
      let phoneNumber = manualData.phoneNumber.trim();
      if (!phoneNumber.startsWith('+')) {
        if (phoneNumber.startsWith('91')) {
          phoneNumber = '+' + phoneNumber;
        } else {
          phoneNumber = '+91' + phoneNumber;
        }
      }
      
      await axios.post('/visitors/manual-checkout', {
        name: manualData.name.trim(),
        phoneNumber: phoneNumber
      }, {
        timeout: 10000
      });
      setSuccess(`Thank you for visiting ${companyName}`);
      setManualData({ name: '', phoneNumber: '' });
      setCountdown(5);
    } catch (err) {
      console.error('Manual checkout error:', err);
      setError(err.response?.data?.error || err.message || 'Checkout failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== 'scan' && scanning) {
      stopScanner();
    }
  }, [mode]);

  useEffect(() => {
    if (success && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (success && countdown === 0) {
      navigate('/');
    }
  }, [success, countdown, navigate]);

  return (
    <div className="checkout-screen">
      <div className="checkout-wrapper">
        <h1 className="checkout-title">Visitor Checkout</h1>

        <div className="checkout-tabs">
          <button
            className={`tab-btn ${mode === 'enter' ? 'active' : ''}`}
            onClick={() => {
              setMode('enter');
              if (scanning) stopScanner();
            }}
          >
            Enter Code
          </button>
          <button
            className={`tab-btn ${mode === 'scan' ? 'active' : ''}`}
            onClick={() => {
              setMode('scan');
              if (scanning) stopScanner();
            }}
          >
            Scan QR Code
          </button>
          <button
            className={`tab-btn ${mode === 'manual' ? 'active' : ''}`}
            onClick={() => {
              setMode('manual');
              if (scanning) stopScanner();
            }}
          >
            Manual Checkout
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}
        {success && (
          <div className="success-screen">
            <div className="success-icon-large">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
            </div>
            <div className="success-message-large">{success}</div>
            <div className="success-subtitle">Redirecting to home in {countdown} {countdown === 1 ? 'second' : 'seconds'}...</div>
          </div>
        )}

        {!success && mode === 'enter' && (
          <form onSubmit={handleQRSubmit} className="checkout-form">
            <div className="form-group">
              <label>Enter Exit Code</label>
              <input
                type="text"
                value={qrToken}
                onChange={(e) => {
                  const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
                  setQrToken(value);
                }}
                placeholder="Enter 4-character code"
                required
                autoFocus
                maxLength="4"
                style={{ 
                  textTransform: 'uppercase',
                  fontFamily: 'monospace',
                  fontSize: '24px',
                  letterSpacing: '8px',
                  textAlign: 'center',
                  fontWeight: 'bold'
                }}
              />
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate('/')}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? 'Processing...' : 'Checkout'}
              </button>
            </div>
          </form>
        )}

        {!success && mode === 'scan' && (
          <div className="scan-container">
            <div id="qr-reader" style={{ width: '100%', marginBottom: '20px' }}></div>
            {!scanning && (
              <button
                className="btn btn-primary"
                onClick={startScanner}
                style={{ width: '100%', marginBottom: '15px' }}
              >
                Start Camera
              </button>
            )}
            {scanning && (
              <button
                className="btn btn-secondary"
                onClick={stopScanner}
                style={{ width: '100%', marginBottom: '15px' }}
              >
                Stop Camera
              </button>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  if (scanning) stopScanner();
                  navigate('/');
                }}
              >
                Back
              </button>
            </div>
          </div>
        )}

        {!success && mode === 'manual' && (
          <form onSubmit={handleManualSubmit} className="checkout-form">
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={manualData.name}
                onChange={(e) => setManualData({ ...manualData, name: e.target.value })}
                placeholder="Enter visitor name"
                required
              />
            </div>
            <div className="form-group">
              <label>Phone Number</label>
              <div className="phone-input-group">
                <span className="phone-prefix">+91</span>
                <input
                  type="tel"
                  value={manualData.phoneNumber.replace(/^\+91/, '')}
                  onChange={(e) => {
                    let value = e.target.value.replace(/^\+91/, '').replace(/^91/, '').trim();
                    setManualData({ ...manualData, phoneNumber: value });
                  }}
                  placeholder="9876543210"
                  style={{ flex: 1 }}
                  maxLength="10"
                  required
                />
              </div>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate('/')}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? 'Processing...' : 'Checkout'}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="branding-footer">
        Workplace Visitor Management System
      </div>
    </div>
  );
};

export default CheckoutScreen;
