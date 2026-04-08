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

  const refreshProfile = useCallback(async () => {
    try {
      const res = await axios.get('/admin/profile');
      setProfile(res.data?.admin || null);
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
    </TrialExperienceContext.Provider>
  );
}
