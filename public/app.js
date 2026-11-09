const socket = io();
const $ = id => document.getElementById(id);
let consoleConnected = false;
let listenerJoined = false;
let msgCount = 0;
let guestJoined = false;
const guestToken = new URLSearchParams(window.location.search).get('guest') || '';

// LiveKit Cloud SFU bağlantısı: yayıncı ve tüm dinleyiciler aynı bulut odasına bağlanır.
let liveKitRoom = null;
let liveKitRole = null;
let liveKitPublishedTrack = null;
let currentListenerName = '';
let currentGuestName = '';
let mixedStream = null;
let audioContext = null;
let streamDestination = null;
let streamMasterGain = null;
let monitorMasterGain = null;
let musicGainNode = null;
let effectsGainNode = null;
let micGainNode = null;
let micHighpass = null;
let micBassFilter = null;
let micMidFilter = null;
let micTrebleFilter = null;
let micCompressor = null;
let micLimiter = null;
let micAnalyser = null;
let micInputSource = null;
let micStream = null;
let micFrame = null;
let micMuted = false;
let musicMuted = false;
let effectsMuted = false;

const player = $('musicPlayer');
const effectPlayers = {
  laugh: $('fxLaugh'),
  applause: $('fxApplause'),
  horn: $('fxHorn'),
  drum: $('fxDrum'),
  bell: $('fxBell')
};
const effectNames = { laugh: 'Kahkaha', applause: 'Alkış', horn: 'Korna', drum: 'Davul geçişi', bell: 'Zil' };

if (guestToken) {
  $('listenerCard').classList.add('hidden');
  $('guestInviteCard').classList.remove('hidden');
  $('guestStatus').textContent = 'Davet bulundu. Adını ve soyadını yazarak katılabilirsin.';
}

document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
  $('listenView').classList.toggle('hidden', btn.dataset.view !== 'listen');
  $('consoleView').classList.toggle('hidden', btn.dataset.view !== 'console');
}));

function updateAudioStatus(message, isError = false) {
  $('audioStatus').textContent = message;
  $('audioStatus').classList.toggle('error-text', isError);
}

socket.on('radio:state', state => {
  $('status').classList.toggle('on', state.live);
  $('status').classList.toggle('off', !state.live);
  $('status').innerHTML = `<i></i> ${state.live ? 'CANLI YAYIN' : 'YAYIN KAPALI'}`;
  $('showTitle').textContent = state.showTitle || 'Motorcu Sohbeti';
  $('infoTitle').textContent = state.showTitle || 'Motorcu Sohbeti';
  $('listenerCount').textContent = `${state.listeners || 0} / ${state.guests || 0}`;
  $('infoStatus').textContent = state.live ? 'Canlı' : 'Kapalı';
  $('playerText').textContent = state.live ? 'Yayın açık. Canlı dinlemek için aşağıdaki düğmeye bas.' : 'Yayın başladığında burada görünecek.';
  $('listenNowBtn').disabled = !state.live || (!listenerJoined && !guestJoined);
  if (!state.live) {
    updateAudioStatus('Yayın kapalı.');
    if (liveKitRole === 'listener') stopListenerAudio('Yayın sona erdi.');
  } else if (listenerJoined || guestJoined) {
    updateAudioStatus('Canlı yayın bulundu. Dinlemek için düğmeye bas.');
  }
});

$('joinBtn').addEventListener('click', () => {
  const firstName = $('listenerFirstName').value.trim();
  const lastName = $('listenerLastName').value.trim();
  if (!firstName || !lastName) {
    $('messageFeedback').textContent = 'Lütfen adını ve soyadını yaz.';
    return;
  }
  socket.emit('join:listener', { firstName, lastName });
  $('messageFeedback').textContent = 'Dinleyici bağlantısı kuruluyor…';
});
socket.on('listener:error', message => { $('messageFeedback').textContent = message; });
socket.on('listener:joined', data => {
  listenerJoined = true;
  guestJoined = false;
  currentListenerName = data.name || `${$('listenerFirstName').value.trim()} ${$('listenerLastName').value.trim()}`.trim();
  $('messageFeedback').textContent = `Dinleyici olarak bağlandın: ${data.name}`;
  $('listenNowBtn').disabled = false;
});

