# Publicação gratuita do K.A - Gestão de Paradas

Projeto Firebase: `pcm-gestaoparadas-kisley`.

Esta versão usa somente recursos disponíveis no plano gratuito Spark:

- Firebase Hosting para o endereço público;
- Cloud Firestore para a base compartilhada;
- Firebase Authentication para liberar edição com a senha geral;
- GitHub Actions para publicação automática.

Não utiliza Cloud Functions nem Secret Manager e não exige ativação do plano Blaze.

## Acesso

- qualquer pessoa com o link pode visualizar;
- o botão **Administrador** solicita o nome e a senha geral `PCM2026`;
- a conta técnica de edição é `operador@ka-paradas.app`;
- as regras do Firestore permitem escrita somente para essa conta autenticada;
- vários computadores podem entrar ao mesmo tempo e editar atividades diferentes;
- o nome informado no login é gravado como responsável pela atualização.

A nova parada usa as coleções `ka_free_state_v2` e
`ka_free_activity_buckets_v2`, inicialmente vazias. Os dados das coleções
anteriores são preservados, mas não aparecem nesta versão do aplicativo.

Antes do uso em produção, troque a senha inicial no Firebase Authentication.

## Publicação manual

```powershell
npm run build:firebase
npx firebase-tools@15.24.0 deploy --project pcm-gestaoparadas-kisley --only hosting,firestore:rules,firestore:indexes
```

Endereço publicado: `https://pcm-gestaoparadas-kisley.web.app`.

## GitHub

Os fluxos em `.github/workflows` publicam uma prévia em pull requests e a versão oficial quando a branch `main` é atualizada. O repositório precisa destes segredos:

- `FIREBASE_PROJECT_ID`: `pcm-gestaoparadas-kisley`;
- `FIREBASE_SERVICE_ACCOUNT`: JSON da conta de serviço usada para publicação.

## Limites

O plano Spark possui cotas diárias. A base foi dividida em 16 blocos para diminuir leituras e permitir atualizações simultâneas com menor consumo. Se o uso real ultrapassar as cotas, será necessário reduzir a frequência de atualizações ou migrar para o Blaze.
