# AUDITORIA TÉCNICA — Desafios do Amor 3.3.0

**Data:** 02/11/2026  
**Origem auditada:** `Desafios-do-amor-main.zip` (versão do código: 3.2.0)  
**Entregável:** código completo do aplicativo web/PWA atualizado para 3.3.0  
**Escopo de avaliação:** análise estática do HTML, CSS, JavaScript, estado persistido, notificações, PWA e testes automatizados de lógica. **Houve teste funcional no DOM real do Chromium, sem navegação de rede. Ainda não houve validação da navegação HTTPS, instalação e atualização do PWA nem teste em dispositivo físico.**

## 1. Visão geral do aplicativo recebido

Aplicativo web estático, sem etapa de compilação e sem backend. Usa HTML/CSS/JavaScript, `localStorage` + IndexedDB, Service Worker e manifesto PWA. Permite onboarding, desafios diários por categoria, biblioteca, desafios personalizados, favoritos, check-in, histórico, calendário, metas, estatísticas, modo escuro/discreto, notificações locais e exportação/importação de backup JSON.

**Pontos positivos já presentes na 3.2.0**
- Interface mobile-first com navegação, contraste/foco e suporte a movimento reduzido.
- Sanitização de textos ao gerar HTML (`escapeHTML`), backups JSON, limite de conteúdo personalizado e suporte a funcionamento offline.
- Controle de maioridade/consentimento para habilitar desafios íntimos.
- Service Worker com cache de recursos e indicação de atualização pendente.

## 2. Achados, prioridades e resultado

| Prioridade | Defeito ou risco encontrado na 3.2.0 | Consequência | Situação na 3.3.0 |
|---|---|---|---|
| **P0** | `persist()` reutilizava `state` e atribuía `state = await saveState(state)` após gravação assíncrona. | Uma gravação antiga poderia sobrescrever atualizações mais recentes na memória. | **Corrigido:** snapshots por operação, fila sequencial, sem reassinar estado global. |
| **P1** | Modo discreto só aplicava blur CSS no texto; histórico não ocultava conteúdo, e a surpresa era revelada ao abrir. | Texto íntimo permanecia no DOM e visível em determinados fluxos. | **Corrigido:** placeholder sem texto real no HTML, revelação explícita em desafio diário, catálogo, histórico e surpresa; compartilhamento exige revelação. |
| **P1** | Alteração do perfil recriava todo o dia e desmarcava progresso. | Conclusões da sessão podiam desaparecer do painel. | **Corrigido:** preserva desafios compatíveis e seus estados; restringe novamente categorias ao mudar consentimento/perfil/intensidade. |
| **P1** | `parseBackup()` validava dados obrigatórios somente **depois** de normalizá-los para arrays padrão. | Arquivos parcialmente inválidos poderiam ser aceitos. | **Corrigido:** valida campos originais, tipo do estado e recusa schema futuro. |
| **P1** | `saveState()` dependia de `localStorage.setItem` e ignorava falha do IndexedDB. | Falha silenciosa ou impossibilidade de salvar quando um armazenamento era bloqueado. | **Melhorado:** tenta as duas cópias e sinaliza erro se ambas falharem. |
| **P1** | Biblioteca e histórico geravam todos os itens de uma vez; biblioteca era renderizada inclusive fora de foco. | Custo elevado de DOM em aparelhos modestos / históricos longos. | **Corrigido:** mostra 36 desafios inicialmente e 50 registros de histórico, expandindo sob demanda. |
| **P1** | Conteúdo personalizado de intimidade persistia no catálogo mesmo se a opção fosse desativada. | Exposição de categoria não mais autorizada no perfil. | **Corrigido:** itens íntimos personalizados ficam fora da biblioteca/surpresas enquanto a categoria estiver desabilitada. |
| **P2** | Calendário utilizava `setMonth()` mantendo o dia original. | Avanço/retorno de meses podia saltar um mês em dias 29–31. | **Corrigido:** ajusta para dia 1 antes da mudança de mês. |
| **P2** | Formato regex aceitava datas impossíveis como 2026-02-30. | Datas inválidas em perfil, check-ins ou backup. | **Corrigido:** valida dia real por mês/ano, inclusive fevereiro bissexto. |
| **P2** | Cálculo de dias juntos/sequências baseado em diferença de timestamps e fração de dias. | Risco de erro de um dia em mudanças de horário de verão. | **Corrigido:** usa datas civis e UTC para comparar dias. |
| **P2** | Falta de atualização automática quando a página permanece aberta após a meia-noite. | Desafio do dia anterior permanece na tela até navegar. | **Corrigido:** ao retomar o app/foco, gera o dia novo e atualiza vistas. |
| **P2** | Radio group do check-in usava botões sem semântica/teclado completas. | Dificuldade para leitores de tela e teclado. | **Corrigido:** `role=radio`, `aria-checked`, roving tabindex e setas. |
| **P2** | Repetição de check-ins do mesmo dia em backup antigo. | Média de humor poderia contar o mesmo dia mais de uma vez. | **Corrigido:** mantém último registro por dia na normalização. |
| **P2** | `showReminder()` podia aguardar indefinidamente um SW `ready` ainda não registrado. | Lembrete ou teste potencialmente pendente. | **Corrigido:** consulta registro existente e usa API nativa como fallback. |
| **P2** | Verificações de lembrete poderiam se sobrepor. | Possível envio repetido perto do horário definido. | **Mitigado:** trava de execução simultânea; controle por data mantido. |
| **P2** | Lembretes em modo discreto incluíam dados do casal no texto de notificação. | Prévia na tela bloqueada poderia revelar detalhes. | **Corrigido:** texto neutro no modo discreto. |
| **P3** | Mensagem de conexão dizia que havia atualizações por estar online; pluralização do calendário incorreta. | Mensagens enganosas. | **Corrigido:** copy revisado. |

