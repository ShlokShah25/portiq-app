import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import TopNav from './TopNav';
import './Onboarding.css';

const Onboarding = () => {
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!companyName.trim()) {
      setError('Company name is required');
      return;
    }

    try {
      setSubmitting(true);
      const formData = new FormData();
      formData.append('name', companyName.trim());
      if (logoFile) {
        formData.append('logo', logoFile);
      }

      await axios.post('/onboarding/organization', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      // Once organization is created and linked, send user into main app
      navigate('/dashboard', { replace: true });
    } catch (err) {
      console.error('Onboarding error:', err);
      setError(
        err.response?.data?.error ||
          err.message ||
          'Failed to complete onboarding. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="onboarding-screen">
      <TopNav />
      <div className="onboarding-wrapper">
        <div className="onboarding-card">
          <h1 className="onboarding-title">Set up your organization</h1>
          <p className="onboarding-subtitle">
            Create your Portiq workspace so meetings and summaries stay isolated to your company.
          </p>

          {error && <div className="onboarding-error">{error}</div>}

          <form className="onboarding-form" onSubmit={handleSubmit}>
            <div className="onboarding-field">
              <label>Company Name</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Inc."
                required
              />
            </div>

            <div className="onboarding-field">
              <label>Company Logo (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setLogoFile(file || null);
                }}
              />
              <p className="onboarding-help">
                A square PNG or SVG works best. Used for branded summaries and emails.
              </p>
            </div>

            <div className="onboarding-actions">
              <button
                type="submit"
                className="onboarding-primary"
                disabled={submitting}
              >
                {submitting ? 'Creating organization…' : 'Continue'}
              </button>
              <button
                type="button"
                className="onboarding-secondary"
                onClick={() => navigate('/dashboard')}
                disabled={submitting}
              >
                Skip for now
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;

