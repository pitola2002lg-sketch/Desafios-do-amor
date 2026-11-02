/** Sem dependências externas: node --test tests/core.test.cjs */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const script = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const makeCtx = (local = new Map(), opts = {}) => {
    const storage = {
        getItem(k) { if(opts.blockStorage) throw Error('blocked'); return local.get(k) ?? null; },
        setItem(k, v) { if(opts.blockStorage) throw Error('blocked'); local.set(k, String(v)); }
    };
    const context = vm.createContext({
        window: {}, localStorage: storage, console: { warn() {}, error() {}, info() {} },
        Date, Math, JSON, Promise, setTimeout,
    });
    vm.runInContext(script('js/challenges.js'), context);
    vm.runInContext(script('js/storage.js'), context);
    vm.runInContext(script('js/ui.js'), context);
    return { context, local, storage, storageModule: context.window.LoveStorage, challengeModule: context.window.LoveChallenges };
};

test('perfil sem consentimento não libera onboarding ou intimidade (inclusive migração)', async () => {
    const { storageModule: s, local } = makeCtx();
    local.set('userGender', 'male');
    const state = await s.loadState();
    assert.equal(state.profile.onboardingComplete, false);
    assert.equal(state.profile.intimacyEnabled, false);
    const altered = s.normalizeState({ profile: { person1:'A',person2:'B',consentAccepted:false,ageConfirmed:true,intimacyEnabled:true,onboardingComplete:true } });
    assert.equal(altered.profile.onboardingComplete, false);
    assert.equal(altered.profile.intimacyEnabled, false);
});

test('normalização rejeita datas de calendário impossíveis', () => {
    const { storageModule:s } = makeCtx();
    for(const invalid of ['2026-02-30','2025-02-29','2026-13-01','2026-00-01','0000-01-01','xx']){
        assert.equal(s.normalizeState({profile:{ anniversary: invalid }}).profile.anniversary, '', invalid);
    }
    assert.equal(s.normalizeState({profile:{ anniversary: '2024-2-29' }}).profile.anniversary, '2024-02-29');
});

test('backup íntegro, formato inválido, incompleto e versão futura', () => {
    const { storageModule:s } = makeCtx();
    const state = s.createDefaultState();
    state.profile.person1 = 'Teste';
    assert.equal(s.parseBackup(s.serializeBackup(state)).profile.person1, 'Teste');
    assert.throws(() => s.parseBackup('{"format":"desafios-do-amor-backup","state":{}}'));
    assert.throws(() => s.parseBackup(JSON.stringify({ format:'desafios-do-amor-backup', schemaVersion:999, state:{ profile:{}, settings:{}, completions:[], markedDates:[] } })));
});

test('saveState preserva backup local sem IndexedDB, falha se ambos bloqueados', async () => {
    const { storageModule:s,local } = makeCtx();
    const state = s.createDefaultState();
    state.profile.person1='Ana';
    await s.saveState(state);
    assert.equal(JSON.parse(local.get(s.STATE_KEY)).profile.person1,'Ana');
    const blocked = makeCtx(new Map(), {blockStorage:true});
    await assert.rejects(blocked.storageModule.saveState(blocked.storageModule.createDefaultState()), /armazenamento/);
});

test('intensidade de desafios em todos os perfis e consentimento da categoria', () => {
    const { challengeModule:c } = makeCtx();
    for(const gender of ['male','female','other']){
        for(const intensity of ['leve','moderada','intensa']){
            const selected = c.getChallengePool('sexo', {gender,intensity});
            const allowed = intensity === 'leve' ? ['leve'] : intensity === 'moderada' ? ['leve','moderada'] : ['leve','moderada','intensa'];
            assert(selected.length > 0);
            assert(selected.every(item => allowed.includes(c.getIntensity(item))), `${gender} ${intensity}`);
        }
    }
    assert.equal(c.getAvailableCategories({ageConfirmed:true,intimacyEnabled:true,consentAccepted:false}).length, 2);
});

test('escapamento de HTML personalizado impede injeção de marcação', () => {
    const {context} = makeCtx();
    const x = context.window.LoveUI.escapeHTML('<img src=x onerror="alert(1)">');
    assert(!x.includes('<img'));
    assert(x.includes('&lt;img'));
});

