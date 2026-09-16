# Servidor + Railway — a base da versão controlada (créditos e contas)

> Este é o **backend** que transforma o HM Módulos numa versão que **o dono
> controla**: contas centrais, créditos e registro central. Ele **serve o
> app** (a mesma tela) e oferece a **API**. Os **dumps do cliente nunca passam
> pelo servidor** — ele cuida só de conta, crédito e registro.

## O que já está pronto

- `server/index.js` — o servidor (Node puro + driver `pg`). Serve o app e a API.
- `server/db.js` — conexão com Postgres e criação automática das tabelas.
- `nixpacks.toml` — diz para a Railway instalar só o necessário e como iniciar.
- Reaproveita o `src/core/auth.js` (senha com scrypt) — mesma proteção do resto.

**Importante (estado atual):** o servidor já **hospeda o app** e tem a **API de
contas/créditos/registro** pronta. A **tela ainda usa o armazenamento local**
(cada navegador). **Ligar a tela na API** (login central, créditos de verdade) é
a **próxima etapa** — depois que o servidor estiver no ar e você validar. Ou
seja: subir agora já te dá o app hospedado (sob seu controle) + a base pronta.

## Como subir na Railway (passo a passo)

1. Crie uma conta em **https://railway.app** e clique em **New Project**.
2. Escolha **Deploy from GitHub repo** e selecione o repositório
   `cauedds1/SistemaHMMecanica`, no branch de desenvolvimento
   (`claude/enigma-bccm-airbag-sync-achdnl`).
3. Adicione o banco: no projeto, **New → Database → Add PostgreSQL**.
4. Ligue o banco ao app: abra o **serviço do app** → aba **Variables** →
   **New Variable** → escolha **Add Reference** e aponte para o
   `DATABASE_URL` do Postgres (a Railway lista ele). Isso cria a variável
   `DATABASE_URL` no app.
5. Ainda em **Variables**, adicione:
   - `TOKEN_SECRET` = uma frase longa e aleatória (ex.: 40+ caracteres). É o que
     assina os logins.
   - `ADMIN_KEY` = uma senha secreta só sua (serve para **recarregar créditos**).
6. A Railway detecta o `nixpacks.toml` e faz o deploy sozinho (instala, inicia
   `node server/index.js`).
7. Gere o endereço público: **Settings → Networking → Generate Domain**. Vai
   sair uma URL tipo `https://hmmodulos-production.up.railway.app`.

### Conferir se subiu
Abra no navegador: `SUA-URL/api/saude` — deve responder:
```json
{ "ok": true, "banco": true, "versao": "0.2.0" }
```
Se `banco: true`, o Postgres está conectado. Abrir só a URL (sem `/api/saude`)
mostra o app.

## O que a API já faz (a base dos créditos)

| Rota | O que faz |
| --- | --- |
| `GET /api/saude` | Diz se está no ar e se o banco conectou |
| `POST /api/oficina/criar` | Cria a oficina + o responsável (com senha) |
| `POST /api/login` | Entra (devolve um token) |
| `GET/POST/DELETE /api/usuarios` | Responsável cadastra/remove operadores |
| `GET /api/creditos` | Saldo de créditos da oficina |
| `POST /api/creditos/recarga` | **Você** (com `ADMIN_KEY`) adiciona créditos |
| `POST /api/operacoes` | Registra a operação, **debita o preço** e grava no registro central |
| `GET /api/operacoes` | Lista o histórico central da oficina |

### Preço por operação (você define)
Fica em `server/index.js`, no `PRECOS` (em créditos):
`diagnóstico 0 · sincronismo 2 · restaurar-km 3 · airbag-crash 5`.
Mudar preço é trocar um número. Cada operação só passa se houver saldo; senão o
servidor recusa (código 402) — é a **trava real** que o `.exe` sozinho não tem.

## As tabelas (Postgres)

- `oficinas` — cada oficina/cliente, com **saldo de créditos** e plano.
- `usuarios` — dono + operadores (senha com scrypt, permissão por papel).
- `operacoes` — **registro central** de tudo, com corrente de hash (à prova de
  adulteração), por oficina.
- `creditos_mov` — extrato de créditos (toda recarga e todo débito).

## Decisões suas que faltam (não travam subir)

- **Preço de cada operação** (os números do `PRECOS`).
- **Modelo de venda**: pacotes de crédito? mensalidade? (define como você recarrega.)
- **Nome do produto** (P3) — aparece na tela.

## Segurança (mantida)

- Senha nunca em texto (scrypt); token de login assinado (HMAC) e com validade.
- Recarga de crédito exige `ADMIN_KEY` (só você).
- Dumps do cliente **não** passam pelo servidor. Segredos ficam em Variables
  (fora do repositório; o `.env` está no `.gitignore`).
