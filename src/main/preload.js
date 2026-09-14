'use strict';

/**
 * Ponte segura entre a interface (renderer) e o motor (processo principal).
 *
 * A interface NÃO enxerga o Node nem o sistema de arquivos. Só enxerga estas
 * funções, por canais nomeados. É assim que uma tela fica impedida de fazer
 * qualquer coisa fora do que foi explicitamente liberado aqui.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('motor', {
  // Analisa um dump (Uint8Array) → { reconhecido, perfilId, analise }
  analisar: (bytes) => ipcRenderer.invoke('modulo:analisar', bytes),
  // Salva um arquivo corrigido (nunca sobrescreve o original)
  salvar: (sugestao, bytes) => ipcRenderer.invoke('modulo:salvar', { sugestao, bytes }),
  // Registro persistente (caderninho) — só acrescenta e lê
  registro: {
    adicionar: (dados) => ipcRenderer.invoke('registro:adicionar', dados),
    listar: () => ipcRenderer.invoke('registro:listar'),
    verificar: () => ipcRenderer.invoke('registro:verificar'),
  },
});
