const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const cors = require('cors');

const app = express();
const PORT = 3001;

const SSL_OPTIONS = {
  key: fs.readFileSync('./certs/privkey.pem'),
  cert: fs.readFileSync('./certs/fullchain.pem'),
};

// Only allow your frontend
app.use(cors());

// Stream cache: { [channel]: { url, timestamp } }
const streamCache = new Map();

function sanitizeChannelName(name) {
  return name.trim().toLowerCase();
}

function handleStreamRequest(channel, res) {
  const clean = sanitizeChannelName(channel);

  if (!/^[a-z0-9_]+$/.test(clean)) {
    return res.status(400).json({ error: 'Invalid channel name' });
  }

  const cached = streamCache.get(clean);
  if (cached && Date.now() - cached.timestamp < 30_000) {
    return res.json({ proxy: cached.url });
  }

  const cmd = `streamlink https://www.twitch.tv/${clean} best --stream-url`;

  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`[Streamlink Error] ${stderr}`);
      return res.status(500).json({ error: stderr || 'Stream not available' });
    }

    const m3u8 = stdout.trim();
    const encoded = Buffer.from(m3u8).toString('base64');
    const proxyUrl = `https://api.ninjam.us:3000/${encoded}.m3u8`;

    streamCache.set(clean, {
      url: proxyUrl,
      timestamp: Date.now(),
    });

    return res.json({ proxy: proxyUrl });
  });
}

// Route: /twitch?channel=name
app.get('/twitch', (req, res) => {
  const channel = req.query.channel;
  if (!channel) {
    return res.status(400).json({ error: 'Missing channel query parameter' });
  }

  handleStreamRequest(channel, res);
});

// Route: /twitch/:channel
app.get('/twitch/:channel', (req, res) => {
  const { channel } = req.params;
  handleStreamRequest(channel, res);
});

// Route: /auth/:urlencodedemail
app.get('/auth/:urlencodedemail', (req, res) => {
  const { urlencodedemail } = req.params;
  const email = decodeURIComponent(urlencodedemail);

  if (!email || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Find the email in beta.txt (line-seperated emails)
  fs.readFile('./beta.txt', 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    const emails = data.split('\n').map(line => line.trim());
    if (emails.includes(email)) {
      return res.json({ authenticated: true });
    } else {
      return res.json({ authenticated: false });
    }
  });
});


// HTTPS server
https.createServer(SSL_OPTIONS, app).listen(PORT, () => {
  console.log(`Backend HTTPS server running on https://api.ninjam.us:${PORT}`);
});
