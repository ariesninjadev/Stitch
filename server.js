const express = require('express');
const { exec } = require('child_process');
const app = express();
const PORT = 8080; // Your API endpoint, not the HLSD port

app.get('/twitch/:channel', (req, res) => {
  const channel = req.params.channel;
  const cmd = `~/.local/bin/streamlink https://www.twitch.tv/${channel} best --stream-url`;

  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`[ERROR] ${stderr}`);
      return res.status(500).json({ error: 'Failed to fetch stream URL' });
    }

    const m3u8 = stdout.trim();
    const encoded = Buffer.from(m3u8).toString('base64');
    const proxyUrl = `http://localhost:3000/proxy/${encoded}.m3u8`; // HLSD must be running here

    return res.json({ proxy: proxyUrl });
  });
});

app.listen(PORT, () => {
  console.log(`Node proxy server listening on http://localhost:${PORT}`);
});
