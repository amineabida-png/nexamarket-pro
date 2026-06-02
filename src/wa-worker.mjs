import makeWASocket, { 
  useMultiFileAuthState, 
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { existsSync, mkdirSync } from 'fs';
import { createServer } from 'http';

// Ensure auth dir exists
const AUTH_DIR = process.env.DATA_DIR ? process.env.DATA_DIR + '/wa_auth' : '/tmp/wa_auth';
if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });

let waSocket    = null;
let waQRCode    = null;
let waConnected = false;
let waPhone     = null;
const waMessages = [];

async function startWA() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    waSocket = makeWASocket({
      version,
      auth: state,
      browser: ['NexaMarket', 'Chrome', '120'],
      connectTimeoutMs: 60000,
      logger: { level: 'silent', child: () => ({ level:'silent', trace:()=>{}, debug:()=>{}, info:()=>{}, warn:()=>{}, error:()=>{}, fatal:()=>{} }) }
    });

    waSocket.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;
      if (qr) { waQRCode = qr; waConnected = false; console.log('[WA] QR ready'); }
      if (connection === 'open') { 
        waConnected = true; waQRCode = null;
        waPhone = waSocket.user?.id?.split(':')[0];
        console.log('[WA] Connected:', waPhone);
      }
      if (connection === 'close') {
        waConnected = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code !== DisconnectReason.loggedOut) {
          console.log('[WA] Reconnecting...');
          setTimeout(startWA, 5000);
        }
      }
    });

    waSocket.ev.on('creds.update', saveCreds);

    waSocket.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
      if (type !== 'notify') return;
      for (const msg of msgs) {
        if (msg.key.fromMe) continue;
        const body  = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const from  = msg.key.remoteJid;
        const phone = from.replace('@s.whatsapp.net','');
        const name  = msg.pushName || phone;
        if (!body) continue;
        waMessages.push({ phone, name, body, time: new Date().toISOString(), direction: 'in' });
        if (waMessages.length > 100) waMessages.shift();
        console.log('[WA] MSG from', name, ':', body);
      }
    });
  } catch(e) {
    console.error('[WA Error]', e.message);
    setTimeout(startWA, 10000);
  }
}

// HTTP server for IPC with main server
const PORT = process.env.WA_PORT || 3001;
createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'GET' && req.url === '/status') {
    res.end(JSON.stringify({ connected: waConnected, qr: waQRCode, phone: waPhone }));
  } else if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { phone, message } = JSON.parse(body);
        if (!waSocket || !waConnected) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Not connected' })); return; }
        await waSocket.sendMessage(phone.replace(/\D/g,'') + '@s.whatsapp.net', { text: message });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    });
  } else if (req.method === 'GET' && req.url === '/messages') {
    res.end(JSON.stringify(waMessages.slice(-50)));
  } else if (req.method === 'POST' && req.url === '/restart') {
    if (waSocket) waSocket.logout().catch(()=>{});
    waSocket = null; waConnected = false; waQRCode = null;
    startWA();
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
  }
}).listen(PORT, () => {
  console.log('[WA Worker] HTTP server on port', PORT);
  startWA();
});
