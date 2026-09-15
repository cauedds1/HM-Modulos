# Como gerar o programa instalável (.exe) — Windows

> O `.exe` final **só pode ser gerado numa máquina Windows** (é o Windows que
> monta o instalador do Windows). No ambiente de desenvolvimento (Linux) dá para
> construir e testar todo o miolo, mas o instalador em si sai daqui. Este guia é
> o passo a passo para gerar o `.exe` quando quiser.

## O que você precisa (uma vez só)

1. Um computador com **Windows** (10 ou 11).
2. **Node.js** instalado — baixe em https://nodejs.org (versão "LTS", o botão da
   esquerda). É só ir clicando em "avançar" na instalação.

## Passo a passo

Abra o **Prompt de Comando** (ou PowerShell) na pasta do projeto e rode, na ordem:

```bat
npm install
npm run build:win
```

- `npm install` baixa as peças necessárias (faz isso uma vez; pode demorar
  alguns minutos na primeira vez).
- `npm run build:win` monta o instalador.

## Onde o instalador aparece

Quando terminar, o arquivo estará em:

```
dist\HM-Modulos-Setup-0.2.0.exe
```

(o número é a versão, definida em `package.json`).

Esse é o **instalador**. Ao abrir, ele instala o programa "HM Módulos" no
Windows, cria o atalho, e a partir daí o mecânico abre pelo menu Iniciar como
qualquer programa — **sem precisar instalar mais nada** (Node, navegador, etc.
já vão embutidos no `.exe`).

## Detalhes úteis

- **Ícone do programa:** por enquanto usa o ícone padrão. Para um ícone próprio,
  coloque um arquivo `build/icon.ico` (256×256) — o empacotador usa
  automaticamente. (Opcional; não impede de gerar.)
- **Assinatura digital:** sem assinatura, o Windows mostra um aviso azul
  ("Windows protegeu o computador") na primeira execução — é só clicar em "Mais
  informações → Executar assim mesmo". Para tirar esse aviso é preciso um
  certificado de code signing (pago); fica para quando o produto for distribuído
  de verdade.
- **Onde os dados ficam:** o registro de operações e a configuração ficam na
  pasta de dados do app do Windows (`%APPDATA%\HM Modulos`), na máquina da
  oficina. Não vão para lugar nenhum na internet.
- **O original é sagrado:** ao corrigir/gravar, o programa abre a janela "Salvar
  como" e grava um **arquivo novo** — nunca por cima do que você abriu.

## Por que confiar que vai funcionar

O programa é o **mesmo código** já testado aqui (68 testes automáticos no motor,
e o app validado contra dumps reais). O `.exe` só embrulha esse código num
pacote que o Windows sabe instalar. Não há reescrita: o que funciona no teste é
o que roda no programa final.
