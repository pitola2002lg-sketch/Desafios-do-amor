(() => {
const { getAvailableCategories, getChallengePool, getIntensity } = window.LoveChallenges;
const { APP_VERSION, loadState, parseBackup, saveState, serializeBackup, todayKey } = window.LoveStorage;
const { notificationCapability, requestNotificationPermission, showReminder, startNotificationSystem } = window.LoveNotifications;
const { $, $$, categoryMeta, escapeHTML, showScreen, toast } = window.LoveUI;

let state;
let currentCalendar = new Date();
let currentCatalogRecords = [];
let currentHistoryRecords = [];
let catalogLimit = 36;
let historyLimit = 50;
const hiddenContentMessage = 'Conteúdo reservado. Toque em Revelar para visualizar.';
function isPrivateCategory(category) {
    return category === 'sexo' && (state.settings.discreetMode || !categoriesForProfile().includes('sexo'));
}
function privateText(text, hidden) { return hidden ? hiddenContentMessage : escapeHTML(text); }
function canShare(category, revealed) {
    if (!isPrivateCategory(category) || revealed) return true;
    toast('Revele o desafio antes de compartilhá-lo.');
    return false;
}
let deferredInstallPrompt = null;
let waitingWorker = null;
let saveQueue = Promise.resolve();
let selectedMood = 0;
let currentSurprise = null;

const screenHashes = {
    homeScreen: 'home', todayScreen: 'today', libraryScreen: 'explore', calendarScreen: 'calendar',
    statsScreen: 'stats', historyScreen: 'history', settingsScreen: 'settings'
};
const hashScreens = Object.fromEntries(Object.entries(screenHashes).map(([screen, hash]) => [hash, screen]));

function persist() {
    // Captura um snapshot agora; saves assíncronos não podem substituir mudanças mais recentes.
    const snapshot = JSON.parse(JSON.stringify(state));
    saveQueue = saveQueue.catch(() => {}).then(() => saveState(snapshot));
    return saveQueue.catch(error => {
        console.error('Falha ao salvar estado', error);
        toast('Não foi possível salvar os dados. Verifique o armazenamento do navegador.');
    });
}

function dateKeyFromDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function randomId(prefix) {
    return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function categoriesForProfile() {
    return getAvailableCategories(state.profile);
}

function pickChallenge(category) {
    const pool = getChallengePool(category, state.profile);
    if (!pool.length) return '';
    const recent = state.recent[category] || [];
    const available = pool.filter(item => !recent.includes(item));
    const source = available.length ? available : pool;
    const selected = source[Math.floor(Math.random() * source.length)];
    state.recent[category] = [...recent, selected].slice(-7);
    return selected;
}

function dailyIsValid() {
    const categories = categoriesForProfile();
    return state.daily.dateKey === todayKey()
        && categories.every(category => typeof state.daily.challenges[category] === 'string' && state.daily.challenges[category])
        && Object.keys(state.daily.challenges).every(category => categories.includes(category))
        && categories.every(category => getChallengePool(category, state.profile).includes(state.daily.challenges[category]))
        && categories.every(category => ['pending', 'completed'].includes(state.daily.status[category]));
}

function ensureDaily(force = false) {
    if (!force && dailyIsValid()) return;
    const categories = categoriesForProfile();
    const previous = state.daily;
    const sameDay = previous.dateKey === todayKey();
    state.daily = { dateKey: todayKey(), challenges: {}, status: {} };
    categories.forEach(category => {
        const previousText = previous.challenges?.[category];
        const permitted = sameDay && previousText && getChallengePool(category, state.profile).includes(previousText);
        state.daily.challenges[category] = permitted ? previousText : pickChallenge(category);
        state.daily.status[category] = permitted && previous.status?.[category] === 'completed' ? 'completed' : 'pending';
    });
    persist();
}

function completedToday() {
    return Object.values(state.daily.status).filter(status => status === 'completed').length;
}

function weeklyCompletions() {
    const now = new Date();
    const weekday = now.getDay() || 7;
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(now.getDate() - weekday + 1);
    return state.completions.filter(item => new Date(item.completedAt) >= monday).length;
}

function updateHeader() {
    const names = [state.profile.person1, state.profile.person2].filter(Boolean);
    $('#coupleGreeting').textContent = names.length ? `${names.join(' & ')} — um momento de cada vez.` : 'Um pequeno gesto pode mudar o dia.';
    document.body.classList.toggle('dark-mode', state.settings.darkMode);
    document.body.classList.toggle('discreet-mode', state.settings.discreetMode);
    $('#themeButton').textContent = state.settings.darkMode ? '☀️' : '🌙';
    $('#themeButton').setAttribute('aria-label', state.settings.darkMode ? 'Ativar modo claro' : 'Ativar modo escuro');
    document.querySelector('meta[name="theme-color"]').content = state.settings.darkMode ? '#241c29' : '#7b1fa2';
}

function renderHome() {
    ensureDaily();
    const total = Object.keys(state.daily.challenges).length;
    const completed = completedToday();
    const percent = total ? Math.round((completed / total) * 100) : 0;
    $('#dailyProgressValue').textContent = `${completed}/${total}`;
    $('#dailyProgressRing').style.setProperty('--progress', `${percent * 3.6}deg`);
    $('#homeSummary').textContent = completed === total ? 'Vocês concluíram todos os desafios de hoje! 🎉' : `${total - completed} desafio${total - completed === 1 ? '' : 's'} esperando por vocês.`;
    const weekly = weeklyCompletions();
    const goal = state.settings.weeklyGoal;
    $('#weeklyGoalText').textContent = `${weekly} de ${goal} desafios`;
    $('#weeklyGoalBar').style.width = `${Math.min(100, Math.round((weekly / goal) * 100))}%`;
    renderRelationshipDays();
    const checkIn = state.checkIns.find(item => item.dateKey === todayKey());
    selectedMood = checkIn?.mood || 0;
    $$('#moodButtons button').forEach(button => {
        const selected = Number(button.dataset.mood) === selectedMood;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-checked', String(selected));
        button.tabIndex = selected ? 0 : -1;
    });
    if (!selectedMood) $('#moodButtons button[data-mood="3"]').tabIndex = 0;
    $('#checkInNote').value = checkIn?.note || '';
    updateAppBadge();
}

function renderRelationshipDays() {
    const value = state.profile.anniversary;
    if (!value) {
        $('#relationshipDays').textContent = 'Nossa história';
        $('#relationshipSince').textContent = 'Adicione a data do relacionamento nos ajustes.';
        return;
    }
    const start = new Date(`${value}T12:00:00`);
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const days = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
        - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86_400_000);
    if (Number.isNaN(days) || days < 0) {
        $('#relationshipDays').textContent = 'Uma história prestes a começar';
        $('#relationshipSince').textContent = 'A data escolhida ainda vai chegar.';
        return;
    }
    $('#relationshipDays').textContent = `${days.toLocaleString('pt-BR')} dias juntos`;
    $('#relationshipSince').textContent = `Desde ${start.toLocaleDateString('pt-BR')}`;
}

function renderToday() {
    ensureDaily();
    $('#todayDate').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    const list = $('#dailyChallengeList');
    list.innerHTML = categoriesForProfile().map(category => {
        const meta = categoryMeta(category);
        const completed = state.daily.status[category] === 'completed';
        const sensitive = isPrivateCategory(category);
        return `<article class="daily-card ${category} ${completed ? 'completed' : ''}">
            <span class="eyebrow">${meta.icon} ${meta.label.toUpperCase()}</span>
            <h3>${completed ? 'Concluído' : 'Desafio de hoje'}</h3>
            <p class="${sensitive ? 'private-placeholder' : ''}">${privateText(state.daily.challenges[category], sensitive)}</p>
            <div class="card-actions">
                <button class="primary-card-action" type="button" data-daily-action="complete" data-category="${category}" ${completed ? 'disabled' : ''}>${completed ? '✓ Feito' : 'Marcar como feito'}</button>
                <button type="button" data-daily-action="replace" data-category="${category}" ${completed ? 'disabled' : ''}>Trocar</button>
                <button type="button" data-daily-action="share" data-category="${category}">Compartilhar</button>
                ${sensitive ? `<button type="button" data-daily-action="reveal" data-category="${category}" aria-pressed="false">Revelar</button>` : ''}
            </div>
        </article>`;
    }).join('');
    $('#dailyCompleteMessage').hidden = completedToday() !== Object.keys(state.daily.challenges).length;
}

async function completeChallenge(category, text, source = 'daily') {
    const key = todayKey();
    const duplicate = state.completions.some(item => item.dateKey === key && item.text === text);
    if (duplicate) {
        if (source === 'daily') {
            state.daily.status[category] = 'completed';
            const dailyComplete = Object.values(state.daily.status).every(value => value === 'completed');
            if (dailyComplete && !state.markedDates.includes(key)) state.markedDates.push(key);
            await persist(); renderAllCurrentViews(); toast('Este desafio já estava registrado hoje.');
        } else toast('Este desafio já foi registrado hoje.');
        return;
    }
    const completion = { id: randomId('done'), dateKey: key, completedAt: new Date().toISOString(), category, text, source };
    state.completions.push(completion);
    let addedMarkedDate = false;
    if (source === 'daily') state.daily.status[category] = 'completed';
    const dailyComplete = Object.keys(state.daily.status).length && Object.values(state.daily.status).every(value => value === 'completed');
    if (dailyComplete && !state.markedDates.includes(key)) {
        state.markedDates.push(key);
        state.markedDates.sort();
        addedMarkedDate = true;
    }
    state.lastUndo = { completion, dailyCategory: source === 'daily' ? category : null, addedMarkedDate };
    await persist();
    renderAllCurrentViews();
    toast('🎉 Desafio concluído!', { label: 'Desfazer', run: undoLastCompletion });
}

async function undoLastCompletion() {
    const undo = state.lastUndo;
    if (!undo?.completion?.id) return;
    state.completions = state.completions.filter(item => item.id !== undo.completion.id);
    if (undo.dailyCategory && state.daily.dateKey === undo.completion.dateKey) state.daily.status[undo.dailyCategory] = 'pending';
    if (undo.addedMarkedDate) state.markedDates = state.markedDates.filter(key => key !== undo.completion.dateKey);
    state.lastUndo = null;
    await persist();
    renderAllCurrentViews();
    toast('Conclusão desfeita.');
}

function libraryRecords() {
    const records = [];
    categoriesForProfile().forEach(category => getChallengePool(category, state.profile).forEach(text => records.push({ category, text, source: 'extra' })));
    state.customChallenges.filter(item => item.category !== 'sexo' || categoriesForProfile().includes('sexo'))
        .forEach(item => records.push({ ...item, source: 'custom' }));
    return records;
}

function renderLibrary() {
    const query = $('#challengeSearch').value.trim().toLocaleLowerCase('pt-BR');
    const filter = $('#libraryCategory').value;
    currentCatalogRecords = libraryRecords().filter(item => {
        const favorite = state.favorites.includes(item.text);
        const categoryMatch = filter === 'all' || filter === item.category || (filter === 'custom' && item.source === 'custom') || (filter === 'favorites' && favorite);
        return categoryMatch && item.text.toLocaleLowerCase('pt-BR').includes(query);
    });
    const catalog = $('#challengeCatalog');
    $('#catalogResultCount').textContent = `${currentCatalogRecords.length} desafio${currentCatalogRecords.length === 1 ? '' : 's'} encontrado${currentCatalogRecords.length === 1 ? '' : 's'}`;
    if (!currentCatalogRecords.length) {
        catalog.innerHTML = '<div class="empty-state">Nenhum desafio encontrado com este filtro.</div>';
        $('#showMoreChallenges').hidden = true;
        return;
    }
    catalog.innerHTML = currentCatalogRecords.slice(0, catalogLimit).map((item, index) => {
        const meta = categoryMeta(item.category);
        const favorite = state.favorites.includes(item.text);
        const sensitive = isPrivateCategory(item.category);
        return `<article class="catalog-item"><span class="catalog-icon" aria-hidden="true">${meta.icon}</span><div class="catalog-copy"><p class="${sensitive ? 'private-placeholder' : ''}">${privateText(item.text, sensitive)}</p><small>${meta.label}${item.source === 'custom' ? ' • Personalizado' : ` • ${getIntensity(item.text)}`}</small></div><div class="item-actions">${sensitive ? `<button type="button" data-catalog-action="reveal" data-index="${index}" aria-pressed="false" aria-label="Revelar texto">👁</button>` : ''}<button type="button" data-catalog-action="favorite" data-index="${index}" aria-label="${favorite ? 'Remover dos' : 'Adicionar aos'} favoritos">${favorite ? '★' : '☆'}</button><button type="button" data-catalog-action="complete" data-index="${index}" aria-label="Marcar como concluído">✓</button><button type="button" data-catalog-action="share" data-index="${index}" aria-label="Compartilhar">↗</button>${item.source === 'custom' ? `<button type="button" data-catalog-action="delete" data-index="${index}" aria-label="Excluir desafio">🗑</button>` : ''}</div></article>`;
    }).join('');
    $('#showMoreChallenges').hidden = currentCatalogRecords.length <= catalogLimit;
}

async function toggleFavorite(text) {
    state.favorites = state.favorites.includes(text) ? state.favorites.filter(item => item !== text) : [...state.favorites, text];
    await persist();
    renderLibrary();
    toast(state.favorites.includes(text) ? 'Adicionado aos favoritos.' : 'Removido dos favoritos.');
}

async function shareChallenge(text) {
    const shareText = `Nosso desafio: ${text} 💕`;
    try {
        if (navigator.share) await navigator.share({ title: 'Desafios do Amor', text: shareText });
        else { await navigator.clipboard.writeText(shareText); toast('Desafio copiado para compartilhar.'); }
    } catch (error) {
        if (error.name !== 'AbortError') toast('Não foi possível compartilhar agora.');
    }
}

function renderCalendar() {
    const year = currentCalendar.getFullYear();
    const month = currentCalendar.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    $('#calendarMonth').textContent = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(currentCalendar);
    let html = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => `<span class="calendar-label">${day}</span>`).join('');
    html += '<span class="calendar-day empty"></span>'.repeat(firstWeekday);
    for (let day = 1; day <= days; day += 1) {
        const date = new Date(year, month, day);
        const key = dateKeyFromDate(date);
        const marked = state.markedDates.includes(key);
        html += `<button class="calendar-day ${marked ? 'marked' : ''} ${key === todayKey() ? 'today' : ''}" type="button" data-calendar-date="${key}" aria-pressed="${marked}">${day}</button>`;
    }
    $('#calendar').innerHTML = html;
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const count = state.markedDates.filter(key => key.startsWith(monthPrefix)).length;
    $('#calendarSummary').textContent = count === 1 ? '1 dia especial neste mês.' : `${count} dias especiais neste mês.`;
}

function completionDayKeys() {
    return [...new Set(state.completions.map(item => item.dateKey))].sort();
}

function streaks() {
    const keys = completionDayKeys();
    if (!keys.length) return { current: 0, best: 0 };
    const numbers = keys.map(key => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); });
    let best = 1, run = 1;
    for (let index = 1; index < numbers.length; index += 1) {
        run = Math.round((numbers[index] - numbers[index - 1]) / 86_400_000) === 1 ? run + 1 : 1;
        best = Math.max(best, run);
    }
    const set = new Set(keys);
    const cursor = new Date(); cursor.setHours(12, 0, 0, 0);
    if (!set.has(dateKeyFromDate(cursor))) cursor.setDate(cursor.getDate() - 1);
    let current = 0;
    while (set.has(dateKeyFromDate(cursor))) { current += 1; cursor.setDate(cursor.getDate() - 1); }
    return { current, best };
}

