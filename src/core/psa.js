'use strict';

/**
 * PSA — o "codigo de protecao" do painel BCCM (Citroen C3/Aircross/Basalt),
 * decifrado por analise diferencial (antes/depois de um painel com KM
 * conhecida). Era o bloqueio principal do projeto (P1b/E1).
 *
 * ===================================================================
 * COMO A KM VIVE NO PAINEL (BCCM 95512, 64 KB)
 * ===================================================================
 * A KM NAO fica num campo unico. Fica num ANEL DE REGISTROS de 16 bytes.
 * Cada registro:
 *   [0..3]  hash de 4 bytes (o "codigo de protecao") — LE
 *   [4..5]  00 00
 *   [6]     digito verificador = (km0 + km1 + km2) & 0xFF  (soma dos bytes da KM)
 *   [7..11] 00 00 00 00 00
 *   [12..14] KM x 10, little-endian (ex.: 60200 km -> 602000 -> 90 2F 09)
 *   [15]    00
 *
 * O painel guarda DOIS contadores em aneis distintos:
 *   - odometro principal (a quilometragem real, alta) — este e o que se corrige
 *   - um contador secundario (valores baixos, ~137) — NAO se mexe
 * (Confirmado: a ferramenta de referencia so reescreveu os registros do
 *  odometro principal e deixou o secundario intacto.)
 *
 * ===================================================================
 * A FORMULA DO HASH (verificada em 44/44 registros de 2 dumps reais, e
 * reproduzindo o arquivo de referencia registro a registro):
 * ===================================================================
 *   hash = CRC32_refletido(  [km0, km1, km2, 0,0,0,0,0,0,0]  ) XOR 0xE38A6876
 * onde:
 *   - CRC32_refletido = CRC-32 padrao (poly 0xEDB88320), init=0, xorout=0
 *   - a mensagem sao os 3 bytes da KM (ordem de memoria) + 7 bytes 0x00
 *   - o resultado e gravado em little-endian nos bytes [0..3] do registro
 *
 * Ou seja: a PSA usou o CRC-32 classico (o mesmo do ZIP/PNG), so que numa
 * janela especifica com uma constante XOR. Nao e um algoritmo exotico.
 */

// Tabela do CRC-32 refletido (poly 0xEDB88320), init=0, xorout=0.
const TAB = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  TAB[n] = c;
}
function crc32r(bytes) {
  let c = 0 >>> 0;
  for (const b of bytes) c = (TAB[(c ^ b) & 0xff] ^ (c >>> 8)) >>> 0;
  return c >>> 0;
}

const CONST_XOR = 0xE38A6876;

/** O digito verificador do byte [6] de um registro de KM. */
function digitoKm(k0, k1, k2) {
  return (k0 + k1 + k2) & 0xff;
}

/** O hash de 4 bytes (numero de 32 bits) de um registro de KM. */
function hashRegistroKm(k0, k1, k2) {
  return (crc32r([k0, k1, k2, 0, 0, 0, 0, 0, 0, 0]) ^ CONST_XOR) >>> 0;
}

/**
 * Monta os 16 bytes de um registro de KM valido para uma KM (em km inteiros).
 * Guarda km x 10; o hash e o digito sao recalculados. Devolve um Buffer(16).
 */
function montarRegistroKm(km) {
  const raw = km * 10;
  const k0 = raw & 0xff, k1 = (raw >> 8) & 0xff, k2 = (raw >> 16) & 0xff;
  const rec = Buffer.alloc(16, 0);
  const h = hashRegistroKm(k0, k1, k2);
  rec[0] = h & 0xff; rec[1] = (h >> 8) & 0xff; rec[2] = (h >> 16) & 0xff; rec[3] = (h >> 24) & 0xff;
  rec[6] = digitoKm(k0, k1, k2);
  rec[12] = k0; rec[13] = k1; rec[14] = k2;
  return rec;
}

