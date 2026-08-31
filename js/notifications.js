(() => {
const { todayKey } = window.LoveStorage;

const categoryLabels = { carinho: 'carinho', amor: 'amor', sexo: 'intimidade' };
let reminderTimer = null;

function notificationCapability() {
    if (!('Notification' in window)) return { supported: false, permission: 'unsupported' };
    return { supported: true, permission: Notification.permission };
}

function weeklyProgress(state) {
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(now.getDate() - day + 1);
    return state.completions.filter(item => new Date(item.completedAt) >= monday).length;
}

function buildSmartReminder(state) {
    const today = todayKey();
    const pending = Object.entries(state.daily.status || {})
        .filter(([, status]) => status !== 'completed')
        .map(([category]) => categoryLabels[category]);
    const names = [state.profile.person1, state.profile.person2].filter(Boolean).join(' e ');
    const prefix = names ? `${names}, ` : '';
    if (state.daily.dateKey !== today || !Object.keys(state.daily.challenges || {}).length) {
        return `${prefix}os desafios de hoje já estão esperando por vocês 💕`;
    }
    if (pending.length) {
        return `${prefix}ainda falta ${pending.join(', ')} no desafio de hoje.`;
    }
    if (!state.checkIns?.some(item => item.dateKey === today)) {
        return `${prefix}vocês concluíram os desafios. Que tal registrar como estão se sentindo hoje?`;
    }
    const progress = weeklyProgress(state);
    const goal = state.settings.weeklyGoal;
    if (progress < goal) return `${prefix}vocês completaram o dia! Faltam ${goal - progress} desafios para a meta semanal.`;
    return `${prefix}meta semanal alcançada! Que tal escolher um favorito para celebrar?`;
}

async function requestNotificationPermission() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    return Notification.requestPermission();
}

async function showReminder(state, test = false) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    const options = {
        body: test ? `Teste: ${buildSmartReminder(state)}` : buildSmartReminder(state),
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        tag: 'daily-love-reminder',
        renotify: false,
        data: { url: './#today' }
    };
    try {
        const registration = await navigator.serviceWorker?.ready;
        if (registration) await registration.showNotification('Desafios do Amor', options);
        else new Notification('Desafios do Amor', options);
        return true;
    } catch {
        try { new Notification('Desafios do Amor', options); return true; } catch { return false; }
    }
}

function startNotificationSystem({ getState, save, onStatus }) {
    const check = async () => {
        const state = getState();
        if (!state?.settings.notificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
        const [hour, minute] = state.settings.notificationTime.split(':').map(Number);
        const now = new Date();
        const due = now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute);
        const key = todayKey();
        if (!due || state.settings.lastReminderDate === key) return;
        const sent = await showReminder(state);
        if (sent) {
            state.settings.lastReminderDate = key;
            await save(state);
            onStatus?.('Lembrete inteligente enviado.');
        }
    };
    clearInterval(reminderTimer);
    reminderTimer = setInterval(check, 60_000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    check();
    return check;
}

window.LoveNotifications = { notificationCapability, buildSmartReminder, requestNotificationPermission, showReminder, startNotificationSystem };
})();
