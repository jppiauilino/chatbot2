const { ipcRenderer } = require('electron');
const qrcode = require('qrcode');

// Elementos da UI
const startStopBtn = document.getElementById('start-stop-btn');
const outputBox = document.getElementById('output-box');
const editBtn = document.getElementById('edit-btn');
const exitBtn = document.getElementById('exit-btn');
const mainView = document.getElementById('main-view');
const editorView = document.getElementById('editor-view');
const visualEditorContainer = document.getElementById('visual-editor');
const saveBtn = document.getElementById('save-btn');
const cancelBtn = document.getElementById('cancel-btn');
const qrcodeContainer = document.getElementById('qrcode-container');
const toastContainer = document.getElementById('toast-container');

// --- Funções Auxiliares ---

function showMainView() {
    editorView.classList.add('hidden');
    mainView.classList.remove('hidden');
}

function showEditorView() {
    mainView.classList.add('hidden');
    editorView.classList.remove('hidden');
}

function setMainButtonsEnabled(enabled) {
    startStopBtn.disabled = !enabled;
    editBtn.disabled = !enabled;
    exitBtn.disabled = !enabled;
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 5000);
}

// --- Editor Visual ---

function createFormGroup(key, value) {
    const group = document.createElement('div');
    group.className = 'form-group';
    
    const label = document.createElement('label');
    label.textContent = key.replace(/_/g, ' '); // Formata o nome para exibição
    label.htmlFor = `editor-${key}`;
    group.appendChild(label);

    const content = Array.isArray(value) ? value.join('\n') : value;
    const textarea = document.createElement('textarea');
    textarea.id = `editor-${key}`;
    textarea.dataset.key = key;
    textarea.value = content;
    group.appendChild(textarea);
    
    return group;
}

function populateVisualEditor(messages) {
    visualEditorContainer.innerHTML = ''; // Limpa o editor
    const data = JSON.parse(messages);

    // Itera sobre as chaves principais do JSON de mensagens
    for (const key in data) {
        if (key === 'boasVindas') {
            const group = createFormGroup('Mensagem de Boas Vindas', data[key].titulo);
            visualEditorContainer.appendChild(group);
        } else if (key.startsWith('submenu_')) {
            const submenu = data[key];
            if (submenu.mensagens) { // Para menus com múltiplas mensagens como "nossosPlanos"
                const content = submenu.mensagens
                    .filter(m => m.tipo === 'texto')
                    .map(m => m.conteudo.join('\n'))
                    .join('\n\n---\n\n'); // Separador visual
                const group = createFormGroup(key, content);
                visualEditorContainer.appendChild(group);
            }
        } else if (key.startsWith('resposta_')) {
            const response = data[key].mensagens[0].conteudo;
            const group = createFormGroup(key, response);
            visualEditorContainer.appendChild(group);
        }
    }
}

function reconstructMessagesFromEditor() {
    const newMessages = {};
    const textareas = visualEditorContainer.querySelectorAll('textarea');
    
    // Recria a estrutura base do JSON (simplificado)
    const baseStructure = JSON.parse(localStorage.getItem('baseMessagesStructure'));
    if (!baseStructure) {
        showToast('Erro: Estrutura base de mensagens não encontrada. Não foi possível salvar.', 'error');
        return null;
    }

    textareas.forEach(textarea => {
        const key = textarea.dataset.key;
        const value = textarea.value;

        if (key === 'Mensagem de Boas Vindas') {
            baseStructure.boasVindas.titulo = value;
        } else if (key.startsWith('submenu_')) {
             const messagesArray = value.split('\n\n---\n\n').map(block => ({
                tipo: 'texto',
                conteudo: block.split('\n')
            }));
            // Mantém a última parte do menu (o "voltar")
            const originalSubmenu = baseStructure[key].mensagens;
            const menuPart = originalSubmenu.find(m => m.tipo === 'menu');
            baseStructure[key].mensagens = [...messagesArray, menuPart];

        } else if (key.startsWith('resposta_')) {
            baseStructure[key].mensagens[0].conteudo = value;
        }
    });

    return JSON.stringify(baseStructure, null, 2);
}


