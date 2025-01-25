const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, Browsers, DisconnectReason } = require('@whiskeysockets/baileys');
const { join } = require('path');
const { writeFile, mkdir } = require('fs/promises');
const QRCode = require('qrcode');
const fs = require('fs').promises;

const app = express();
const port = process.env.PORT || 10000;

// Настраиваем CORS для разрешенных доменов
app.use(cors({
    origin: ['https://2wix.ru', 'http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 200
}));

// Добавляем обработку OPTIONS запросов
app.options('*', cors());

// Парсинг JSON с увеличенным лимитом
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Хранилище для активных соединений
const connections = new Map();

// Хранилище для QR кодов
const qrCodes = new Map();

// Создаем папку для сессий, если её нет
async function ensureSessionsDirectory() {
    const sessionsDir = join(__dirname, 'sessions');
    try {
        await fs.access(sessionsDir);
        console.log('Sessions directory exists:', sessionsDir);
    } catch {
        console.log('Creating sessions directory:', sessionsDir);
        await fs.mkdir(sessionsDir, { recursive: true });
        // Создаем пустой файл creds.json для инициализации
        const credsPath = join(sessionsDir, 'creds.json');
        await fs.writeFile(credsPath, '{}', 'utf8');
        console.log('Created empty creds.json');
    }
    return sessionsDir;
}

// Функция для создания соединения с WhatsApp
async function connectToWhatsApp(sessionId) {
    console.log('Starting WhatsApp connection for session:', sessionId);
    
    try {
        // Убеждаемся, что папка sessions существует
        const sessionsDir = await ensureSessionsDirectory();
        console.log('Sessions directory:', sessionsDir);
        
        // Создаем папку для конкретной сессии
        const sessionDir = join(sessionsDir, sessionId);
        await fs.mkdir(sessionDir, { recursive: true });
        console.log('Created session directory:', sessionDir);
        
        // Копируем пустой creds.json если его нет
        const credsPath = join(sessionDir, 'creds.json');
        try {
            await fs.access(credsPath);
            console.log('Creds file exists:', credsPath);
        } catch {
            console.log('Creating new creds file:', credsPath);
            const defaultCreds = {
                noiseKey: null,
                signedIdentityKey: null,
                signedPreKey: null,
                registrationId: null,
                advSecretKey: null,
                processedHistoryMessages: [],
                nextPreKeyId: 0,
                firstUnuploadedPreKeyId: 0,
                accountSyncCounter: 0,
                accountSettings: {
                    unarchiveChats: false
                },
                deviceId: null,
                phoneId: null,
                identityId: null,
                registered: false,
                backupToken: null,
                registration: null,
                pairingCode: null
            };
            await fs.writeFile(credsPath, JSON.stringify(defaultCreds, null, 2), 'utf8');
        }
        
        // Инициализируем состояние авторизации
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        console.log('Auth state initialized:', state);

        // Создаем сокет с правильными параметрами
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: Browsers.ubuntu('Chrome'),
            defaultQueryTimeoutMs: undefined,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            emitOwnEvents: true,
            markOnlineOnConnect: true,
            qrTimeout: 40000
        });

        console.log('WhatsApp socket created');

        // Обработчик событий соединения
        sock.ev.on('connection.update', async (update) => {
            console.log('Connection update:', update);
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                // Генерируем QR код
                try {
                    console.log('Generating QR code for session:', sessionId);
                    const qrCode = await QRCode.toDataURL(qr);
                    qrCodes.set(sessionId, qrCode);
                    console.log('QR code generated and stored for session:', sessionId);
                    console.log('Current QR codes:', Array.from(qrCodes.keys()));
                } catch (err) {
                    console.error('QR Code generation error:', err);
                }
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('Connection closed, should reconnect:', shouldReconnect);
                if (shouldReconnect) {
                    connectToWhatsApp(sessionId);
                }
            }

            if (connection === 'open') {
                console.log('Connection opened successfully');
                // Сохраняем состояние сразу после успешного подключения
                await saveCreds();
            }
        });

        // Сохраняем учетные данные при обновлении
        sock.ev.on('creds.update', async () => {
            console.log('Credentials updated');
            await saveCreds();
        });

        // Сохраняем соединение
        connections.set(sessionId, sock);
        console.log('Connection stored in connections map');
        
        return sock;
    } catch (error) {
        console.error('Error in connectToWhatsApp:', error);
        throw error;
    }
}

// Middleware для логирования запросов
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    next();
});

// Endpoint для проверки статуса сервера
app.get('/', (req, res) => {
    res.json({ status: 'WhatsApp Server is running' });
});

// Endpoint для создания новой сессии
app.post('/session/create', async (req, res) => {
    console.log('Received request to create new session');
    try {
        const sessionId = Date.now().toString();
        console.log('Generated session ID:', sessionId);
        
        await connectToWhatsApp(sessionId);
        console.log('WhatsApp connection established');
        
        res.json({ sessionId });
    } catch (error) {
        console.error('Session creation error:', error);
        res.status(500).json({ 
            error: 'Failed to create session',
            details: error.message,
            stack: error.stack
        });
    }
});

// Endpoint для получения QR кода
app.get('/session/:sessionId/qr', (req, res) => {
    const { sessionId } = req.params;
    console.log('Received request for QR code, session:', sessionId);
    console.log('Available QR codes:', Array.from(qrCodes.keys()));
    console.log('Available connections:', Array.from(connections.keys()));
    
    const qrCode = qrCodes.get(sessionId);
    
    if (qrCode) {
        console.log('QR code found for session:', sessionId);
        res.json({ qr: qrCode });
    } else {
        console.log('QR code not found for session:', sessionId);
        res.status(404).json({ 
            error: 'QR code not found',
            sessionId,
            availableSessions: Array.from(qrCodes.keys())
        });
    }
});

// Endpoint для отправки сообщения
app.post('/session/:sessionId/send', async (req, res) => {
    const { sessionId } = req.params;
    const { number, message } = req.body;
    
    console.log('Received request to send message:', {
        sessionId,
        number,
        message
    });
    
    try {
        const sock = connections.get(sessionId);
        if (!sock) {
            console.log('Session not found:', sessionId);
            return res.status(404).json({ error: 'Session not found' });
        }

        // Форматируем номер телефона
        const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        
        // Отправляем сообщение
        console.log('Sending message to:', jid);
        await sock.sendMessage(jid, { text: message });
        
        console.log('Message sent successfully');
        res.json({ success: true });
    } catch (error) {
        console.error('Message sending error:', error);
        res.status(500).json({ 
            error: 'Failed to send message',
            details: error.message,
            stack: error.stack
        });
    }
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        details: err.message,
        stack: err.stack
    });
});

// Запускаем сервер
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
