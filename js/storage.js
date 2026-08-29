(() => {
const APP_VERSION = '3.1.0';
const STATE_KEY = 'desafiosDoAmorState';
const DB_NAME = 'DesafiosDoAmorDB';
const DB_VERSION = 2;
const STORE = 'state';

const todayKey = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const createDefaultState = () => ({
    schemaVersion: 2,
    appVersion: APP_VERSION,
    profile: {
        person1: '',
        person2: '',
        gender: 'other',
        ageConfirmed: false,
        consentAccepted: false,
        intimacyEnabled: false,
        intensity: 'moderada',
        onboardingComplete: false
    },
    daily: { dateKey: '', challenges: {}, status: {} },
    recent: { carinho: [], amor: [], sexo: [] },
    completions: [],
    markedDates: [],
    favorites: [],
    customChallenges: [],
    settings: {
        darkMode: false,
        notificationsEnabled: false,
        notificationTime: '20:00',
        weeklyGoal: 5,
        lastReminderDate: '',
        lastBackupAt: ''
    },
    lastUndo: null,
    updatedAt: new Date().toISOString()
});

function parseJSON(value, fallback = null) {
    if (!value) return fallback;
    try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeDateKey(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return '';
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function validTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')) ? value : '20:00';
}

function cleanText(value, max = 180) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeCompletion(item, index) {
    if (!item || typeof item !== 'object') return null;
    const category = ['carinho', 'amor', 'sexo'].includes(item.category) ? item.category : 'carinho';
    const parsedDate = new Date(item.completedAt || item.date || Date.now());
    const completedAt = Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
    const localDate = new Date(completedAt);
    const fallbackKey = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${String(localDate.getDate()).padStart(2, '0')}`;
    return {
        id: cleanText(item.id, 90) || `legacy-${completedAt}-${index}`,
        dateKey: normalizeDateKey(item.dateKey) || fallbackKey,
        completedAt,
        category,
        text: cleanText(item.text, 400) || 'Desafio concluído',
        source: ['daily', 'extra', 'custom'].includes(item.source) ? item.source : 'daily'
    };
}

function normalizeState(raw) {
    const base = createDefaultState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    const profile = raw.profile && typeof raw.profile === 'object' ? raw.profile : {};
    const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    const daily = raw.daily && typeof raw.daily === 'object' ? raw.daily : {};
    const challenges = daily.challenges && typeof daily.challenges === 'object' ? daily.challenges : {};
    const status = daily.status && typeof daily.status === 'object' ? daily.status : {};

    base.profile = {
        person1: cleanText(profile.person1, 40),
        person2: cleanText(profile.person2, 40),
        gender: ['male', 'female', 'other'].includes(profile.gender) ? profile.gender : 'other',
        ageConfirmed: profile.ageConfirmed === true,
        consentAccepted: profile.consentAccepted === true,
        intimacyEnabled: profile.intimacyEnabled === true,
        intensity: ['leve', 'moderada', 'intensa'].includes(profile.intensity) ? profile.intensity : 'moderada',
        onboardingComplete: profile.onboardingComplete === true
    };
    if (!base.profile.ageConfirmed || !base.profile.consentAccepted) base.profile.intimacyEnabled = false;

    base.daily = {
        dateKey: normalizeDateKey(daily.dateKey),
        challenges: Object.fromEntries(Object.entries(challenges)
            .filter(([key, value]) => ['carinho', 'amor', 'sexo'].includes(key) && typeof value === 'string')
            .map(([key, value]) => [key, cleanText(value, 400)])),
        status: Object.fromEntries(Object.entries(status)
            .filter(([key, value]) => ['carinho', 'amor', 'sexo'].includes(key) && ['pending', 'completed'].includes(value)))
    };
    base.recent = Object.fromEntries(['carinho', 'amor', 'sexo'].map(category => [category,
        Array.isArray(raw.recent?.[category]) ? raw.recent[category].filter(value => typeof value === 'string').slice(-7) : []
    ]));
    base.completions = Array.isArray(raw.completions)
        ? raw.completions.map(normalizeCompletion).filter(Boolean).slice(-5000)
        : [];
    base.markedDates = [...new Set((Array.isArray(raw.markedDates) ? raw.markedDates : []).map(normalizeDateKey).filter(Boolean))].sort();
    base.favorites = [...new Set((Array.isArray(raw.favorites) ? raw.favorites : []).filter(value => typeof value === 'string').map(value => cleanText(value, 400)).filter(Boolean))].slice(-500);
    base.customChallenges = (Array.isArray(raw.customChallenges) ? raw.customChallenges : []).map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const text = cleanText(item.text, 240);
        if (!text) return null;
        return {
            id: cleanText(item.id, 90) || `custom-${Date.now()}-${index}`,
            category: ['carinho', 'amor', 'sexo'].includes(item.category) ? item.category : 'carinho',
            text,
            createdAt: cleanText(item.createdAt, 40) || new Date().toISOString()
        };
    }).filter(Boolean).slice(-300);
    base.settings = {
        darkMode: settings.darkMode === true,
        notificationsEnabled: settings.notificationsEnabled === true,
        notificationTime: validTime(settings.notificationTime),
        weeklyGoal: Math.min(21, Math.max(1, Number.parseInt(settings.weeklyGoal, 10) || 5)),
        lastReminderDate: normalizeDateKey(settings.lastReminderDate),
        lastBackupAt: cleanText(settings.lastBackupAt, 40)
    };
    base.lastUndo = raw.lastUndo && typeof raw.lastUndo === 'object' ? raw.lastUndo : null;
    base.updatedAt = cleanText(raw.updatedAt, 40) || new Date().toISOString();
    base.appVersion = APP_VERSION;
    base.schemaVersion = 2;
    return base;
}

function migrateLegacy() {
    const state = createDefaultState();
    const gender = localStorage.getItem('userGender');
    const markedDates = parseJSON(localStorage.getItem('markedDates'), []);
    const completed = parseJSON(localStorage.getItem('completedChallenges'), []);
    const oldDaily = parseJSON(localStorage.getItem('currentDailyChallenge'), {});
    const oldStatus = parseJSON(localStorage.getItem('challengeStatus'), {});
    const oldDate = localStorage.getItem('lastChallengeDate');

    if (['male', 'female', 'other'].includes(gender)) {
        state.profile.gender = gender;
        state.profile.onboardingComplete = true;
    }
    state.profile.person1 = 'Você';
    state.profile.person2 = 'Seu amor';
    state.profile.intimacyEnabled = false;
    state.settings.darkMode = localStorage.getItem('darkMode') === 'true';
    state.settings.notificationsEnabled = localStorage.getItem('notificationEnabled') === 'true';
    state.settings.notificationTime = validTime(localStorage.getItem('notificationTime'));
    state.markedDates = Array.isArray(markedDates) ? markedDates.map(normalizeDateKey).filter(Boolean) : [];
    state.completions = Array.isArray(completed) ? completed.map(normalizeCompletion).filter(Boolean) : [];
    const oldDateParsed = oldDate ? new Date(oldDate) : null;
    if (oldDateParsed && !Number.isNaN(oldDateParsed.getTime())) {
        state.daily.dateKey = `${oldDateParsed.getFullYear()}-${String(oldDateParsed.getMonth() + 1).padStart(2, '0')}-${String(oldDateParsed.getDate()).padStart(2, '0')}`;
    }
    if (oldDaily && typeof oldDaily === 'object') state.daily.challenges = oldDaily;
    if (oldStatus && typeof oldStatus === 'object') {
        state.daily.status = Object.fromEntries(['carinho', 'amor', 'sexo'].map(category => [category, oldStatus[category] === 'completed' ? 'completed' : 'pending']));
    }
    return normalizeState(state);
}

function openDB() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB indisponível'));
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function idbGet() {
    try {
        const db = await openDB();
        const value = await new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE, 'readonly');
            const request = transaction.objectStore(STORE).get('latest');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        db.close();
        return value;
    } catch { return null; }
}

async function idbSet(state) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE, 'readwrite');
            transaction.objectStore(STORE).put(state, 'latest');
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
        });
        db.close();
    } catch (error) {
        console.warn('Não foi possível atualizar a cópia no IndexedDB.', error);
    }
}

async function loadState() {
    const local = parseJSON(localStorage.getItem(STATE_KEY));
    const indexed = await idbGet();
    let selected;
    if (local && indexed) {
        selected = String(indexed.updatedAt || '') > String(local.updatedAt || '') ? indexed : local;
    } else {
        selected = local || indexed || migrateLegacy();
    }
    const state = normalizeState(selected);
    await saveState(state);
    return state;
}

async function saveState(state) {
    const normalized = normalizeState(state);
    normalized.updatedAt = new Date().toISOString();
    state.updatedAt = normalized.updatedAt;
    state.appVersion = APP_VERSION;
    state.schemaVersion = 2;
    localStorage.setItem(STATE_KEY, JSON.stringify(normalized));
    await idbSet(normalized);
    return normalized;
}

function serializeBackup(state) {
    return JSON.stringify({
        format: 'desafios-do-amor-backup',
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        state: normalizeState(state)
    }, null, 2);
}

function parseBackup(text) {
    const data = JSON.parse(text);
    if (!data || data.format !== 'desafios-do-amor-backup' || !data.state || typeof data.state !== 'object') {
        throw new Error('Formato de backup inválido');
    }
    const normalized = normalizeState(data.state);
    if (!Array.isArray(normalized.completions) || !Array.isArray(normalized.markedDates)) throw new Error('Dados obrigatórios ausentes');
    return normalized;
}

window.LoveStorage = { APP_VERSION, STATE_KEY, createDefaultState, todayKey, normalizeState, loadState, saveState, serializeBackup, parseBackup };
})();