$('joinGuestBtn').addEventListener('click', () => {
  if (!guestToken) {
    $('guestStatus').textContent = 'Davet kodu bulunamadı. Yayıncıdan yeni bağlantı iste.';
    return;
  }
  const first = $('guestFirstName').value.trim();
  const last = $('guestLastName').value.trim();
  if (!first || !last) {
    $('guestStatus').textContent = 'Lütfen adını ve soyadını yaz.';
    return;
  }
  $('guestStatus').textContent = 'Konuk oturumu açılıyor…';
  socket.emit('join:guest', { token: guestToken, name: `${first} ${last}` });
});
socket.on('guest:joined', data => {
  guestJoined = true;
  listenerJoined = false;
  currentGuestName = data.name || `${$('guestFirstName').value.trim()} ${$('guestLastName').value.trim()}`.trim();
  $('guestStatus').textContent = `Hoş geldin ${data.name}. Canlı yayın hazırlanıyor…`;
  $('listenNowBtn').disabled = false;
});
socket.on('guest:error', message => { $('guestStatus').textContent = message; });
socket.on('guest:ended', message => {
  guestJoined = false;
  stopListenerAudio(message);
  $('guestStatus').textContent = message;
});

$('sendBtn').addEventListener('click', () => {
  if (!listenerJoined && !guestJoined) {
    $('messageFeedback').textContent = 'Önce adın ve soyadınla dinleyici olarak bağlan.';
    return;
  }
  const message = $('message').value.trim();
  if (!message) return;
  socket.emit('chat:send', { message });
  $('message').value = '';
  $('messageFeedback').textContent = 'Mesaj yayın konsoluna gönderildi.';
});

$('consoleLogin').addEventListener('click', () => socket.emit('join:console', { pin: $('consolePin').value }));
socket.on('console:ready', data => {
  consoleConnected = true;
  $('consoleLogin').textContent = data.demoMode ? 'Konsola bağlandı (deneme)' : 'Konsola bağlandı';
  $('consoleLogin').classList.add('primary');
  if (data.isPublisher && liveKitRole === 'host') updateStudioStatus('LiveKit yayın bağlantısı açık.');
});
socket.on('auth:error', message => alert(message));
socket.on('disconnect', () => {
  consoleConnected = false;
  $('consoleLogin').textContent = 'Konsola bağlan';
  $('consoleLogin').classList.remove('primary');
  if (liveKitRole === 'listener') stopListenerAudio('Sunucu bağlantısı kesildi.');
  if (liveKitRole === 'host') disconnectLiveKitHost();
});

// Publisher audio graph. Music, microphone and effects are mixed into one outgoing stream.
async function ensureAudioGraph() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Bu tarayıcı Web Audio API desteklemiyor.');
    audioContext = new AudioContextClass({ latencyHint: 'interactive' });
    streamDestination = audioContext.createMediaStreamDestination();
    streamMasterGain = audioContext.createGain();
    monitorMasterGain = audioContext.createGain();
    musicGainNode = audioContext.createGain();
    effectsGainNode = audioContext.createGain();
    micGainNode = audioContext.createGain();
    micHighpass = audioContext.createBiquadFilter();
    micHighpass.type = 'highpass';
    micHighpass.frequency.value = 80;

    micBassFilter = audioContext.createBiquadFilter();
    micBassFilter.type = 'lowshelf';
    micBassFilter.frequency.value = 120;

    micMidFilter = audioContext.createBiquadFilter();
    micMidFilter.type = 'peaking';
    micMidFilter.frequency.value = 1200;
    micMidFilter.Q.value = 0.8;

    micTrebleFilter = audioContext.createBiquadFilter();
    micTrebleFilter.type = 'highshelf';
    micTrebleFilter.frequency.value = 8000;

    micCompressor = audioContext.createDynamicsCompressor();
    micCompressor.threshold.value = -24;
    micCompressor.knee.value = 20;
    micCompressor.ratio.value = 3;
    micCompressor.attack.value = 0.005;
    micCompressor.release.value = 0.15;

    micLimiter = audioContext.createDynamicsCompressor();
    micLimiter.threshold.value = -3;
    micLimiter.knee.value = 0;
    micLimiter.ratio.value = 20;
    micLimiter.attack.value = 0.001;
    micLimiter.release.value = 0.08;

    micAnalyser = audioContext.createAnalyser();
    micAnalyser.fftSize = 256;

    streamMasterGain.connect(streamDestination);
    monitorMasterGain.connect(audioContext.destination);
    musicGainNode.connect(streamMasterGain);
    musicGainNode.connect(monitorMasterGain);
    effectsGainNode.connect(streamMasterGain);
    effectsGainNode.connect(monitorMasterGain);
    // Mikrofon işleme zinciri: EQ -> kompresör -> limiter -> yayın.
    micHighpass.connect(micBassFilter);
    micBassFilter.connect(micMidFilter);
    micMidFilter.connect(micTrebleFilter);
    micTrebleFilter.connect(micCompressor);
    micCompressor.connect(micLimiter);
    micLimiter.connect(micGainNode);
    micGainNode.connect(streamMasterGain); // Yerel mikrofon monitörü kapalı.

    const musicSource = audioContext.createMediaElementSource(player);
    musicSource.connect(musicGainNode);
    player.volume = 1;
    for (const audio of Object.values(effectPlayers)) {
      const source = audioContext.createMediaElementSource(audio);
      source.connect(effectsGainNode);
      audio.volume = 1;
    }
    mixedStream = streamDestination.stream;
    applyAllGains();
  }
  if (audioContext.state === 'suspended') await audioContext.resume();
  return mixedStream;
}

