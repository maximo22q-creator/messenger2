// =============================================
// МЕССЕНДЖЕР - БЭКЕНД (server.js)
// Node.js + Express + SQLite + Telegram Bot
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
    username TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_verified INTEGER DEFAULT 0,
    verification_code TEXT,
    telegram_chat_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_email TEXT NOT NULL,
    receiver_email TEXT NOT NULL,
    message_text TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_read INTEGER DEFAULT 0
  )
`);

// Таблица для связи Telegram → регистрация
db.exec(`
  CREATE TABLE IF NOT EXISTS telegram_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_token TEXT UNIQUE NOT NULL,
    telegram_chat_id TEXT,
    telegram_username TEXT,
    code TEXT,
    is_used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_email);
  CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_email);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
`);

console.log('✅ База данных SQLite готова');

// =============================================
// TELEGRAM BOT (Long Polling)
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
          const username = update.message.from.username || update.message.from.first_name || 'User';

          console.log(`📨 Telegram от ${username} (${chatId}): ${text}`);

          // Обработка /start с параметром (токен сессии)
          if (text.startsWith('/start')) {
            const parts = text.split(' ');
            const sessionToken = parts[1];

            if (sessionToken) {
              // Проверяем есть ли такая сессия
              const session = db.prepare('SELECT * FROM telegram_sessions WHERE session_token = ?').get(sessionToken);
              
              if (session && !session.is_used) {
                // Генерируем код и сохраняем в сессию
                const code = generateCode();
                db.prepare('UPDATE telegram_sessions SET telegram_chat_id = ?, telegram_username = ?, code = ? WHERE session_token = ?')
                  .run(chatId, username, code, sessionToken);

                await sendTelegramMessage(chatId, 
                  `👋 Привет, <b>${username}</b>!\n\n` +
                  `Твой код для подтверждения регистрации:\n\n` +
                  `<code>${code}</code>\n\n` +
                  `Введи этот код на сайте, чтобы завершить регистрацию.`
                );
              } else {
                await sendTelegramMessage(chatId, 
                  `⚠️ Ссылка недействительна или уже использована.\n\n` +
                  `Вернись на сайт и начни регистрацию заново.`
                );
              }
            } else {
              await sendTelegramMessage(chatId, 
                `👋 Привет!\n\n` +
                `Я бот для регистрации в мессенджере.\n\n` +
                `Чтобы получить код подтверждения, начни регистрацию на сайте и перейди по ссылке которая появится.`
              );
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Ошибка polling Telegram:', error.message);
  }
  
  // Повторяем через 1 секунду
  setTimeout(pollTelegramUpdates, 1000);
}

// Запускаем polling
pollTelegramUpdates();
console.log('🤖 Telegram бот запущен');

// =============================================
// ЭНДПОИНТ: НАЧАТЬ РЕГИСТРАЦИЮ (создать сессию)
// =============================================
app.post('/register/start', (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: 'Все поля обязательны' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Пароль должен быть минимум 6 символов' });
    }

    const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    
    if (existingUser && existingUser.is_verified) {
      return res.status(409).json({ success: false, error: 'Пользователь с таким email уже существует' });
    }

    // Создаём сессию Telegram
    const sessionToken = generateSessionToken();
    db.prepare('INSERT INTO telegram_sessions (session_token) VALUES (?)').run(sessionToken);

    // Сохраняем/обновляем пользователя (пока без подтверждения)
    if (existingUser && !existingUser.is_verified) {
      db.prepare('UPDATE users SET username = ?, password = ?, verification_code = ? WHERE email = ?')
        .run(username, password, sessionToken, email);
    } else {
      db.prepare('INSERT INTO users (username, email, password, verification_code) VALUES (?, ?, ?, ?)')
        .run(username, email, password, sessionToken);
    }

    // Возвращаем ссылку на Telegram
    const telegramLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${sessionToken}`;
    
    res.json({ 
      success: true, 
      telegramLink,
      sessionToken,
      email,
      message: 'Перейди в Telegram, чтобы получить код'
    });

  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера: ' + error.message });
  }
});

