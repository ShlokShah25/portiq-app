import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { marketingPricingUrl } from '../config/urls';
import './TrialExperience.css';

const TrialExperienceContext = createContext(null);

const ONBOARDING_KEY = 'portiq_onboarding_v1_done';
const WELCOME_KEY = 'portiq_trial_welcome_v1_done';
const PRODUCT_KEY = 'portiq_product';
const PRODUCT_SYNC_FLAG_KEY = 'portiq_product_sync_once';

export function useTrialExperience() {
  return useContext(TrialExperienceContext);
}

export default function TrialExperienceProvider({ children }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [limitModalOpen, setLimitModalOpen] = useState(false);
  const [forcePasswordOpen, setForcePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const refreshProfile = useCallback(async () => {
    try {
      const res = await axios.get('/admin/profile');
      const admin = res.data?.admin || null;
      setProfile(admin);
      if (admin && typeof window !== 'undefined') {
        const serverProduct = String(admin.productType || 'workplace').toLowerCase();
        let localProduct = 'workplace';
        try {
          localProduct = window.localStorage.getItem(PRODUCT_KEY) || 'workplace';
        } catch (_) {
          localProduct = 'workplace';
        }
        if (serverProduct && localProduct !== serverProduct) {
          try {
            window.localStorage.setItem(PRODUCT_KEY, serverProduct);
          } catch (_) {
            // ignore write failures and continue without a hard reload
          }
          try {
            const marker = `${localProduct}->${serverProduct}`;
            const seen = window.sessionStorage.getItem(PRODUCT_SYNC_FLAG_KEY);
            if (seen !== marker) {
              window.sessionStorage.setItem(PRODUCT_SYNC_FLAG_KEY, marker);
              // Product shell is decided at bootstrap; one guarded reload applies mode-specific UI.
              window.location.reload();
              return;
            }
          } catch (_) {
            // If session storage is unavailable, avoid repeated reload attempts.
          }
        } else {
          try {
            window.sessionStorage.removeItem(PRODUCT_SYNC_FLAG_KEY);
          } catch (_) {
            // ignore
          }
        }
      }
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  useEffect(() => {
    if (!profile?.isTrialing) {
      setOnboardingStep(0);
      setWelcomeOpen(false);
    }
  }, [profile?.isTrialing]);

  useEffect(() => {
    if (loading || !profile?.isTrialing) return;
    const done = typeof window !== 'undefined' && window.localStorage.getItem(ONBOARDING_KEY) === '1';
    if (!done) {
      setOnboardingStep(1);
      setWelcomeOpen(false);
      return;
    }
    const welcomeDone =
      typeof window !== 'undefined' && window.localStorage.getItem(WELCOME_KEY) === '1';
    if (!welcomeDone) {
      setWelcomeOpen(true);
    }
  }, [loading, profile?.isTrialing]);

  useEffect(() => {
    const onLimit = () => setLimitModalOpen(true);
    window.addEventListener('portiq-trial-limit', onLimit);
    return () => window.removeEventListener('portiq-trial-limit', onLimit);
  }, []);

  useEffect(() => {
    if (!profile?.trialExhausted) return;
    try {
      if (window.sessionStorage.getItem('portiq_trial_limit_modal_v1') === '1') return;
    } catch {
      /* ignore */
    }
    setLimitModalOpen(true);
    try {
      window.sessionStorage.setItem('portiq_trial_limit_modal_v1', '1');
    } catch {
      /* ignore */
    }
  }, [profile?.trialExhausted]);

  useEffect(() => {
    const mustChange = !!profile?.mustChangePassword;
    setForcePasswordOpen(mustChange);
    if (!mustChange) {
      setCurrentPassword('');
      setNewPassword('');
      setPasswordError('');
      setPasswordBusy(false);
    }
  }, [profile?.mustChangePassword]);

  const completeOnboarding = useCallback(() => {
    try {
      window.localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      /* ignore */
    }
    setOnboardingStep(0);
    setWelcomeOpen(true);
  }, []);

  const dismissWelcome = useCallback(() => {
    try {
      window.localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      /* ignore */
    }
    setWelcomeOpen(false);
  }, []);

  const startFirstMeeting = useCallback(() => {
    try {
      window.localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      /* ignore */
    }
    setWelcomeOpen(false);
    navigate('/meetings', { state: { openStartModal: true } });
  }, [navigate]);

  const openPricing = useCallback(() => {
    window.location.href = marketingPricingUrl();
  }, []);

  const dismissLimitModal = useCallback(() => {
    setLimitModalOpen(false);
  }, []);

  const submitForcedPasswordChange = useCallback(async () => {
    setPasswordError('');
    const curr = String(currentPassword || '').trim();
    const next = String(newPassword || '').trim();
    if (!curr || !next) {
      setPasswordError('Current password and new password are required.');
      return;
    }
    if (next.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    setPasswordBusy(true);
    try {
      await axios.put('/admin/password', { currentPassword: curr, newPassword: next });
      await refreshProfile();
      setCurrentPassword('');
      setNewPassword('');
      setForcePasswordOpen(false);
    } catch (err) {
      const d = err.response?.data;
      setPasswordError(
        [d?.error, d?.details].filter(Boolean).join(' — ') ||
          'Unable to update password. Please try again.'
      );
    } finally {
      setPasswordBusy(false);
    }
  }, [currentPassword, newPassword, refreshProfile]);

  const value = useMemo(
    () => ({
      profile,
      loading,
      refreshProfile,
    }),
    [profile, loading, refreshProfile]
  );

  const showOnboarding = onboardingStep >= 1 && onboardingStep <= 3;

  return (
    <TrialExperienceContext.Provider value={value}>
      {children}

      {showOnboarding && (
        <div
          className="portiq-trial-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="portiq-onboarding-title"
        >
          <div className="portiq-trial-modal">
            <div className="portiq-trial-modal__steps" aria-hidden>
              {[1, 2, 3].map((s) => (
                <span
                  key={s}
                  className={`portiq-trial-modal__step-dot${
                    s <= onboardingStep ? ' portiq-trial-modal__step-dot--on' : ''
                  }`}
                />
              ))}
            </div>

            {onboardingStep === 1 && (
              <>
                <p className="portiq-trial-modal__eyebrow">Step 1 of 3</p>
                <h2 className="portiq-trial-modal__title" id="portiq-onboarding-title">
                  Welcome to PortIQ
                </h2>
                <p className="portiq-trial-modal__body">
                  You’re set up to run structured meetings with clear outcomes—without extra busywork.
                </p>
                <div className="portiq-trial-modal__actions">
                  <button
                    type="button"
                    className="portiq-trial-modal__btn portiq-trial-modal__btn--primary"
                    onClick={() => setOnboardingStep(2)}
                  >
                    Next
                  </button>
                </div>
              </>
            )}

            {onboardingStep === 2 && (
              <>
                <p className="portiq-trial-modal__eyebrow">Step 2 of 3</p>
                <h2 className="portiq-trial-modal__title" id="portiq-onboarding-title">
                  How it works
                </h2>
                <ul className="portiq-trial-modal__list">
                  <li>Start a meeting</li>
                  <li>Talk normally</li>
                  <li>Get summaries and action items</li>
                </ul>
                <div className="portiq-trial-modal__actions">
                  <button
                    type="button"
                    className="portiq-trial-modal__btn portiq-trial-modal__btn--primary"
                    onClick={() => setOnboardingStep(3)}
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    className="portiq-trial-modal__btn portiq-trial-modal__btn--ghost"
                    onClick={() => setOnboardingStep(1)}
                  >
                    Back
                  </button>
                </div>
              </>
            )}

            {onboardingStep === 3 && (
              <>
                <p className="portiq-trial-modal__eyebrow">Step 3 of 3</p>
                <h2 className="portiq-trial-modal__title" id="portiq-onboarding-title">
                  Start your first meeting
                </h2>
                <p className="portiq-trial-modal__body">
                  When you’re ready, open a new meeting and PortIQ will capture the signal—not the noise.
                </p>
                <div className="portiq-trial-modal__actions">
                  <button
                    type="button"
                    className="portiq-trial-modal__btn portiq-trial-modal__btn--primary"
                    onClick={completeOnboarding}
                  >
                    Continue
                  </button>
                  <button
                    type="button"
                    className="portiq-trial-modal__btn portiq-trial-modal__btn--ghost"
                    onClick={() => setOnboardingStep(2)}
                  >
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {welcomeOpen && profile?.isTrialing && (
        <div
          className="portiq-trial-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="portiq-welcome-title"
        >
          <div className="portiq-trial-modal">
            <button
              type="button"
              className="portiq-trial-modal__close"
              onClick={dismissWelcome}
              aria-label="Close"
            >
              ×
            </button>
            <h2 className="portiq-trial-modal__title" id="portiq-welcome-title">
              Welcome to your free trial
            </h2>
            <p className="portiq-trial-modal__body">
              You get 3 meetings to experience how PortIQ turns conversations into clear summaries and
              action items.
            </p>
            <div className="portiq-trial-modal__actions">
              <button
                type="button"
                className="portiq-trial-modal__btn portiq-trial-modal__btn--primary"
                onClick={startFirstMeeting}
              >
                Start your first meeting
              </button>
            </div>
          </div>
        </div>
      )}

      {limitModalOpen && profile?.trialExhausted && (
        <div
          className="portiq-trial-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="portiq-limit-title"
        >
          <div className="portiq-trial-modal">
            <button
              type="button"
              className="portiq-trial-modal__close"
              onClick={dismissLimitModal}
              aria-label="Close"
            >
              ×
            </button>
            <h2 className="portiq-trial-modal__title" id="portiq-limit-title">
              You’ve reached your free limit
            </h2>
            <p className="portiq-trial-modal__body">
              Continue turning meetings into clear summaries and action items without missing anything.
            </p>
            <div className="portiq-trial-modal__actions">
              <button
                type="button"
                className="portiq-trial-modal__btn portiq-trial-modal__btn--primary"
                onClick={openPricing}
              >
                Get Plan Now
              </button>
              <button
                type="button"
                className="portiq-trial-modal__btn portiq-trial-modal__btn--ghost"
                onClick={dismissLimitModal}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {forcePasswordOpen && (
        <div
          className="portiq-trial-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="portiq-force-password-title"
        >
          <div className="portiq-trial-modal">
            <h2 className="portiq-trial-modal__title" id="portiq-force-password-title">
              Change your temporary password
            </h2>
            <p className="portiq-trial-modal__body">
              For security, you must set a new password before continuing.
            </p>
            <label className="portiq-trial-modal__body" style={{ display: 'block', marginBottom: 10 }}>
              Current password
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                style={{ width: '100%', marginTop: 6 }}
              />
            </label>
            <label className="portiq-trial-modal__body" style={{ display: 'block' }}>
              New password
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={{ width: '100%', marginTop: 6 }}
              />
            </label>
            {passwordError ? (
              <p style={{ marginTop: 10, color: '#fca5a5', fontSize: 13 }}>{passwordError}</p>
            ) : null}
            <div className="portiq-trial-modal__actions">
              <button
                type="button"
                className="portiq-trial-modal__btn portiq-trial-modal__btn--primary"
                onClick={submitForcedPasswordChange}
                disabled={passwordBusy}
              >
                {passwordBusy ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </TrialExperienceContext.Provider>
  );
}
