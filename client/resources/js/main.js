// Auth check before doing anything else
async function checkAuth() {
    try {
        // Try to get user ID from local storage, cookie, etc.
        // This is a placeholder - implement your actual UID retrieval method
        const uid = localStorage.getItem('uid') || getCookie('userId');

        if (!uid) {
            location.href = '/login'; // Redirect to login page if no UID found
            throw new Error('No user ID found');
        }

        const urlEncodedUid = encodeURIComponent(uid);

        const authRes = await fetch(`https://api.ninjam.us:3001/auth/${urlEncodedUid}`);
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
        document.querySelector('.auth-message').textContent = 'No Access.';
        document.querySelector('.auth-description').textContent = 'You must be part of the Stitch beta program to access this site.';
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
    timeDisplay.textContent = isLive ? `${watchingFor(video.duration)}` : `${currentTime} / ${formatTime(hls.liveSyncPosition)}`;

    // Update play/pause button icon
    playPauseBtn.innerHTML = video.paused 
        ? '<i class="fa-solid fa-play"></i>' 
        : '<i class="fa-solid fa-pause"></i>';

    // Update mute button icon
    muteBtn.innerHTML = video.muted 
        ? '<i class="fa-solid fa-volume-xmark"></i>' 
        : '<i class="fa-solid fa-volume-high"></i>';
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
    updateControls(); // Update the icon immediately
});

liveIndicator.addEventListener('click', () => {
    if (hls && hls.liveSyncPosition) {
        video.currentTime = hls.liveSyncPosition;
        video.play();
    }
});

form.addEventListener('submit', (e) => {
    e.preventDefault();
    const channel = input.value.trim().toLowerCase();
    if (channel) {
        window.history.replaceState({}, '', `?channel=${channel}`);
        loadChannel(channel);
    }
});

// Modified loadChannel function to properly handle controls
const loadChannel = async (channel) => {
    if (!channel) {
        status.textContent = 'Please enter a channel name.';
        return;
    }

    status.textContent = `Loading stream for ${channel}`;

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
                
                // Add the class to hide the placeholder
                document.getElementById('video-container').classList.add('stream-active');

                // Start updating controls
                updateInterval = setInterval(updateControls, 500);
                
                // Reset controls visibility handling when stream loads
                resetControlsHandling();
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = data.proxy;
            video.addEventListener('loadedmetadata', () => {
                video.play();
                status.textContent = `Watching ${channel}`;
                
                // Add the class to hide the placeholder
                document.getElementById('video-container').classList.add('stream-active');

                // Start updating controls
                updateInterval = setInterval(updateControls, 500);
                
                // Reset controls visibility handling when stream loads
                resetControlsHandling();
            });
        } else {
            status.textContent = 'HLS not supported in this browser.';
        }

    } catch (err) {
        console.error(err);
        status.textContent = 'Failed to load stream.';
    }
};

let controlsTimeout = null;

// Updated showControls function with more reliable behavior
const showControls = () => {
    const controls = document.querySelector('.custom-controls');
    
    // Cancel any pending hide operation
    clearTimeout(controlsTimeout);
    
    // Force a DOM reflow to ensure the opacity transition works
    void controls.offsetWidth;
    
    controls.style.opacity = '1';
    controls.style.pointerEvents = 'auto';
    
    // Set timeout to hide controls after delay
    controlsTimeout = setTimeout(() => {
        hideControls();
    }, 3000); // Changed to 3 seconds as specified
};

// Updated hideControls with more reliable behavior
const hideControls = () => {
    const controls = document.querySelector('.custom-controls');
    
    // Only hide if not currently interacting with controls
    if (!isInteractingWithControls) {
        controls.style.opacity = '0';
        controls.style.pointerEvents = 'none';
    }
};

// Track if user is interacting with controls
let isInteractingWithControls = false;

// Update the video event handlers for better iPad compatibility
video.addEventListener('click', function(e) {
    e.stopPropagation();
    showControls();
    
    // Toggle play/pause on mobile devices
    if (isMobileDevice()) {
        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }
    }
});

// Improved touchstart handler for iPad
video.addEventListener('touchstart', function(e) {
    // Don't prevent default entirely to allow HLS to work properly
    e.stopPropagation();
    
    // Use a slight delay to avoid conflicts with HLS.js touch handlers
    setTimeout(() => {
        showControls();
    }, 10);
});

// Improve interaction tracking for controls
document.querySelector('.custom-controls').addEventListener('touchstart', () => {
    isInteractingWithControls = true;
    clearTimeout(controlsTimeout);
}, { passive: false });

document.querySelector('.custom-controls').addEventListener('touchend', () => {
    // Short delay before resetting the interaction flag
    setTimeout(() => {
        isInteractingWithControls = false;
        showControls(); // Reset the timer after interaction
    }, 100);
}, { passive: false });

// Improved resetControlsHandling function
const resetControlsHandling = () => {
    clearTimeout(controlsTimeout);
    
    const controls = document.querySelector('.custom-controls');
    
    if (isMobileDevice()) {
        // Always start with controls visible when stream loads
        controls.style.transition = 'none'; // Temporarily disable transitions
        controls.style.opacity = '1';
        controls.style.pointerEvents = 'auto';
        
        // Force reflow and restore transitions
        void controls.offsetWidth;
        controls.style.transition = '';
        
        // Set timeout to hide controls
        controlsTimeout = setTimeout(() => {
            hideControls();
        }, 3000);
    }
};

// Add specific detection for iPad
const isIPad = () => {
    return /iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
};

// Update mobile detection to include iPad
const isMobileDevice = () => {
    return /Android|webOS|iPhone|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
           isIPad() || 
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
};

const fullscreenBtn = document.getElementById('fullscreenBtn');
const videoContainer = document.getElementById('video-container');

// Toggle fullscreen mode
const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
        videoContainer.requestFullscreen().catch((err) => {
            console.error(`Error attempting to enable fullscreen: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
};

// Update fullscreen button icon
const updateFullscreenIcon = () => {
    const isFullscreen = !!document.fullscreenElement;
    fullscreenBtn.innerHTML = isFullscreen
        ? '<i class="fa-solid fa-compress"></i>'
        : '<i class="fa-solid fa-expand"></i>';
};

// Add event listeners
fullscreenBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFullscreenIcon);