'use strict';

/**
 * Servidor HM Módulos — para hospedar na Railway (ou qualquer Node host).
 *
 * Faz duas coisas:
 *  1) Serve o app (web/index.html) — a versão que o dono controla.
 *  2) Oferece a API de contas, créditos e registro central (Postgres).
 *
 * Filosofia do projeto: poucas dependências. Aqui só usamos o driver `pg`
 * (e mesmo assim, só quando há banco). O resto é Node puro (http, crypto).
 * A senha reaproveita o mesmo scrypt do motor (src/core/auth.js).
 *
 * Segurança:
 *  - Dumps do cliente NUNCA passam por aqui (ficam no PC/na tela). O servidor
 *    cuida só de conta, crédito e registro.
 *  - Senha com scrypt (nunca em texto). Token assinado (HMAC) por login.
 *  - Recarga de crédito exige ADMIN_KEY (só o dono).
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const db = require('./db');
const auth = require('../src/core/auth'); // scrypt (hashSenha / verificarSenha)

const PORT = process.env.PORT || 3000;
const WEB_DIR = path.join(__dirname, '..', 'web');

// Segredo para assinar tokens. Em produção, defina TOKEN_SECRET na Railway.
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.TOKEN_SECRET) {
  console.warn('[srv] TOKEN_SECRET não definido — usando um temporário (logins caem a cada reinício). Defina TOKEN_SECRET na Railway.');
}
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// Preço de cada operação em créditos. O dono ajusta aqui (ou, no futuro, numa
// tela). Leitura/diagnóstico de graça; gravações custam.
const PRECOS = {
  'diagnostico': 0,
  'sincronismo': 2,
  'restaurar-km': 3,
  'airbag-crash': 5,
  'default': 1,
};

/* ------------------------- utilidades ------------------------- */

function enviar(res, status, obj) {
  const corpo = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(corpo);
}

function lerJson(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (c) => { dados += c; if (dados.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(dados ? JSON.parse(dados) : {}); } catch (e) { reject(new Error('JSON inválido')); } });
    req.on('error', reject);
  });
}

