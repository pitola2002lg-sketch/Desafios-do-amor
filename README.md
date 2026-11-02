# Desafios do Amor — 3.3.0

Aplicativo web/PWA estático de desafios de casal, com dados locais. Versão atualizada a partir do ZIP da 3.2.0.

## Rodar

Em servidor local ou hospedagem HTTPS, publique todo o conteúdo da pasta com `index.html` na raiz. Sem build ou dependências de produção. Para rodar localmente:

```bash
python -m http.server 8000
```

Abra `http://localhost:8000` e faça o onboarding. Para instalar como PWA, acesse via HTTPS ou localhost. O modo discreto oculta textos íntimos até revelação explícita, mas **não criptografa** os dados do armazenamento nem o backup JSON.

## Testes

```bash
node --test tests/core.test.cjs
```

Teste de interface em Chromium com DOM real, sem servidor:

```bash
python -m pip install playwright
python tests/browser_dom_smoke.py
```

Teste completo com servidor local e Service Worker (depende de navegação localhost autorizada):

```bash
python tests/browser_smoke.py
```

Confira `AUDITORIA_DESAFIOS_DO_AMOR_V3_3_0.md` para as correções implementadas, as validações executadas e as limitações.