## 3. Arquivos modificados

- `js/app.js` — persistência, geração diária, UI e privacidade, paginação, navegação e datas.
- `js/storage.js` — versão 3.3.0, validação de datas/backup, consentimento na migração, deduplicação e tolerância a falhas do storage.
- `js/notifications.js` — privacidade dos lembretes, fallback e prevenção de checagens simultâneas.
- `index.html` — paginadores, botão de revelar surpresa, semântica do check-in e indicação de versão.
- `styles.css` — placeholder privativo e componentes de histórico/paginação.
- `sw.js` — cache atualizado para `desafios-do-amor-v3.3.0`.
- `tests/core.test.cjs` — 11 testes automáticos Node, sem dependências externas.
- `tests/browser_dom_smoke.py` — teste funcional da interface real em Chromium, sem depender de servidor/network.
- `tests/browser_smoke.py` — roteiro Playwright completo para execução em Chromium local com servidor e Service Worker.

Os ícones e a base de desafios foram preservados. Não há adição de serviços externos, trackers, anúncios ou backend.

## 4. Testes realizados vs. pendentes

**Reproduzidos e aprovados na execução atual:**

- Sintaxe de 5 arquivos JavaScript da pasta `js/` e `sw.js` com `node --check` — **6/6 sem erros de sintaxe**.
- `node --test tests/core.test.cjs` — **11/11 aprovados**: consentimento/migração, datas, backups, fallback storage, intensidade, HTML escapado, snapshots concorrentes, preservação de progresso, privacidade das páginas, paginação, recursos e versão do cache.
- Inspeção do HTML/manifesto — **97 IDs únicos**, recursos referenciados presentes, JSON do manifesto válido.
- `python tests/browser_dom_smoke.py` no Chromium — **APROVADO**, com DOM e eventos reais: cadastro, conclusão, catálogo, busca, personalização, favoritos, calendário, surpresa, histórico, perfil, proteção do modo discreto, compartilhamento bloqueado até revelar, check-in/teclado, arquivo de backup e dados após novo boot do app. Esse ensaio usa armazenamento injetado porque o `about:blank` não oferece origem PWA segura; não valida IndexedDB real nem Service Worker.

