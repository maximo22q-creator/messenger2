// =============================================
// МЕССЕНДЖЕР - БЭКЕНД (server.js)
// Node.js + Express + SQLite
// С мульти-аккаунтами и профилями
// =============================================

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' })); // для аватарок
app.use(express.static(path.join(__dirname, 'public')));

const db = new Database('messenger.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Добавляем колонки если их нет (для существующих БД)
try { db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT ''`); } catch(e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`); } catch(e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''`); } catch(e) {}

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
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    username TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_username);
  CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_username);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
`);

console.log('✅ База данных SQLite готова');

function generateToken() {
  return Math.random().toString(36).substring(2) + 
         Math.random().toString(36).substring(2) +
         Date.now().toString(36);
}

function validateUsername(username) {
  if (!username || username.length < 3) return 'Ник должен быть минимум 3 символа';
  if (username.length > 20) return 'Ник не длиннее 20 символов';
  if (!/^[a-zA-Z0-9_а-яА-ЯёЁ]+$/.test(username)) return 'Ник может содержать только буквы, цифры и _';
  return null;
}

// =============================================
// РЕГИСТРАЦИЯ
// =============================================
app.post('/register', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Ник и пароль обязательны' });
    }

    const trimmedUsername = username.trim();
    const validationError = validateUsername(trimmedUsername);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Пароль должен быть минимум 6 символов' });
    }

    const existingUser = db.prepare('SELECT * FROM users WHERE username = ?').get(trimmedUsername);
    if (existingUser) {
      return res.status(409).json({ success: false, error: 'Пользователь с таким ником уже существует' });
    }

    const result = db.prepare('INSERT INTO users (username, password, display_name) VALUES (?, ?, ?)')
      .run(trimmedUsername, password, trimmedUsername);
    const user = db.prepare('SELECT id, username, display_name, bio, avatar FROM users WHERE id = ?')
      .get(result.lastInsertRowid);
    
    const token = generateToken();
    db.prepare('INSERT INTO sessions (token, username) VALUES (?, ?)').run(token, trimmedUsername);
    
    console.log(`✅ Новый пользователь: ${trimmedUsername}`);
    
    res.json({ success: true, user, token });

  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера: ' + error.message });
  }
});

// =============================================
// ВХОД
// =============================================
app.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Ник и пароль обязательны' });
    }

    const trimmedUsername = username.trim();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(trimmedUsername);

    if (!user || user.password !== password) {
      return res.status(401).json({ success: false, error: 'Неверный ник или пароль' });
    }

    const token = generateToken();
    db.prepare('INSERT INTO sessions (token, username) VALUES (?, ?)').run(token, trimmedUsername);

    console.log(`🔑 Вход: ${trimmedUsername}`);
    
    res.json({ 
      success: true,
      user: { 
        id: user.id, 
        username: user.username,
        display_name: user.display_name,
        bio: user.bio,
        avatar: user.avatar
      },
      token
    });

  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ПРОВЕРКА ТОКЕНА