function applyAllGains() {
  if (!audioContext) return;
  const master = Number($('masterVolume').value) / 100;
  const music = musicMuted ? 0 : Number($('musicVolume').value) / 100;
  const effects = effectsMuted ? 0 : Number($('effectsVolume').value) / 100;
  const mic = micMuted ? 0 : Number($('micVolume').value) / 100;
  musicGainNode.gain.setTargetAtTime(music, audioContext.currentTime, 0.015);
  effectsGainNode.gain.setTargetAtTime(effects, audioContext.currentTime, 0.015);
  micGainNode.gain.setTargetAtTime(mic, audioContext.currentTime, 0.015);
  streamMasterGain.gain.setTargetAtTime(master, audioContext.currentTime, 0.015);
  monitorMasterGain.gain.setTargetAtTime(master, audioContext.currentTime, 0.015);
  $('musicVolumeValue').textContent = `${$('musicVolume').value}%`;
  $('effectsVolumeValue').textContent = `${$('effectsVolume').value}%`;
  $('micVolumeValue').textContent = `${$('micVolume').value}%`;
  $('masterVolumeValue').textContent = `${$('masterVolume').value}%`;
}

function updateStudioStatus(message, isError = false) {
  $('micStatus').textContent = message;
  $('micStatus').classList.toggle('error-text', isError);
}

