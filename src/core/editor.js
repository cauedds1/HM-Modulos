'use strict';

/**
 * Editor — o lado da ESCRITA (operações "Reparar", "Sincronizar",
 * "Restaurar KM"). Escreve VIN/KM e recalcula os checksums do perfil.
 *
 * Regra de segurança nº 1: NUNCA mexe no buffer original. Toda operação
 * trabalha numa cópia e devolve um buffer novo. É o "o original é sagrado"
 * do escopo, garantido no código.
 *
 * A escrita da KM depende de o perfil declarar os checksums do módulo. Para
 * os PSA, o checksum-por-registro ainda não foi decifrado (P1b): enquanto o
 * perfil não tiver os checksums, `corrigir` escreve o campo mas avisa que o
 * arquivo ainda não é aceitável pelo módulo. Assim que a fórmula entrar no
 * perfil, esta mesma máquina passa a produzir arquivos válidos, sem reescrita.
 */

const codec = require('./codec');
const checksum = require('./checksum');

function clonar(buf) {
  return Buffer.from(buf);
}

/** Escreve o VIN (17 ASCII) no offset do perfil. */
function escreverVin(buf, perfil, vin) {
  codec.escreverVin(buf, { offset: perfil.campos.vin.offset, tamanho: perfil.campos.vin.tamanho }, vin);
}

/** Escreve a quilometragem no campo do perfil (e nas réplicas, se houver). */
function escreverKm(buf, perfil, km) {
  const c = perfil.campos.km;
  const bruto = km * (c.fator || 1); // dump guarda km × fator
  const alvos = [{ offset: c.offset, tamanho: c.tamanho, endian: c.endian || 'le' }].concat(c.replicas || []);
  for (const a of alvos) {
    codec.escreverReplica(
      buf,
      { offset: a.offset, tamanho: a.tamanho, endian: a.endian || c.endian || 'le', encoding: 'raw' },
      bruto
    );
  }
}

/** Recalcula e grava todos os checksums declarados no perfil. */
function aplicarChecksums(buf, perfil) {
  return (perfil.checksums || []).map((spec) => checksum.aplicar(buf, spec));
}

/** Diz se o perfil sabe recalcular os checksums (senão, o arquivo não é aceitável ainda). */
function temChecksums(perfil) {
  return Array.isArray(perfil.checksums) && perfil.checksums.length > 0;
}

/**
 * Aplica alterações (vin e/ou km) numa CÓPIA do dump e recalcula os
 * checksums. Devolve { buffer, checksums, aceitavel }.
 *   aceitavel=false quando o perfil ainda não tem os checksums (P1b) — o
 *   campo foi escrito, mas o módulo rejeitaria o arquivo.
 */
function corrigir(bufOriginal, perfil, { vin = null, km = null } = {}) {
  const buf = clonar(bufOriginal);
  if (vin != null) escreverVin(buf, perfil, vin);
  if (km != null) escreverKm(buf, perfil, km);
  const checksums = aplicarChecksums(buf, perfil);
  return { buffer: buf, checksums, aceitavel: temChecksums(perfil) };
}

module.exports = { corrigir, escreverVin, escreverKm, aplicarChecksums, temChecksums, clonar };