// =============================================
app.post('/api/auth/check', (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Токен обязателен' });
    }

    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Токен недействителен' });
    }

    const user = db.prepare('SELECT id, username, display_name, bio, avatar FROM users WHERE username = ?')
      .get(session.username);
    if (!user) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return res.status(401).json({ success: false, error: 'Пользователь не найден' });
    }

    db.prepare('UPDATE sessions SET last_used = CURRENT_TIMESTAMP WHERE token = ?').run(token);

    res.json({ success: true, user });
  } catch (error) {
    console.error('Ошибка проверки токена:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ВЫХОД
// =============================================
app.post('/api/auth/logout', (req, res) => {
  try {
    const { token } = req.body;
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ОБНОВЛЕНИЕ ПРОФИЛЯ
// =============================================
app.post('/api/profile/update', (req, res) => {
  try {
    const { token, display_name, bio, username: newUsername } = req.body;
    
    if (!token) {
      return res.status(400).json({ success: false, error: 'Токен обязателен' });
    }

    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Токен недействителен' });
    }

    // Проверки
    const trimmedDisplayName = (display_name || '').trim().substring(0, 50);
    const trimmedBio = (bio || '').trim().substring(0, 200);
    
    // Изменение юзернейма
    if (newUsername && newUsername.trim() !== session.username) {
      const trimmedNew = newUsername.trim();
      const validationError = validateUsername(trimmedNew);
      if (validationError) {
        return res.status(400).json({ success: false, error: validationError });
      }

      const exists = db.prepare('SELECT * FROM users WHERE username = ?').get(trimmedNew);
      if (exists) {
        return res.status(409).json({ success: false, error: 'Такой ник уже занят' });
      }

      // Обновляем везде
      db.prepare('UPDATE users SET username = ?, display_name = ?, bio = ? WHERE username = ?')
        .run(trimmedNew, trimmedDisplayName, trimmedBio, session.username);
      db.prepare('UPDATE sessions SET username = ? WHERE username = ?').run(trimmedNew, session.username);
      db.prepare('UPDATE messages SET sender_username = ? WHERE sender_username = ?').run(trimmedNew, session.username);
      db.prepare('UPDATE messages SET receiver_username = ? WHERE receiver_username = ?').run(trimmedNew, session.username);
    } else {
      db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE username = ?')
        .run(trimmedDisplayName, trimmedBio, session.username);
    }

    const finalUsername = newUsername?.trim() || session.username;
    const user = db.prepare('SELECT id, username, display_name, bio, avatar FROM users WHERE username = ?')
      .get(finalUsername);

    console.log(`✏️ Профиль обновлён: ${finalUsername}`);
    res.json({ success: true, user });

  } catch (error) {
    console.error('Ошибка обновления профиля:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера: ' + error.message });
  }
});

// =============================================
// ОБНОВЛЕНИЕ АВАТАРА
// =============================================
app.post('/api/profile/avatar', (req, res) => {
  try {
    const { token, avatar } = req.body;
    
    if (!token) {
      return res.status(400).json({ success: false, error: 'Токен обязателен' });
    }

    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Токен недействителен' });
    }

    // Проверка размера (base64 может быть до ~700 КБ для 500 КБ файла)
    if (avatar && avatar.length > 800000) {
      return res.status(400).json({ success: false, error: 'Аватар слишком большой (макс 500 КБ)' });
    }

    db.prepare('UPDATE users SET avatar = ? WHERE username = ?').run(avatar || '', session.username);

    console.log(`🖼️ Аватар обновлён: ${session.username}`);
    res.json({ success: true });

  } catch (error) {
    console.error('Ошибка обновления аватара:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// СМЕНА ПАРОЛЯ
// =============================================
app.post('/api/profile/password', (req, res) => {
  try {
    const { token, oldPassword, newPassword } = req.body;
    
    if (!token || !oldPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Все поля обязательны' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Новый пароль минимум 6 символов' });
    }

    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Токен недействителен' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(session.username);
    if (user.password !== oldPassword) {
      return res.status(401).json({ success: false, error: 'Неверный текущий пароль' });
    }

    db.prepare('UPDATE users SET password = ? WHERE username = ?').run(newPassword, session.username);

    console.log(`🔒 Пароль изменён: ${session.username}`);
    res.json({ success: true });

  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// СПИСОК ЧАТОВ
// =============================================
app.get('/api/users', (req, res) => {
  try {
    const currentUsername = req.query.currentUsername;
    if (!currentUsername) {
      return res.status(400).json({ success: false, error: 'currentUsername обязателен' });
    }

    const users = db.prepare(`
      SELECT DISTINCT u.id, u.username, u.display_name, u.avatar, u.bio, u.created_at
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
// НЕПРОЧИТАННЫЕ
// =============================================
app.get('/api/unread-count', (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ success: false, error: 'username обязателен' });

    const result = db.prepare(`
      SELECT COUNT(*) as count FROM messages 
      WHERE receiver_username = ? AND is_read = 0
    `).get(username);

    res.json({ success: true, count: result?.count || 0 });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ПОИСК
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
      SELECT id, username, display_name, avatar, bio FROM users 
      WHERE (username LIKE ? OR display_name LIKE ?) AND username != ?
      ORDER BY username ASC
      LIMIT 20
    `).all(searchTerm, searchTerm, currentUsername);

    res.json({ success: true, users });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// СООБЩЕНИЯ
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
// ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ
// =============================================
app.get('/api/user', (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ success: false, error: 'username обязателен' });

    const user = db.prepare('SELECT id, username, display_name, bio, avatar FROM users WHERE username = ?')
      .get(username);
    if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

app.get('/', (req, res) => {
  res.redirect('/login.html');
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  🚀 MESSENGER SERVER ЗАПУЩЕН');
  console.log('  👤 Профили: ВКЛ');
  console.log('  🖼️  Аватарки: ВКЛ');
  console.log('  👥 Мульти-аккаунты: ВКЛ');
  console.log('═══════════════════════════════════════════════');
  console.log(`  📍 Порт: ${PORT}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
});