function achievement(total) {
    if (total >= 100) return ['👑', 'Amor lendário', 'Vocês ultrapassaram 100 desafios.'];
    if (total >= 50) return ['💎', 'Parceria de ouro', `${100 - total} para o próximo nível.`];
    if (total >= 25) return ['❤️', 'Apaixonados', `${50 - total} para o próximo nível.`];
    if (total >= 10) return ['🔥', 'Conexão crescente', `${25 - total} para o próximo nível.`];
    if (total >= 5) return ['💕', 'Primeiros passos', `${10 - total} para o próximo nível.`];
    return ['🌱', 'Começando juntos', `${5 - total} para a primeira conquista.`];
}

function renderStats() {
    const total = state.completions.length;
    const streak = streaks();
    const [emoji, name, hint] = achievement(total);
    $('#achievementEmoji').textContent = emoji; $('#achievementName').textContent = name; $('#achievementHint').textContent = hint;
    $('#totalChallenges').textContent = total; $('#currentStreak').textContent = streak.current; $('#bestStreak').textContent = streak.best; $('#specialDays').textContent = state.markedDates.length;
    const counts = Object.fromEntries(['carinho', 'amor', 'sexo'].map(category => [category, state.completions.filter(item => item.category === category).length]));
    const max = Math.max(1, ...Object.values(counts));
    $('#categoryStats').innerHTML = Object.entries(counts).map(([category, count]) => { const meta = categoryMeta(category); return `<div class="category-stat-row"><span>${meta.icon} ${meta.label}</span><progress max="${max}" value="${count}" aria-label="${meta.label}: ${count}"></progress><strong>${count}</strong></div>`; }).join('');
    $('#weeklyGoalInput').value = state.settings.weeklyGoal;
    const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - 29);
    const newest = todayKey();
    const oldest = dateKeyFromDate(cutoff);
    const recentCompletionKeys = state.completions.filter(item => item.dateKey >= oldest && item.dateKey <= newest).map(item => item.dateKey);
    const recentCheckIns = state.checkIns.filter(item => item.dateKey >= oldest && item.dateKey <= newest);
    $('#activeDays30').textContent = new Set([...recentCompletionKeys, ...recentCheckIns.map(item => item.dateKey)]).size;
    if (recentCheckIns.length) {
        const average = recentCheckIns.reduce((sum, item) => sum + item.mood, 0) / recentCheckIns.length;
        const emoji = ['😔', '😕', '😐', '🙂', '😍'][Math.max(0, Math.min(4, Math.round(average) - 1))];
        $('#averageMood').textContent = `${average.toFixed(1)} ${emoji}`;
    } else $('#averageMood').textContent = '—';
}

