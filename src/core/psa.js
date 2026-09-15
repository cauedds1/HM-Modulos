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

/* ===================================================================
 * AIRBAG PSA — anel de KM (decifrado 15 set 2026 com antes/depois do
 * mesmo carro: 157383 -> 60200, VIN 935CDNFXDRB522343).
 *
 * Cada registro de KM do airbag:
 *   [0..3] hash de 4 bytes, gravado em BIG-ENDIAN (MSB primeiro)
 *   [4..6] KM (x1, sem fator), little-endian
 * O hash: CRC-32 refletido (mesmo poly 0xEDB88320) sobre [km0,km1,km2,0]
 * (3 bytes de KM + 1 byte zero), XOR 0xD343B576. Verificado em 36/36
 * registros; reproduz o arquivo de referencia byte a byte.
 * (A constante 0xD343B576 e o hash do registro vazio km=0 — o "D3 43 B5 76".)
 * =================================================================== */

const AIR_XOR = 0xD343B576;
const AIR_KM_MAX = 2000000; // plausibilidade (evita falso positivo no scan)

/** Hash de 4 bytes de um registro de KM do airbag (numero de 32 bits). */
function hashRegistroKmAirbag(k0, k1, k2) {
  return (crc32r([k0, k1, k2, 0]) ^ AIR_XOR) >>> 0;
}

/** Diz se um offset carrega um registro de KM valido do airbag. */
function registroKmAirbagValido(buf, o) {
  if (o + 7 > buf.length) return false;
  const k0 = buf[o + 4], k1 = buf[o + 5], k2 = buf[o + 6];
  const H = hashRegistroKmAirbag(k0, k1, k2);
  return buf[o] === ((H >>> 24) & 0xff) && buf[o + 1] === ((H >>> 16) & 0xff)
    && buf[o + 2] === ((H >>> 8) & 0xff) && buf[o + 3] === (H & 0xff);
}

/** Varre o dump do airbag e devolve os registros de KM validos e plausiveis. */
function scanRegistrosAirbag(buf) {
  const out = [];
  for (let o = 0; o + 7 <= buf.length; o++) {
    if (registroKmAirbagValido(buf, o)) {
      const km = buf[o + 4] | (buf[o + 5] << 8) | (buf[o + 6] << 16);
      if (km > 0 && km < AIR_KM_MAX) out.push({ offset: o, km });
    }
  }
  return out;
}

/** Escreve um registro de KM do airbag no offset (hash BE + km LE). */
function escreverRegistroKmAirbag(buf, o, km) {
  const k0 = km & 0xff, k1 = (km >> 8) & 0xff, k2 = (km >> 16) & 0xff;
  const H = hashRegistroKmAirbag(k0, k1, k2);
  buf[o] = (H >>> 24) & 0xff; buf[o + 1] = (H >>> 16) & 0xff;
  buf[o + 2] = (H >>> 8) & 0xff; buf[o + 3] = H & 0xff;
  buf[o + 4] = k0; buf[o + 5] = k1; buf[o + 6] = k2;
}

/**
 * Le a quilometragem do airbag: o odometro e o MAIOR valor do anel (o mais
 * recente da historia). Diferente do painel, o airbag nao tem contador
 * secundario — todos os registros validos sao o mesmo odometro.
 */
function lerKmAirbag(buf) {
  const regs = scanRegistrosAirbag(buf);
  if (!regs.length) return { km: null, registros: 0 };
  const odometro = Math.max(...regs.map((r) => r.km));
  return { km: odometro, registros: regs.length };
}

/**
 * Corrige a KM do airbag numa CoPIA: reescreve TODOS os registros validos do
 * anel para a nova KM (como faz a ferramenta de referencia — verificado byte a
 * byte). Nunca toca no original.
 */
