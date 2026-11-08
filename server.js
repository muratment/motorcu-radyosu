require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { AccessToken } = require('livekit-server-sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });
const PORT = Number(process.env.PORT || 3000);
const CONSOLE_PIN = process.env.CONSOLE_PIN || '';
const GUEST_SESSION_MINUTES = 60;
const MAX_GUESTS = 2;
// Media is relayed through the LiveKit Cloud SFU. The local Express app still serves
// the web interface and issues short-lived room tokens.
const LIVEKIT_URL = String(process.env.LIVEKIT_URL || 'wss://motorcu-radyosu-918cyaue.livekit.cloud').trim();
const LIVEKIT_ROOM = String(process.env.LIVEKIT_ROOM || 'motorcu-radyosu').trim();
const LIVEKIT_API_KEY = String(process.env.LIVEKIT_API_KEY || '').trim();
const LIVEKIT_API_SECRET = String(process.env.LIVEKIT_API_SECRET || '').trim();

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/livekit/status', (_req, res) => res.json({ configured: Boolean(LIVEKIT_API_KEY && LIVEKIT_API_SECRET), serverUrl: LIVEKIT_URL, room: LIVEKIT_ROOM }));
app.post('/api/livekit/token', async (req, res) => {
  try {
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return res.status(503).json({ error: 'LiveKit API Key ve API Secret ayarlanmamış. SETUP_LIVEKIT.bat dosyasını çalıştır.' });
    }
    const role = String(req.body?.role || 'listener');
    if (!['host', 'listener'].includes(role)) return res.status(400).json({ error: 'Geçersiz katılımcı türü.' });
    const participantName = String(req.body?.name || (role === 'host' ? 'Motorcu Radyo Yayıncısı' : '')).trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!participantName || (role === 'listener' && participantName.split(' ').length < 2)) {
      return res.status(400).json({ error: 'Dinleyici için ad ve soyad gereklidir.' });
    }
    if (role === 'host' && CONSOLE_PIN && String(req.body?.pin || '') !== CONSOLE_PIN) {
      return res.status(403).json({ error: 'Yayın konsolu PIN kodu hatalı.' });
    }
    const identity = `${role}-${crypto.randomBytes(8).toString('hex')}`;
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, name: participantName, ttl: '2h' });
    at.addGrant({ roomJoin: true, room: LIVEKIT_ROOM, canPublish: role === 'host', canSubscribe: true, canPublishData: false });
    const token = await at.toJwt();
    return res.json({ token, serverUrl: LIVEKIT_URL, room: LIVEKIT_ROOM, identity, name: participantName, role });
  } catch (error) {
    console.error('LiveKit token error:', error);
    return res.status(500).json({ error: 'LiveKit katılım anahtarı üretilemedi. API bilgilerini ve proje URL adresini kontrol et.' });
  }
});
app.get('/health', (_req, res) => res.json({ ok: true, version: '0.5.0', live: radioState.live }));

let radioState = { live: false, showTitle: 'Motorcu Sohbeti', listeners: 0, guests: 0, audioMode: 'livekit-cloud' };
const listenerNames = new Map();
const guestNames = new Map();
let guestSession = null;
let guestSessionTimer = null;
let publisherSocketId = null;

function getLanAddress() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal &&
          (entry.address.startsWith('192.168.') || entry.address.startsWith('10.') || entry.address.startsWith('172.'))) {
        return entry.address;
      }
    }
  }
  return null;
}

function updateCounts() {
  radioState.listeners = listenerNames.size;
  radioState.guests = guestNames.size;
  io.emit('radio:state', radioState);
  io.to('console').emit('guest:participants', [...guestNames.entries()].map(([socketId, name]) => ({
    id: socketId.slice(0, 6), name
  })));
}

function fullName(firstName, lastName) {
  const first = String(firstName || '').trim().replace(/\s+/g, ' ').slice(0, 50);
  const last = String(lastName || '').trim().replace(/\s+/g, ' ').slice(0, 50);
  if (!first || !last) return '';
  return `${first} ${last}`.slice(0, 100);
}

function getGuestSessionInfo(includeToken = false) {
  if (!guestSession) return { active: false, guestCount: guestNames.size, maxGuests: MAX_GUESTS };
  const info = {
    active: true,
    expiresAt: guestSession.expiresAt,
    guestCount: guestNames.size,
    maxGuests: MAX_GUESTS,
    inviteBaseUrl: guestSession.inviteBaseUrl
  };
  if (includeToken) info.token = guestSession.token;
  return info;
}