function renderHistory() {
    const filter = $('#historyFilter').value;
    currentHistoryRecords = [...state.completions].reverse().filter(item => filter === 'all' || item.category === filter);
    $('#historyResultCount').textContent = `${currentHistoryRecords.length} registro${currentHistoryRecords.length === 1 ? '' : 's'}`;
    $('#showMoreHistory').hidden = currentHistoryRecords.length <= historyLimit;
    $('#historyList').innerHTML = currentHistoryRecords.length ? currentHistoryRecords.slice(0, historyLimit).map((item, index) => {
        const meta = categoryMeta(item.category); const date = new Date(item.completedAt);
        const sensitive = isPrivateCategory(item.category);
        return `<article class="history-item"><span class="catalog-icon">${meta.icon}</span><div><p class="${sensitive ? 'private-placeholder' : ''}">${privateText(item.text, sensitive)}</p><small>${date.toLocaleDateString('pt-BR')} às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • ${meta.label}</small>${sensitive ? `<button type="button" class="history-reveal" data-history-index="${index}" aria-pressed="false">Revelar</button>` : ''}</div></article>`;
    }).join('') : '<div class="empty-state">O histórico ainda está vazio. Concluam o primeiro desafio juntos.</div>';
}

function renderSettings() {
    const profile = state.profile;
    $('#appVersionLabel').textContent = APP_VERSION;
    $('#profilePerson1').value = profile.person1; $('#profilePerson2').value = profile.person2; $('#profileAnniversary').value = profile.anniversary || ''; $('#profileAnniversary').max = todayKey(); $('#profileGender').value = profile.gender; $('#profileIntimacy').checked = profile.intimacyEnabled; $('#profileIntensity').value = profile.intensity; $('#profileAge').checked = profile.ageConfirmed; $('#profileConsent').checked = profile.consentAccepted;
    $('#profileAdultOptions').hidden = !profile.intimacyEnabled;
    $('#notificationEnabled').checked = state.settings.notificationsEnabled;
    $('#notificationTime').value = state.settings.notificationTime;
    $('#discreetMode').checked = state.settings.discreetMode;
    const capability = notificationCapability();
    $('#notificationStatus').textContent = !capability.supported ? 'Não suportado neste navegador.' : `Permissão: ${capability.permission}.`;
    $('#backupStatus').textContent = state.settings.lastBackupAt ? `Último backup: ${new Date(state.settings.lastBackupAt).toLocaleString('pt-BR')}` : 'Nenhum backup exportado nesta versão.';
    updateConnectionStatus();
}