function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function deB64url(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

/** Cria um token assinado (HMAC) com validade. */
function criarToken(payload, horas = 12) {
  const corpo = { ...payload, exp: Date.now() + horas * 3600 * 1000 };
  const p = b64url(JSON.stringify(corpo));
  const assinatura = b64url(crypto.createHmac('sha256', TOKEN_SECRET).update(p).digest());
  return p + '.' + assinatura;
}

/** Verifica e devolve o payload do token, ou null se inválido/expirado. */
function lerToken(token) {
  try {
    const [p, assin] = String(token).split('.');
    if (!p || !assin) return null;
    const esperado = b64url(crypto.createHmac('sha256', TOKEN_SECRET).update(p).digest());
    const a = deB64url(assin), b = deB64url(esperado);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const corpo = JSON.parse(deB64url(p).toString('utf8'));
    if (!corpo.exp || Date.now() > corpo.exp) return null;
    return corpo;
  } catch (e) { return null; }
}

/** Extrai o token do cabeçalho Authorization: Bearer <token>. */
function sessaoDe(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? lerToken(m[1]) : null;
}

function sha256Hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

/* ------------------------- rotas da API ------------------------- */

async function rotaApi(req, res, url) {
  const rota = url.pathname;
  const metodo = req.method;

  // saúde: sempre responde (mesmo sem banco)
  if (rota === '/api/saude' && metodo === 'GET') {
    return enviar(res, 200, { ok: true, banco: db.temBanco(), versao: '0.2.0' });
  }

  if (!db.temBanco()) return enviar(res, 503, { erro: 'banco indisponível (defina DATABASE_URL)' });

  // criar oficina + responsável (primeiro acesso da oficina)
  if (rota === '/api/oficina/criar' && metodo === 'POST') {
    const b = await lerJson(req);
    if (!b.oficina || !b.nome || !b.senha) return enviar(res, 400, { erro: 'informe oficina, nome e senha' });
    let hash;
    try { hash = auth.hashSenha(b.senha); } catch (e) { return enviar(res, 400, { erro: e.message }); }
    const r = await db.comTransacao(async (c) => {
      const of = await c.query('INSERT INTO oficinas(nome) VALUES($1) RETURNING id, saldo_creditos', [b.oficina]);
      const oficinaId = of.rows[0].id;
      const us = await c.query(
        'INSERT INTO usuarios(oficina_id,nome,papel,senha_hash) VALUES($1,$2,$3,$4) RETURNING id',
        [oficinaId, b.nome, 'responsavel', hash]);
      return { oficinaId, usuarioId: us.rows[0].id, saldo: of.rows[0].saldo_creditos };
    });
    const token = criarToken({ oficinaId: r.oficinaId, usuarioId: r.usuarioId, papel: 'responsavel', nome: b.nome });
    return enviar(res, 201, { token, oficinaId: r.oficinaId, papel: 'responsavel', nome: b.nome, saldo: r.saldo });
  }

  // login
  if (rota === '/api/login' && metodo === 'POST') {
    const b = await lerJson(req);
    if (!b.oficinaId || !b.usuario || !b.senha) return enviar(res, 400, { erro: 'informe oficinaId, usuario e senha' });
    const u = await db.q('SELECT id,papel,senha_hash,ativo FROM usuarios WHERE oficina_id=$1 AND nome=$2', [b.oficinaId, b.usuario]);
    const row = u.rows[0];
    if (!row || !row.ativo || !auth.verificarSenha(b.senha, row.senha_hash)) {
      return enviar(res, 401, { erro: 'usuário ou senha incorretos' });
    }
    const token = criarToken({ oficinaId: Number(b.oficinaId), usuarioId: row.id, papel: row.papel, nome: b.usuario });
    return enviar(res, 200, { token, oficinaId: Number(b.oficinaId), papel: row.papel, nome: b.usuario });
  }

  // daqui pra baixo exige sessão
  const ses = sessaoDe(req);
  if (!ses) return enviar(res, 401, { erro: 'não autenticado' });

  // usuários da oficina
  if (rota === '/api/usuarios' && metodo === 'GET') {
    const r = await db.q('SELECT id,nome,papel,ativo,criado_em FROM usuarios WHERE oficina_id=$1 ORDER BY id', [ses.oficinaId]);
    return enviar(res, 200, { usuarios: r.rows });
  }
  if (rota === '/api/usuarios' && metodo === 'POST') {
    if (ses.papel !== 'responsavel') return enviar(res, 403, { erro: 'só o responsável cadastra usuários' });
    const b = await lerJson(req);
    if (!b.nome || !b.senha || !b.papel) return enviar(res, 400, { erro: 'informe nome, senha e papel' });
    if (!['consulta', 'operador', 'responsavel'].includes(b.papel)) return enviar(res, 400, { erro: 'papel inválido' });
    let hash;
    try { hash = auth.hashSenha(b.senha); } catch (e) { return enviar(res, 400, { erro: e.message }); }
    try {
      const r = await db.q('INSERT INTO usuarios(oficina_id,nome,papel,senha_hash) VALUES($1,$2,$3,$4) RETURNING id', [ses.oficinaId, b.nome, b.papel, hash]);
      return enviar(res, 201, { id: r.rows[0].id, nome: b.nome, papel: b.papel });
    } catch (e) {
      return enviar(res, 409, { erro: 'já existe usuário com esse nome' });
    }
  }
  const mDel = rota.match(/^\/api\/usuarios\/(\d+)$/);
  if (mDel && metodo === 'DELETE') {
    if (ses.papel !== 'responsavel') return enviar(res, 403, { erro: 'só o responsável remove usuários' });
    const id = Number(mDel[1]);
    const resp = await db.q("SELECT count(*)::int n FROM usuarios WHERE oficina_id=$1 AND papel='responsavel'", [ses.oficinaId]);
    const alvo = await db.q('SELECT papel FROM usuarios WHERE id=$1 AND oficina_id=$2', [id, ses.oficinaId]);
    if (!alvo.rows[0]) return enviar(res, 404, { erro: 'usuário não encontrado' });
    if (alvo.rows[0].papel === 'responsavel' && resp.rows[0].n <= 1) return enviar(res, 400, { erro: 'precisa haver ao menos um responsável' });
    await db.q('DELETE FROM usuarios WHERE id=$1 AND oficina_id=$2', [id, ses.oficinaId]);
    return enviar(res, 200, { removido: id });
  }

  // créditos
  if (rota === '/api/creditos' && metodo === 'GET') {
    const r = await db.q('SELECT saldo_creditos FROM oficinas WHERE id=$1', [ses.oficinaId]);
    return enviar(res, 200, { saldo: r.rows[0] ? r.rows[0].saldo_creditos : 0 });
  }
  // recarga: só com ADMIN_KEY (o dono do produto)
  if (rota === '/api/creditos/recarga' && metodo === 'POST') {
    if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) return enviar(res, 403, { erro: 'recarga exige ADMIN_KEY' });
    const b = await lerJson(req);
    const oficinaId = Number(b.oficinaId), qtd = Number(b.quantidade);
    if (!oficinaId || !Number.isInteger(qtd) || qtd === 0) return enviar(res, 400, { erro: 'informe oficinaId e quantidade' });
    const r = await db.comTransacao(async (c) => {
      const up = await c.query('UPDATE oficinas SET saldo_creditos = saldo_creditos + $1 WHERE id=$2 RETURNING saldo_creditos', [qtd, oficinaId]);
      if (!up.rows[0]) throw new Error('oficina não encontrada');
      await c.query('INSERT INTO creditos_mov(oficina_id,delta,motivo) VALUES($1,$2,$3)', [oficinaId, qtd, 'recarga']);
      return up.rows[0].saldo_creditos;
    });
    return enviar(res, 200, { saldo: r });
  }

  // registrar uma operação: debita o preço e grava no registro central (hash-chain)
  if (rota === '/api/operacoes' && metodo === 'POST') {
    const b = await lerJson(req);
    if (!b.tipo) return enviar(res, 400, { erro: 'informe o tipo' });
    const custo = PRECOS[b.tipo] != null ? PRECOS[b.tipo] : PRECOS.default;
    try {
      const r = await db.comTransacao(async (c) => {
        const of = await c.query('SELECT saldo_creditos FROM oficinas WHERE id=$1 FOR UPDATE', [ses.oficinaId]);
        const saldo = of.rows[0] ? of.rows[0].saldo_creditos : 0;
        if (custo > 0 && saldo < custo) { const e = new Error('créditos insuficientes'); e.code = 402; e.saldo = saldo; throw e; }
        const ult = await c.query('SELECT seq,hash FROM operacoes WHERE oficina_id=$1 ORDER BY seq DESC LIMIT 1', [ses.oficinaId]);
        const seq = ult.rows[0] ? ult.rows[0].seq + 1 : 1;
        const hashPrev = ult.rows[0] ? ult.rows[0].hash : 'genesis';
        const canon = JSON.stringify({ seq, oficina: ses.oficinaId, usuario: ses.usuarioId, tipo: b.tipo, resumo: b.resumo || '', detalhes: b.detalhes || null, os: b.os || null, custo, hashPrev });
        const hash = sha256Hex(canon + hashPrev);
        await c.query(
          'INSERT INTO operacoes(oficina_id,usuario_id,seq,tipo,resumo,detalhes,os,custo,hash,hash_prev) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [ses.oficinaId, ses.usuarioId, seq, b.tipo, b.resumo || null, b.detalhes || null, b.os || null, custo, hash, hashPrev]);
        let saldoNovo = saldo;
        if (custo > 0) {
          const up = await c.query('UPDATE oficinas SET saldo_creditos = saldo_creditos - $1 WHERE id=$2 RETURNING saldo_creditos', [custo, ses.oficinaId]);
          saldoNovo = up.rows[0].saldo_creditos;
          await c.query('INSERT INTO creditos_mov(oficina_id,delta,motivo) VALUES($1,$2,$3)', [ses.oficinaId, -custo, 'operacao:' + b.tipo]);
        }
        return { seq, hash, custo, saldo: saldoNovo };
      });
      return enviar(res, 201, r);
    } catch (e) {
      if (e.code === 402) return enviar(res, 402, { erro: 'créditos insuficientes', saldo: e.saldo, custo });
      throw e;
    }
  }
  if (rota === '/api/operacoes' && metodo === 'GET') {
    const r = await db.q('SELECT seq,tipo,resumo,os,custo,ts,hash FROM operacoes WHERE oficina_id=$1 ORDER BY seq', [ses.oficinaId]);
    return enviar(res, 200, { operacoes: r.rows });
  }

  return enviar(res, 404, { erro: 'rota não encontrada' });
}

/* ------------------------- arquivos estáticos ------------------------- */

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function servirEstatico(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  // impede sair da pasta web
  const alvo = path.normalize(path.join(WEB_DIR, rel));
  if (!alvo.startsWith(WEB_DIR)) return enviar(res, 403, { erro: 'proibido' });
  fs.readFile(alvo, (err, dados) => {
    if (err) {
      // fallback: entrega o app (single-page)
      return fs.readFile(path.join(WEB_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('não encontrado'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo)] || 'application/octet-stream' });
    res.end(dados);
  });
}

/* ------------------------- servidor ------------------------- */

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await rotaApi(req, res, url);
    return servirEstatico(req, res, url);
  } catch (e) {
    console.error('[srv] erro:', e.message);
    if (!res.headersSent) enviar(res, 500, { erro: 'erro interno' });
  }
});

async function iniciar() {
  db.conectar();
  try { await db.migrar(); } catch (e) { console.error('[db] falha ao migrar:', e.message); }
  servidor.listen(PORT, () => console.log(`[srv] HM Módulos ouvindo na porta ${PORT} (banco: ${db.temBanco() ? 'sim' : 'não'})`));
}

iniciar();

module.exports = { servidor };