function corrigirKmAirbag(bufOriginal, novaKm) {
  const buf = Buffer.from(bufOriginal);
  const regs = scanRegistrosAirbag(buf);
  const odometro = regs.length ? Math.max(...regs.map((r) => r.km)) : null;
  for (const r of regs) escreverRegistroKmAirbag(buf, r.offset, novaKm);
  return { buffer: buf, alterados: regs.length, de: odometro, para: novaKm };
}

/* ===================================================================
 * VIN (chassi) do PAINEL — checksum decifrado (verificado em 3 carros).
 *
 * O VIN fica em 0x0B00 (17 ASCII). Logo depois:
 *   [+17] = 0x01 (constante)
 *   [+18..+19] = checksum de 16 bits, little-endian, = soma dos 18 bytes
 *                [VIN(17) + o 0x01] (ou seja, soma do VIN + 1).
 * Confirmado em 935CDNFXDRB522343, 935CPFCA5SB556938 e 935CEFC2CRB551519.
 *
 * NOTA DE HONESTIDADE: a FoRMULA do checksum está confirmada, mas a gravação
 * de VIN ainda NAO foi provada de ponta a ponta (falta um antes/depois de uma
 * troca de VIN, como tivemos para a KM). Enquanto isso, escreverVinPainel
 * recalcula o checksum conhecido — mas o produto só deve LIBERAR a gravação de
 * VIN após essa confirmação. Airbag: o checksum do VIN do airbag ainda não foi
 * decifrado (offset varia por modelo e parece um hash; faltam amostras).
 * =================================================================== */

const VIN_PAINEL_OFFSET = 0x0B00;

/** Checksum do VIN do painel (16 bits) = soma de VIN(17) + byte [+17]. */
function checksumVinPainel(buf, o = VIN_PAINEL_OFFSET) {
  let s = 0;
  for (let i = 0; i < 18; i++) s += buf[o + i]; // 17 do VIN + o 0x01
  return s & 0xffff;
}

/** Confere se o checksum gravado do VIN do painel bate com a fórmula. */
function vinPainelValido(buf, o = VIN_PAINEL_OFFSET) {
  const gravado = buf[o + 18] | (buf[o + 19] << 8);
  return gravado === checksumVinPainel(buf, o);
}

/**
 * Escreve um novo VIN no painel numa CoPIA e recalcula o checksum conhecido.
 * Devolve { buffer, de, para }. Nunca toca no original. Recusa VIN != 17 chars.
 * (Gravação de VIN ainda pendente de confirmação byte a byte — ver nota acima.)
 */
function escreverVinPainel(bufOriginal, novoVin) {
  if (typeof novoVin !== 'string' || novoVin.length !== 17) {
    throw new Error('VIN inválido (precisa de 17 caracteres)');
  }
  const buf = Buffer.from(bufOriginal);
  const o = VIN_PAINEL_OFFSET;
  const de = lerVinPainelBruto(buf, o);
  for (let i = 0; i < 17; i++) buf[o + i] = novoVin.charCodeAt(i);
  const ck = checksumVinPainel(buf, o); // recalcula sobre o VIN novo
  buf[o + 18] = ck & 0xff;
  buf[o + 19] = (ck >> 8) & 0xff;
  return { buffer: buf, de, para: novoVin };
}

function lerVinPainelBruto(buf, o = VIN_PAINEL_OFFSET) {
  let s = '';
  for (let i = 0; i < 17; i++) { const c = buf[o + i]; s += (c >= 0x20 && c <= 0x7e) ? String.fromCharCode(c) : ''; }
  return s;
}

module.exports = {
  crc32r, CONST_XOR, digitoKm, hashRegistroKm,
  montarRegistroKm, pareceRegistroKm, registroKmValido,
  scanRegistros, separarOdometro, lerKmPainel, corrigirKmPainel,
  // airbag
  AIR_XOR, hashRegistroKmAirbag, registroKmAirbagValido, scanRegistrosAirbag,
  escreverRegistroKmAirbag, lerKmAirbag, corrigirKmAirbag,
  // vin painel
  VIN_PAINEL_OFFSET, checksumVinPainel, vinPainelValido, escreverVinPainel,
};