function renderAllCurrentViews() {
    updateHeader(); renderHome(); renderToday(); renderLibrary(); renderCalendar(); renderStats(); renderHistory(); renderSettings();
}

function navigate(screenId, updateHash = true) {
    if (!state.profile.onboardingComplete) screenId = 'onboardingScreen';
    if (!document.getElementById(screenId)) screenId = 'homeScreen';
    if (screenId === 'homeScreen') renderHome();
    if (screenId === 'todayScreen') renderToday();
    if (screenId === 'libraryScreen') renderLibrary();
    if (screenId === 'calendarScreen') renderCalendar();
    if (screenId === 'statsScreen') renderStats();
    if (screenId === 'historyScreen') renderHistory();
    if (screenId === 'settingsScreen') renderSettings();
    showScreen(screenId);
    $('#bottomNav').hidden = screenId === 'onboardingScreen';
    $$('#bottomNav button').forEach(button => button.classList.toggle('active', button.dataset.screen === screenId));
    if (updateHash && screenHashes[screenId]) history.replaceState(null, '', `#${screenHashes[screenId]}`);
}

function updateConnectionStatus() {
    const element = $('#connectionStatus');
    if (element) element.textContent = navigator.onLine ? 'Online — você pode verificar atualizações.' : 'Offline — o conteúdo salvo continua funcionando.';
}

