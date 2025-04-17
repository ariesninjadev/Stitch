const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const cors = require('cors');

const app = express();
const PORT = 3001;

// SSL certs
const SSL_OPTIONS = {
  key: fs.readFileSync('./certs/privkey.pem'),
  cert: fs.readFileSync('./certs/fullchain.pem'),
};

// Allow only your frontend
app.use(cors({
  origin: 'https://stitch-coy.pages.dev',
}));

// Cache for stream URLs
const streamCache = new Map();

function sanitizeChannelName(name) {
  return name.trim().toLowerCase();
}

app.get('/twitch/:channel?', (req, res) => {
  const raw = req.params.channel || req.query.channel;
  if (!raw) return res.status(400).json({ error: 'No channel specified' });

  const channel = sanitizeChannelName(raw);

  if (!/^[a-z0-9_]+$/.test(channel)) {
    return res.status(400).json({ error: 'Invalid channel name' });
  }

  const cached = streamCache.get(channel);
  if (cached && Date.now() - cached.timestamp < 30_000) {
    return res.json({ proxy: cached.url });
  }

  const cmd = `streamlink https://www.twitch.tv/${channel} best --stream-url`;
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`[Streamlink Error] ${stderr}`);
      return res.status(500).json({ error: stderr || 'Failed to fetch stream URL' });
    }

    const m3u8 = stdout.trim();
    const encoded = Buffer.from(m3u8).toString('base64');
    const proxyUrl = `https://api.ninjam.us:3000/${encoded}.m3u8`;

    streamCache.set(channel, {
      url: proxyUrl,
      timestamp: Date.now(),
    });

    return res.json({ proxy: proxyUrl });
  });
});

https.createServer(SSL_OPTIONS, app).listen(PORT, () => {
  console.log(`Backend HTTPS server running on https://api.ninjam.us:${PORT}`);
});
