// =============================================
// МЕССЕНДЖЕР - БЭКЕНД (server.js)
// Node.js + Express + SQLite + Brevo API
// =============================================

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// НАСТРОЙКИ BREVO
// =============================================
const BREVO_API_KEY = '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';
const SENDER_EMAIL = 'skambombtg@gmail.com';
const SENDER_NAME = 'BombAnimation';

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

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_email);
  CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_email);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
`);

console.log('✅ База данных SQLite готова');

// =============================================
// ФУНКЦИИ
// =============================================
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Отправка письма через Brevo API (HTTP запрос, не SMTP)
async function sendVerificationEmail(email, code) {
  const emailData = {
    sender: {
      name: SENDER_NAME,
      email: SENDER_EMAIL
    },
    to: [{ email: email }],
    subject: `Ваш код подтверждения: ${code}`,
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px; background: #1e293b; border-radius: 16px;">
        <h2 style="color: #818cf8; text-align: center;">📬 Подтверждение регистрации</h2>
        <p style="color: #94a3b8; text-align: center;">Ваш 6-значный код:</p>
        <div style="background: #334155; border-radius: 12px; padding: 20px; text-align: center; font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #fff; margin: 20px 0;">
          ${code}
        </div>
        <p style="color: #64748b; text-align: center; font-size: 12px;">Код действителен 10 минут</p>
      </div>
    `,
    textContent: `Ваш код подтверждения: ${code}`
  };

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify(emailData)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Brevo API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  console.log(`📧 Письмо отправлено на ${email} | Код: ${code} | messageId: ${result.messageId}`);
  return result;
}

// =============================================
// ЭНДПОИНТ: РЕГИСТРАЦИЯ
// =============================================
app.post('/register', async (req, res) => {
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

    const code = generateCode();

    if (existingUser && !existingUser.is_verified) {
      db.prepare('UPDATE users SET username = ?, password = ?, verification_code = ? WHERE email = ?')
        .run(username, password, code, email);
    } else {
      db.prepare('INSERT INTO users (username, email, password, verification_code) VALUES (?, ?, ?, ?)')
        .run(username, email, password, code);
    }

    await sendVerificationEmail(email, code);
    res.json({ success: true, message: 'Код отправлен на вашу почту', email });

  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера: ' + error.message });
  }
});

// =============================================
// ЭНДПОИНТ: ВЕРИФИКАЦИЯ
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

    if (user.verification_code !== code) {
      return res.status(400).json({ success: false, error: 'Неверный код подтверждения' });
    }

    db.prepare('UPDATE users SET is_verified = 1, verification_code = NULL WHERE email = ?').run(email);
    console.log(`✅ Аккаунт ${email} подтверждён`);
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
      return res.status(403).json({ success: false, error: 'Почта не подтверждена. Проверьте email.' });
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
        SELECT COUNT(*) as count 
        FROM messages 
        WHERE sender_email = ? AND receiver_email = ? AND is_read = 0
      `).get(user.email, currentEmail);

      const lastMessage = db.prepare(`
        SELECT message_text, timestamp, sender_email
        FROM messages 
        WHERE (sender_email = ? AND receiver_email = ?) 
           OR (sender_email = ? AND receiver_email = ?)
        ORDER BY timestamp DESC
        LIMIT 1
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
    console.error('Ошибка получения пользователей:', error);
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
      SELECT id, sender_email, receiver_email, message_text, timestamp
      FROM messages 
      WHERE (sender_email = ? AND receiver_email = ?) 
         OR (sender_email = ? AND receiver_email = ?)
      ORDER BY timestamp ASC
    `).all(currentEmail, partnerEmail, partnerEmail, currentEmail);

    db.prepare(`
      UPDATE messages 
      SET is_read = 1 
      WHERE sender_email = ? AND receiver_email = ? AND is_read = 0
    `).run(partnerEmail, currentEmail);

    res.json({ success: true, messages });

  } catch (error) {
    console.error('Ошибка получения сообщений:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ЭНДПОИНТ: ОТПРАВИТЬ СООБЩЕНИЕ
// =============================================
app.post('/api/messages', (req, res) => {
  try {
    const { senderEmail, receiverEmail, messageText } = req.body;

    if (!senderEmail || !receiverEmail || !messageText) {
      return res.status(400).json({ success: false, error: 'Все поля обязательны' });
    }

    if (!messageText.trim()) {
      return res.status(400).json({ success: false, error: 'Сообщение не может быть пустым' });
    }

    const receiver = db.prepare('SELECT * FROM users WHERE email = ? AND is_verified = 1').get(receiverEmail);
    if (!receiver) {
      return res.status(404).json({ success: false, error: 'Получатель не найден' });
    }

    const result = db.prepare(`
      INSERT INTO messages (sender_email, receiver_email, message_text) 
      VALUES (?, ?, ?)
    `).run(senderEmail, receiverEmail, messageText.trim());

    const newMessage = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);

    console.log(`💬 ${senderEmail} → ${receiverEmail}: ${messageText.substring(0, 50)}...`);
    
    res.json({ success: true, message: newMessage });

  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// =============================================
// ЭНДПОИНТ: ПОЛУЧИТЬ ИНФОРМАЦИЮ О ПОЛЬЗОВАТЕЛЕ
// =============================================
app.get('/api/user', (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ success: false, error: 'email обязателен' });
    }

    const user = db.prepare('SELECT id, username, email FROM users WHERE email = ? AND is_verified = 1').get(email);
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

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
  console.log('  🚀 MESSENGER SERVER ЗАПУЩЕН (Brevo API)');
  console.log('═══════════════════════════════════════════════');
  console.log(`  📍 Порт: ${PORT}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
});
