// =============================================
// МЕССЕНДЖЕР - БЭКЕНД (server.js)
// Node.js + Express + SQLite + Telegram Bot 2FA
// =============================================

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// НАСТРОЙКИ TELEGRAM БОТА
// =============================================
const TELEGRAM_BOT_TOKEN = '8507416374:AAEVgD03o56_2L_4HvKDsJp8E_rCR4EP82Y';
const TELEGRAM_BOT_USERNAME = 'RegisterBotCamca_bot';

// =============================================
// MIDDLEWARE
// =============================================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =============================================
// БАЗА ДАННЫХ (SQLite)
// =============================================
const db = new Database('messenger.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_verified INTEGER DEFAULT 0,
    telegram_chat_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_username TEXT NOT NULL,
    receiver_username TEXT NOT NULL,
    message_text TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_read INTEGER DEFAULT 0
  )
`);

// Сессии Telegram (для регистрации и входа)
db.exec(`
  CREATE TABLE IF NOT EXISTS telegram_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_token TEXT UNIQUE NOT NULL,
    session_type TEXT NOT NULL,
    username TEXT NOT NULL,
    telegram_chat_id TEXT,
    telegram_username TEXT,
    code TEXT,
    is_used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_username);
  CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_username);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
`);

console.log('✅ База данных SQLite готова');

// =============================================
// TELEGRAM BOT
// =============================================
let lastUpdateId = 0;

async function sendTelegramMessage(chatId, text) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      })
    });
    return await response.json();
  } catch (error) {
    console.error('Ошибка отправки Telegram:', error.message);
  }
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateSessionToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Слушаем сообщения от бота
async function pollTelegramUpdates() {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`
    );
    const data = await response.json();

    if (data.ok && data.result.length > 0) {
      for (const update of data.result) {
        lastUpdateId = update.update_id;
        
        if (update.message) {
          const chatId = update.message.chat.id.toString();
          const text = update.message.text || '';
          const tgUsername = update.message.from.username || update.message.from.first_name || 'User';

          console.log(`📨 Telegram от ${tgUsername} (${chatId}): ${text}`);

          if (text.startsWith('/start')) {
            const parts = text.split(' ');
            const sessionToken = parts[1];

            if (sessionToken) {
              const session = db.prepare('SELECT * FROM telegram_sessions WHERE session_token = ?').get(sessionToken);
              
              if (session && !session.is_used) {
                const code = generateCode();
                db.prepare('UPDATE telegram_sessions SET telegram_chat_id = ?, telegram_username = ?, code = ? WHERE session_token = ?')
                  .run(chatId, tgUsername, code, sessionToken);

                const actionText = session.session_type === 'register' 
                  ? 'регистрации нового аккаунта' 
                  : 'входа в аккаунт';

                await sendTelegramMessage(chatId, 
                  `👋 Привет, <b>${tgUsername}</b>!\n\n` +
                  `Ты запросил код для <b>${actionText}</b>\n` +
                  `Логин: <code>${session.username}</code>\n\n` +
                  `Твой код:\n\n` +
                  `<code>${code}</code>\n\n` +
                  `⚠️ Никому не сообщай этот код!`
                );
              } else {
                await sendTelegramMessage(chatId, 
                  `⚠️ Ссылка недействительна или уже использована.\n\n` +
                  `Вернись на сайт и начни заново.`
                );
              }
            } else {
              await sendTelegramMessage(chatId, 
                `👋 Привет!\n\n` +
                `Я бот для регистрации и входа в мессенджер.\n\n` +
                `Чтобы получить код — начни регистрацию или вход на сайте и перейди по ссылке.`
              );
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Ошибка polling Telegram:', error.message);
  }
  
  setTimeout(pollTelegramUpdates, 1000);
}

pollTelegramUpdates();
console.log('🤖 Telegram бот запущен: @' + TELEGRAM_BOT_USERNAME);

// =============================================
// ЭНДПОИНТ: НАЧАТЬ РЕГИСТРАЦИЮ
// =============================================
app.post('/register/start', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Ник и пароль обязательны' });
    }

    if (username.length < 3) {
      return res.status(400).json({ success: false, error: 'Ник должен быть минимум 3 символа' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Пароль должен быть минимум 6 символов' });
    }

    // Проверка на допустимые символы в нике
    if (!/^[a-zA-Z0-9_а-яА-Я]+$/.test(username)) {
      return res.status(400).json({ success: false, error: 'Ник может содержать только буквы, цифры и _' });
    }

    const existingUser = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    
    if (existingUser && existingUser.is_verified) {
      return res.status(409).json({ success: false, error: 'Пользователь с таким ником уже существует' });
    }

    const sessionToken = generateSessionToken();
    db.prepare('INSERT INTO telegram_sessions (session_token, session_type, username) VALUES (?, ?, ?)')
      .run(sessionToken, 'register', username);

    if (existingUser && !existingUser.is_verified) {
      db.prepare('UPDATE users SET password = ? WHERE username = ?').run(password, username);
    } else {
      db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, password);
    }

    const telegramLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${sessionToken}`;
    
    res.json({ 
      success: true, 
      telegramLink,
      sessionToken,
      username,
      message: 'Перейди в Telegram, чтобы получить код'
    });

  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера: ' + error.message });
  }
});

// =============================================
// ЭНДПОИНТ: НАЧАТЬ ВХОД
// =============================================
app.post('/login/start', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Ник и пароль обязательны' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
      return res.status(401).json({ success: false, error: 'Неверный ник или пароль' });
    }

    if (user.password !== password) {
      return res.status(401).json({ success: false, error: 'Неверный ник или пароль' });
    }

    if (!user.is_verified) {
      return res.status(403).json({ success: false, error: 'Аккаунт не подтверждён. Сначала завершите регистрацию.' });
    }

    // Создаём сессию для входа
    const sessionToken = generateSessionToken();
    db.prepare('INSERT INTO telegram_sessions (session_token, session_type, username) VALUES (?, ?, ?)')
      .run(sessionToken, 'login', username);

    // Если у пользователя уже привязан Telegram — сразу отправляем код
    if (user.telegram_chat_id) {
      const code = generateCode();
      db.prepare('UPDATE telegram_sessions SET telegram_chat_id = ?, code = ? WHERE session_token = ?')
        .run(user.telegram_chat_id, code, sessionToken);

      sendTelegramMessage(user.telegram_chat_id, 
        `🔐 <b>Вход в аккаунт</b>\n\n` +
        `Логин: <code>${username}</code>\n\n` +
        `Код для входа:\n\n` +
        `<code>${code}</code>\n\n` +
        `⚠️ Если это не ты — смени пароль!`
      ).catch(() => {});

      res.json({ 
        success: true, 
        sessionToken,
        username,
        alreadyLinked: true,
        message: 'Код отправлен в Telegram'
      });
    } else {
      // Если Telegram не привязан — даём ссылку
      const telegramLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${sessionToken}`;
      res.json({ 
        success: true, 
        telegramLink,
        sessionToken,
        username,
        alreadyLinked: false,
        message: 'Перейди в Telegram, чтобы получить код'
      });
    }

  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера: ' + error.message });
  }
});

