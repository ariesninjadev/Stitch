const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3001;

const SSL_OPTIONS = {
  key: fs.readFileSync('./certs/privkey.pem'),
  cert: fs.readFileSync('./certs/fullchain.pem'),
};

// Only allow your frontend
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Stream cache: { [channel]: { url, timestamp } }
const streamCache = new Map();

function sanitizeChannelName(name) {
  return name.trim().toLowerCase();
}

// Update the handleStreamRequest function to specify a lower quality option

function handleStreamRequest(channel, res) {
  const clean = sanitizeChannelName(channel);

  if (!/^[a-z0-9_]+$/.test(clean)) {
      return res.status(400).json({ error: 'Invalid channel name' });
  }

  const cached = streamCache.get(clean);
  if (cached && Date.now() - cached.timestamp < 30_000) {
      return res.json({ proxy: cached.url });
  }

  // Modified to prefer 720p60 or 720p streams which require less bandwidth
  // The order is: try 720p60 first, then 720p, then best available
  const cmd = `streamlink https://www.twitch.tv/${clean} 720p60,720p,best --stream-url --twitch-disable-ads --hls-segment-threads 2 --hls-segment-timeout 10 --hls-timeout 60`;

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

    const emails = data.split('\n').map(line => line.trim()).filter(Boolean);
    if (emails.includes(email)) {
      return res.json({ authenticated: true });
    } else {
      return res.json({ authenticated: false });
    }
  });
});

// Beta admin interface
app.get('/admin', (req, res) => {
  fs.readFile('./beta.txt', 'utf8', (err, data) => {
    if (err) {
      return res.status(500).send('Error reading beta users file');
    }
    
    const emails = data.split('\n').map(email => email.trim()).filter(Boolean);
    
    // Send HTML page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Beta Users Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; line-height: 1.6; }
          .container { max-width: 800px; margin: 0 auto; }
          h1 { color: #333; }
          .user-list { margin: 20px 0; }
          .user-item { 
            display: flex; 
            justify-content: space-between; 
            padding: 8px;
            border-bottom: 1px solid #eee;
          }
          .user-item:hover { background-color: #f9f9f9; }
          form { margin: 20px 0; }
          input[type="email"] { 
            padding: 8px; 
            width: 300px;
            border: 1px solid #ddd;
            border-radius: 4px;
          }
          button {
            padding: 8px 16px;
            background-color: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
          }
          .remove-btn {
            background-color: #f44336;
            padding: 4px 8px;
          }
          button:hover { opacity: 0.9; }
          .count { margin-bottom: 20px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Beta Users Management</h1>
          
          <form action="/admin/add" method="POST">
            <h2>Add User</h2>
            <input type="email" name="email" placeholder="Enter email address" required>
            <button type="submit">Add to Beta</button>
          </form>

          <div class="count">Total beta users: ${emails.length}</div>
          
          <h2>Current Beta Users</h2>
          <div class="user-list">
            ${emails.map(email => `
              <div class="user-item">
                <span>${email}</span>
                <form action="/admin/remove" method="POST" style="margin:0">
                  <input type="hidden" name="email" value="${email}">
                  <button type="submit" class="remove-btn">Remove</button>
                </form>
              </div>
            `).join('')}
          </div>
        </div>
      </body>
      </html>
    `);
  });
});

// Add a beta user
app.post('/admin/add', (req, res) => {
  const { email } = req.body;
  
  if (!email || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
    return res.status(400).send('Invalid email address');
  }

  fs.readFile('./beta.txt', 'utf8', (err, data) => {
    if (err) {
      return res.status(500).send('Error reading beta users file');
    }

    let emails = data.split('\n').map(line => line.trim()).filter(Boolean);
    
    if (emails.includes(email)) {
      return res.redirect('/admin?message=User already exists');
    }

    emails.push(email);
    
    fs.writeFile('./beta.txt', emails.join('\n') + '\n', err => {
      if (err) {
        return res.status(500).send('Error writing to beta users file');
      }
      res.redirect('/admin');
    });
  });
});

// Remove a beta user
app.post('/admin/remove', (req, res) => {
  const { email } = req.body;
  
  fs.readFile('./beta.txt', 'utf8', (err, data) => {
    if (err) {
      return res.status(500).send('Error reading beta users file');
    }

    let emails = data.split('\n').map(line => line.trim()).filter(Boolean);
    emails = emails.filter(e => e !== email);
    
    fs.writeFile('./beta.txt', emails.join('\n') + '\n', err => {
      if (err) {
        return res.status(500).send('Error writing to beta users file');
      }
      res.redirect('/admin');
    });
  });
});

// HTTPS server
https.createServer(SSL_OPTIONS, app).listen(PORT, () => {
  console.log(`Backend HTTPS server running on https://api.ninjam.us:${PORT}`);
});