async function requestLiveKitToken(role, name, pin = '') {
  const response = await fetch('/api/livekit/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, name, pin })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `LiveKit anahtarı alınamadı (${response.status}).`);
  return data;
}

function getLiveKitSdk() {
  if (!window.LiveKitClient?.Room) throw new Error('LiveKit tarayıcı bileşeni yüklenemedi. Sunucuyu kapatıp BASLAT.bat dosyasını yeniden çalıştır.');
  return window.LiveKitClient;
}

async function connectLiveKitListener() {
  if (!listenerJoined && !guestJoined) throw new Error('Önce adın ve soyadınla dinleyici olarak bağlan.');
  if (liveKitRoom && liveKitRole === 'listener') return;
  if (liveKitRoom) await liveKitRoom.disconnect();
  const name = guestJoined ? currentGuestName : currentListenerName;
  const config = await requestLiveKitToken('listener', name);
  const LK = getLiveKitSdk();
  const room = new LK.Room({ adaptiveStream: true, dynacast: true });
  room.on(LK.RoomEvent.TrackSubscribed, async (track) => {
    if (track.kind !== LK.Track.Kind.Audio) return;
    const audio = $('liveAudio');
    audio.srcObject = new MediaStream([track.mediaStreamTrack]);
    audio.muted = false;
    audio.volume = 1;
    try {
      await audio.play();
      updateAudioStatus('Canlı ses LiveKit üzerinden geliyor.');
      $('listenNowBtn').textContent = 'Canlı yayını dinliyorsun';
    } catch (_) {
      updateAudioStatus('Ses bağlantısı hazır. Dinlemek için Canlı yayını dinle düğmesine tekrar bas.');
    }
  });
  room.on(LK.RoomEvent.TrackUnsubscribed, (track) => {
    if (track.kind === LK.Track.Kind.Audio) {
      const audio = $('liveAudio');
      audio.pause();
      audio.srcObject = null;
    }
  });
  room.on(LK.RoomEvent.Disconnected, () => {
    if (liveKitRoom === room) {
      liveKitRoom = null;
      liveKitRole = null;
      updateAudioStatus('LiveKit bağlantısı kapandı.');
    }
  });
  await room.connect(config.serverUrl, config.token);
  liveKitRoom = room;
  liveKitRole = 'listener';
  updateAudioStatus('LiveKit odasına bağlandın. Yayıncıdan ses bekleniyor…');
}

async function disconnectLiveKitHost() {
  if (liveKitRoom && liveKitRole === 'host') {
    try {
      if (liveKitPublishedTrack) await liveKitRoom.localParticipant.unpublishTrack(liveKitPublishedTrack);
      await liveKitRoom.disconnect();
    } catch (_) {}
  }
  liveKitRoom = null;
  liveKitRole = null;
  liveKitPublishedTrack = null;
}

function stopListenerAudio(message) {
  if (liveKitRoom && liveKitRole === 'listener') {
    try { liveKitRoom.disconnect(); } catch (_) {}
    liveKitRoom = null;
    liveKitRole = null;
  }
  const audio = $('liveAudio');
  audio.pause();
  audio.srcObject = null;
  $('listenNowBtn').textContent = '▶ Canlı yayını dinle';
  $('listenNowBtn').disabled = !(listenerJoined || guestJoined);
  updateAudioStatus(message || 'Ses bağlantısı kapatıldı.');
}

let radioIsLive = false;

async function startRadio() {
  if (!consoleConnected) return alert('Önce konsola bağlan.');
  if (liveKitRoom && liveKitRole === 'host') return;
  try {
    await ensureAudioGraph();
    const config = await requestLiveKitToken('host', 'Motorcu Radyo Yayıncısı', $('consolePin').value);
    const LK = getLiveKitSdk();
    const room = new LK.Room({ adaptiveStream: true, dynacast: true });
    await room.connect(config.serverUrl, config.token);
    const track = mixedStream.getAudioTracks()[0];
    if (!track) throw new Error('Mikslenmiş ses kanalı oluşturulamadı.');
    await room.localParticipant.publishTrack(track, {
      source: LK.Track.Source.Microphone,
      name: 'Motorcu Radyosu Canlı Ses'
    });
    liveKitRoom = room;
    liveKitRole = 'host';
    liveKitPublishedTrack = track;
    radioIsLive = true;
    socket.emit('radio:control', { action: 'start', title: $('programTitle').value });
    $('streamStatus').textContent = 'Canlı ses LiveKit Cloud sunucusuna gönderiliyor. Dinleyiciler bağlanabilir.';
    $('startBtn').textContent = '🔴 Yayın açık';
  } catch (error) {
    await disconnectLiveKitHost();
    $('streamStatus').textContent = `Canlı yayın başlatılamadı: ${error.message}`;
    alert(`Canlı yayın başlatılamadı: ${error.message}`);
  }
}
async function stopRadio() {
  if (!consoleConnected) return alert('Önce konsola bağlan.');
  radioIsLive = false;
  socket.emit('radio:control', { action: 'stop' });
  await disconnectLiveKitHost();
  $('streamStatus').textContent = 'Yayın kapatıldı.';
  $('startBtn').textContent = '🔴 Yayını başlat';
}
$('startBtn').addEventListener('click', startRadio);
$('stopBtn').addEventListener('click', stopRadio);
$('programTitle').addEventListener('change', () => {
  if (consoleConnected) socket.emit('radio:control', { action: 'title', title: $('programTitle').value });
});
$('listenNowBtn').addEventListener('click', async () => {
  try {
    const audio = $('liveAudio');
    audio.muted = false;
    audio.volume = 1;
    // Calling play directly inside the user click helps mobile browsers unlock audio.
    audio.play().catch(() => {});
    updateAudioStatus('LiveKit Cloud bağlantısı kuruluyor…');
    await connectLiveKitListener();
    $('listenNowBtn').textContent = 'Bağlantı kuruldu – ses bekleniyor';
  } catch (error) {
    updateAudioStatus(error.message, true);
  }
});

socket.on('chat:message', data => {
  msgCount++;
  $('messageCount').textContent = msgCount;
  if (msgCount === 1) $('consoleMessages').innerHTML = '';
  const item = document.createElement('div'); item.className = 'message-item';
  const name = document.createElement('strong'); name.textContent = data.name;
  const role = document.createElement('span'); role.className = 'muted small'; role.textContent = ` · ${data.role || 'Dinleyici'}`;
  const body = document.createElement('p'); body.textContent = data.message;
  const time = document.createElement('span'); time.className = 'muted small';
  time.textContent = new Date(data.time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  item.append(name, role, time, body); $('consoleMessages').prepend(item);
});
socket.on('chat:system', text => {
  if (!consoleConnected) return;
  const item = document.createElement('div'); item.className = 'message-item muted small';
  item.textContent = text; $('consoleMessages').prepend(item);
});

// Playlist player.
let tracks = [];
let currentIndex = -1;
let repeatOne = false;
let shuffle = false;
let currentObjectUrl = null;
function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
function renderPlaylist() {
  $('trackCount').textContent = `${tracks.length} parça`;
  const list = $('playlist');
  list.innerHTML = '';
  list.classList.toggle('empty', tracks.length === 0);
  if (!tracks.length) {
    list.textContent = 'MP3 dosyalarını ekleyerek listenizi oluşturun.';
    $('trackTitle').textContent = 'Henüz parça seçilmedi';
    return;
  }
  tracks.forEach((track, index) => {
    const row = document.createElement('div');
    row.className = 'track-row' + (index === currentIndex ? ' selected' : '');
    const play = document.createElement('button');
    play.className = 'track-select'; play.textContent = `${index + 1}. ${track.name}`; play.title = track.name;
    play.addEventListener('click', () => loadTrack(index, true));
    const up = document.createElement('button'); up.className = 'mini-btn'; up.textContent = '↑'; up.title = 'Yukarı taşı'; up.disabled = index === 0;
    up.addEventListener('click', () => moveTrack(index, -1));
    const down = document.createElement('button'); down.className = 'mini-btn'; down.textContent = '↓'; down.title = 'Aşağı taşı'; down.disabled = index === tracks.length - 1;
    down.addEventListener('click', () => moveTrack(index, 1));
    const remove = document.createElement('button'); remove.className = 'mini-btn remove'; remove.textContent = '×'; remove.title = 'Listeden çıkar';
    remove.addEventListener('click', () => removeTrack(index));
    row.append(play, up, down, remove); list.append(row);
  });
}
function loadTrack(index, autoplay) {
  if (index < 0 || index >= tracks.length) return;
  currentIndex = index;
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(tracks[index].file);
  player.src = currentObjectUrl;
  player.volume = 1; // Web Audio channel gain performs the mix.
  $('trackTitle').textContent = tracks[index].name;
  renderPlaylist();
  if (autoplay) player.play().then(() => $('playPause').textContent = 'Ⅱ').catch(() => {
    $('playPause').textContent = '▶';
    $('trackTime').textContent = 'Çalmak için tekrar ▶ tuşuna basın';
  });
}
function moveTrack(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= tracks.length) return;
  [tracks[index], tracks[target]] = [tracks[target], tracks[index]];
  if (currentIndex === index) currentIndex = target;
  else if (currentIndex === target) currentIndex = index;
  renderPlaylist();
}
function removeTrack(index) {
  const wasCurrent = index === currentIndex;
  tracks.splice(index, 1);
  if (!tracks.length) {
    player.pause(); player.removeAttribute('src'); currentIndex = -1;
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  } else if (wasCurrent) {
    currentIndex = -1; loadTrack(Math.min(index, tracks.length - 1), false);
  } else if (index < currentIndex) currentIndex--;
  renderPlaylist();
}
function nextTrack() {
  if (!tracks.length) return;
  if (shuffle && tracks.length > 1) {
    let next = currentIndex;
    while (next === currentIndex) next = Math.floor(Math.random() * tracks.length);
    loadTrack(next, true);
  } else if (currentIndex < tracks.length - 1) loadTrack(currentIndex + 1, true);
  else if (repeatOne) loadTrack(0, true);
  else { player.pause(); $('playPause').textContent = '▶'; }
}
$('audioFiles').addEventListener('change', event => {
  const added = [...event.target.files].filter(file => file.type.startsWith('audio/'));
  tracks.push(...added.map(file => ({ name: file.name, file })));
  renderPlaylist();
  if (currentIndex === -1 && tracks.length) loadTrack(0, false);
  event.target.value = '';
});
$('clearPlaylist').addEventListener('click', () => {
  player.pause(); tracks = []; currentIndex = -1;
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = null; player.removeAttribute('src');
  $('playPause').textContent = '▶'; $('trackTime').textContent = '00:00 / 00:00';
  renderPlaylist();
});
$('playPause').addEventListener('click', async () => {
  if (!tracks.length) return alert('Önce MP3 dosyası ekleyin.');
  try { if (audioContext?.state === 'suspended') await audioContext.resume(); } catch (_) {}
  if (currentIndex === -1) loadTrack(0, false);
  if (player.paused) player.play().then(() => $('playPause').textContent = 'Ⅱ').catch(() => {});
  else { player.pause(); $('playPause').textContent = '▶'; }
});
$('nextTrack').addEventListener('click', nextTrack);
$('prevTrack').addEventListener('click', () => {
  if (!tracks.length) return;
  if (player.currentTime > 3) player.currentTime = 0;
  else loadTrack(Math.max(0, currentIndex - 1), true);
});
$('repeatTrack').addEventListener('click', () => {
  repeatOne = !repeatOne; $('repeatTrack').classList.toggle('active', repeatOne);
  $('repeatTrack').title = repeatOne ? 'Listenin başına dön' : 'Tekrar kapalı';
});
$('shuffleTrack').addEventListener('click', () => {
  shuffle = !shuffle; $('shuffleTrack').classList.toggle('active', shuffle);
  $('shuffleTrack').title = shuffle ? 'Karışık çalma açık' : 'Karışık çalma kapalı';
});
player.addEventListener('ended', () => {
  if (repeatOne) { player.currentTime = 0; player.play(); }
  else nextTrack();
});
player.addEventListener('timeupdate', () => {
  $('trackTime').textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
  if (Number.isFinite(player.duration) && player.duration > 0) $('seekBar').value = Math.round(player.currentTime / player.duration * 1000);
});
$('seekBar').addEventListener('input', () => {
  if (Number.isFinite(player.duration)) player.currentTime = Number($('seekBar').value) / 1000 * player.duration;
});
player.addEventListener('play', () => $('playPause').textContent = 'Ⅱ');
player.addEventListener('pause', () => $('playPause').textContent = '▶');

// Mixer controls are routed into the outgoing WebRTC audio mix.
function applyAllGainsSafe() {
  if (audioContext) applyAllGains();
  else {
    $('musicVolumeValue').textContent = `${$('musicVolume').value}%`;
    $('effectsVolumeValue').textContent = `${$('effectsVolume').value}%`;
    $('micVolumeValue').textContent = `${$('micVolume').value}%`;
    $('masterVolumeValue').textContent = `${$('masterVolume').value}%`;
  }
}
['musicVolume', 'effectsVolume', 'micVolume', 'masterVolume'].forEach(id => $(id).addEventListener('input', applyAllGainsSafe));
$('musicMute').addEventListener('click', () => {
  musicMuted = !musicMuted;
  $('musicMute').textContent = musicMuted ? 'Müziğin sesini aç' : 'Müziği sessize al';
  $('musicMute').classList.toggle('muted-toggle', musicMuted);
  applyAllGainsSafe();
});
$('effectsMute').addEventListener('click', () => {
  effectsMuted = !effectsMuted;
  $('effectsMute').textContent = effectsMuted ? 'Efektlerin sesini aç' : 'Efektleri sessize al';
  $('effectsMute').classList.toggle('muted-toggle', effectsMuted);
  applyAllGainsSafe();
});
$('micMute').addEventListener('click', () => {
  micMuted = !micMuted;
  $('micMute').textContent = micMuted ? 'Mikrofonun sesini aç' : 'Mikrofonu sessize al';
  $('micMute').classList.toggle('muted-toggle', micMuted);
  applyAllGainsSafe();
});

document.querySelectorAll('.sound-button').forEach(button => {
  button.addEventListener('click', async () => {
    try {
      await ensureAudioGraph();
      if (effectsMuted || Number($('effectsVolume').value) === 0 || Number($('masterVolume').value) === 0) {
        $('effectStatus').textContent = 'Efekt kanalı sessizde veya ses seviyesi sıfır.';
        return;
      }
      const audio = effectPlayers[button.dataset.effect];
      if (!audio) return;
      audio.currentTime = 0;
      await audio.play();
      $('effectStatus').textContent = `${effectNames[button.dataset.effect]} efekti çalıyor ve yayın miksine ekleniyor.`;
      button.classList.add('playing');
      audio.onended = () => button.classList.remove('playing');
    } catch (error) {
      $('effectStatus').textContent = `Efekt çalınamadı: ${error.message}`;
    }
  });
});

// Microphone input: microphone is mixed into the outgoing stream, never locally monitored.
function applyMicProcessing() {
  if (!audioContext || !micBassFilter) return;

  micBassFilter.gain.setTargetAtTime(Number($('micBass').value), audioContext.currentTime, 0.02);
  micMidFilter.gain.setTargetAtTime(Number($('micMid').value), audioContext.currentTime, 0.02);
  micTrebleFilter.gain.setTargetAtTime(Number($('micTreble').value), audioContext.currentTime, 0.02);

  const compressorOn = $('micCompressor').checked;
  micCompressor.threshold.setTargetAtTime(compressorOn ? -24 : 0, audioContext.currentTime, 0.02);
  micCompressor.ratio.setTargetAtTime(compressorOn ? 3 : 1, audioContext.currentTime, 0.02);

  $('micBassValue').textContent = `${$('micBass').value} dB`;
  $('micMidValue').textContent = `${$('micMid').value} dB`;
  $('micTrebleValue').textContent = `${$('micTreble').value} dB`;
}

function applyMicControl() {
  if (audioContext && micGainNode) {
    const value = micMuted ? 0 : Number($('micVolume').value) / 100;
    micGainNode.gain.setTargetAtTime(value, audioContext.currentTime, 0.015);
  }
  $('micVolumeValue').textContent = `${$('micVolume').value}%`;
  applyMicProcessing();
}

['micBass', 'micMid', 'micTreble', 'micCompressor'].forEach(id => {
  $(id).addEventListener('input', applyMicProcessing);
  $(id).addEventListener('change', applyMicProcessing);
});

async function loadMicrophoneDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const select = $('micInputDevice');
  const selected = select.value;
  select.innerHTML = '<option value="">Varsayılan mikrofon</option>';
  devices.filter(device => device.kind === 'audioinput').forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Mikrofon ${index + 1}`;
    select.appendChild(option);
  });
  select.value = selected;
}

$('micInputDevice').addEventListener('change', async () => {
  if (!micStream) return;
  micStream.getTracks().forEach(track => track.stop());
  micStream = null;
  if (micInputSource) micInputSource.disconnect();
  micInputSource = null;
  $('micEnable').click();
});
$('micEnable').addEventListener('click', async () => {
  try {
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
      micStream = null;
      if (micInputSource) micInputSource.disconnect();
      micInputSource = null;
      if (micFrame) cancelAnimationFrame(micFrame);
      $('micEnable').textContent = '🎙️ Mikrofon izni ver';
      updateStudioStatus('Mikrofon kapalı.');
      $('micMeter').style.width = '0%';
      applyMicControl();
      return;
    }
    await ensureAudioGraph();
    const selectedMic = $('micInputDevice').value;
    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: $('micNoiseSuppression').checked,
      autoGainControl: false
    };
    if (selectedMic) audioConstraints.deviceId = { exact: selectedMic };
    micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    await loadMicrophoneDevices();
    micInputSource = audioContext.createMediaStreamSource(micStream);
    micInputSource.connect(micAnalyser);
    micInputSource.connect(micHighpass);
    applyMicProcessing();
    applyMicControl();
    const data = new Uint8Array(micAnalyser.frequencyBinCount);
    const draw = () => {
      if (!micStream) return;
      micAnalyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const sample of data) { const value = (sample - 128) / 128; sum += value * value; }
      const rms = Math.sqrt(sum / data.length);
      const gain = micMuted ? 0 : Number($('micVolume').value) / 100;
      $('micMeter').style.width = `${Math.min(100, rms * gain * 420)}%`;
      micFrame = requestAnimationFrame(draw);
    };
    draw();
    $('micEnable').textContent = 'Mikrofonu kapat';
    updateStudioStatus('Mikrofon açık • canlı ses miksine bağlı.');
  } catch (error) {
    updateStudioStatus(`Mikrofon açılamadı: ${error.message}`, true);
  }
});

// Guest invitation flow.
function formatExpiry(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function showGuestSession(info, token = '') {
  const details = $('guestSessionDetails');
  if (!info || !info.active) {
    details.classList.add('hidden');
    $('guestSessionStatus').textContent = 'Konuk oturumu kapalı.';
    return;
  }
  details.classList.remove('hidden');
  $('guestSessionStatus').textContent = 'Konuk oturumu açık. Davet bağlantısını paylaşabilirsin.';
  $('guestExpiry').textContent = `Son geçerlilik: ${formatExpiry(info.expiresAt)} • En fazla ${info.maxGuests || 2} konuk`;
  if (token && info.inviteBaseUrl) {
    try {
      const invite = new URL('/', info.inviteBaseUrl);
      invite.searchParams.set('guest', token);
      $('guestInviteLink').value = invite.toString();
    } catch (_) { $('guestSessionStatus').textContent = 'Davet bağlantısı hazırlanamadı.'; }
  }
  updateGuestRosterCount(info.guestCount || 0, info.maxGuests || 2);
}
function updateGuestRosterCount(count, max = 2) { $('guestRosterCount').textContent = `${count} / ${max}`; }
function renderGuestRoster(people) {
  const roster = $('guestRoster');
  roster.innerHTML = '';
  if (!Array.isArray(people) || people.length === 0) {
    roster.innerHTML = '<p class="muted small">Henüz konuk katılmadı.</p>';
    updateGuestRosterCount(0, 2);
    return;
  }
  people.forEach(person => {
    const row = document.createElement('div'); row.className = 'guest-person';
    const name = document.createElement('span'); name.textContent = person.name || 'Konuk';
    const state = document.createElement('span'); state.textContent = '● Bağlı';
    row.append(name, state); roster.append(row);
  });
  updateGuestRosterCount(people.length, 2);
}
$('createGuestSession').addEventListener('click', () => {
  if (!consoleConnected) { $('guestSessionStatus').textContent = 'Önce yayın konsoluna bağlan.'; return; }
  $('guestSessionStatus').textContent = 'Konuk oturumu açılıyor…';
  socket.emit('guest:create');
});
$('endGuestSession').addEventListener('click', () => {
  if (!consoleConnected) return;
  socket.emit('guest:end');
  $('guestSessionStatus').textContent = 'Konuk oturumu kapatılıyor…';
});
$('copyGuestLink').addEventListener('click', async () => {
  const value = $('guestInviteLink').value;
  if (!value) return;
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
    else {
      $('guestInviteLink').focus(); $('guestInviteLink').select();
      if (!document.execCommand('copy')) throw new Error('Kopyalama desteklenmiyor');
    }
    $('guestSessionStatus').textContent = 'Davet bağlantısı kopyalandı.';
  } catch (_) {
    $('guestSessionStatus').textContent = 'Bağlantıyı seçip Ctrl+C ile kopyala.';
    $('guestInviteLink').focus(); $('guestInviteLink').select();
  }
});
socket.on('guest:session', data => showGuestSession(data, data?.token || ''));
socket.on('guest:session-state', data => showGuestSession(data));
socket.on('guest:participants', renderGuestRoster);
