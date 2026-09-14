'use strict';

/**
 * Processo principal do Electron — a "moldura" do programa instalável.
 *
 * Segurança (boas práticas do Electron):
 *  - contextIsolation: true e nodeIntegration: false → a interface (renderer)
 *    não tem acesso direto ao sistema; só fala com o motor pela ponte do
 *    preload, por canais nomeados. É o que impede uma tela comprometida de
 *    mexer no computador da oficina.
 *  - o motor (src/core) roda no processo principal, longe da interface.
 *
 * Nesta fase (E3) a moldura carrega a interface de teste (web/index.html).
 * As telas migram para o renderer conforme a construção avança.
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const perfilMod = require('../core/perfil');
const leitor = require('../core/leitor');
const armazenamento = require('../core/armazenamento');

let janela = null;

// Onde o registro fica guardado: pasta de dados do app, na máquina da oficina.
function caminhoRegistro() {
  return path.join(app.getPath('userData'), 'registro.json');
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0C1214',
    title: 'HM Módulos',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  janela.removeMenu();
  janela.loadFile(path.join(__dirname, '..', '..', 'web', 'index.html'));
}

/* ---- ponte segura: a interface pede, o motor responde ---- */

// Analisa um dump: recebe os bytes, devolve VIN/KM/integridade sem nunca
// escrever no arquivo original.
ipcMain.handle('modulo:analisar', (_ev, bytes) => {
  const buf = Buffer.from(bytes);
  const perfis = perfilMod.carregarPerfis();
  const perfil = perfilMod.detectar(buf, perfis);
  if (!perfil) {
    return { reconhecido: false, tamanho: buf.length };
  }
  return { reconhecido: true, perfilId: perfil.id, analise: leitor.analisar(buf, perfil) };
});

// Salva um arquivo corrigido SEM sobrescrever o original (arquivo novo).
ipcMain.handle('modulo:salvar', async (_ev, { sugestao, bytes }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(janela, {
    title: 'Salvar arquivo corrigido',
    defaultPath: sugestao || 'corrigido.bin',
    filters: [{ name: 'Dump de módulo', extensions: ['bin', 'eep', 'hex'] }],
  });
  if (canceled || !filePath) return { salvo: false };
  fs.writeFileSync(filePath, Buffer.from(bytes));
  return { salvo: true, caminho: filePath };
});

// Registro persistente (o caderninho): só acrescenta e lista; nunca apaga.
ipcMain.handle('registro:adicionar', (_ev, dados) => armazenamento.adicionar(caminhoRegistro(), dados));
ipcMain.handle('registro:listar', () => armazenamento.carregar(caminhoRegistro()));
ipcMain.handle('registro:verificar', () => armazenamento.verificar(caminhoRegistro()));

app.whenReady().then(() => {
  criarJanela();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
