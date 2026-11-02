"""Chromium UI smoke sem servidor/redes; não certifica Service Worker nem PWA instalado.
Dependência: pip install playwright; navegador Chromium instalado ou `playwright install chromium`.
Execute: python tests/browser_dom_smoke.py
"""
import os
import re
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SOURCE = re.sub(r'<script defer src="js/[^\"]+"></script>', '', (ROOT / 'index.html').read_text())
JS = ['js/challenges.js', 'js/storage.js', 'js/notifications.js', 'js/ui.js', 'js/app.js']


def boot(browser, stored=None):
    page = browser.new_page(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, locale='pt-BR')
    page.set_default_timeout(8000)
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(SOURCE)
    page.add_style_tag(content=(ROOT / 'styles.css').read_text())
    page.evaluate('''(stored) => {
        const items = new Map(Object.entries(stored || {}));
        Object.defineProperty(window, 'localStorage', {
            configurable:true,
            value:{ getItem(key){return items.get(key) ?? null;}, setItem(key, value){items.set(key, String(value));},
                removeItem(key){items.delete(key);} }
        });
        // PWA e IndexedDB requerem origem segura; são testados separadamente.
        Object.defineProperty(window, 'indexedDB', {configurable:true, value: undefined});
    }''', stored or {})
    for src in JS:
        page.add_script_tag(content=(ROOT / src).read_text())
    page.wait_for_function("document.querySelector('#splashScreen')?.classList.contains('done')", timeout=10000)
    return page,errors


def main():
    chromium_path = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome') or shutil.which('chrome')
    options = {'executable_path':chromium_path} if chromium_path else {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**options, headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])
        page,errors = boot(browser)
        page.wait_for_selector('#onboardingScreen.active')
        page.locator('#onboardingPerson1').fill('Ana')
        page.locator('#onboardingPerson2').fill('Bia')
        page.locator('#onboardingConsent').check()
        page.locator('#onboardingForm [type="submit"]').click()
        page.wait_for_selector('#homeScreen.active')
        assert page.locator('#dailyProgressValue').inner_text() == '0/2'
        page.locator('[data-action="go-today"]').click()
        page.wait_for_selector('#todayScreen.active')
        assert page.locator('.daily-card').count() == 2
        page.locator('.daily-card [data-daily-action="complete"]').first.click()
        page.wait_for_function('document.querySelectorAll(".daily-card.completed").length === 1')
        assert page.locator('#dailyProgressValue').inner_text() == '1/2'
        # Sem clique PWA; testa DOM interativo real.
        page.locator('#bottomNav [data-screen="libraryScreen"]').click()
        page.wait_for_selector('#libraryScreen.active')
        assert page.locator('.catalog-item').count() == 36
        page.locator('#showMoreChallenges').click()
        assert page.locator('.catalog-item').count() > 36
        page.locator('#challengeSearch').fill('desafio-sem-ocorrencias-49498')
        assert 'Nenhum desafio' in page.locator('#challengeCatalog').inner_text()
        page.locator('#challengeSearch').fill('')
        page.locator('#customText').fill('Vamos preparar uma surpresa para amanhã')
        page.locator('#customChallengeForm button[type=submit]').click()
        page.wait_for_function('document.querySelector("#challengeCatalog").textContent.includes("Vamos preparar uma surpresa")')
        page.locator('#challengeCatalog [data-catalog-action=favorite]').first.click()
        page.wait_for_function('document.querySelector("#challengeCatalog [data-catalog-action=favorite]")?.textContent.includes("★")')
        # O histórico é acessível pela home (quick grid), não pela bottomNav.
        page.locator('[data-screen="homeScreen"]').first.click()
        page.locator('[data-screen="historyScreen"]').first.click()
        page.wait_for_selector('#historyScreen.active')
        assert 'desafio' in page.locator('#historyList').inner_text().lower() or page.locator('.history-item').count() == 1
        page.locator('[data-screen="homeScreen"]').first.click()
        page.locator('[data-screen="calendarScreen"]').first.click()
        page.wait_for_selector('#calendarScreen.active')
        page.locator('#calendar [data-calendar-date]').first.click()
        assert '1 dia especial' in page.locator('#calendarSummary').inner_text()
        page.locator('[data-screen="homeScreen"]').first.click()
        page.locator('[data-action="surprise-now"]').click()
        assert page.locator('#surpriseDialog').is_visible()
        page.locator('[data-action="close-surprise"]').click()
        page.locator('[data-screen="settingsScreen"]').first.click()
        page.wait_for_selector('#settingsScreen.active')
        page.locator('#profileIntimacy').check()
        page.locator('#profileAge').check()
        page.locator('#profileForm [type=submit]').click()
        page.locator('#discreetMode').check()
        page.locator('[data-screen="todayScreen"]').first.click()
        page.wait_for_selector('#todayScreen.active')
        private = page.locator('.daily-card.sexo')
        assert private.count() == 1
        assert 'Conteúdo reservado' in private.locator('p').inner_text()
        page.locator('.daily-card.sexo [data-daily-action="reveal"]').click()
        assert 'Conteúdo reservado' not in private.locator('p').inner_text()
        page.locator('.daily-card.sexo [data-daily-action="reveal"]').click()
        assert 'Conteúdo reservado' in private.locator('p').inner_text()
        page.locator('.daily-card.sexo [data-daily-action="share"]').click()
        assert 'Revele' in page.locator('#toast').inner_text()
        page.locator('[data-screen="homeScreen"]').first.click()
        page.locator('#moodButtons button[data-mood="3"]').focus()
        page.keyboard.press('ArrowRight')
        assert page.locator('#moodButtons button[aria-checked=true]').get_attribute('data-mood') == '4'
        page.locator('[data-action="save-checkin"]').click()
        page.wait_for_function('document.querySelector("#toast").textContent.includes("Check-in")')
        page.locator('[data-screen="settingsScreen"]').first.click()
        with page.expect_download(timeout=5000) as download_info:
            page.locator('[data-action="export-backup"]').click()
        assert download_info.value.suggested_filename.endswith('.json')
        statejson = page.evaluate('localStorage.getItem("desafiosDoAmorState")')
        assert statejson and '"person1":"Ana"' in statejson
        from_page = {'desafiosDoAmorState': statejson}
        assert not errors, errors
        page2, errors2 = boot(browser, from_page)
        page2.wait_for_selector('#homeScreen.active')
        assert 'Ana & Bia' in page2.locator('#coupleGreeting').inner_text()
        assert page2.locator('#dailyProgressValue').inner_text().startswith('1/')
        assert not errors2, errors2
        print('PASS: Chromium (DOM real) onboarding, desafios, biblioteca, busca, custom, favoritos, calendário, surpresa, histórico, perfil, privacidade, compartilhamento, humor, backup e estado reiniciado')
        browser.close()

if __name__ == '__main__': main()
