# K.A - Gestão de Paradas

Aplicativo para planejamento, execução e controle de paradas industriais. A interface
funciona em computadores, tablets e celulares e inclui atividades, Curva S, bloqueios,
desbloqueios, limpezas, reuniões e relatório da parada.

## Formas de uso

- **Online atual:** aplicação Vinext publicada pelo Sites, com Cloudflare D1.
- **Online Firebase:** versão preparada para Firebase Hosting, Cloud Functions e Firestore.
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

A versão Firebase é gerada em `firebase/public`. A API fica em
`firebase/functions`, e o guia de primeira publicação está em
`FIREBASE-SETUP.md`.

## Controle de acesso

Quem possui o link pode consultar o plano. Alterações exigem uma sessão de operador.
No Firebase, a senha é validada pela API e armazenada no Secret Manager; ela não é
gravada no HTML nem no GitHub. O Firestore bloqueia acesso direto do navegador.

## Publicação pelo GitHub

O site estático é publicado pelo GitHub Pages quando a branch `main` é atualizada.
O Firebase permanece responsável apenas por Authentication, Firestore, regras e
índices. O workflow do Firebase não publica mais o Hosting.

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
