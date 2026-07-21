// =============================================
// МЕССЕНДЖЕР - БЭКЕНД (server.js)
// Node.js + Express + SQLite
// Простая регистрация без подтверждений + поиск
// =============================================

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_username);
  CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_username);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
`);

console.log('✅ База данных SQLite готова');

// =============================================
// ЭНДПОИНТ: РЕГИСТРАЦИЯ
// =============================================
app.post('/register', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Ник и пароль обязательны' });
    }

    const trimmedUsername = username.trim();

    if (trimmedUsername.length < 3) {
      return res.status(400).json({ success: false, error: 'Ник должен быть минимум 3 символа' });
    }

    if (trimmedUsername.length > 20) {
      return res.status(400).json({ success: false, error: 'Ник не длиннее 20 символов' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Пароль должен быть минимум 6 символов' });
    }

    if (!/^[a-zA-Z0-9_а-яА-ЯёЁ]+$/.test(trimmedUsername)) {
      return res.status(400).json({ success: false, error: 'Ник может содержать только буквы, цифры и _' });
    }

    const existingUser = db.prepare('SELECT * FROM users WHERE username = ?').get(trimmedUsername);
    
    if (existingUser) {
      return res.status(409).json({ success: false, error: 'Пользователь с таким ником уже существует' });
    }

    const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(trimmedUsername, password);
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(result.lastInsertRowid);
    
    console.log(`✅ Новый пользователь: ${trimmedUsername}`);
    
    res.json({ 
      success: true, 
      message: 'Аккаунт создан!',
      user
    });

  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера: ' + error.message });
  }
});

// =============================================
// ЭНДПОИНТ: ВХОД
// =============================================
app.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Ник и пароль обязательны' });
    }

    const trimmedUsername = username.trim();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(trimmedUsername);

    if (!user) {
      return res.status(401).json({ success: false, error: 'Неверный ник или пароль' });
    }

    if (user.password !== password) {
      return res.status(401).json({ success: false, error: 'Неверный ник или пароль' });
    }

    console.log(`🔑 Вход: ${trimmedUsername}`);
    
    res.json({ 
      success: true, 
      message: 'Вход выполнен!',
      user: { id: user.id, username: user.username }
    });

  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ЭНДПОИНТ: ПОЛУЧИТЬ СПИСОК ЧАТОВ (только те с кем общался)
// =============================================
app.get('/api/users', (req, res) => {
  try {
    const currentUsername = req.query.currentUsername;
    if (!currentUsername) {
      return res.status(400).json({ success: false, error: 'currentUsername обязателен' });
    }

    // Только пользователи с которыми есть переписка
    const users = db.prepare(`
      SELECT DISTINCT u.id, u.username, u.created_at
      FROM users u
      WHERE u.username != ?
        AND u.username IN (
          SELECT sender_username FROM messages WHERE receiver_username = ?
          UNION
          SELECT receiver_username FROM messages WHERE sender_username = ?
        )
      ORDER BY u.username ASC
    `).all(currentUsername, currentUsername, currentUsername);

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
    console.error(error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ЭНДПОИНТ: ПОИСК ПОЛЬЗОВАТЕЛЕЙ ПО НИКУ
// =============================================
app.get('/api/search', (req, res) => {
  try {
    const { query, currentUsername } = req.query;
    if (!currentUsername) {
      return res.status(400).json({ success: false, error: 'currentUsername обязателен' });
    }

    if (!query || query.trim().length < 1) {
      return res.json({ success: true, users: [] });
    }

    const searchTerm = `%${query.trim()}%`;
    const users = db.prepare(`
      SELECT id, username FROM users 
      WHERE username LIKE ? AND username != ?
      ORDER BY username ASC
      LIMIT 20
    `).all(searchTerm, currentUsername);

    res.json({ success: true, users });
  } catch (error) {
    console.error(error);
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

    const receiver = db.prepare('SELECT * FROM users WHERE username = ?').get(receiverUsername);
    if (!receiver) {
      return res.status(404).json({ success: false, error: 'Получатель не найден' });
    }

    const result = db.prepare(`
      INSERT INTO messages (sender_username, receiver_username, message_text) VALUES (?, ?, ?)
    `).run(senderUsername, receiverUsername, messageText.trim());

    const newMessage = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
    console.log(`💬 ${senderUsername} → ${receiverUsername}: ${messageText.substring(0, 50)}`);

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

    const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
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
  console.log('  🔍 Поиск пользователей: ВКЛЮЧЕН');
  console.log('═══════════════════════════════════════════════');
  console.log(`  📍 Порт: ${PORT}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
});
