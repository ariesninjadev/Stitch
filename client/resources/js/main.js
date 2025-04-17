// Auth check before doing anything else
async function checkAuth() {
    try {
      // Try to get user ID from local storage, cookie, etc.
      // This is a placeholder - implement your actual UID retrieval method
      const uid = localStorage.getItem('userId') || getCookie('userId');
      
      if (!uid) {
        location.href = '/login'; // Redirect to login page if no UID found
        throw new Error('No user ID found');
      }
      
      const authRes = await fetch(`https://api.ninjam.us:3001/auth/${uid}`);
      const authData = await authRes.json();
      
      if (authData.authenticated) {
        // Auth successful, show main content
        document.getElementById('auth-loading').style.display = 'none';
        document.getElementById('main-content').style.display = 'block';
        
        // Check for initial channel after authentication succeeds
        const initialChannel = getQueryParam('channel');
        if (initialChannel) {
          input.value = initialChannel;
          loadChannel(initialChannel);
        }
      } else {
        throw new Error('Authentication failed');
      }
    } catch (err) {
      console.error('Auth error:', err);
      document.querySelector('.auth-message').textContent = 'Authentication failed';
      document.getElementById('login-link').style.display = 'inline-block';
    }
  }
  
  // Helper function to get cookie value
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
  }

  // Start auth check
  checkAuth();

  const form = document.getElementById('form');
  const input = document.getElementById('channelInput');
  const status = document.getElementById('status');
  const video = document.getElementById('video');
  const liveIndicator = document.getElementById('liveIndicator');
  const seekbar = document.getElementById('seekbar');
  const seekbarProgress = document.getElementById('seekbar-progress');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const muteBtn = document.getElementById('muteBtn');
  const timeDisplay = document.getElementById('timeDisplay');

  let hls = null;
  let isDraggingSeekbar = false;
  let updateInterval;

  const getQueryParam = (key) => {
    const params = new URLSearchParams(window.location.search);
    return params.get(key);
  };

  const isAtLiveEdge = () => {
    if (!hls || !hls.liveSyncPosition || isNaN(video.currentTime)) return false;
    return Math.abs(video.currentTime - hls.liveSyncPosition) < 3;
  };

  // Format time as MM:SS
  const formatTime = (seconds) => {
    seconds = Math.floor(seconds);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  function watchingFor() {
      if (hls && hls.liveSyncPosition) {
          return `Watching for ${formatTime(hls.liveSyncPosition)}`;
      } else {
          return 'LIVE';
      }
  }

  // Update seekbar and controls
  const updateControls = () => {
    if (!hls || isNaN(video.duration)) return;
    
    const isLive = isAtLiveEdge();
    liveIndicator.classList.toggle('inactive', !isLive);

    // If at live edge, make seekbar look like it's at the end
    let progressPercentage;
    if (isLive) {
      progressPercentage = 100;
    } else {
      const bufferedEnd = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
      progressPercentage = (video.currentTime / bufferedEnd) * 100;
    }
    
    if (!isDraggingSeekbar) {
      seekbarProgress.style.width = `${progressPercentage}%`;
    }

    // Update time display
    const currentTime = formatTime(video.currentTime);
    const duration = isLive ? "LIVE" : formatTime(video.duration);
    timeDisplay.textContent = isLive ? `${watchingFor(video.duration)}` : `${currentTime} / ${formatTime(video.duration)}`;

    // Update play/pause button
    playPauseBtn.textContent = video.paused ? "Play" : "Pause";
    
    // Update mute button
    muteBtn.textContent = video.muted ? "Unmute" : "Mute";
  };

  // Seekbar event listeners
  seekbar.addEventListener('mousedown', (e) => {
    isDraggingSeekbar = true;
    updateSeekPosition(e);
  });

  document.addEventListener('mousemove', (e) => {
    if (isDraggingSeekbar) {
      updateSeekPosition(e);
    }
  });

  document.addEventListener('mouseup', () => {
    isDraggingSeekbar = false;
  });

  const updateSeekPosition = (e) => {
    if (!video.buffered.length) return;
    
    const rect = seekbar.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const bufferedEnd = video.buffered.end(video.buffered.length - 1);
    
    video.currentTime = Math.min(Math.max(0, pos * bufferedEnd), bufferedEnd);
    seekbarProgress.style.width = `${pos * 100}%`;
  };

  // Control button event listeners
  playPauseBtn.addEventListener('click', () => {
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  });

  muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    muteBtn.textContent = video.muted ? "Unmute" : "Mute";
  });

  liveIndicator.addEventListener('click', () => {
    if (hls && hls.liveSyncPosition) {
      video.currentTime = hls.liveSyncPosition;
      video.play();
    }
  });

  const loadChannel = async (channel) => {
    if (!channel) {
      status.textContent = 'Please enter a channel name.';
      return;
    }

    status.textContent = `Loading stream for ${channel}...`;

    try {
      const res = await fetch(`https://api.ninjam.us:3001/twitch/${channel}`);
      const data = await res.json();

      if (!data.proxy) {
        status.textContent = `Error: ${data.error || 'No stream found'}`;
        return;
      }

      video.pause();
      video.removeAttribute('src');
      video.load();
      if (hls) {
        hls.destroy();
        hls = null;
      }
      
      clearInterval(updateInterval);

      if (Hls.isSupported()) {
        hls = new Hls();
        hls.loadSource(data.proxy);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          const seekTo = hls.liveSyncPosition || video.duration;
          if (!isNaN(seekTo)) {
            video.currentTime = seekTo;
          }
          video.play();
          status.textContent = `Watching ${channel}`;
          
          // Start updating controls
          updateInterval = setInterval(updateControls, 500);
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = data.proxy;
        video.addEventListener('loadedmetadata', () => {
          video.play();
          status.textContent = `Watching ${channel}`;
          
          // Start updating controls
          updateInterval = setInterval(updateControls, 500);
        });
      } else {
        status.textContent = 'HLS not supported in this browser.';
      }

    } catch (err) {
      console.error(err);
      status.textContent = 'Failed to load stream.';
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const channel = input.value.trim().toLowerCase();
    if (channel) {
      window.history.replaceState({}, '', `?channel=${channel}`);
      loadChannel(channel);
    }
  });