// =============================================
// ЭНДПОИНТ: ПРОВЕРИТЬ, ПРИШЁЛ ЛИ КОД
// (фронтенд опрашивает раз в секунду)
// =============================================
app.get('/register/check/:sessionToken', (req, res) => {
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
// ЭНДПОИНТ: ВЕРИФИКАЦИЯ КОДА
// =============================================
app.post('/verify', (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'Email и код обязательны' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    if (user.is_verified) {
      return res.status(400).json({ success: false, error: 'Аккаунт уже подтверждён' });
    }

    // Ищем сессию по session_token (сохранён в verification_code)
    const session = db.prepare('SELECT * FROM telegram_sessions WHERE session_token = ?').get(user.verification_code);

    if (!session || !session.code) {
      return res.status(400).json({ success: false, error: 'Сначала получи код в Telegram' });
    }

    if (session.code !== code) {
      return res.status(400).json({ success: false, error: 'Неверный код' });
    }

    // Помечаем сессию как использованную и активируем пользователя
    db.prepare('UPDATE telegram_sessions SET is_used = 1 WHERE session_token = ?').run(user.verification_code);
    db.prepare('UPDATE users SET is_verified = 1, verification_code = NULL, telegram_chat_id = ? WHERE email = ?')
      .run(session.telegram_chat_id, email);
    
    console.log(`✅ Аккаунт ${email} подтверждён через Telegram`);
    res.json({ success: true, message: 'Аккаунт успешно подтверждён!' });

  } catch (error) {
    console.error('Ошибка верификации:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ЭНДПОИНТ: ВХОД
// =============================================
app.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email и пароль обязательны' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      return res.status(401).json({ success: false, error: 'Неверный email или пароль' });
    }

    if (user.password !== password) {
      return res.status(401).json({ success: false, error: 'Неверный email или пароль' });
    }

    if (!user.is_verified) {
      return res.status(403).json({ success: false, error: 'Аккаунт не подтверждён' });
    }

    console.log(`🔑 Пользователь ${email} вошёл в систему`);
    res.json({ 
      success: true, 
      message: 'Вход выполнен успешно!',
      user: { id: user.id, username: user.username, email: user.email }
    });

  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ЭНДПОИНТ: ПОЛУЧИТЬ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ
// =============================================
app.get('/api/users', (req, res) => {
  try {
    const currentEmail = req.query.currentEmail;
    if (!currentEmail) {
      return res.status(400).json({ success: false, error: 'currentEmail обязателен' });
    }

    const users = db.prepare(`
      SELECT id, username, email, created_at 
      FROM users 
      WHERE is_verified = 1 AND email != ?
      ORDER BY username ASC
    `).all(currentEmail);

    const usersWithUnread = users.map(user => {
      const unreadCount = db.prepare(`
        SELECT COUNT(*) as count FROM messages 
        WHERE sender_email = ? AND receiver_email = ? AND is_read = 0
      `).get(user.email, currentEmail);

      const lastMessage = db.prepare(`
        SELECT message_text, timestamp, sender_email FROM messages 
        WHERE (sender_email = ? AND receiver_email = ?) OR (sender_email = ? AND receiver_email = ?)
        ORDER BY timestamp DESC LIMIT 1
      `).get(user.email, currentEmail, currentEmail, user.email);

      return {
        ...user,
        unreadCount: unreadCount?.count || 0,
        lastMessage: lastMessage?.message_text || null,
        lastMessageTime: lastMessage?.timestamp || null,
        lastMessageIsMine: lastMessage?.sender_email === currentEmail
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
    const { with: partnerEmail, currentEmail } = req.query;
    if (!partnerEmail || !currentEmail) {
      return res.status(400).json({ success: false, error: 'with и currentEmail обязательны' });
    }

    const messages = db.prepare(`
      SELECT id, sender_email, receiver_email, message_text, timestamp FROM messages 
      WHERE (sender_email = ? AND receiver_email = ?) OR (sender_email = ? AND receiver_email = ?)
      ORDER BY timestamp ASC
    `).all(currentEmail, partnerEmail, partnerEmail, currentEmail);

    db.prepare(`
      UPDATE messages SET is_read = 1 
      WHERE sender_email = ? AND receiver_email = ? AND is_read = 0
    `).run(partnerEmail, currentEmail);

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
    const { senderEmail, receiverEmail, messageText } = req.body;
    if (!senderEmail || !receiverEmail || !messageText || !messageText.trim()) {
      return res.status(400).json({ success: false, error: 'Все поля обязательны' });
    }

    const receiver = db.prepare('SELECT * FROM users WHERE email = ? AND is_verified = 1').get(receiverEmail);
    if (!receiver) {
      return res.status(404).json({ success: false, error: 'Получатель не найден' });
    }

    const result = db.prepare(`
      INSERT INTO messages (sender_email, receiver_email, message_text) VALUES (?, ?, ?)
    `).run(senderEmail, receiverEmail, messageText.trim());

    const newMessage = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
    console.log(`💬 ${senderEmail} → ${receiverEmail}: ${messageText.substring(0, 50)}`);
    
    // Уведомление получателю в Telegram (если у него привязан)
    if (receiver.telegram_chat_id) {
      sendTelegramMessage(receiver.telegram_chat_id, 
        `💬 <b>Новое сообщение</b> от ${senderEmail}:\n\n${messageText.trim()}`
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
    const { email } = req.query;
    if (!email) return res.status(400).json({ success: false, error: 'email обязателен' });

    const user = db.prepare('SELECT id, username, email FROM users WHERE email = ? AND is_verified = 1').get(email);
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
  console.log('═══════════════════════════════════════════════');
  console.log(`  📍 Порт: ${PORT}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
});
