# K.A - Gestão de Paradas

Aplicativo para planejamento, execução e controle de paradas industriais. A interface
funciona em computadores, tablets e celulares e inclui atividades, Curva S, bloqueios,
desbloqueios, limpezas, reuniões e relatório da parada.

## Formas de uso

- **Online atual:** site estático no GitHub Pages com Firebase Authentication e Firestore.
- **Servidor local:** aplicação Vinext com a API de desenvolvimento.
- **Offline:** HTML único em `outputs/KA-Gestao-de-Paradas-OFFLINE.html`.

## Desenvolvimento

Requer Node.js 22 ou superior.

```bash
npm install
npm run dev
npm test
```

## Gerar as versões distribuíveis

```bash
npm run build:firebase
node work/build-offline-html.mjs
```

A versão Firebase é gerada em `firebase/public`. O guia de configuração está em
`FIREBASE-SETUP.md`.

## Controle de acesso

Quem possui o link pode consultar o plano. Alterações exigem a conta compartilhada
`operador@ka-paradas.app`, com senha inicial de teste `PCM2026`. Vários computadores
podem usar essa conta ao mesmo tempo; cada pessoa informa o próprio nome para o
histórico. O Firestore mescla alterações feitas em atividades diferentes e rejeita
conflitos no mesmo campo. A senha deve ser trocada antes de uso em produção.

## Publicação pelo GitHub

O site estático é publicado pelo GitHub Pages quando a branch `main` é atualizada.
O Firebase permanece responsável apenas por Authentication, Firestore, regras e
índices. O workflow do Firebase não publica mais o Hosting.

Esta versão inicia a nova parada nas coleções `ka_free_state_v2` e
`ka_free_activity_buckets_v2`. As coleções anteriores não são carregadas nem
apagadas e permanecem no Firestore como histórico.

Antes da primeira publicação:

1. Em **Settings > Pages**, escolha **GitHub Actions** como origem.
2. No Firebase Authentication, adicione `SEU_USUARIO.github.io` aos domínios
   autorizados.
3. Configure os segredos `FIREBASE_PROJECT_ID` e `FIREBASE_SERVICE_ACCOUNT` para
   permitir a publicação das regras e índices do Firestore.

O build usado pelo Pages pode ser gerado localmente com:

```bash
npm run build:github-pages
```
