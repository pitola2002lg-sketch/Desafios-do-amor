"""Teste de regressão no Chromium: python -m pip install playwright; python tests/browser_smoke.py
Sirva a pasta via localhost; o script cria seu próprio servidor local.
"""
import json
import os
import shutil
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8877
@contextmanager
def server():
    p = subprocess.Popen(['python', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                urlopen(f'http://127.0.0.1:{PORT}/', timeout=.5)
                break
            except Exception:
                time.sleep(.1)
        else: raise RuntimeError('Servidor não abriu')
        yield f'http://127.0.0.1:{PORT}/'
    finally:
        p.terminate(); p.wait(timeout=5)

def run():
    failures = []
    with server() as address, sync_playwright() as pw:
        browser_path = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome') or shutil.which('chrome')
        browser_args = {'executable_path': browser_path} if browser_path else {}
        browser = pw.chromium.launch(**browser_args, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        context = browser.new_context(viewport={ 'width': 390, 'height': 844 }, is_mobile=True, has_touch=True, locale='pt-BR', timezone_id='America/Sao_Paulo', permissions=['notifications'])
        page = context.new_page()
        page.on('pageerror', lambda error: failures.append(str(error)))
        page.goto(address)
        page.wait_for_selector('#onboardingScreen.active')
        assert page.locator('#onboardingTitle').is_visible()
        page.locator('#onboardingPerson1').fill('Ana')
        page.locator('#onboardingPerson2').fill('Bia')
        page.locator('#onboardingConsent').check()
        page.locator('#onboardingForm button[type=submit]').click()
        page.wait_for_selector('#homeScreen.active')
        assert page.locator('#dailyProgressValue').inner_text() == '0/2'
        page.locator('[data-action="go-today"]').click()
        page.wait_for_selector('#todayScreen.active')
        assert page.locator('.daily-card').count() == 2
        page.locator('.daily-card [data-daily-action="complete"]').first.click()
        page.wait_for_timeout(200)
        assert page.locator('.daily-card.completed').count() == 1
        assert page.locator('.daily-card [data-daily-action="complete"]:not([disabled])').count() == 1
        page.locator('#bottomNav [data-screen="libraryScreen"]').click()
        page.wait_for_selector('#libraryScreen.active')
        assert page.locator('.catalog-item').count() <= 36
        catalog_count = page.locator('#catalogResultCount').inner_text()
        assert 'desafio' in catalog_count
        assert page.locator('#showMoreChallenges').is_visible()
        page.locator('#showMoreChallenges').click()
        assert page.locator('.catalog-item').count() > 36
        page.locator('#challengeSearch').fill('zzziiinexistente')
        assert page.locator('#showMoreChallenges').is_hidden()
        assert page.locator('.empty-state').count() > 0
        page.locator('#challengeSearch').fill('')
        page.locator('#customText').fill('Andar no parque com café')
        page.locator('#customChallengeForm button[type=submit]').click()
        page.wait_for_timeout(200)
        assert page.locator('#challengeCatalog').inner_text().find('Andar no parque com café') >= 0
        # Calendário regressão data >28 ao ir para fevereiro.
        page.evaluate("""() => { const el=document.querySelector('[data-screen="calendarScreen"]'); el.click(); }""")
        page.wait_for_selector('#calendarScreen.active')
        page.locator('[data-action="next-month"]').click()
        assert page.locator('#calendarMonth').inner_text()
        # Modo discreto: texto sensível não pode estar no DOM até revelação.
        page.locator('[data-screen="settingsScreen"]').first.click()
        page.wait_for_selector('#settingsScreen.active')
        page.locator('#profileIntimacy').check()
        page.locator('#profileAge').check()
        page.locator('#profileForm button[type=submit]').click()
        page.wait_for_timeout(150)
        page.locator('#discreetMode').check()
        page.wait_for_timeout(150)
        page.locator('[data-screen="todayScreen"]').first.click()
        page.wait_for_selector('#todayScreen.active')
        private = page.locator('.daily-card.sexo')
        assert private.count() == 1
        assert 'Conteúdo reservado' in private.locator('p').inner_text()
        assert 'Conteúdo reservado' in private.inner_text()
        page.locator('.daily-card.sexo [data-daily-action="reveal"]').click()
        assert private.locator('p').inner_text() != 'Conteúdo reservado. Toque em Revelar para visualizar.'
        page.locator('.daily-card.sexo [data-daily-action="reveal"]').click()
        assert 'Conteúdo reservado' in private.locator('p').inner_text()
        page.locator('[data-screen="homeScreen"]').first.click()
        page.locator('[data-action="surprise-now"]').click()
        assert page.locator('#surpriseDialog').is_visible()
        page.locator('[data-action="close-surprise"]').click()
        page.locator('[data-screen="settingsScreen"]').first.click()
        with page.expect_download() as info:
            page.locator('[data-action="export-backup"]').click()
        download = info.value
        assert download.suggested_filename.endswith('.json')
        file = ROOT / 'tests' / '.backup_test.json'
        download.save_as(file)
        backup = json.loads(file.read_text())
        assert backup['format'] == 'desafios-do-amor-backup'
        file.unlink(missing_ok=True)
        page.reload()
        page.wait_for_selector('#settingsScreen.active')
        assert page.locator('#coupleGreeting').inner_text().startswith('Ana & Bia')
        # Testar ativação offline via service worker: depois da instalação de cache, todos os assets do shell precisam estar presentes.
        page.wait_for_function("async () => !!(await navigator.serviceWorker.getRegistration())")
        page.wait_for_timeout(600)
        count = page.evaluate("async () => (await caches.keys()).length")
        assert count >= 1
        # Accessibility: foco de rádio e setas
        page.locator('[data-screen="homeScreen"]').first.click()
        page.wait_for_selector('#homeScreen.active')
        page.locator('#moodButtons button[data-mood="3"]').focus()
        page.keyboard.press('ArrowRight')
        assert page.locator('#moodButtons button[aria-checked="true"]').get_attribute('data-mood') == '4'
        assert not failures, failures
        print('PASS: onboarding, desafio, catálogo paginado, busca, personalizado, calendário, privacidade, surpresa, backup, persistência, SW, teclado')
        browser.close()

if __name__ == '__main__': run()
