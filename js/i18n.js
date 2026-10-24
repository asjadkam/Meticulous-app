/* Meticulous i18n — v252 (APP-LANGUAGE-BUTTON + I18N, owner
 * Oct 23, 2026 06:31–06:39 MDT: "we also need a language
 * change option in preferences… when the language tab is
 * used, the language of the ENTIRE app should change";
 * the language list is his, incl. Punjabi in BOTH scripts —
 * "Both!").
 *
 * FRAMEWORK FIRST, per the queue: this file carries the
 * language registry, the string packs, the fallback rule and
 * the direction rule. Surfaces convert module by module in
 * follow-on versions; a surface is "converted" only when its
 * strings come through t(). The v252 converted surface is
 * named in version.json: the dashboard module names (through
 * App's moduleTitle seam) and this picker's own card.
 *
 * Rules:
 * - English is the source of truth. t(key) reads the chosen
 *   language's pack, then English, then the caller's fallback,
 *   then the key itself — a missing string is NEVER blank and
 *   NEVER blocks a screen.
 * - Module PROPER names that are acronyms in every market
 *   (PTI — the inspection's own name; P&L) stay as-is in every
 *   pack; everything else is translated.
 * - Direction: Urdu, Arabic and Punjabi-Shahmukhi are RTL;
 *   the rest LTR. setLang applies document.dir immediately;
 *   each converted surface picks the language up as it paints.
 * - The choice persists on the 'app_lang' store key the
 *   moment it is made (no Save button — the Preferences
 *   live-apply pattern).
 */