async function handleOnboarding(event) {
    event.preventDefault();
    const intimacyEnabled = $('#onboardingIntimacy').checked;
    const ageConfirmed = $('#onboardingAge').checked;
    const consentAccepted = $('#onboardingConsent').checked;
    if (!consentAccepted || (intimacyEnabled && !ageConfirmed)) {
        $('#onboardingError').textContent = intimacyEnabled && !ageConfirmed ? 'Confirme a maioridade para ativar desafios de intimidade.' : 'É necessário aceitar o acordo de respeito e consentimento.';
        return;
    }
    state.profile = { person1: $('#onboardingPerson1').value.trim(), person2: $('#onboardingPerson2').value.trim(), anniversary: '', gender: $('#onboardingGender').value, ageConfirmed, consentAccepted, intimacyEnabled, intensity: $('#onboardingIntensity').value, onboardingComplete: true };
    ensureDaily(true); await persist(); renderAllCurrentViews(); navigate('homeScreen'); toast('Perfil criado. Bem-vindos! 💕');
}

async function handleProfile(event) {
    event.preventDefault();
    const intimacyEnabled = $('#profileIntimacy').checked;
    const ageConfirmed = $('#profileAge').checked;
    const consentAccepted = $('#profileConsent').checked;
    if (!consentAccepted || (intimacyEnabled && !ageConfirmed)) {
        $('#profileError').textContent = intimacyEnabled && !ageConfirmed ? 'Confirme a maioridade para ativar intimidade.' : 'Confirme o acordo de consentimento.';
        return;
    }
    const previousSignature = `${state.profile.gender}-${state.profile.intimacyEnabled}-${state.profile.ageConfirmed}-${state.profile.consentAccepted}-${state.profile.intensity}`;
    state.profile = { ...state.profile, person1: $('#profilePerson1').value.trim(), person2: $('#profilePerson2').value.trim(), anniversary: $('#profileAnniversary').value, gender: $('#profileGender').value, ageConfirmed, consentAccepted, intimacyEnabled, intensity: $('#profileIntensity').value, onboardingComplete: true };
    const nextSignature = `${state.profile.gender}-${state.profile.intimacyEnabled}-${state.profile.ageConfirmed}-${state.profile.consentAccepted}-${state.profile.intensity}`;
    if (previousSignature !== nextSignature) ensureDaily(true);
    await persist(); renderAllCurrentViews(); $('#profileError').textContent = ''; toast('Perfil atualizado.');
}