**Tentados, mas não certificados:**

- Chromium + Playwright **via navegação de rede/arquivo**: `Page.goto` falhou com **`net::ERR_BLOCKED_BY_ADMINISTRATOR`**, inclusive para URL `localhost` e `file://`. Trata-se de restrição do ambiente de teste; não é evidência de falha no aplicativo. O teste alternativo carregou código/HTML diretamente no Chromium e confirmou cliques reais, mas **não** o fluxo completo da origem HTTPS, o comportamento da rede, o SW, a instalação PWA nem desempenho mobile físico.
- Instalação PWA e atualização de Service Worker em Android/iOS/desktop: **não reproduzidas em aparelho real**.
- Notificações reais ao horário programado e permissões específicas de navegadores/dispositivos: **não reproduzidas em aparelho real**. O app não fornece push garantido em segundo plano; os lembretes locais funcionam ao abrir/retomar o app.
- Mudança de fuso horário, migração de dados antigos reais e restauração em browser com quota cheia: **cenários pendentes**.

### Como repetir os testes

Na pasta do projeto:

```bash
node --test tests/core.test.cjs
```

Para testar interações da interface no Chromium **sem servidor** (com armazenamento simulado):

```bash
python -m pip install playwright
python tests/browser_dom_smoke.py
```

Para o teste com servidor local e Service Worker em um PC com Chromium e Python/Playwright acessíveis:

```bash
python -m pip install playwright
python tests/browser_smoke.py
```

O roteiro `browser_smoke.py` cria servidor local e verifica onboarding, desafios, busca, biblioteca, privado/revelação, surpresa, backup, estado após recarga, cache do PWA e teclado. O script tenta encontrar Chromium/Chrome no sistema; se não houver instalação, execute `python -m playwright install chromium` ou informe `CHROMIUM_EXECUTABLE`. A execução em navegador não foi possível neste ambiente.

## 5. Próximas prioridades reais

1. **Teste end-to-end em Chromium móvel e desktop** e teste físico do PWA Android/iOS; confirmar fluxos e capturar screenshots e console.
2. **Reforçar QA da persistência real** com IndexedDB sob quota cheia, importações antigas, atualização de versão do SW e simulação de falha ao gravar.
3. **Melhorar a classificação e curadoria de desafios:** atualmente a intensidade íntima é inferida por expressões regulares, que podem classificar frases ambiguamente. Recomenda-se metadado explícito por desafio e revisão editorial.
4. **Privacidade adicional opcional:** PIN/biometria para abrir app e backups criptografados em vez do JSON legível atual, sujeitos à experiência de recuperação.
5. **Acessibilidade auditada com tecnologia assistiva:** VoiceOver/TalkBack, contraste e fluxo completo de formulários.
6. **Desempenho medido em dispositivo real:** medir INP, LCP, impacto das imagens e do tamanho total do cache antes de reduzir/alterar arte.

## 6. Implantação e compatibilidade

Este é um app estático: hospede o conteúdo da pasta (com `index.html` na raiz) no mesmo caminho do site atual, em **HTTPS**. O Service Worker atualizado ativa o cache 3.3.0 após instalação/atualização. Dados existentes continuam armazenados no dispositivo: não foi feita limpeza de estado nem mudança de formato incompatível. **Antes de substituir a versão publicada, exporte um backup no app atual.**

**Publicação no GitHub não foi realizada** nesta auditoria: a entrega contém o código atualizado pronto para subir, mas a origem fornecida foi um arquivo ZIP sem referência explícita ao repositório de destino.

**Nota de certificação:** o resultado é uma revisão de código com testes de lógica e **teste funcional de interface em Chromium via DOM**, não uma homologação da experiência PWA completa em produção.