/** Diz se um registro de 16 bytes tem a "cara" de um registro de KM. */
function pareceRegistroKm(rec) {
  if (rec.length < 16) return false;
  if (rec[4] || rec[5] || rec[7] || rec[8] || rec[9] || rec[10] || rec[11] || rec[15]) return false;
  const k0 = rec[12], k1 = rec[13], k2 = rec[14];
  if ((k0 | k1 | k2) === 0) return false;
  return rec[6] === digitoKm(k0, k1, k2);
}

/** Verifica se o hash gravado de um registro confere com a formula. */
function registroKmValido(rec) {
  if (!pareceRegistroKm(rec)) return false;
  const real = (rec[0] | (rec[1] << 8) | (rec[2] << 16) | (rec[3] << 24)) >>> 0;
  return real === hashRegistroKm(rec[12], rec[13], rec[14]);
}

/**
 * Varre o dump inteiro e devolve todos os registros de KM validos:
 *   [{ offset, km, raw }]  (km em km inteiros; raw = km x10 gravado)
 * Nao assume alinhamento — procura em cada posicao.
 */
function scanRegistros(buf) {
  const out = [];
  for (let o = 0; o + 16 <= buf.length; o++) {
    const rec = buf.subarray(o, o + 16);
    if (registroKmValido(rec)) {
      const raw = rec[12] | (rec[13] << 8) | (rec[14] << 16);
      out.push({ offset: o, raw, km: Math.floor(raw / 10) });
    }
  }
  return out;
}

/**
 * Separa o odometro PRINCIPAL do contador secundario.
 * O painel guarda dois aneis: o odometro real (valores altos) e um contador
 * secundario (valores baixos). Eles ficam bem separados em valor, entao
 * quebramos a lista ordenada no MAIOR salto: o grupo de cima e o principal.
 * Devolve { principal:[regs], secundario:[regs], odometro }.
 */
function separarOdometro(registros) {
  if (registros.length === 0) return { principal: [], secundario: [], odometro: null };
  const vals = [...new Set(registros.map((r) => r.km))].sort((a, b) => a - b);
  let corte = vals[0], maiorSalto = -1;
  for (let i = 1; i < vals.length; i++) {
    const salto = vals[i] - vals[i - 1];
    if (salto > maiorSalto) { maiorSalto = salto; corte = vals[i]; }
  }
  // se so ha um grupo, tudo e principal
  const principal = registros.filter((r) => r.km >= corte);
  const secundario = registros.filter((r) => r.km < corte);
  const odometro = principal.length ? Math.max(...principal.map((r) => r.km)) : Math.max(...registros.map((r) => r.km));
  return { principal, secundario, odometro };
}

/** Le a quilometragem do painel (odometro principal do anel). */
function lerKmPainel(buf) {
  const regs = scanRegistros(buf);
  const { principal, odometro } = separarOdometro(regs);
  return { km: odometro, registros: regs.length, registrosOdometro: principal.length };
}

/**
 * Corrige a KM do painel numa CoPIA: reescreve SoMENTE os registros do
 * odometro principal (o secundario fica intacto, como faz a ferramenta de
 * referencia), recalculando hash e digito de cada um. Devolve
 * { buffer, alterados, de, para }. Nunca toca no buffer original.
 */
function corrigirKmPainel(bufOriginal, novaKm) {
  const buf = Buffer.from(bufOriginal);
  const regs = scanRegistros(buf);
  const { principal, odometro } = separarOdometro(regs);
  const modelo = montarRegistroKm(novaKm);
  for (const r of principal) {
    // preserva bytes que nao fazem parte do registro de KM (nao ha, mas por seguranca copiamos so os campos)
    modelo.copy(buf, r.offset);
  }
  return { buffer: buf, alterados: principal.length, de: odometro, para: novaKm };
}

module.exports = {
  crc32r, CONST_XOR, digitoKm, hashRegistroKm,
  montarRegistroKm, pareceRegistroKm, registroKmValido,
  scanRegistros, separarOdometro, lerKmPainel, corrigirKmPainel,
};