async function exportBackup() {
    state.settings.lastBackupAt = new Date().toISOString(); await persist();
    const blob = new Blob([serializeBackup(state)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
    link.download = `desafios-do-amor-backup-${todayKey()}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    renderSettings(); toast('Arquivo de backup preparado. Guarde-o em local privado.');
}

async function importBackup(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('O backup excede o limite de 2 MB.'); return; }
    try {
        const imported = parseBackup(await file.text());
        if (!confirm('Restaurar este backup substituirá os dados atuais. Deseja continuar?')) return;
        await saveQueue.catch(() => {});
        state = imported; await persist(); ensureDaily(); renderAllCurrentViews();
        navigate(state.profile.onboardingComplete ? 'homeScreen' : 'onboardingScreen');
        toast('Backup restaurado com sucesso.');
    } catch { toast('Backup inválido ou corrompido.'); }
}

async function handleNotificationToggle() {
    const enabled = $('#notificationEnabled').checked;
    if (enabled) {
        const permission = await requestNotificationPermission();
        if (permission !== 'granted') { $('#notificationEnabled').checked = false; state.settings.notificationsEnabled = false; toast('Permissão de notificação não concedida.'); }
        else { state.settings.notificationsEnabled = true; state.settings.lastReminderDate = ''; toast('Lembretes ativados.'); }
    } else { state.settings.notificationsEnabled = false; toast('Lembretes desativados.'); }
    await persist(); renderSettings();
}

async function checkForUpdates(manual = false) {
    try {
        const registration = await navigator.serviceWorker?.getRegistration();
        if (!registration) { if (manual) toast('O app precisa ser aberto por HTTPS ou localhost para atualizar.'); return; }
        await registration.update();
        if (registration.waiting) { waitingWorker = registration.waiting; $('#updateBanner').hidden = false; }
        else if (manual) toast('Você já está na versão mais recente.');
    } catch { if (manual) toast('Não foi possível verificar atualizações.'); }
}

async function installApp() {
    if (!deferredInstallPrompt) { toast('Use o menu do navegador e escolha “Adicionar à tela inicial”.'); return; }
    deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $('#installButton').hidden = true;
}

function updateAppBadge() {
    const pending = Object.values(state.daily.status || {}).filter(value => value !== 'completed').length;
    try {
        if (pending && navigator.setAppBadge) navigator.setAppBadge(pending);
        else if (!pending && navigator.clearAppBadge) navigator.clearAppBadge();
    } catch { /* O selo é opcional e não existe em todos os navegadores. */ }
}

async function saveCheckIn() {
    if (!selectedMood) { toast('Escolha como vocês estão se sentindo hoje.'); return; }
    const entry = { dateKey: todayKey(), mood: selectedMood, note: $('#checkInNote').value.trim().slice(0, 300), updatedAt: new Date().toISOString() };
    const index = state.checkIns.findIndex(item => item.dateKey === entry.dateKey);
    if (index >= 0) state.checkIns[index] = entry; else state.checkIns.push(entry);
    await persist(); renderHome(); renderStats(); toast('Check-in do casal salvo. 💞');
}

async function openSurprise() {
    const pool = libraryRecords();
    const available = pool.filter(item => !state.surpriseRecent.includes(item.text));
    const source = available.length ? available : pool;
    if (!source.length) { toast('Nenhum desafio disponível para o perfil atual.'); return; }
    currentSurprise = source[Math.floor(Math.random() * source.length)];
    state.surpriseRecent = [...state.surpriseRecent, currentSurprise.text].slice(-12);
    await persist();
    const meta = categoryMeta(currentSurprise.category);
    $('#surpriseCategory').textContent = `${meta.icon} ${meta.label}`;
    const concealed = isPrivateCategory(currentSurprise.category);
    $('#surpriseText').textContent = concealed ? hiddenContentMessage : currentSurprise.text;
    $('#surpriseText').classList.toggle('private-placeholder', concealed);
    $('#revealSurprise').hidden = !concealed;
    $('#revealSurprise').setAttribute('aria-pressed', 'false');
    $('#revealSurprise').textContent = 'Revelar desafio';
    $('#surpriseDialog').showModal();
}

function closeSurprise() {
    if ($('#surpriseDialog').open) $('#surpriseDialog').close();
}

function refreshForNewDay() {
    if (!state?.profile?.onboardingComplete || state.daily.dateKey === todayKey()) return;
    ensureDaily();
    renderAllCurrentViews();
    toast('Os desafios de hoje já estão disponíveis.');
}

function bindEvents() {
    document.addEventListener('click', async event => {
        const screenButton = event.target.closest('[data-screen]');
        if (screenButton) { navigate(screenButton.dataset.screen); return; }
        const actionButton = event.target.closest('[data-action]');
        if (!actionButton) return;
        const actions = {
            'toggle-theme': async () => { state.settings.darkMode = !state.settings.darkMode; await persist(); updateHeader(); },
            'go-today': () => navigate('todayScreen'),
            'surprise-now': openSurprise,
            'save-checkin': saveCheckIn,
            'refresh-daily': async () => {
                if (!confirm('Trocar somente os desafios que ainda estão pendentes hoje?')) return;
                Object.keys(state.daily.challenges).forEach(category => {
                    if (state.daily.status[category] !== 'completed') state.daily.challenges[category] = pickChallenge(category);
                });
                await persist(); renderAllCurrentViews(); toast('Desafios pendentes atualizados.');
            },
            'previous-month': () => { currentCalendar.setDate(1); currentCalendar.setMonth(currentCalendar.getMonth() - 1); renderCalendar(); },
            'next-month': () => { currentCalendar.setDate(1); currentCalendar.setMonth(currentCalendar.getMonth() + 1); renderCalendar(); },
            'save-weekly-goal': async () => { state.settings.weeklyGoal = Math.min(21, Math.max(1, Number.parseInt($('#weeklyGoalInput').value, 10) || 5)); await persist(); renderAllCurrentViews(); toast('Meta semanal salva.'); },
            'export-backup': exportBackup,
            'choose-backup': () => $('#backupFile').click(),
            'test-notification': async () => { const permission = await requestNotificationPermission(); if (permission === 'granted') { const sent = await showReminder(state, true); toast(sent ? 'Notificação de teste enviada.' : 'Não foi possível enviar o teste.'); } else toast('Autorize as notificações para testar.'); renderSettings(); },
            'install-app': installApp,
            'check-update': () => checkForUpdates(true),
            'apply-update': () => waitingWorker?.postMessage({ type: 'SKIP_WAITING' }),
            'dismiss-update': () => { $('#updateBanner').hidden = true; },
            'close-surprise': closeSurprise,
            'complete-surprise': async () => { if (!currentSurprise) return; const item = currentSurprise; closeSurprise(); await completeChallenge(item.category, item.text, item.source); },
            'favorite-surprise': async () => { if (currentSurprise) await toggleFavorite(currentSurprise.text); },
            'share-surprise': async () => {
                if (currentSurprise && canShare(currentSurprise.category, !$('#surpriseText').classList.contains('private-placeholder')))
                    await shareChallenge(currentSurprise.text);
            },
            'reveal-surprise': () => {
                if (!currentSurprise) return;
                const text = $('#surpriseText');
                const isConcealed = text.classList.toggle('private-placeholder');
                text.textContent = isConcealed ? hiddenContentMessage : currentSurprise.text;
                $('#revealSurprise').textContent = isConcealed ? 'Revelar desafio' : 'Ocultar desafio';
                $('#revealSurprise').setAttribute('aria-pressed', String(!isConcealed));
            }
        };
        await actions[actionButton.dataset.action]?.();
    });

    $('#dailyChallengeList').addEventListener('click', async event => {
        const button = event.target.closest('[data-daily-action]'); if (!button) return;
        const category = button.dataset.category; const text = state.daily.challenges[category];
        if (button.dataset.dailyAction === 'complete') await completeChallenge(category, text, 'daily');
        if (button.dataset.dailyAction === 'replace') { state.daily.challenges[category] = pickChallenge(category); state.daily.status[category] = 'pending'; await persist(); renderToday(); toast('Desafio trocado.'); }
        if (button.dataset.dailyAction === 'share') {
            const hidden = !!button.closest('.daily-card').querySelector('.private-placeholder');
            if (canShare(category, !hidden)) await shareChallenge(text);
        }
        if (button.dataset.dailyAction === 'reveal') {
            const paragraph = button.closest('.daily-card').querySelector('p.private-placeholder, p.revealed-private');
            if (!paragraph) return;
            const concealed = paragraph.classList.toggle('private-placeholder');
            paragraph.classList.toggle('revealed-private', !concealed);
            paragraph.textContent = concealed ? hiddenContentMessage : text;
            button.textContent = concealed ? 'Revelar' : 'Ocultar';
            button.setAttribute('aria-pressed', String(!concealed));
        }
    });

    $('#challengeCatalog').addEventListener('click', async event => {
        const button = event.target.closest('[data-catalog-action]'); if (!button) return;
        const item = currentCatalogRecords[Number(button.dataset.index)]; if (!item) return;
        if (button.dataset.catalogAction === 'favorite') await toggleFavorite(item.text);
        if (button.dataset.catalogAction === 'complete') await completeChallenge(item.category, item.text, item.source);
        if (button.dataset.catalogAction === 'share') {
            const hidden = !!button.closest('.catalog-item').querySelector('.private-placeholder');
            if (canShare(item.category, !hidden)) await shareChallenge(item.text);
        }
        if (button.dataset.catalogAction === 'reveal') {
            const paragraph = button.closest('.catalog-item').querySelector('p.private-placeholder, p.revealed-private');
            if (!paragraph) return;
            const concealed = paragraph.classList.toggle('private-placeholder');
            paragraph.classList.toggle('revealed-private', !concealed);
            paragraph.textContent = concealed ? hiddenContentMessage : item.text;
            button.setAttribute('aria-pressed', String(!concealed));
            button.setAttribute('aria-label', concealed ? 'Revelar texto' : 'Ocultar texto');
        }
        if (button.dataset.catalogAction === 'delete' && confirm('Excluir este desafio personalizado?')) {
            state.customChallenges = state.customChallenges.filter(custom => custom.id !== item.id);
            if (!libraryRecords().some(record => record.text === item.text)) state.favorites = state.favorites.filter(text => text !== item.text);
            await persist(); renderLibrary(); toast('Desafio excluído.');
        }
    });

    $('#historyList').addEventListener('click', event => {
        const button = event.target.closest('[data-history-index]'); if (!button) return;
        const item = currentHistoryRecords[Number(button.dataset.historyIndex)];
        if (!item) return;
        const paragraph = button.closest('.history-item').querySelector('p');
        const concealed = paragraph.classList.toggle('private-placeholder');
        paragraph.classList.toggle('revealed-private', !concealed);
        paragraph.textContent = concealed ? hiddenContentMessage : item.text;
        button.textContent = concealed ? 'Revelar' : 'Ocultar';
        button.setAttribute('aria-pressed', String(!concealed));
    });

    $('#showMoreChallenges').addEventListener('click', () => { catalogLimit += 36; renderLibrary(); });
    $('#showMoreHistory').addEventListener('click', () => { historyLimit += 50; renderHistory(); });
    $('#calendar').addEventListener('click', async event => {
        const button = event.target.closest('[data-calendar-date]'); if (!button) return;
        const key = button.dataset.calendarDate;
        state.markedDates = state.markedDates.includes(key) ? state.markedDates.filter(item => item !== key) : [...state.markedDates, key].sort();
        await persist(); renderCalendar(); renderStats();
    });

    $('#customChallengeForm').addEventListener('submit', async event => {
        event.preventDefault(); const category = $('#customCategory').value; const text = $('#customText').value.trim();
        if (!text) return;
        if (category === 'sexo' && !categoriesForProfile().includes('sexo')) { toast('Ative a intimidade, maioridade e consentimento no perfil.'); return; }
        state.customChallenges.push({ id: randomId('custom'), category, text: text.slice(0, 240), createdAt: new Date().toISOString() });
        await persist(); $('#customText').value = ''; $('#libraryCategory').value = 'custom'; renderLibrary(); toast('Desafio personalizado criado.');
    });

    $('#onboardingForm').addEventListener('submit', handleOnboarding);
    $('#profileForm').addEventListener('submit', handleProfile);
    $('#onboardingIntimacy').addEventListener('change', event => { $('#onboardingAdultOptions').hidden = !event.target.checked; });
    $('#profileIntimacy').addEventListener('change', event => { $('#profileAdultOptions').hidden = !event.target.checked; });
    $('#challengeSearch').addEventListener('input', () => { catalogLimit = 36; renderLibrary(); });
    $('#libraryCategory').addEventListener('change', () => { catalogLimit = 36; renderLibrary(); });
    $('#historyFilter').addEventListener('change', () => { historyLimit = 50; renderHistory(); });
    $('#notificationEnabled').addEventListener('change', handleNotificationToggle);
    $('#discreetMode').addEventListener('change', async event => { state.settings.discreetMode = event.target.checked; await persist(); renderAllCurrentViews(); toast(event.target.checked ? 'Modo discreto ativado.' : 'Modo discreto desativado.'); });
    const chooseMood = button => {
        selectedMood = Number(button.dataset.mood);
        $$('#moodButtons button').forEach(item => {
            const selected = item === button;
            item.classList.toggle('selected', selected);
            item.setAttribute('aria-checked', String(selected));
            item.tabIndex = selected ? 0 : -1;
        });
    };
    $('#moodButtons').addEventListener('click', event => {
        const button = event.target.closest('[data-mood]'); if (button) chooseMood(button);
    });
    $('#moodButtons').addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = $$('#moodButtons button');
        const at = buttons.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (at + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        chooseMood(buttons[next]); buttons[next].focus();
    });
    $('#notificationTime').addEventListener('change', async event => { state.settings.notificationTime = event.target.value || '20:00'; state.settings.lastReminderDate = ''; await persist(); toast('Horário salvo.'); });
    $('#backupFile').addEventListener('change', async event => { await importBackup(event.target.files?.[0]); event.target.value = ''; });
    window.addEventListener('focus', refreshForNewDay);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshForNewDay(); });
    window.addEventListener('online', () => { updateConnectionStatus(); checkForUpdates(false); });
    window.addEventListener('offline', updateConnectionStatus);
    window.addEventListener('hashchange', () => navigate(hashScreens[location.hash.slice(1)] || 'homeScreen', false));
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; $('#installButton').hidden = false; });
    window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; $('#installButton').hidden = true; toast('Aplicativo instalado com sucesso.'); });
}

async function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    try {
        const registration = await navigator.serviceWorker.register('sw.js');
        if (registration.waiting) { waitingWorker = registration.waiting; $('#updateBanner').hidden = false; }
        registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) { waitingWorker = worker; $('#updateBanner').hidden = false; } });
        });
        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloading) return;
            reloading = true; location.reload();
        });
    } catch (error) { console.warn('Service Worker indisponível.', error); }
}

async function init() {
    state = await loadState();
    ensureDaily();
    bindEvents();
    updateHeader();
    renderAllCurrentViews();
    navigate(state.profile.onboardingComplete ? (hashScreens[location.hash.slice(1)] || 'homeScreen') : 'onboardingScreen', false);
    startNotificationSystem({ getState: () => state, save: async current => { state = current; await persist(); }, onStatus: message => console.info(message) });
    await registerServiceWorker();
    setTimeout(() => $('#splashScreen').classList.add('done'), 350);
    setTimeout(() => checkForUpdates(false), 1500);
    console.info(`Desafios do Amor v${APP_VERSION} carregado.`);
}

init().catch(error => {
    console.error(error);
    document.body.innerHTML = '<main class="fatal-error"><h1>Não foi possível abrir o aplicativo</h1><p>Atualize a página e confira se o navegador permite salvar dados neste dispositivo. Seus backups continuam disponíveis no arquivo que você exportou.</p></main>';
});
})();
