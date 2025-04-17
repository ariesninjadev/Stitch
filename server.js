const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const app = express();

const SSL_OPTIONS = {
  key: fs.readFileSync('/etc/letsencrypt/live/api.ninjam.us/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/api.ninjam.us/cert.pem')
};

const PORT = 3001;

app.get('/twitch/:channel', (req, res) => {
  const channel = req.params.channel;
  const cmd = `streamlink https://www.twitch.tv/${channel} best --stream-url`;

  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`[ERROR] ${stderr}`);
      return res.status(500).json({ error: 'Failed to fetch stream URL' });
    }

    const m3u8 = stdout.trim();
    const encoded = Buffer.from(m3u8).toString('base64');
    const proxyUrl = `https://api.ninjam.us:3000/proxy/${encoded}.m3u8`;

    return res.json({ proxy: proxyUrl });
  });
});

https.createServer(SSL_OPTIONS, app).listen(PORT, () => {
  console.log(`HTTPS server running at https://localhost:${PORT}`);
});
