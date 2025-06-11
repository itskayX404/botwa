const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason } = require('@whiskeysockets/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const qrcode = require('qrcode-terminal');
const express = require('express');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const app = express();
app.get('/', (req, res) => res.send('🤖 Bot WhatsApp Aktif'));

// Endpoint untuk download session
app.get('/download-session', (req, res) => {
  const sessionPath = './session';
  
  // Cek apakah folder session ada
  if (!fs.existsSync(sessionPath)) {
    return res.status(404).send('❌ Folder session tidak ditemukan');
  }

  // Set header untuk download file ZIP
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="session-backup.zip"');

  // Buat archive ZIP
  const archive = archiver('zip', {
    zlib: { level: 9 } // Kompresi maksimal
  });

  archive.on('error', (err) => {
    console.error('❌ Error saat membuat ZIP:', err);
    res.status(500).send('❌ Gagal membuat backup session');
  });

  // Pipe archive ke response
  archive.pipe(res);

  // Tambahkan semua file dari folder session
  archive.directory(sessionPath, 'session');

  // Finalisasi archive
  archive.finalize();
  
  console.log('📦 Session backup sedang didownload...');
});

// Endpoint untuk download semua file project
app.get('/download-all', (req, res) => {
  // Set header untuk download file ZIP
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="project-backup.zip"');

  // Buat archive ZIP
  const archive = archiver('zip', {
    zlib: { level: 9 } // Kompresi maksimal
  });

  archive.on('error', (err) => {
    console.error('❌ Error saat membuat ZIP:', err);
    res.status(500).send('❌ Gagal membuat backup project');
  });

  // Pipe archive ke response
  archive.pipe(res);

  // Tambahkan semua file dan folder, kecuali node_modules
  archive.glob('**/*', {
    ignore: [
      'node_modules/**',
      '.git/**',
      '.gitignore',
      '*.log'
    ]
  });

  // Finalisasi archive
  archive.finalize();
  
  console.log('📦 Project backup sedang didownload...');
});

app.listen(3000, () => console.log('✅ Server Aktif di http://localhost:3000'));

// Anti-sleep (ping server sendiri setiap 25 detik)
setInterval(() => {
  require('http').get('http://localhost:3000');
}, 25000);

// Anti-spam per user (3 detik)
const userCooldown = {};

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const sock = makeWASocket({ auth: state });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) qrcode.generate(qr, { small: true });

    if (connection === 'open') {
      console.log('✅ Bot berhasil terhubung ke WhatsApp!');
    } else if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log('❌ Koneksi putus, alasan:', reason);
      if (reason !== DisconnectReason.loggedOut) {
        startBot(); // Reconnect
      } else {
        console.log('⚠️ Harus scan QR ulang.');
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.participant || from;
    const caption =
      msg.message?.imageMessage?.caption ||
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text;

    // Cek anti-spam
    if (userCooldown[sender] && Date.now() - userCooldown[sender] < 3000) {
      console.log(`⏱ User ${sender} spam, abaikan.`);
      return;
    }
    userCooldown[sender] = Date.now();

    // Menu
    if (caption === '!menu') {
      await sock.sendMessage(from, {
        text: '📋 Menu Bot:\n\n- Kirim gambar dengan caption *!stiker* atau reply gambar dengan *!stiker* → untuk buat stiker\n- !menu → Tampilkan menu'
      });
      return;
    }

    // Kirim gambar dengan caption !stiker
    if (caption === '!stiker' && msg.message.imageMessage) {
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: sock.logger });
        const sticker = new Sticker(buffer, {
          pack: 'KaBot 🤖',
          author: 'Cindy PUNYA GUA ( kay )',
          type: StickerTypes.FULL,
          quality: 70
        });
        const stickerBuffer = await sticker.toBuffer();
        await sock.sendMessage(from, { sticker: stickerBuffer });
      } catch (err) {
        console.error('❌ Gagal buat stiker:', err);
        await sock.sendMessage(from, { text: '❌ Gagal membuat stiker dari gambar tersebut.' });
      }
    }

    // Balas gambar dengan !stiker
    if (caption === '!stiker' && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
      try {
        const quoted = msg.message.extendedTextMessage.contextInfo;
        const buffer = await downloadMediaMessage(
          { message: quoted.quotedMessage, key: { remoteJid: from, id: quoted.stanzaId, fromMe: false } },
          'buffer',
          {},
          { logger: sock.logger }
        );

        const sticker = new Sticker(buffer, {
          pack: 'KaBot 🤖',
          author: 'Cindy PUNYA GUA ( kay )',
          type: StickerTypes.FULL,
          quality: 70
        });
        const stickerBuffer = await sticker.toBuffer();
        await sock.sendMessage(from, { sticker: stickerBuffer });
      } catch (err) {
        console.error('❌ Gagal buat stiker dari balasan:', err);
        await sock.sendMessage(from, { text: '❌ Gagal membuat stiker. Pastikan kamu membalas gambar dengan benar.' });
      }
    }
  });
}

startBot();