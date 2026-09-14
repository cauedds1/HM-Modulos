'use strict';

/**
 * Armazenamento do registro — persiste o caderninho encadeado em disco.
 *
 * Guarda a cadeia num arquivo JSON local (na máquina da oficina). É
 * append-only por uso: as funções só acrescentam entradas encadeadas; não há
 * função de apagar ou editar. Se alguém mexer no arquivo por fora, a
 * verificação da cadeia denuncia (o selo não bate).
 *
 * JSON em arquivo é suficiente para o volume de uma oficina e não exige
 * dependência nativa. Pode evoluir para SQLite depois sem mudar esta interface.
 */

const fs = require('fs');
const path = require('path');
const registro = require('./registro');

/** Lê a cadeia do arquivo. Arquivo inexistente ou vazio = cadeia vazia. */
function carregar(caminho) {
  try {
    const txt = fs.readFileSync(caminho, 'utf8');
    const lista = JSON.parse(txt);
    return Array.isArray(lista) ? lista : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e; // erro de leitura real: falha segura, não engole
  }
}

/** Grava a cadeia inteira de forma atômica (arquivo temporário + rename). */
function salvar(caminho, lista) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const tmp = caminho + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(lista, null, 2), 'utf8');
  fs.renameSync(tmp, caminho); // rename é atômico: nunca deixa arquivo pela metade
}

/**
 * Acrescenta uma operação ao registro, encadeada. Carrega, cria a entrada
 * ligada à anterior, grava e devolve a entrada criada.
 */
function adicionar(caminho, dados) {
  const lista = carregar(caminho);
  const entrada = registro.novaEntrada(lista, dados);
  lista.push(entrada);
  salvar(caminho, lista);
  return entrada;
}

/** Verifica a integridade da cadeia gravada. */
function verificar(caminho) {
  return registro.verificarCadeia(carregar(caminho));
}

module.exports = { carregar, salvar, adicionar, verificar };
