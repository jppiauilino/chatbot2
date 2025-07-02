const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// --- VARIÁVEIS GLOBAIS ---
let mainWindow;
let client; 
let isBotBusy = false;

// --- FUNÇÕES DE CAMINHO ---
const getAssetPath = (assetName) => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', assetName);
  }
  return path.join(__dirname, assetName);
};

// --- LÓGICA DO CHATBOT INTEGRADA ---

function loadMessages() {
    try {
        const messagesPath = getAssetPath('mensagens.json');
        return JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
    } catch (error) {
        console.error(`ERRO FATAL AO LER MENSAGENS: ${error.message}`);
        dialog.showErrorBox('Erro Crítico', `Não foi possível ler o arquivo 'mensagens.json'.\n\nDetalhes: ${error.message}`);
        app.quit();
        return null;
    }
}

const userStates = {}; 

function buildMenu(menuData) {
    let menuText = menuData.titulo ? `${menuData.titulo}\n\n` : '';
    for (const key in menuData.menu) {
        menuText += `${key} - ${menuData.menu[key].texto}\n`;
    }
    return menuText.trim();
}

async function handleAction(chat, action, contact) {
    const mensagens = loadMessages();
    if (!mensagens) return;

    const actionData = mensagens[action];
    userStates[chat.id._serialized] = action;

    if (!actionData) {
        console.error(`Ação '${action}' não encontrada.`);
        return;
    }

    if (actionData.mensagens) {
        for (const message of actionData.mensagens) {
            if (message.delay) await new Promise(res => setTimeout(res, message.delay));
            await chat.sendStateTyping();
            if (message.tipo === 'texto') {
                let content = Array.isArray(message.conteudo) ? message.conteudo.join('\n') : message.conteudo;
                content = content.replace('{NOME_CLIENTE}', contact.pushname || 'amigo(a)');
                await client.sendMessage(chat.id._serialized, content);
            } else if (message.tipo === 'menu') {
                await client.sendMessage(chat.id._serialized, buildMenu(message.conteudo));
            }
        }
    } else {
        const name = contact.pushname || 'amigo(a)';
        const menuText = buildMenu(actionData).replace('{NOME_CLIENTE}', name.split(" ")[0]);
        await chat.sendStateTyping();
        await new Promise(res => setTimeout(res, 1000));
        await client.sendMessage(chat.id._serialized, menuText);
    }
}

// --- CONTROLO DO BOT ---

function startBotProcess() {
    if (isBotBusy) {
        return;
    }
    isBotBusy = true;
    
    mainWindow.webContents.send('bot-status', 'starting');
    mainWindow.webContents.send('clear-output');
    mainWindow.webContents.send('bot-output', 'Iniciando o cliente do WhatsApp...\n');

    try {
        const { Client, LocalAuth } = require('whatsapp-web.js');

        client = new Client({
            authStrategy: new LocalAuth({ dataPath: path.join(app.getPath('userData'), 'wwebjs_auth') }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'], // Argumentos essenciais para compatibilidade
            }
        });

        client.on('qr', qr => {
            mainWindow.webContents.send('qr-code', qr);
        });

        client.on('authenticated', () => {
            mainWindow.webContents.send('bot-authenticated');
        });
        
        client.on('ready', () => {
            isBotBusy = false;
            mainWindow.webContents.send('bot-status', 'iniciado');
            mainWindow.webContents.send('bot-output', 'Bot conectado e pronto para uso.\n');
        });

        client.on('disconnected', (reason) => {
            isBotBusy = false;
            mainWindow.webContents.send('bot-status', 'parado');
            mainWindow.webContents.send('bot-output', `\n>> O bot foi desconectado. Razão: ${reason} <<\n`);
            client = null;
        });

        client.on('auth_failure', (msg) => {
            isBotBusy = false;
            mainWindow.webContents.send('bot-status', 'parado');
            mainWindow.webContents.send('bot-output', `\n>> FALHA NA AUTENTICAÇÃO: ${msg} <<\n`);
            client = null;
        });
        
        client.on('message_create', async msg => {
            if (msg.fromMe || !msg.from.endsWith('@c.us')) return;

            const chat = await msg.getChat();
            const contact = await msg.getContact();
            const userInput = msg.body.trim().toLowerCase();
            const currentState = userStates[msg.from] || 'boasVindas';
            const mensagens = loadMessages();

            let currentActionData = mensagens[currentState];
            let nextAction = null;

            if (currentActionData?.menu?.[userInput]) {
                nextAction = currentActionData.menu[userInput].acao;
            } else if (['menu', 'oi', 'olá', 'ola'].some(k => userInput.includes(k))) {
                nextAction = 'boasVindas';
            }

            if (nextAction) {
                await handleAction(chat, nextAction, contact);
                const finalActionData = mensagens[nextAction];
                if (finalActionData && !finalActionData.menu) {
                    userStates[msg.from] = 'boasVindas';
                }
            }
        });

        mainWindow.webContents.send('bot-output', 'Inicializando conexão com o WhatsApp...\n');
        client.initialize().catch(err => {
            console.error('Erro no client.initialize:', err);
            mainWindow.webContents.send('bot-output', `\n>> ERRO GRAVE AO INICIAR: ${err.message} <<\n`);
            mainWindow.webContents.send('bot-status', 'parado');
            isBotBusy = false;
            client = null;
        });

    } catch (err) {
        console.error('Erro crítico no bloco startBotProcess:', err);
        mainWindow.webContents.send('bot-output', `\n>> ERRO CRÍTICO NO ARRANQUE: ${err.message} <<\n`);
        mainWindow.webContents.send('bot-status', 'parado');
        isBotBusy = false;
    }
}

