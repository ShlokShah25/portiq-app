const UI_LANG_KEY = 'portiq_ui_language';

export const SUPPORTED_UI_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'mr', label: 'Marathi' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'ru', label: 'Russian' },
  { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'ja', label: 'Japanese' },
];

export function getUiLanguage() {
  if (typeof window === 'undefined') return 'en';
  return window.localStorage.getItem(UI_LANG_KEY) || 'en';
}

export function setUiLanguage(code) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(UI_LANG_KEY, code || 'en');
}

const STRINGS = {
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.meetings': 'Meetings',
    'nav.participantBook': 'Participant book',
    'nav.insights': 'Insights',
    'nav.profile': 'Profile',
    'nav.admin': 'Admin',
    'nav.settings': 'Settings',
    'nav.logout': 'Logout',
  },
  hi: {
    'nav.dashboard': 'डैशबोर्ड',
    'nav.meetings': 'मीटिंग्स',
    'nav.participantBook': 'प्रतिभागी पुस्तक',
    'nav.insights': 'इनसाइट्स',
    'nav.profile': 'प्रोफ़ाइल',
    'nav.admin': 'एडमिन',
    'nav.settings': 'सेटिंग्स',
    'nav.logout': 'लॉगआउट',
  },
  mr: {
    'nav.dashboard': 'डॅशबोर्ड',
    'nav.meetings': 'मीटिंग्स',
    'nav.participantBook': 'सहभागी पुस्तिका',
    'nav.insights': 'इनसाइट्स',
    'nav.profile': 'प्रोफाइल',
    'nav.admin': 'अ‍ॅडमिन',
    'nav.settings': 'सेटिंग्ज',
    'nav.logout': 'लॉगआउट',
  },
  gu: {
    'nav.dashboard': 'ડેશબોર્ડ',
    'nav.meetings': 'મીટિંગ્સ',
    'nav.participantBook': 'ભાગ લેનાર પુસ્તક',
    'nav.insights': 'ઇન્સાઇટ્સ',
    'nav.profile': 'પ્રોફાઇલ',
    'nav.admin': 'એડમિન',
    'nav.settings': 'સેટિંગ્સ',
    'nav.logout': 'લોગ આઉટ',
  },
  es: {
    'nav.dashboard': 'Panel',
    'nav.meetings': 'Reuniones',
    'nav.participantBook': 'Libreta de participantes',
    'nav.insights': 'Insights',
    'nav.profile': 'Perfil',
    'nav.admin': 'Admin',
    'nav.settings': 'Ajustes',
    'nav.logout': 'Cerrar sesión',
  },
  fr: {
    'nav.dashboard': 'Tableau de bord',
    'nav.meetings': 'Réunions',
    'nav.participantBook': 'Carnet de participants',
    'nav.insights': 'Insights',
    'nav.profile': 'Profil',
    'nav.admin': 'Admin',
    'nav.settings': 'Paramètres',
    'nav.logout': 'Déconnexion',
  },
  de: {
    'nav.dashboard': 'Dashboard',
    'nav.meetings': 'Meetings',
    'nav.participantBook': 'Teilnehmerbuch',
    'nav.insights': 'Insights',
    'nav.profile': 'Profil',
    'nav.admin': 'Admin',
    'nav.settings': 'Einstellungen',
    'nav.logout': 'Abmelden',
  },
  ru: {
    'nav.dashboard': 'Панель',
    'nav.meetings': 'Встречи',
    'nav.participantBook': 'Книга участников',
    'nav.insights': 'Аналитика',
    'nav.profile': 'Профиль',
    'nav.admin': 'Админ',
    'nav.settings': 'Настройки',
    'nav.logout': 'Выйти',
  },
  zh: {
    'nav.dashboard': '仪表盘',
    'nav.meetings': '会议',
    'nav.participantBook': '参会人名册',
    'nav.insights': '洞察',
    'nav.profile': '个人资料',
    'nav.admin': '管理',
    'nav.settings': '设置',
    'nav.logout': '退出登录',
  },
  ja: {
    'nav.dashboard': 'ダッシュボード',
    'nav.meetings': 'ミーティング',
    'nav.participantBook': '参加者ブック',
    'nav.insights': 'インサイト',
    'nav.profile': 'プロフィール',
    'nav.admin': '管理',
    'nav.settings': '設定',
    'nav.logout': 'ログアウト',
  },
};

export function L(key) {
  const lang = getUiLanguage();
  const table = STRINGS[lang] || STRINGS.en;
  return table[key] || STRINGS.en[key] || key;
}

