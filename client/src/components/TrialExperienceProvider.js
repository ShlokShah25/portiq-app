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
import { isEducation } from '../config/product';
import './TrialExperience.css';
import './Profile.css';

/**
 * Copy for the generic 3-step trial onboarding + welcome/limit modals below.
 * Keyed by product so a teacher on trial sees "lecture"/"classroom" language
 * instead of "meeting" language, matching the vocabulary used everywhere else
 * in Education mode (see config/terminology.js). Add a `cura` entry here if
 * Cura ever needs the same generic modals instead of its own onboarding flow.
 */
const ONBOARDING_COPY = {
  workplace: {
    step1Body:
      'You’re set up to run structured meetings with clear outcomes—without extra busywork.',
    step2Items: ['Start a meeting', 'Talk normally', 'Get summaries and action items'],
    step3Title: 'Start your first meeting',
    step3Body: 'When you’re ready, open a new meeting and PortIQ will capture the signal—not the noise.',
    welcomeBody:
      'You get 3 meetings to experience how PortIQ turns conversations into clear summaries and action items.',
    welcomeCta: 'Start your first meeting',
    limitBody: 'Continue turning meetings into clear summaries and action items without missing anything.',
  },
  education: {
    step1Body:
      'You’re set up to run structured lectures with clear notes—without extra busywork.',
    step2Items: ['Start a lecture', 'Teach normally', 'Get lecture notes and reminders'],
    step3Title: 'Start your first lecture',
    step3Body:
      'When you’re ready, open a new lecture and PortIQ will capture the signal—not the noise. Set up your classrooms first so lecture notes route to the right students automatically.',
    welcomeBody:
      'You get 3 lectures to experience how PortIQ turns your teaching into clear notes and reminders for students.',
    welcomeCta: 'Start your first lecture',
    limitBody: 'Continue turning lectures into clear notes and reminders without missing anything.',
  },
};

function onboardingCopy() {
  return ONBOARDING_COPY[isEducation ? 'education' : 'workplace'];
}

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
  const copy = onboardingCopy();

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
                  {isEducation ? 'Welcome to PortIQ Education' : 'Welcome to PortIQ'}
                </h2>
                <p className="portiq-trial-modal__body">{copy.step1Body}</p>
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
                  {copy.step2Items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
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
                  {copy.step3Title}
                </h2>
                <p className="portiq-trial-modal__body">{copy.step3Body}</p>
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
            <p className="portiq-trial-modal__body">{copy.welcomeBody}</p>
            <div className="portiq-trial-modal__actions">
              <button
                type="button"
                className="portiq-trial-modal__btn portiq-trial-modal__btn--primary"
                onClick={startFirstMeeting}
              >
                {copy.welcomeCta}
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
            <p className="portiq-trial-modal__body">{copy.limitBody}</p>
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
          <div className="portiq-trial-modal portiq-trial-modal--password">
            <h2 className="portiq-trial-modal__title" id="portiq-force-password-title">
              Change your temporary password
            </h2>
            <p className="portiq-trial-modal__body">
              For security, you must set a new password before continuing.
            </p>
            <div className="profile-password-card" style={{ marginTop: 14 }}>
              <div className="profile-field-group">
                <label htmlFor="portiq-force-password-current">Current password</label>
                <input
                  id="portiq-force-password-current"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className="profile-field-group" style={{ marginTop: 12 }}>
                <label htmlFor="portiq-force-password-new">New password</label>
                <input
                  id="portiq-force-password-new"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
            {passwordError ? <p className="profile-password-error" style={{ marginTop: 12 }}>{passwordError}</p> : null}
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