function endGuestSession(reason = 'Konuk oturumu yayıncı tarafından kapatıldı.') {
  if (guestSessionTimer) clearTimeout(guestSessionTimer);
  guestSessionTimer = null;
  guestSession = null;
  for (const [socketId] of guestNames) {
    const guestSocket = io.sockets.sockets.get(socketId);
    if (guestSocket) {
      guestSocket.emit('guest:ended', reason);
      guestSocket.disconnect(true);
    }
  }
  io.to('console').emit('guest:session-state', getGuestSessionInfo());
  updateCounts();
}

function publishState() {
  updateCounts();
  if (radioState.live && publisherSocketId) {
    for (const socketId of [...listenerNames.keys(), ...guestNames.keys()]) {
      io.to(socketId).emit('audio:available', { mode: radioState.audioMode });
    }
  }
}

io.on('connection', socket => {
  socket.emit('radio:state', radioState);

  socket.on('join:listener', data => {
    if (guestNames.has(socket.id)) return;
    const name = fullName(data?.firstName, data?.lastName);
    if (!name) {
      socket.emit('listener:error', 'Mesaj ve dinleyici kaydı için ad ve soyad alanlarını doldur.');
      return;
    }
    if (!listenerNames.has(socket.id)) {
      listenerNames.set(socket.id, name);
      updateCounts();
      io.to('console').emit('chat:system', `${name} dinleyici olarak bağlandı.`);
    }
    socket.emit('listener:joined', { name });
    if (radioState.live) socket.emit('audio:available', { mode: radioState.audioMode });
  });

  socket.on('join:console', data => {
    const pin = String(data?.pin || '');
    if (CONSOLE_PIN && pin !== CONSOLE_PIN) {
      socket.emit('auth:error', 'Konsol PIN\'i hatalı.');
      return;
    }
    socket.join('console');
    socket.emit('console:ready', { demoMode: !CONSOLE_PIN });
    socket.emit('guest:session', getGuestSessionInfo(true));
    socket.emit('guest:participants', [...guestNames.entries()].map(([socketId, name]) => ({
      id: socketId.slice(0, 6), name
    })));
    socket.emit('audio:publisher-state', { live: radioState.live, isPublisher: publisherSocketId === socket.id });
  });

  socket.on('guest:create', () => {
    if (!socket.rooms.has('console')) return;
    if (guestSession) {
      socket.emit('guest:session', getGuestSessionInfo(true));
      return;
    }
    const lanAddress = getLanAddress();
    const inviteBaseUrl = lanAddress
      ? `http://${lanAddress}:${PORT}`
      : `http://${socket.handshake.headers.host || `localhost:${PORT}`}`;
    guestSession = {
      token: crypto.randomBytes(24).toString('hex'),
      createdAt: Date.now(),
      expiresAt: Date.now() + GUEST_SESSION_MINUTES * 60 * 1000,
      inviteBaseUrl
    };
    guestSessionTimer = setTimeout(() => endGuestSession('Konuk oturumunun 60 dakikalık süresi doldu.'), GUEST_SESSION_MINUTES * 60 * 1000);
    socket.emit('guest:session', getGuestSessionInfo(true));
    io.to('console').emit('guest:session-state', getGuestSessionInfo());
    io.to('console').emit('chat:system', 'Konuk oturumu açıldı; davet bağlantısı hazır.');
  });

  socket.on('guest:end', () => {
    if (!socket.rooms.has('console')) return;
    endGuestSession('Yayıncı konuk oturumunu kapattı.');
  });

  socket.on('join:guest', data => {
    const token = String(data?.token || '');
    if (!guestSession || Date.now() > guestSession.expiresAt || !token || token !== guestSession.token) {
      socket.emit('guest:error', 'Bu konuk bağlantısı geçersiz veya süresi dolmuş. Yayıncıdan yeni bağlantı iste.');
      return;
    }
    if (guestNames.has(socket.id)) {
      socket.emit('guest:joined', { name: guestNames.get(socket.id), expiresAt: guestSession.expiresAt });
      return;
    }
    if (guestNames.size >= MAX_GUESTS) {
      socket.emit('guest:error', `Konuk odası dolu. Aynı anda en fazla ${MAX_GUESTS} konuk katılabilir.`);
      return;
    }
    const name = String(data?.name || '').trim().replace(/\s+/g, ' ').slice(0, 100);
    if (name.split(' ').filter(Boolean).length < 2) {
      socket.emit('guest:error', 'Lütfen adını ve soyadını yaz.');
      return;
    }
    listenerNames.delete(socket.id);
    guestNames.set(socket.id, name);
    socket.join('guest-session');
    socket.emit('guest:joined', { name, expiresAt: guestSession.expiresAt });
    io.to('console').emit('chat:system', `${name} konuk oturumuna katıldı.`);
    updateCounts();
    if (radioState.live) socket.emit('audio:available', { mode: radioState.audioMode });
  });

  socket.on('radio:control', data => {
    if (!socket.rooms.has('console')) return;
    if (data?.action === 'start') {
      // Only the currently connected console may publish this session.
      publisherSocketId = socket.id;
      radioState.live = true;
      radioState.showTitle = String(data.title || radioState.showTitle).slice(0, 80);
      publishState();
      io.to('console').emit('chat:system', 'Canlı ses aktarımı LiveKit Cloud üzerinden açıldı.');
    } else if (data?.action === 'stop') {
      radioState.live = false;
      const oldPublisher = publisherSocketId;
      publisherSocketId = null;
      io.emit('audio:ended', { reason: 'Yayıncı yayını bitirdi.' });
      io.to('console').emit('chat:system', 'Canlı yayın kapatıldı.');
      if (oldPublisher) io.to(oldPublisher).emit('audio:publisher-stop');
      updateCounts();
    } else if (data?.action === 'title') {
      radioState.showTitle = String(data.title || 'Motorcu Sohbeti').slice(0, 80);
      io.emit('radio:state', radioState);
    }
  });

  // WebRTC request: the server only signals; audio travels directly between browsers.
  socket.on('audio:request', () => {
    if (!radioState.live || !publisherSocketId) {
      socket.emit('audio:error', 'Yayın şu anda kapalı.');
      return;
    }
    const isKnownListener = listenerNames.has(socket.id) || guestNames.has(socket.id);
    if (!isKnownListener) {
      socket.emit('audio:error', 'Önce adın ve soyadınla dinleyici olarak bağlan.');
      return;
    }
    const existingListeners = listenerNames.size + guestNames.size;
    if (existingListeners > MAX_DIRECT_LISTENERS) {
      socket.emit('audio:error', `Bu deneme sürümünde aynı anda en fazla ${MAX_DIRECT_LISTENERS} dinleyici desteklenir.`);
      return;
    }
    io.to(publisherSocketId).emit('audio:viewer', { viewerId: socket.id, name: listenerNames.get(socket.id) || guestNames.get(socket.id) });
  });

  socket.on('audio:signal', data => {
    if (!data || typeof data.to !== 'string' || !data.to) return;
    const isPublisher = socket.id === publisherSocketId;
    const isListener = listenerNames.has(socket.id) || guestNames.has(socket.id);
    if (!isPublisher && !(isListener && data.to === publisherSocketId)) return;
    if (isPublisher && !(listenerNames.has(data.to) || guestNames.has(data.to))) return;
    const payload = { from: socket.id, type: data.type };
    if (data.type === 'description' && data.description) payload.description = data.description;
    else if (data.type === 'ice' && data.candidate) payload.candidate = data.candidate;
    else return;
    io.to(data.to).emit('audio:signal', payload);
  });

  socket.on('chat:send', data => {
    if (!listenerNames.has(socket.id) && !guestNames.has(socket.id)) return;
    const message = String(data?.message || '').trim().slice(0, 400);
    if (!message) return;
    const isGuest = guestNames.has(socket.id);
    io.to('console').emit('chat:message', {
      name: isGuest ? guestNames.get(socket.id) : listenerNames.get(socket.id),
      role: isGuest ? 'Konuk' : 'Dinleyici',
      message,
      time: Date.now()
    });
  });

  socket.on('disconnect', () => {
    if (publisherSocketId === socket.id) {
      publisherSocketId = null;
      radioState.live = false;
      io.emit('audio:ended', { reason: 'Yayıncı bağlantısı kesildi.' });
      updateCounts();
    }
    const listenerRemoved = listenerNames.delete(socket.id);
    const guestRemoved = guestNames.delete(socket.id);
    if (publisherSocketId) io.to(publisherSocketId).emit('audio:viewer-left', { viewerId: socket.id });
    if (listenerRemoved || guestRemoved) updateCounts();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = getLanAddress();
  console.log(`Motorcu Radyosu 0.5.0 çalışıyor: http://localhost:${PORT}`);
  if (lan) console.log(`Aynı Wi-Fi testi için telefon adresi: http://${lan}:${PORT}`);
  console.log('Canlı ses aktarımı: LiveKit Cloud SFU.');
  console.log(`LiveKit sunucusu: ${LIVEKIT_URL}`);
  console.log(`LiveKit kimlik bilgileri: ${LIVEKIT_API_KEY && LIVEKIT_API_SECRET ? 'ayarlı' : 'EKSİK - SETUP_LIVEKIT.bat çalıştırılmalı'}`);
  console.log('Not: Dinleyici sayfası şu an yerel bilgisayar/ağ adresinden açılır. WhatsApp grubuna dağıtım için bu uygulama ayrıca herkese açık HTTPS adresinde barındırılmalıdır.');
});