// --- Event Listeners dos Botões ---

startStopBtn.addEventListener('click', () => {
    const isBotRunning = startStopBtn.dataset.status === 'iniciado';
    if (isBotRunning) ipcRenderer.send('stop-bot');
    else ipcRenderer.send('start-bot');
});

editBtn.addEventListener('click', async () => {
    try {
        const messages = await ipcRenderer.invoke('get-messages');
        // Salva a estrutura original para reconstrução
        localStorage.setItem('baseMessagesStructure', messages);
        populateVisualEditor(messages);
        showEditorView();
    } catch (error) {
        showToast(`Erro ao carregar mensagens: ${error.message}`, 'error');
    }
});

saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';

    const newMessagesString = reconstructMessagesFromEditor();
    if (!newMessagesString) {
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        saveBtn.textContent = 'Salvar e Reiniciar';
        return;
    }

    const result = await ipcRenderer.invoke('save-messages', newMessagesString);
    
    if (result.success) {
        showMainView();
        showToast('Mensagens salvas com sucesso!');
    } else {
        showToast(`ERRO AO SALVAR: ${result.message}`, 'error');
    }

    saveBtn.disabled = false;
    cancelBtn.disabled = false;
    saveBtn.textContent = 'Salvar e Reiniciar';
});

cancelBtn.addEventListener('click', () => {
    showMainView();
});

exitBtn.addEventListener('click', () => {
    ipcRenderer.send('exit-app');
});

// --- Handlers de Eventos IPC ---

ipcRenderer.on('clear-output', () => {
    outputBox.textContent = '';
    qrcodeContainer.innerHTML = '';
    qrcodeContainer.style.display = 'none';
});

ipcRenderer.on('bot-output', (event, data) => {
    if (outputBox.textContent.startsWith('O bot está inativo.')) outputBox.textContent = '';
    outputBox.textContent += data;
    outputBox.scrollTop = outputBox.scrollHeight;
});

ipcRenderer.on('qr-code', (event, qrText) => {
    outputBox.textContent = 'QR Code recebido. Por favor, escaneie com seu celular.';
    qrcode.toDataURL(qrText, { width: 250 }, (err, url) => {
        if (err) {
            outputBox.textContent = 'Erro ao gerar o QR Code.';
            return;
        }
        qrcodeContainer.innerHTML = `<img src="${url}" alt="QR Code">`;
        qrcodeContainer.style.display = 'block';
    });
});

ipcRenderer.on('bot-authenticated', () => {
    qrcodeContainer.innerHTML = '';
    qrcodeContainer.style.display = 'none';
    outputBox.textContent = 'Autenticado com sucesso! Carregando...';
});

ipcRenderer.on('bot-status', (event, status) => {
    startStopBtn.dataset.status = status;
    switch (status) {
        case 'iniciado':
            startStopBtn.textContent = '⏹️ Parar Bot';
            startStopBtn.style.backgroundColor = 'var(--success-green)';
            setMainButtonsEnabled(true);
            break;
        case 'parado':
            startStopBtn.textContent = '▶️ Iniciar Bot';
            startStopBtn.style.backgroundColor = 'var(--primary-blue)';
            if (!outputBox.textContent.includes('O bot foi parado')) {
                outputBox.textContent = 'O bot está inativo. Clique em \'Iniciar\' para começar.';
            }
            setMainButtonsEnabled(true);
            break;
        case 'starting':
        case 'stopping':
        case 'restarting':
            startStopBtn.textContent = status.charAt(0).toUpperCase() + status.slice(1) + '...';
            startStopBtn.style.backgroundColor = '#6c757d';
            setMainButtonsEnabled(false);
            break;
    }
});