// =============================================
// ЭНДПОИНТ: ПРОВЕРИТЬ ПРИШЁЛ ЛИ КОД
// =============================================
app.get('/session/check/:sessionToken', (req, res) => {
  try {
    const { sessionToken } = req.params;
    const session = db.prepare('SELECT * FROM telegram_sessions WHERE session_token = ?').get(sessionToken);
    
    if (!session) {
      return res.status(404).json({ success: false, error: 'Сессия не найдена' });
    }

    if (session.code) {
      res.json({ 
        success: true, 
        ready: true,
        telegramUsername: session.telegram_username
      });
    } else {
      res.json({ success: true, ready: false });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ЭНДПОИНТ: ПОДТВЕРДИТЬ КОД (регистрация или вход)
// =============================================
app.post('/verify', (req, res) => {
  try {
    const { sessionToken, code } = req.body;

    if (!sessionToken || !code) {
      return res.status(400).json({ success: false, error: 'Сессия и код обязательны' });
    }

    const session = db.prepare('SELECT * FROM telegram_sessions WHERE session_token = ?').get(sessionToken);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Сессия не найдена' });
    }

    if (session.is_used) {
      return res.status(400).json({ success: false, error: 'Сессия уже использована' });
    }

    if (!session.code) {
      return res.status(400).json({ success: false, error: 'Сначала получи код в Telegram' });
    }

    if (session.code !== code) {
      return res.status(400).json({ success: false, error: 'Неверный код' });
    }

    // Помечаем сессию как использованную
    db.prepare('UPDATE telegram_sessions SET is_used = 1 WHERE session_token = ?').run(sessionToken);

    if (session.session_type === 'register') {
      // Регистрация: активируем аккаунт и привязываем Telegram
      db.prepare('UPDATE users SET is_verified = 1, telegram_chat_id = ? WHERE username = ?')
        .run(session.telegram_chat_id, session.username);
      
      console.log(`✅ Аккаунт ${session.username} зарегистрирован через Telegram`);
      
      const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(session.username);
      res.json({ 
        success: true, 
        type: 'register',
        message: 'Аккаунт создан!',
        user
      });
    } else {
      // Вход
      const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(session.username);
      console.log(`🔑 Пользователь ${session.username} вошёл через Telegram`);
      res.json({ 
        success: true, 
        type: 'login',
        message: 'Вход выполнен!',
        user
      });
    }

  } catch (error) {
    console.error('Ошибка верификации:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ЭНДПОИНТ: ПОЛУЧИТЬ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ
// =============================================
app.get('/api/users', (req, res) => {
  try {
    const currentUsername = req.query.currentUsername;
    if (!currentUsername) {
      return res.status(400).json({ success: false, error: 'currentUsername обязателен' });
    }

    const users = db.prepare(`
      SELECT id, username, created_at 
      FROM users 
      WHERE is_verified = 1 AND username != ?
      ORDER BY username ASC
    `).all(currentUsername);

    const usersWithUnread = users.map(user => {
      const unreadCount = db.prepare(`
        SELECT COUNT(*) as count FROM messages 
        WHERE sender_username = ? AND receiver_username = ? AND is_read = 0
      `).get(user.username, currentUsername);

      const lastMessage = db.prepare(`
        SELECT message_text, timestamp, sender_username FROM messages 
        WHERE (sender_username = ? AND receiver_username = ?) OR (sender_username = ? AND receiver_username = ?)
        ORDER BY timestamp DESC LIMIT 1
      `).get(user.username, currentUsername, currentUsername, user.username);

      return {
        ...user,
        unreadCount: unreadCount?.count || 0,
        lastMessage: lastMessage?.message_text || null,
        lastMessageTime: lastMessage?.timestamp || null,
        lastMessageIsMine: lastMessage?.sender_username === currentUsername
      };
    });

    usersWithUnread.sort((a, b) => {
      if (a.lastMessageTime && b.lastMessageTime) {
        return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
      }
      if (a.lastMessageTime) return -1;
      if (b.lastMessageTime) return 1;
      return 0;
    });

    res.json({ success: true, users: usersWithUnread });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ЭНДПОИНТ: ПОЛУЧИТЬ СООБЩЕНИЯ
// =============================================
app.get('/api/messages', (req, res) => {
  try {
    const { with: partnerUsername, currentUsername } = req.query;
    if (!partnerUsername || !currentUsername) {
      return res.status(400).json({ success: false, error: 'with и currentUsername обязательны' });
    }

    const messages = db.prepare(`
      SELECT id, sender_username, receiver_username, message_text, timestamp FROM messages 
      WHERE (sender_username = ? AND receiver_username = ?) OR (sender_username = ? AND receiver_username = ?)
      ORDER BY timestamp ASC
    `).all(currentUsername, partnerUsername, partnerUsername, currentUsername);

    db.prepare(`
      UPDATE messages SET is_read = 1 
      WHERE sender_username = ? AND receiver_username = ? AND is_read = 0
    `).run(partnerUsername, currentUsername);

    res.json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ЭНДПОИНТ: ОТПРАВИТЬ СООБЩЕНИЕ
// =============================================
app.post('/api/messages', (req, res) => {
  try {
    const { senderUsername, receiverUsername, messageText } = req.body;
    if (!senderUsername || !receiverUsername || !messageText || !messageText.trim()) {
      return res.status(400).json({ success: false, error: 'Все поля обязательны' });
    }

    const receiver = db.prepare('SELECT * FROM users WHERE username = ? AND is_verified = 1').get(receiverUsername);
    if (!receiver) {
      return res.status(404).json({ success: false, error: 'Получатель не найден' });
    }

    const result = db.prepare(`
      INSERT INTO messages (sender_username, receiver_username, message_text) VALUES (?, ?, ?)
    `).run(senderUsername, receiverUsername, messageText.trim());

    const newMessage = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
    console.log(`💬 ${senderUsername} → ${receiverUsername}: ${messageText.substring(0, 50)}`);
    
    // Уведомление в Telegram получателю
    if (receiver.telegram_chat_id) {
      sendTelegramMessage(receiver.telegram_chat_id, 
        `💬 <b>Новое сообщение</b> от <b>${senderUsername}</b>:\n\n${messageText.trim()}`
      ).catch(() => {});
    }

    res.json({ success: true, message: newMessage });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ЭНДПОИНТ: ПОЛУЧИТЬ ИНФО О ПОЛЬЗОВАТЕЛЕ
// =============================================
app.get('/api/user', (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ success: false, error: 'username обязателен' });

    const user = db.prepare('SELECT id, username FROM users WHERE username = ? AND is_verified = 1').get(username);
    if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// СЛУЖЕБНЫЕ ЭНДПОИНТЫ
// =============================================
app.get('/', (req, res) => {
  res.redirect('/register.html');
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// =============================================
// ЗАПУСК СЕРВЕРА
// =============================================
app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  🚀 MESSENGER SERVER ЗАПУЩЕН');
  console.log('  🤖 Telegram Bot: @' + TELEGRAM_BOT_USERNAME);
  console.log('  🔐 Авторизация: 2FA через Telegram');
  console.log('═══════════════════════════════════════════════');
  console.log(`  📍 Порт: ${PORT}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
});