(function () {
  'use strict';
  window.Meticulous = window.Meticulous || {};

  var LANGS = [
    { code: 'en',    name: 'English',            dir: 'ltr' },
    { code: 'ur',    name: 'اردو',                dir: 'rtl' },
    { code: 'pa-sh', name: 'پنجابی (شاہ مکھی)',   dir: 'rtl' },
    { code: 'pa-gur', name: 'ਪੰਜਾਬੀ (ਗੁਰਮੁਖੀ)',   dir: 'ltr' },
    { code: 'hi',    name: 'हिन्दी',              dir: 'ltr' },
    { code: 'ar',    name: 'العربية',             dir: 'rtl' },
    { code: 'ru',    name: 'Русский',             dir: 'ltr' },
    { code: 'uk',    name: 'Українська',          dir: 'ltr' },
    { code: 'es',    name: 'Español',             dir: 'ltr' },
    { code: 'fr',    name: 'Français',            dir: 'ltr' },
    { code: 'bs',    name: 'Bosanski',            dir: 'ltr' },
    { code: 'zh',    name: '中文',                 dir: 'ltr' },
    { code: 'ja',    name: '日本語',               dir: 'ltr' }
  ];

  /* The v252 pack surface: the dashboard module names +
   * the picker's own word. Keys are added surface by surface
   * in the follow-on conversion versions. */
  var PACKS = {
    en: {
      'mod.revenue': 'Revenue', 'mod.dispatch': 'Dispatch', 'mod.navigator': 'Navigator',
      'mod.fuel': 'Fuel & Expense', 'mod.pnl': 'P&L', 'mod.maintenance': 'Maintenance',
      'mod.pti': 'PTI', 'mod.damage': 'Damage & Incident', 'mod.manifest': 'Manifest / Daily Log',
      'mod.invoice': 'Invoice', 'mod.paystub': 'Pay Stub', 'mod.connect': 'Connect',
      'prefs.language': 'Language'
    },
    ur: {
      'mod.revenue': 'آمدنی', 'mod.dispatch': 'روانگی', 'mod.navigator': 'رہنما',
      'mod.fuel': 'ایندھن اور خرچ', 'mod.pnl': 'P&L', 'mod.maintenance': 'دیکھ بھال',
      'mod.pti': 'PTI', 'mod.damage': 'نقصان اور واقعہ', 'mod.manifest': 'Manifest / روزنامچہ',
      'mod.invoice': 'رسید', 'mod.paystub': 'تنخواہ پرچی', 'mod.connect': 'رابطہ',
      'prefs.language': 'زبان'
    },
    'pa-sh': {
      'mod.revenue': 'آمدنی', 'mod.dispatch': 'روانگی', 'mod.navigator': 'رہنما',
      'mod.fuel': 'بالن تے خرچ', 'mod.pnl': 'P&L', 'mod.maintenance': 'دیکھ بھال',
      'mod.pti': 'PTI', 'mod.damage': 'نقصان تے واقعہ', 'mod.manifest': 'Manifest / روزنامچہ',
      'mod.invoice': 'رسید', 'mod.paystub': 'تنخواہ پرچی', 'mod.connect': 'رابطہ',
      'prefs.language': 'زبان'
    },
    'pa-gur': {
      'mod.revenue': 'ਆਮਦਨ', 'mod.dispatch': 'ਰਵਾਨਗੀ', 'mod.navigator': 'ਨੈਵੀਗੇਟਰ',
      'mod.fuel': 'ਬਾਲਣ ਅਤੇ ਖਰਚਾ', 'mod.pnl': 'P&L', 'mod.maintenance': 'ਰੱਖ-ਰਖਾਅ',
      'mod.pti': 'PTI', 'mod.damage': 'ਨੁਕਸਾਨ ਅਤੇ ਘਟਨਾ', 'mod.manifest': 'ਮੈਨੀਫੈਸਟ / ਰੋਜ਼ਾਨਾ ਲੌਗ',
      'mod.invoice': 'ਇਨਵੌਇਸ', 'mod.paystub': 'ਤਨਖਾਹ ਪਰਚੀ', 'mod.connect': 'ਕਨੈਕਟ',
      'prefs.language': 'ਭਾਸ਼ਾ'
    },
    hi: {
      'mod.revenue': 'आय', 'mod.dispatch': 'प्रेषण', 'mod.navigator': 'नेविगेटर',
      'mod.fuel': 'ईंधन और खर्च', 'mod.pnl': 'P&L', 'mod.maintenance': 'रखरखाव',
      'mod.pti': 'PTI', 'mod.damage': 'क्षति और घटना', 'mod.manifest': 'मैनिफ़ेस्ट / दैनिक लॉग',
      'mod.invoice': 'चालान', 'mod.paystub': 'वेतन पर्ची', 'mod.connect': 'कनेक्ट',
      'prefs.language': 'भाषा'
    },
    ar: {
      'mod.revenue': 'الإيرادات', 'mod.dispatch': 'الإرسال', 'mod.navigator': 'الملاح',
      'mod.fuel': 'الوقود والمصروفات', 'mod.pnl': 'P&L', 'mod.maintenance': 'الصيانة',
      'mod.pti': 'PTI', 'mod.damage': 'الضرر والحوادث', 'mod.manifest': 'البيان / السجل اليومي',
      'mod.invoice': 'الفاتورة', 'mod.paystub': 'قسيمة الراتب', 'mod.connect': 'اتصال',
      'prefs.language': 'اللغة'
    },
    ru: {
      'mod.revenue': 'Доход', 'mod.dispatch': 'Диспетчерская', 'mod.navigator': 'Навигатор',
      'mod.fuel': 'Топливо и расходы', 'mod.pnl': 'P&L', 'mod.maintenance': 'Обслуживание',
      'mod.pti': 'PTI', 'mod.damage': 'Повреждения и инциденты', 'mod.manifest': 'Манифест / дневной журнал',
      'mod.invoice': 'Счёт', 'mod.paystub': 'Расчётный лист', 'mod.connect': 'Связь',
      'prefs.language': 'Язык'
    },
    uk: {
      'mod.revenue': 'Дохід', 'mod.dispatch': 'Диспетчерська', 'mod.navigator': 'Навігатор',
      'mod.fuel': 'Паливо та витрати', 'mod.pnl': 'P&L', 'mod.maintenance': 'Обслуговування',
      'mod.pti': 'PTI', 'mod.damage': 'Пошкодження та інциденти', 'mod.manifest': 'Маніфест / денний журнал',
      'mod.invoice': 'Рахунок', 'mod.paystub': 'Розрахунковий лист', 'mod.connect': 'Зв’язок',
      'prefs.language': 'Мова'
    },
    es: {
      'mod.revenue': 'Ingresos', 'mod.dispatch': 'Despacho', 'mod.navigator': 'Navegador',
      'mod.fuel': 'Combustible y gastos', 'mod.pnl': 'P&L', 'mod.maintenance': 'Mantenimiento',
      'mod.pti': 'PTI', 'mod.damage': 'Daños e incidentes', 'mod.manifest': 'Manifiesto / registro diario',
      'mod.invoice': 'Factura', 'mod.paystub': 'Recibo de sueldo', 'mod.connect': 'Conectar',
      'prefs.language': 'Idioma'
    },
    fr: {
      'mod.revenue': 'Revenus', 'mod.dispatch': 'Expédition', 'mod.navigator': 'Navigateur',
      'mod.fuel': 'Carburant et dépenses', 'mod.pnl': 'P&L', 'mod.maintenance': 'Entretien',
      'mod.pti': 'PTI', 'mod.damage': 'Dommages et incidents', 'mod.manifest': 'Manifeste / journal quotidien',
      'mod.invoice': 'Facture', 'mod.paystub': 'Bulletin de paie', 'mod.connect': 'Connexion',
      'prefs.language': 'Langue'
    },
    bs: {
      'mod.revenue': 'Prihodi', 'mod.dispatch': 'Dispečerska', 'mod.navigator': 'Navigator',
      'mod.fuel': 'Gorivo i troškovi', 'mod.pnl': 'P&L', 'mod.maintenance': 'Održavanje',
      'mod.pti': 'PTI', 'mod.damage': 'Šteta i incidenti', 'mod.manifest': 'Manifest / dnevni zapisnik',
      'mod.invoice': 'Faktura', 'mod.paystub': 'Platna lista', 'mod.connect': 'Povezivanje',
      'prefs.language': 'Jezik'
    },
    zh: {
      'mod.revenue': '收入', 'mod.dispatch': '调度', 'mod.navigator': '导航',
      'mod.fuel': '燃油与支出', 'mod.pnl': 'P&L', 'mod.maintenance': '维护',
      'mod.pti': 'PTI', 'mod.damage': '损坏与事故', 'mod.manifest': '清单 / 每日日志',
      'mod.invoice': '发票', 'mod.paystub': '工资单', 'mod.connect': '连接',
      'prefs.language': '语言'
    },
    ja: {
      'mod.revenue': '収入', 'mod.dispatch': '配車', 'mod.navigator': 'ナビ',
      'mod.fuel': '燃料と経費', 'mod.pnl': 'P&L', 'mod.maintenance': 'メンテナンス',
      'mod.pti': 'PTI', 'mod.damage': '損傷と事故', 'mod.manifest': 'マニフェスト / 日次ログ',
      'mod.invoice': '請求書', 'mod.paystub': '給与明細', 'mod.connect': '接続',
      'prefs.language': '言語'
    }
  };

  function langMeta(code) {
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i];
    return LANGS[0];
  }
  function storeGet() {
    try { if (window.App && App._store) { var v = App._store.get('app_lang', 'en'); if (v && PACKS[v]) return v; } } catch (e) {}
    return 'en';
  }
  function storeSet(code) {
    try { if (window.App && App._store) App._store.set('app_lang', code); } catch (e) {}
  }
  var current = storeGet();

  var I18n = {
    langs: function () { return LANGS.slice(); },
    lang: function () { return current; },
    dir: function (code) { return langMeta(code || current).dir; },
    pack: function (code) { return PACKS[code || current] || {}; },
    /* t(key, fallback): chosen pack → English pack → the
     * caller's fallback → the key itself. Never blank. */
    t: function (key, fallback) {
      var p = PACKS[current];
      if (p && p[key]) return p[key];
      if (PACKS.en[key]) return PACKS.en[key];
      return (fallback !== undefined && fallback !== null) ? fallback : key;
    },
    setLang: function (code) {
      if (!PACKS[code]) code = 'en';
      current = code;
      storeSet(code);
      I18n.applyDir();
      return current;
    },
    applyDir: function () {
      try {
        if (typeof document !== 'undefined' && document.documentElement) {
          document.documentElement.setAttribute('dir', I18n.dir());
          document.documentElement.setAttribute('lang', current === 'pa-sh' || current === 'pa-gur' ? 'pa' : current);
        }
      } catch (e) {}
    }
  };

  Meticulous.i18n = I18n;
  I18n.applyDir();
})();
