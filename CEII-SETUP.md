# KA Gestão de Paradas CEII

O CEII usa o mesmo código do KA, com outro projeto Firebase. A publicação original
continua usando sua configuração atual. Não copie dados operacionais nem contas
do cliente original para o CEII.

## Ambiente

- Nome da página: **KA Gestão de Paradas CEII**.
- Projeto criado: `ka-gestao-paradas-ceii`.
- Perfil: `clients/ceii.json`.
- Site gerado: `dist/clients/ceii`.
- Configuração de publicação: `firebase.ceii.json`.
- Endereço principal: `https://kisleyadans.github.io/ka-gestao-de-paradas/ceii/`.
- Endereço alternativo no Firebase Hosting: `https://ka-gestao-paradas-ceii.web.app`.

Projeto, app Web, Cloud Firestore e Firebase Authentication foram configurados
em 16/10/2026. O Firestore usa a região `southamerica-east1` (São Paulo), no nível
gratuito. A conta administrativa e as 16 contas técnicas de disciplina foram
copiadas do projeto original preservando as senhas, conforme solicitado. A cópia
usa os hashes de senha do Firebase; nenhuma senha faz parte destes arquivos.

## Criar o Firebase separado

1. Crie o projeto `ka-gestao-paradas-ceii` na conta responsável pelo KA, no plano Spark.
   Se esse ID não estiver disponível, atualize `clients/ceii.json` e o site em
   `firebase.ceii.json` com o ID efetivamente criado.
2. Cadastre um app Web e copie somente sua configuração pública.
3. Crie o Cloud Firestore em modo de produção e defina a região apropriada para a operação.
4. Ative Email/Senha no Firebase Authentication. Crie a conta
   `operador@ka-paradas.app` e as contas de disciplina
   necessárias, seguindo os e-mails de `FIREBASE-SETUP.md`. Essas contas pertencem
   somente ao projeto CEII. Não publique senhas ou contas de serviço no GitHub.
5. Autorize `ka-gestao-paradas-ceii.web.app` no Authentication, se necessário.

## Gerar e publicar

O perfil contém somente a configuração pública do app Web CEII. O build recusa o
Firebase principal, configurações ausentes e arquivos de conta de serviço. Pode-se
substituir a configuração pública pela variável `KA_CLIENT_FIREBASE_CONFIG` ou por
um arquivo informado com `--firebase-config=C:/caminho/ceii-web-config.json`.

```powershell
npm run test:clients
npm run build:ceii
npx firebase-tools@15.24.0 deploy --project ka-gestao-paradas-ceii --config firebase.ceii.json --only hosting,firestore:rules,firestore:indexes,auth
```

O comando de publicação precisa da sessão autenticada na conta responsável.
Nunca use `firebase use` para trocar o projeto padrão da publicação original.
O build do GitHub Pages inclui a página original na raiz e o CEII na subpasta
`ceii/`. O workflow existente publica as duas páginas quando `main` é atualizado.
O Firebase CEII autoriza o domínio `kisleyadans.github.io` para autenticação.

As regras reutilizam o modelo atual: consulta pública por link e gravação com
autenticação. O projeto separado mantém contas e dados independentes; o link não
substitui uma regra de leitura autenticada caso o cliente exija consulta privada.

## Verificação antes da liberação

- Confirmar o projeto e o app Web em `client-manifest.json` e no console Firebase.
- Abrir a página em computador e celular, conferir nome CEII e banco inicialmente vazio.
- Fazer login com a conta CEII, importar uma base autorizada para esse cliente,
  editar uma atividade e confirmar o resultado em outro navegador.
- Confirmar que as mesmas senhas do projeto original autenticam no CEII.
- Conferir que a página original mantém seus dados e acesso.

As chaves locais de cache, atividades e sessões da página CEII recebem o prefixo
`ka-client:ceii:`. O Firebase mantém o cache e a autenticação do SDK por projeto/app.
Não há limpeza nem migração dos dados locais ou remotos do cliente original.