async function stopBotProcess() {
    if (isBotBusy || !client) return Promise.resolve();
    isBotBusy = true;
    mainWindow.webContents.send('bot-status', 'stopping');
    mainWindow.webContents.send('bot-output', 'Desconectando o bot...\n');
    try {
        await client.destroy();
    } catch(e) {
        console.error("Erro ao destruir cliente", e)
    } finally {
        isBotBusy = false;
        client = null;
        mainWindow.webContents.send('bot-status', 'parado');
        mainWindow.webContents.send('bot-output', 'Bot parado com sucesso.\n');
    }
}


// --- LÓGICA DO ELECTRON (Janela, Menu, IPC) ---

function createMenu() {
    const menuTemplate = [
        {
            label: 'Arquivo',
            submenu: [
                {
                    label: 'Recarregar Painel',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => mainWindow.reload()
                },
                { type: 'separator' },
                {
                    label: 'Sair',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => app.quit()
                }
            ]
        },
        {
            label: 'Ajuda',
            submenu: [
                {
                    label: 'Verificar Atualizações',
                    click: () => autoUpdater.checkForUpdatesAndNotify()
                },
                {
                    label: 'Ferramentas do Desenvolvedor',
                    accelerator: 'CmdOrCtrl+Shift+I',
                    click: () => mainWindow.webContents.openDevTools()
                }
            ]
        }
    ];
    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: path.join(__dirname, 'build/icon.png')
    });
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.once('ready-to-show', () => {
        autoUpdater.checkForUpdatesAndNotify();
    });
}

app.whenReady().then(() => {
    createWindow();
    createMenu();
});

app.on('window-all-closed', async () => {
    await stopBotProcess();
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('start-bot', startBotProcess);
ipcMain.on('stop-bot', stopBotProcess);

ipcMain.handle('get-messages', async () => {
    return fs.readFileSync(getAssetPath('mensagens.json'), 'utf8');
});

ipcMain.handle('save-messages', async (event, newMessagesString) => {
    try {
        JSON.parse(newMessagesString);
    } catch (error) {
        return { success: false, message: `Erro de sintaxe no JSON: ${error.message}` };
    }

    mainWindow.webContents.send('clear-output');
    mainWindow.webContents.send('bot-output', 'Mensagens salvas! Reiniciando o bot...\n');
    
    await stopBotProcess();
    
    fs.writeFileSync(getAssetPath('mensagens.json'), newMessagesString, 'utf8');
    
    startBotProcess();
    
    return { success: true };
});

ipcMain.on('exit-app', () => app.quit());