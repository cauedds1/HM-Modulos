'use strict';

/**
 * Banco de dados (Postgres) — conexão e esquema.
 *
 * O servidor pode subir SEM banco (para teste do HTTP): se DATABASE_URL não
 * estiver definida, `pool` fica null e as rotas que dependem do banco
 * respondem "banco indisponível". Na Railway, o plugin Postgres define
 * DATABASE_URL automaticamente.
 *
 * O driver `pg` só é carregado quando há DATABASE_URL — assim o servidor roda
 * com Node puro em ambiente sem o pacote instalado (ex.: smoke test).
 */

let pool = null;

function conectar() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('[db] DATABASE_URL não definida — rodando SEM banco (só o app estático e /api/saude).');
    return null;
  }
  const { Pool } = require('pg');
  const local = /localhost|127\.0\.0\.1/.test(url);
  pool = new Pool({
    connectionString: url,
    // Railway (conexão pública) exige SSL; local normalmente não.
    ssl: local ? false : { rejectUnauthorized: false },
    max: 5,
  });
  pool.on('error', (e) => console.error('[db] erro no pool:', e.message));
  return pool;
}

/** Cria as tabelas se ainda não existirem (idempotente). */
async function migrar() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oficinas (
      id             SERIAL PRIMARY KEY,
      nome           TEXT NOT NULL,
      saldo_creditos INTEGER NOT NULL DEFAULT 0,
      plano          TEXT NOT NULL DEFAULT 'teste',
      ativa          BOOLEAN NOT NULL DEFAULT true,
      criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id         SERIAL PRIMARY KEY,
      oficina_id INTEGER NOT NULL REFERENCES oficinas(id) ON DELETE CASCADE,
      nome       TEXT NOT NULL,
      papel      TEXT NOT NULL CHECK (papel IN ('consulta','operador','responsavel')),
      senha_hash TEXT NOT NULL,
      ativo      BOOLEAN NOT NULL DEFAULT true,
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (oficina_id, nome)
    );

    -- Registro central de operações (append-only, com corrente de hash por oficina)
    CREATE TABLE IF NOT EXISTS operacoes (
      id         SERIAL PRIMARY KEY,
      oficina_id INTEGER NOT NULL REFERENCES oficinas(id) ON DELETE CASCADE,
      usuario_id INTEGER REFERENCES usuarios(id),
      seq        INTEGER NOT NULL,
      tipo       TEXT NOT NULL,
      resumo     TEXT,
      detalhes   JSONB,
      os         TEXT,
      custo      INTEGER NOT NULL DEFAULT 0,
      ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
      hash       TEXT NOT NULL,
      hash_prev  TEXT NOT NULL,
      UNIQUE (oficina_id, seq)
    );

    -- Extrato de créditos (toda entrada/saída fica registrada)
    CREATE TABLE IF NOT EXISTS creditos_mov (
      id         SERIAL PRIMARY KEY,
      oficina_id INTEGER NOT NULL REFERENCES oficinas(id) ON DELETE CASCADE,
      delta      INTEGER NOT NULL,
      motivo     TEXT NOT NULL,
      ts         TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_operacoes_oficina ON operacoes(oficina_id);
    CREATE INDEX IF NOT EXISTS idx_usuarios_oficina ON usuarios(oficina_id);
  `);
  console.log('[db] esquema pronto.');
}

function q(texto, params) {
  if (!pool) throw new Error('banco indisponível');
  return pool.query(texto, params);
}

/** Executa uma função dentro de uma transação (BEGIN/COMMIT/ROLLBACK). */
async function comTransacao(fn) {
  if (!pool) throw new Error('banco indisponível');
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const r = await fn(cliente);
    await cliente.query('COMMIT');
    return r;
  } catch (e) {
    await cliente.query('ROLLBACK');
    throw e;
  } finally {
    cliente.release();
  }
}

module.exports = { conectar, migrar, q, comTransacao, temBanco: () => !!pool };
