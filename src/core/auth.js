'use strict';

/**
 * Autenticação — senha guardada com hash forte (scrypt + sal).
 *
 * Nunca se guarda a senha em texto. Guarda-se um hash salgado; para conferir,
 * recalcula-se o hash e compara-se em tempo constante (contra ataque de tempo).
 * É a base do "login com senha real" do produto.
 */

const crypto = require('crypto');

const N = 16384; // custo do scrypt

function hashSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 4) {
    throw new Error('senha muito curta (mínimo 4 caracteres)');
  }
  const sal = crypto.randomBytes(16);
  const dk = crypto.scryptSync(senha, sal, 32, { N });
  return `scrypt$${N}$${sal.toString('hex')}$${dk.toString('hex')}`;
}

function verificarSenha(senha, hash) {
  try {
    const [alg, n, salHex, dkHex] = String(hash).split('$');
    if (alg !== 'scrypt') return false;
    const sal = Buffer.from(salHex, 'hex');
    const esperado = Buffer.from(dkHex, 'hex');
    const calc = crypto.scryptSync(senha, sal, esperado.length, { N: Number(n) });
    return calc.length === esperado.length && crypto.timingSafeEqual(calc, esperado);
  } catch (e) {
    return false;
  }
}

module.exports = { hashSenha, verificarSenha };
