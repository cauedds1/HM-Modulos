'use strict';

/**
 * Leitor — junta perfil + codec + checksum numa análise de um dump.
 *
 * É a operação "Diagnosticar" do escopo: só leitura, nunca altera o dump.
 * Devolve VIN, quilometragem, estado e uma lista de verificações de
 * integridade. Não decide nada sozinho — segue o perfil.
 */

const codec = require('./codec');
const psa = require('./psa');

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const KM_MAX_PLAUSIVEL = 2000000;

function lerAscii(buf, off, tam) {
  let s = '';
  for (let i = 0; i < tam && off + i < buf.length; i++) {
    const c = buf[off + i];
    s += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : '';
  }
  return s.trim();
}

/** Lê o VIN cru e detecta o estado "em branco" (resetado: só 00 ou só FF). */
function lerVin(buf, campo) {
  const bytes = buf.subarray(campo.offset, campo.offset + campo.tamanho);
  const branco = bytes.every((b) => b === 0x00) || bytes.every((b) => b === 0xff);
  const texto = lerAscii(buf, campo.offset, campo.tamanho).toUpperCase();
  return { texto, branco, valido: !branco && VIN_RE.test(texto) };
}

/**
 * Lê a quilometragem conforme o campo do perfil.
 * `fator` aqui é escala de exibição: o dump guarda km × fator, então a KM real
 * é o valor bruto dividido pelo fator (ex.: painel PSA guarda 251000 → 25100).
 */
function lerKm(buf, campo) {
  // PSA: a KM vive num anel de registros com codigo de protecao proprio
  // (decifrado — ver src/core/psa.js). Le o odometro principal do anel.
  if (campo.estrutura === 'anel-de-registros-psa') {
    return psa.lerKmPainel(buf).km; // pode ser null se nao houver registros validos
  }
  if (campo.estrutura === 'anel-airbag-psa') {
    return psa.lerKmAirbag(buf).km;
  }
  const bruto = codec.lerReplica(
    buf,
    { offset: campo.offset, tamanho: campo.tamanho, endian: campo.endian || 'le', encoding: 'raw' }
  );
  return Math.floor(bruto / (campo.fator || 1));
}

/**
 * Analisa um dump segundo um perfil. Devolve:
 *   { modulo, memoria, vin, km, kmConfianca, resetado, checks[] }
 * Cada check: { tipo: 'ok'|'aviso'|'erro', texto, obs }
 */
function analisar(buf, perfil) {
  const checks = [];

  const tamanhoOk = buf.length === perfil.tamanho;
  checks.push({
    tipo: tamanhoOk ? 'ok' : 'erro',
    texto: tamanhoOk ? 'Tamanho do arquivo confere' : `Tamanho inesperado (${buf.length} bytes)`,
    obs: tamanhoOk ? '' : `esperado ${perfil.tamanho}`,
  });

  let estruturaOk = tamanhoOk;
  if (perfil.assinatura) {
    const { janela, janelaTam, texto } = perfil.assinatura;
    estruturaOk = tamanhoOk && lerAscii(buf, janela, janelaTam).indexOf(texto) >= 0;
  }
  checks.push({
    tipo: estruturaOk ? 'ok' : 'erro',
    texto: estruturaOk ? 'Estrutura reconhecida' : 'Estrutura não reconhecida',
    obs: estruturaOk ? perfil.modulo : 'o arquivo não parece deste módulo',
  });

  const vin = lerVin(buf, perfil.campos.vin);
  if (vin.branco) {
    checks.push({ tipo: 'aviso', texto: 'Módulo resetado / virgem', obs: 'chassi em branco' });
  } else {
    checks.push({
      tipo: vin.valido ? 'ok' : 'aviso',
      texto: vin.valido ? 'Chassi (VIN) válido' : 'Chassi não reconhecido',
      obs: vin.valido ? '' : 'fora do padrão de VIN',
    });
  }

  const campoKm = perfil.campos.km;
  const confianca = campoKm.confianca || 'confirmado';
  let km = null;
  if (estruturaOk) km = lerKm(buf, campoKm);
  const kmBranco = vin.branco || km === 65535 || km === null;
  if (kmBranco) {
    checks.push({ tipo: 'aviso', texto: 'Quilometragem em branco', obs: 'módulo resetado ou zerado' });
    km = null;
  } else if (confianca === 'confirmado') {
    const plausivel = km >= 0 && km < KM_MAX_PLAUSIVEL;
    checks.push({
      tipo: plausivel ? 'ok' : 'aviso',
      texto: plausivel ? 'Quilometragem lida' : 'Quilometragem implausível',
      obs: plausivel ? '' : 'possível leitura ruim',
    });
  } else {
    checks.push({ tipo: 'aviso', texto: 'Quilometragem — leitura preliminar', obs: 'formato em calibração' });
  }

  return {
    modulo: perfil.modulo,
    memoria: perfil.memoria,
    vin: vin.branco ? '(em branco)' : vin.texto || '—',
    km,
    kmConfianca: confianca,
    resetado: vin.branco,
    checks,
  };
}

module.exports = { analisar, lerVin, lerKm, lerAscii, VIN_RE };
