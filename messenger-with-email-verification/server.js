// =============================================
// МЕССЕНДЖЕР - БЭКЕНД (server.js)
// С блокировками, локальными именами, удалением
// =============================================

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
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

// Блокировки
db.exec(`
  CREATE TABLE IF NOT EXISTS blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blocker_username TEXT NOT NULL,
    blocked_username TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(blocker_username, blocked_username)
  )
`);

// Локальные имена (только для того кто установил)
db.exec(`
  CREATE TABLE IF NOT EXISTS contact_names (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_username TEXT NOT NULL,
    contact_username TEXT NOT NULL,
    custom_name TEXT NOT NULL,
    UNIQUE(owner_username, contact_username)
  )
`);

// Скрытые чаты (для "удалить чат")
db.exec(`
  CREATE TABLE IF NOT EXISTS hidden_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_username TEXT NOT NULL,
    hidden_username TEXT NOT NULL,
    hidden_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_username, hidden_username)
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_username);
  CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_username);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
  CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_username);
  CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_username);
  CREATE INDEX IF NOT EXISTS idx_contacts ON contact_names(owner_username);
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

// Проверка токена → username
function getUsernameByToken(token) {
  if (!token) return null;
  const session = db.prepare('SELECT username FROM sessions WHERE token = ?').get(token);
  return session?.username || null;
}

// =============================================
// РЕГИСТРАЦИЯ / ВХОД / ТОКЕНЫ
// =============================================
app.post('/register', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'Ник и пароль обязательны' });

    const trimmed = username.trim();
    const err = validateUsername(trimmed);
    if (err) return res.status(400).json({ success: false, error: err });
    if (password.length < 6) return res.status(400).json({ success: false, error: 'Пароль минимум 6 символов' });

    const exists = db.prepare('SELECT * FROM users WHERE username = ?').get(trimmed);
    if (exists) return res.status(409).json({ success: false, error: 'Такой ник уже занят' });

    const result = db.prepare('INSERT INTO users (username, password, display_name) VALUES (?, ?, ?)')
      .run(trimmed, password, trimmed);
    const user = db.prepare('SELECT id, username, display_name, bio, avatar FROM users WHERE id = ?')
      .get(result.lastInsertRowid);
    
    const token = generateToken();
    db.prepare('INSERT INTO sessions (token, username) VALUES (?, ?)').run(token, trimmed);
    
    console.log(`✅ Новый пользователь: ${trimmed}`);
    res.json({ success: true, user, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

app.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'Ник и пароль обязательны' });

    const trimmed = username.trim();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(trimmed);
    if (!user || user.password !== password) {
      return res.status(401).json({ success: false, error: 'Неверный ник или пароль' });
    }

    const token = generateToken();
    db.prepare('INSERT INTO sessions (token, username) VALUES (?, ?)').run(token, trimmed);

    console.log(`🔑 Вход: ${trimmed}`);
    res.json({ 
      success: true,
      user: { id: user.id, username: user.username, display_name: user.display_name, bio: user.bio, avatar: user.avatar },
      token
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

app.post('/api/auth/check', (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, error: 'Токен обязателен' });

    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!session) return res.status(401).json({ success: false, error: 'Токен недействителен' });

    const user = db.prepare('SELECT id, username, display_name, bio, avatar FROM users WHERE username = ?').get(session.username);
    if (!user) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return res.status(401).json({ success: false, error: 'Пользователь не найден' });
    }

    db.prepare('UPDATE sessions SET last_used = CURRENT_TIMESTAMP WHERE token = ?').run(token);
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  try {
    const { token } = req.body;
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ПРОФИЛЬ
// =============================================
app.post('/api/profile/update', (req, res) => {
  try {
    const { token, display_name, bio, username: newUsername } = req.body;
    const currentUsername = getUsernameByToken(token);
    if (!currentUsername) return res.status(401).json({ success: false, error: 'Токен недействителен' });

    const trimmedDN = (display_name || '').trim().substring(0, 50);
    const trimmedBio = (bio || '').trim().substring(0, 200);
    
    if (newUsername && newUsername.trim() !== currentUsername) {
      const trimmedNew = newUsername.trim();
      const err = validateUsername(trimmedNew);
      if (err) return res.status(400).json({ success: false, error: err });

      const exists = db.prepare('SELECT * FROM users WHERE username = ?').get(trimmedNew);
      if (exists) return res.status(409).json({ success: false, error: 'Такой ник уже занят' });

      db.prepare('UPDATE users SET username = ?, display_name = ?, bio = ? WHERE username = ?')
        .run(trimmedNew, trimmedDN, trimmedBio, currentUsername);
      db.prepare('UPDATE sessions SET username = ? WHERE username = ?').run(trimmedNew, currentUsername);
      db.prepare('UPDATE messages SET sender_username = ? WHERE sender_username = ?').run(trimmedNew, currentUsername);
      db.prepare('UPDATE messages SET receiver_username = ? WHERE receiver_username = ?').run(trimmedNew, currentUsername);
      db.prepare('UPDATE blocks SET blocker_username = ? WHERE blocker_username = ?').run(trimmedNew, currentUsername);
      db.prepare('UPDATE blocks SET blocked_username = ? WHERE blocked_username = ?').run(trimmedNew, currentUsername);
      db.prepare('UPDATE contact_names SET owner_username = ? WHERE owner_username = ?').run(trimmedNew, currentUsername);
      db.prepare('UPDATE contact_names SET contact_username = ? WHERE contact_username = ?').run(trimmedNew, currentUsername);
      db.prepare('UPDATE hidden_chats SET owner_username = ? WHERE owner_username = ?').run(trimmedNew, currentUsername);
      db.prepare('UPDATE hidden_chats SET hidden_username = ? WHERE hidden_username = ?').run(trimmedNew, currentUsername);
    } else {
      db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE username = ?')
        .run(trimmedDN, trimmedBio, currentUsername);
    }

    const finalUsername = newUsername?.trim() || currentUsername;
    const user = db.prepare('SELECT id, username, display_name, bio, avatar FROM users WHERE username = ?').get(finalUsername);
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

app.post('/api/profile/avatar', (req, res) => {
  try {
    const { token, avatar } = req.body;
    const currentUsername = getUsernameByToken(token);
    if (!currentUsername) return res.status(401).json({ success: false, error: 'Токен недействителен' });

    if (avatar && avatar.length > 800000) {
      return res.status(400).json({ success: false, error: 'Аватар слишком большой' });
    }

    db.prepare('UPDATE users SET avatar = ? WHERE username = ?').run(avatar || '', currentUsername);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

app.post('/api/profile/password', (req, res) => {
  try {
    const { token, oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ success: false, error: 'Все поля обязательны' });
    if (newPassword.length < 6) return res.status(400).json({ success: false, error: 'Новый пароль минимум 6 символов' });

    const currentUsername = getUsernameByToken(token);
    if (!currentUsername) return res.status(401).json({ success: false, error: 'Токен недействителен' });

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(currentUsername);
    if (user.password !== oldPassword) return res.status(401).json({ success: false, error: 'Неверный текущий пароль' });

    db.prepare('UPDATE users SET password = ? WHERE username = ?').run(newPassword, currentUsername);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// БЛОКИРОВКИ
// =============================================
app.post('/api/block', (req, res) => {
  try {
    const { token, username } = req.body;
    const currentUsername = getUsernameByToken(token);
    if (!currentUsername) return res.status(401).json({ success: false, error: 'Токен недействителен' });
    if (!username || username === currentUsername) return res.status(400).json({ success: false, error: 'Некорректный пользователь' });

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

    db.prepare('INSERT OR IGNORE INTO blocks (blocker_username, blocked_username) VALUES (?, ?)')
      .run(currentUsername, username);

    console.log(`🚫 ${currentUsername} заблокировал ${username}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

app.post('/api/unblock', (req, res) => {
  try {
    const { token, username } = req.body;
    const currentUsername = getUsernameByToken(token);
    if (!currentUsername) return res.status(401).json({ success: false, error: 'Токен недействителен' });

    db.prepare('DELETE FROM blocks WHERE blocker_username = ? AND blocked_username = ?')
      .run(currentUsername, username);

    console.log(`✅ ${currentUsername} разблокировал ${username}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

app.get('/api/blocked', (req, res) => {
  try {
    const { token } = req.query;
    const currentUsername = getUsernameByToken(token);
    if (!currentUsername) return res.status(401).json({ success: false, error: 'Токен недействителен' });

    const blocked = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.avatar, b.created_at
      FROM blocks b
      JOIN users u ON u.username = b.blocked_username
      WHERE b.blocker_username = ?
      ORDER BY b.created_at DESC
    `).all(currentUsername);

    res.json({ success: true, blocked });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ЛОКАЛЬНЫЕ ИМЕНА
// =============================================
app.post('/api/contact-name', (req, res) => {
  try {
    const { token, contactUsername, customName } = req.body;
    const currentUsername = getUsernameByToken(token);
    if (!currentUsername) return res.status(401).json({ success: false, error: 'Токен недействителен' });
    if (!contactUsername) return res.status(400).json({ success: false, error: 'contactUsername обязателен' });

    const trimmed = (customName || '').trim().substring(0, 50);
    
    if (!trimmed) {
      db.prepare('DELETE FROM contact_names WHERE owner_username = ? AND contact_username = ?')
        .run(currentUsername, contactUsername);
    } else {
      db.prepare(`
        INSERT INTO contact_names (owner_username, contact_username, custom_name) VALUES (?, ?, ?)
        ON CONFLICT(owner_username, contact_username) DO UPDATE SET custom_name = excluded.custom_name
      `).run(currentUsername, contactUsername, trimmed);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// УДАЛЕНИЕ ЧАТА (у обоих + скрыть у себя)
// =============================================
app.post('/api/chat/delete', (req, res) => {
  try {
    const { token, username: partnerUsername } = req.body;
    const currentUsername = getUsernameByToken(token);
    if (!currentUsername) return res.status(401).json({ success: false, error: 'Токен недействителен' });

    // Удаляем все сообщения между ними (Вариант Б — у обоих)
    db.prepare(`
      DELETE FROM messages 
      WHERE (sender_username = ? AND receiver_username = ?) 
         OR (sender_username = ? AND receiver_username = ?)
    `).run(currentUsername, partnerUsername, partnerUsername, currentUsername);

    console.log(`🗑️ ${currentUsername} удалил чат с ${partnerUsername}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ОЧИСТКА ИСТОРИИ (у обоих)
// =============================================
app.post('/api/chat/clear', (req, res) => {
  try {
    const { token, username: partnerUsername } = req.body;
    const currentUsername = getUsernameByToken(token);
    if (!currentUsername) return res.status(401).json({ success: false, error: 'Токен недействителен' });

    db.prepare(`
      DELETE FROM messages 
      WHERE (sender_username = ? AND receiver_username = ?) 
         OR (sender_username = ? AND receiver_username = ?)
    `).run(currentUsername, partnerUsername, partnerUsername, currentUsername);

    console.log(`🧹 ${currentUsername} очистил историю с ${partnerUsername}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// СПИСОК ЧАТОВ (с учётом блокировок и локальных имён)
// =============================================
app.get('/api/users', (req, res) => {
  try {
    const currentUsername = req.query.currentUsername;
    if (!currentUsername) return res.status(400).json({ success: false, error: 'currentUsername обязателен' });

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

    // Получаем локальные имена
    const contactNames = {};
    db.prepare('SELECT contact_username, custom_name FROM contact_names WHERE owner_username = ?')
      .all(currentUsername)
      .forEach(row => { contactNames[row.contact_username] = row.custom_name; });

    // Заблокированные (кого я заблокировал)
    const iBlocked = new Set(
      db.prepare('SELECT blocked_username FROM blocks WHERE blocker_username = ?')
        .all(currentUsername).map(r => r.blocked_username)
    );

    const usersWithData = users.map(user => {
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
        custom_name: contactNames[user.username] || null,
        is_blocked: iBlocked.has(user.username),
        unreadCount: unreadCount?.count || 0,
        lastMessage: lastMessage?.message_text || null,
        lastMessageTime: lastMessage?.timestamp || null,
        lastMessageIsMine: lastMessage?.sender_username === currentUsername
      };
    });

    usersWithData.sort((a, b) => {
      if (a.lastMessageTime && b.lastMessageTime) {
        return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
      }
      if (a.lastMessageTime) return -1;
      if (b.lastMessageTime) return 1;
      return 0;
    });

    res.json({ success: true, users: usersWithData });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

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
// ПОИСК (не показывает тех кто тебя заблокировал)
// =============================================
app.get('/api/search', (req, res) => {
  try {
    const { query, currentUsername } = req.query;
    if (!currentUsername) return res.status(400).json({ success: false, error: 'currentUsername обязателен' });

    if (!query || query.trim().length < 1) return res.json({ success: true, users: [] });

    const searchTerm = `%${query.trim()}%`;
    const users = db.prepare(`
      SELECT id, username, display_name, avatar, bio FROM users 
      WHERE (username LIKE ? OR display_name LIKE ?) AND username != ?
      ORDER BY username ASC
      LIMIT 20
    `).all(searchTerm, searchTerm, currentUsername);

    // Локальные имена
    const contactNames = {};
    db.prepare('SELECT contact_username, custom_name FROM contact_names WHERE owner_username = ?')
      .all(currentUsername)
      .forEach(row => { contactNames[row.contact_username] = row.custom_name; });

    const iBlocked = new Set(
      db.prepare('SELECT blocked_username FROM blocks WHERE blocker_username = ?')
        .all(currentUsername).map(r => r.blocked_username)
    );

    const enriched = users.map(u => ({
      ...u,
      custom_name: contactNames[u.username] || null,
      is_blocked: iBlocked.has(u.username)
    }));

    res.json({ success: true, users: enriched });
  } catch (error) {
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
    if (!receiver) return res.status(404).json({ success: false, error: 'Получатель не найден' });

    // Проверка: заблокировал ли меня получатель
    const iAmBlocked = db.prepare(
      'SELECT 1 FROM blocks WHERE blocker_username = ? AND blocked_username = ?'
    ).get(receiverUsername, senderUsername);
    
    if (iAmBlocked) {
      return res.status(403).json({ success: false, error: 'Пользователь заблокировал вас' });
    }

    // Проверка: я заблокировал получателя
    const iBlockedThem = db.prepare(
      'SELECT 1 FROM blocks WHERE blocker_username = ? AND blocked_username = ?'
    ).get(senderUsername, receiverUsername);
    
    if (iBlockedThem) {
      return res.status(403).json({ success: false, error: 'Вы заблокировали этого пользователя. Разблокируйте, чтобы писать.' });
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
    const { username, currentUsername } = req.query;
    if (!username) return res.status(400).json({ success: false, error: 'username обязателен' });

    const user = db.prepare('SELECT id, username, display_name, bio, avatar FROM users WHERE username = ?').get(username);
    if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

    // Если известен currentUsername — добавим локальное имя и статус блокировки
    if (currentUsername) {
      const cn = db.prepare('SELECT custom_name FROM contact_names WHERE owner_username = ? AND contact_username = ?')
        .get(currentUsername, username);
      user.custom_name = cn?.custom_name || null;

      const blocked = db.prepare('SELECT 1 FROM blocks WHERE blocker_username = ? AND blocked_username = ?')
        .get(currentUsername, username);
      user.is_blocked = !!blocked;
    }

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
  console.log('  👤 Профили | 🖼️ Аватарки | 👥 Мульти-акки');
  console.log('  🚫 Блокировки | ✏️ Локальные имена');
  console.log('═══════════════════════════════════════════════');
  console.log(`  📍 Порт: ${PORT}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
});
