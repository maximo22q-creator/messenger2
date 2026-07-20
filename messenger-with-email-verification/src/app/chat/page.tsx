"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

interface User {
  id: number;
  name: string;
  email: string;
}

interface Message {
  id: number;
  senderId: number;
  receiverId: number;
  content: string;
  createdAt: string;
  senderName: string;
}

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check auth
  useEffect(() => {
    fetch("/api/me")
      .then((r) => {
        if (!r.ok) throw new Error("Not authenticated");
        return r.json();
      })
      .then((data) => {
        setMe(data.user);
        setLoading(false);
      })
      .catch(() => {
        router.push("/login");
      });
  }, [router]);

  // Load users
  useEffect(() => {
    if (!me) return;
    fetch("/api/users")
      .then((r) => r.json())
      .then((data) => setUsers(data.users || []));
  }, [me]);

  // Load messages for selected user
  const loadMessages = useCallback(() => {
    if (!selectedUser) return;
    fetch(`/api/messages?partnerId=${selectedUser.id}`)
      .then((r) => r.json())
      .then((data) => {
        setMessages(data.messages || []);
      });
  }, [selectedUser]);

  useEffect(() => {
    loadMessages();

    // Poll for new messages every 3 seconds
    if (pollRef.current) clearInterval(pollRef.current);
    if (selectedUser) {
      pollRef.current = setInterval(loadMessages, 3000);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedUser, loadMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim() || !selectedUser) return;

    const content = newMessage.trim();
    setNewMessage("");

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId: selectedUser.id, content }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, data.message]);
      }
    } catch {
      // ignore
    }
  }

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <svg className="animate-spin w-6 h-6" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Загрузка...
        </div>
      </div>
    );
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  function getInitials(name: string) {
    return name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  const avatarColors = [
    "from-violet-500 to-purple-600",
    "from-blue-500 to-cyan-600",
    "from-emerald-500 to-teal-600",
    "from-orange-500 to-red-600",
    "from-pink-500 to-rose-600",
    "from-amber-500 to-yellow-600",
  ];

  function getAvatarColor(id: number) {
    return avatarColors[id % avatarColors.length];
  }

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? "w-80" : "w-0"
        } transition-all duration-300 bg-slate-800/90 backdrop-blur-xl border-r border-slate-700/50 flex flex-col overflow-hidden shrink-0`}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-700/50">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
              💬 Messenger
            </h1>
            <button
              onClick={handleLogout}
              className="text-slate-400 hover:text-red-400 transition p-2 rounded-lg hover:bg-slate-700/50"
              title="Выйти"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>

          {/* Current user info */}
          <div className="flex items-center gap-3 bg-slate-900/40 rounded-xl p-3">
            <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${getAvatarColor(me?.id || 0)} flex items-center justify-center text-white font-bold text-sm shrink-0`}>
              {getInitials(me?.name || "?")}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{me?.name}</p>
              <p className="text-xs text-slate-400 truncate">{me?.email}</p>
            </div>
          </div>
        </div>

        {/* Users list */}
        <div className="flex-1 overflow-y-auto p-2">
          <p className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Пользователи ({users.length})
          </p>
          {users.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              <p>Нет других пользователей</p>
              <p className="text-xs mt-1">Пригласите друзей!</p>
            </div>
          ) : (
            users.map((u) => (
              <button
                key={u.id}
                onClick={() => {
                  setSelectedUser(u);
                  setMessages([]);
                }}
                className={`w-full flex items-center gap-3 p-3 rounded-xl transition ${
                  selectedUser?.id === u.id
                    ? "bg-indigo-600/20 border border-indigo-500/30"
                    : "hover:bg-slate-700/50"
                }`}
              >
                <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${getAvatarColor(u.id)} flex items-center justify-center text-white font-bold text-sm shrink-0`}>
                  {getInitials(u.name)}
                </div>
                <div className="text-left min-w-0">
                  <p className="text-sm font-medium text-white truncate">{u.name}</p>
                  <p className="text-xs text-slate-400 truncate">{u.email}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="h-16 bg-slate-800/60 backdrop-blur-xl border-b border-slate-700/50 flex items-center gap-3 px-4 shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-slate-400 hover:text-white transition p-2 rounded-lg hover:bg-slate-700/50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {selectedUser ? (
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${getAvatarColor(selectedUser.id)} flex items-center justify-center text-white font-bold text-xs shrink-0`}>
                {getInitials(selectedUser.name)}
              </div>
              <div>
                <p className="font-medium text-white">{selectedUser.name}</p>
                <p className="text-xs text-slate-400">{selectedUser.email}</p>
              </div>
            </div>
          ) : (
            <p className="text-slate-400">Выберите собеседника</p>
          )}
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!selectedUser ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-slate-800/60 mb-4">
                  <svg className="w-10 h-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <p className="text-slate-500 text-lg">Выберите собеседника</p>
                <p className="text-slate-600 text-sm mt-1">для начала общения</p>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <p className="text-slate-500">Нет сообщений</p>
                <p className="text-slate-600 text-sm mt-1">Начните разговор!</p>
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.senderId === me?.id;
              return (
                <div
                  key={msg.id}
                  className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${
                      isMe
                        ? "bg-gradient-to-br from-indigo-600 to-purple-600 text-white rounded-br-md"
                        : "bg-slate-700/70 text-slate-100 rounded-bl-md"
                    }`}
                  >
                    {!isMe && (
                      <p className="text-xs font-medium text-indigo-400 mb-1">
                        {msg.senderName}
                      </p>
                    )}
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                    <p
                      className={`text-[10px] mt-1 ${
                        isMe ? "text-indigo-200" : "text-slate-400"
                      }`}
                    >
                      {formatTime(msg.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message input */}
        {selectedUser && (
          <div className="p-4 border-t border-slate-700/50 bg-slate-800/40 backdrop-blur-xl">
            <form onSubmit={handleSend} className="flex gap-3">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Введите сообщение..."
                className="flex-1 px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              />
              <button
                type="submit"
                disabled={!newMessage.trim()}
                className="px-5 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium rounded-xl shadow-lg shadow-indigo-500/25 transition disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