function loadApp(initial) {
    const f = makeCtx();
    const elements = new Map();
    const $ = selector => {
        if (!elements.has(selector)) elements.set(selector, { value:'', innerHTML:'', textContent:'', hidden:false, classList:{toggle(){}}, style:{setProperty(){} } });
        return elements.get(selector);
    };
    const saves = [];
    const appStorage = {
        ...f.storageModule,
        async saveState(snapshot) { await new Promise(resolve=>setTimeout(resolve,3)); saves.push(JSON.parse(JSON.stringify(snapshot))); return snapshot; }
    };
    f.context.window.LoveStorage = appStorage;
    f.context.window.LoveNotifications = {};
    f.context.window.LoveUI = {...f.context.window.LoveUI, $, $$:()=>[], toast(){} };
    f.context.navigator = {};
    let code = script('js/app.js');
    code = code.slice(0, code.lastIndexOf('init().catch(')) + `window.__appTests = {
        setState(v){state=v;}, getState(){return state;}, persist, ensureDaily, renderToday, renderLibrary,
        renderHistory, libraryRecords, isPrivateCategory
    };})();`;
    vm.runInContext(code, f.context);
    const app = f.context.window.__appTests;
    app.setState(initial || f.storageModule.createDefaultState());
    return { app, elements, $, saves, ...f };
}

test('persistir snapshots seguidos não sobrescreve a alteração mais recente', async () => {
    const {app,saves} = loadApp();
    const s=app.getState();
    s.profile.person1='Ana';
    const first=app.persist();
    s.profile.person1='Bia';
    const second=app.persist();
    await Promise.all([first,second]);
    assert.equal(s.profile.person1,'Bia');
    assert.deepEqual(saves.map(x=>x.profile.person1),['Ana','Bia']);
});

test('perfil editado no mesmo dia preserva desafios concluídos permitidos', async () => {
    const {app} = loadApp();
    const s=app.getState();
    s.profile={person1:'Ana',person2:'Bia',intimacyEnabled:false,consentAccepted:true,ageConfirmed:false,intensity:'leve',gender:'other',onboardingComplete:true};
    app.ensureDaily(true);
    s.daily.status.carinho='completed';
    const prev=s.daily.challenges.carinho;
    s.profile.intimacyEnabled=true;
    s.profile.ageConfirmed=true;
    app.ensureDaily(true);
    assert.equal(s.daily.challenges.carinho, prev);
    assert.equal(s.daily.status.carinho, 'completed');
    assert.equal(s.daily.status.sexo, 'pending');
    s.profile.intimacyEnabled=false;
    app.ensureDaily(true);
    assert(!('sexo' in s.daily.challenges));
});

test('modo discreto redige desafio diário, catálogo e histórico no HTML', async () => {
    const {app,$, storageModule}=loadApp();
    const s=app.getState();
    s.profile={person1:'Ana',person2:'Bia',intimacyEnabled:true,consentAccepted:true,ageConfirmed:true,intensity:'leve',gender:'other',onboardingComplete:true};
    s.settings.discreetMode=true;
    app.ensureDaily(true);
    const secret=s.daily.challenges.sexo;
    app.renderToday();
    assert(!$('#dailyChallengeList').innerHTML.includes(secret));
    assert($('#dailyChallengeList').innerHTML.includes('Conteúdo reservado'));
    $('#challengeSearch').value=''; $('#libraryCategory').value='sexo';
    app.renderLibrary();
    assert(!$('#challengeCatalog').innerHTML.includes(secret));
    const one = {id:'a',category:'sexo',text:'Um segredo só do casal',dateKey:storageModule.todayKey(),completedAt:new Date().toISOString()};
    s.completions.push(one);
    $('#historyFilter').value='all';
    app.renderHistory();
    assert(!$('#historyList').innerHTML.includes(one.text));
    s.profile.intimacyEnabled=false;
    assert(app.libraryRecords().every(item=>item.category !== 'sexo'));
});

test('catálogo e histórico paginam resultados longos', () => {
    const {app,$}=loadApp();
    const s=app.getState();
    s.profile={person1:'Ana',person2:'Bia',intimacyEnabled:false,consentAccepted:true,ageConfirmed:false,intensity:'leve',gender:'other',onboardingComplete:true};
    $('#libraryCategory').value='all';
    app.renderLibrary();
    assert.equal(($('#challengeCatalog').innerHTML.match(/class="catalog-item"/g)||[]).length,36);
    assert.equal($('#showMoreChallenges').hidden,false);
    s.completions = Array.from({length:90}, (_, i)=>({id:`test-${i}`,dateKey:'2026-10-01',category:'amor',text:`Test ${i}`,completedAt:'2026-10-01T10:00:00.000Z'}));
    $('#historyFilter').value='all';
    app.renderHistory();
    assert.equal(($('#historyList').innerHTML.match(/class="history-item"/g)||[]).length,50);
    assert.equal($('#showMoreHistory').hidden,false);
});

test('lista offline de shell e recursos existem, versões consistentes', () => {
    const sw = script('sw.js');
    const assets = [...sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/(.*?)'/g)].map(m => m[1]);
    assert(assets.length >= 10);
    for(const item of assets) assert(fs.existsSync(path.join(ROOT,item)), item);
    assert(sw.includes('v3.3.0'));
    assert(script('js/storage.js').includes("'3.3.0'"));
    assert(script('index.html').includes('3.3.0'));
});
