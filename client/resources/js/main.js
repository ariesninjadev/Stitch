// Auth check before doing anything else
async function checkAuth() {
    try {
        // Try to get user ID from local storage, cookie, etc.
        // This is a placeholder - implement your actual UID retrieval method
        const uid = localStorage.getItem('uid');
        const sv = localStorage.getItem('secVersion');

        if ((!uid) || sv != 2) {
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

let streamStartTime = null;
let viewingStartTime = null;

const form = document.getElementById('form');
const input = document.getElementById('channelInput');
const status = document.getElementById('status');
const video = document.getElementById('video');
const liveIndicator = document.getElementById('liveIndicator');
const playPauseBtn = document.getElementById('playPauseBtn');
const muteBtn = document.getElementById('muteBtn');
const timeDisplay = document.getElementById('timeDisplay');

let userManuallyMuted = false;
let autoUnmuteEnabled = true;
let isFirstTimeLoad = true;
const audioNotificationText = document.getElementById('audio-notification-text');
const audioNotification = document.getElementById('audio-notification');
const dismissAudioBtn = document.getElementById('dismiss-audio-notice');

let hls = null;
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

    if (video.paused) {
        return `Paused`;
    }

    if (viewingStartTime) {
        const watchingDuration = Math.floor((Date.now() - viewingStartTime) / 1000);
        return `Watching for ${formatTime(watchingDuration)}`;
    }

    return 'LIVE';
}

function handlePlayPause() {
    if (video.paused) {
        // Store the current timestamp when paused
        if (viewingStartTime) {
            // Save how much time we've watched so far
            const watchedSoFar = Date.now() - viewingStartTime;
            // Store this as a data attribute on the video element
            video.dataset.watchedTime = watchedSoFar;
        }
        video.play();
    } else {
        isLiveIndicatorActive = false;
        video.pause();
    }

    // Update the viewing start time when resuming playback
    if (!video.paused && video.dataset.watchedTime) {
        // Adjust the viewingStartTime to account for the time already watched
        viewingStartTime = Date.now() - parseInt(video.dataset.watchedTime, 10);
    } else if (!video.paused && !viewingStartTime) {
        // If this is the first time play is pressed, set the start time
        viewingStartTime = Date.now();
    }
}

// Function to show the audio notification
function showAudioNotification() {
    // Update notification text based on context
    if (!userManuallyMuted && autoUnmuteEnabled && isFirstTimeLoad) {
        audioNotificationText.textContent = "Stream is muted. Click anywhere to unmute.";
    } else {
        audioNotificationText.textContent = "Stream is muted.";
    }

    audioNotification.classList.add('visible');

    // Auto-hide after 8 seconds
    setTimeout(() => {
        if (audioNotification.classList.contains('visible')) {
            audioNotification.classList.remove('visible');
        }
    }, 8000);
}

// Function to hide audio notification
function hideAudioNotification() {
    audioNotification.classList.remove('visible');
}

// Add click listener to dismiss button
dismissAudioBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent triggering the auto-unmute
    hideAudioNotification();
    autoUnmuteEnabled = false; // Disable auto-unmute if user dismisses notice
});

// Auto-unmute when user clicks anywhere (if they haven't manually muted)
document.addEventListener('click', (e) => {
    // Only auto-unmute if:
    // 1. Video exists and is currently muted
    // 2. User hasn't manually muted
    // 3. Auto-unmute feature is enabled
    // 4. The loading overlay is not visible (added check)
    const loadingOverlay = document.getElementById('stream-loading-overlay');
    const isLoadingVisible = loadingOverlay.classList.contains('visible');

    if (video && video.muted && !userManuallyMuted && autoUnmuteEnabled && !isLoadingVisible) {
        video.muted = false;
        hideAudioNotification();
        isFirstTimeLoad = false; // No longer first time once unmuted
        updateControls(); // Update the mute button icon
    }
});

let isLiveIndicatorActive = true;

// Update seekbar and controls
const updateControls = () => {
    if (!hls || isNaN(video.duration)) return;

    // Consider stream as not "live" if it's paused
    const isLive = !video.paused;
    liveIndicator.classList.toggle('inactive', !isLiveIndicatorActive);

    // Update time display
    timeDisplay.textContent = `${watchingFor(video.currentTime)}`;

    // Update play/pause button icon
    playPauseBtn.innerHTML = video.paused
        ? '<i class="fa-solid fa-play"></i>'
        : '<i class="fa-solid fa-pause"></i>';

    // Update mute button icon
    muteBtn.innerHTML = video.muted
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';
};

// Control button event listeners
playPauseBtn.addEventListener('click', handlePlayPause);

// Update the mute button click handler to track manual muting
muteBtn.addEventListener('click', () => {
    userManuallyMuted = !video.muted; // Will be true if user mutes, false if user unmutes
    isFirstTimeLoad = false; // No longer first time once user interacts with mute
    video.muted = !video.muted;

    // Show/hide notification based on mute state
    if (video.muted) {
        showAudioNotification();
    } else {
        hideAudioNotification();
    }

    updateControls(); // Update the icon immediately
});

liveIndicator.addEventListener('click', () => {
    if (hls && hls.liveSyncPosition) {
        video.currentTime = hls.liveSyncPosition;
        isLiveIndicatorActive = true;
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

    var displayChannel = channel;
    var isFRC = false;

    // FRC event custom formatting
    if (channel.startsWith('firstinspires_')) {
        isFRC = true;
        displayChannel = channel.replace('firstinspires_', '');
        displayChannel = displayChannel.charAt(0).toUpperCase() + displayChannel.slice(1) + " Division";
    }

    streamStartTime = null;
    viewingStartTime = null;

    userManuallyMuted = false;
    autoUnmuteEnabled = true;

    status.textContent = `Loading stream for ${displayChannel}`;

    try {
        const res = await fetch(`https://api.ninjam.us:3001/twitch/${channel}`);
        const data = await res.json();

        const functionalVerb = isFRC ? 'active' : 'streaming';

        if (!data.proxy) {
            if (data.error === 'Stream not available') {
                status.textContent = `${displayChannel} is not currently ${functionalVerb}.`;
                return;
            } else {
                status.textContent = `Error: ${data.error || 'No stream found'}`;
                return;
            }
        }

        streamStartTime = Date.now();

        video.pause();
        video.removeAttribute('src');
        video.load();
        if (hls) {
            hls.destroy();
            hls = null;
        }

        clearInterval(updateInterval);

        // Show loading overlay before starting the stream
        const loadingOverlay = document.getElementById('stream-loading-overlay');
        loadingOverlay.classList.add('visible');

        const countdownElement = document.getElementById('countdown-timer');
        let timeLeft = 16;
        countdownElement.textContent = timeLeft - 1;

        // Start countdown timer
        const countdownInterval = setInterval(() => {
            timeLeft -= 1;
            if (timeLeft <= 0) {
                clearInterval(countdownInterval);
                loadingOverlay.classList.remove('visible');
            } else {
                countdownElement.textContent = timeLeft - 1;
            }
        }, 1000);

        // Clear any existing timeout
        if (window.loadingTimeout) {
            clearTimeout(window.loadingTimeout);
        }

        // Set a backup timer to hide the overlay after 16 seconds in case the interval fails
        window.loadingTimeout = setTimeout(() => {
            clearInterval(countdownInterval);
            loadingOverlay.classList.remove('visible');

            // Show audio notification AFTER loading overlay disappears
            // but only if the video is still muted
            if (video.muted) {
                setTimeout(() => {
                    showAudioNotification();
                }, 300); // Small delay for visual separation
            }
        }, 16000);

        if (Hls.isSupported()) {
            hls = new Hls({
                // Buffer configuration
                maxBufferLength: 90,               // Increase buffer length to 90 seconds
                maxMaxBufferLength: 120,           // Maximum buffer length can grow to 120 seconds
                maxBufferSize: 60 * 1000 * 1000,   // Increase max buffer size to 60MB
                maxBufferHole: 1,                  // More tolerant of buffer holes (1 second)

                // Live stream settings
                liveSyncDuration: 10,              // Target being 10 seconds behind live edge
                liveMaxLatencyDuration: 60,        // Accept up to 60 seconds behind live
                liveDurationInfinity: true,        // Treat live streams as infinite duration

                // Bandwidth estimation and ABR settings
                abrEwmaDefaultEstimate: 1000000,   // Default bandwidth estimate (1 Mbps)
                abrEwmaFastLive: 3.0,              // Faster ABR reactions for live content
                abrBandWidthFactor: 0.8,           // More conservative bandwidth usage (80%)
                abrBandWidthUpFactor: 0.7,         // Slower bitrate switching up

                // Stability settings
                fragLoadingTimeOut: 20000,         // Longer timeout for segment loading (20s)
                manifestLoadingTimeOut: 15000,     // Longer timeout for manifest loading (15s)
                fragLoadingMaxRetry: 6,            // More retries for failed segments

                // Recovery behavior
                startLevel: -1,                    // Auto select starting quality level
                startFragPrefetch: true,           // Prefetch initial fragments
                lowLatencyMode: false,             // Disable low latency mode to favor stability

                // Reduce CPU usage
                stretchShortVideoTrack: true,      // Handle short segments better
                forceKeyFrameOnDiscontinuity: true // Force keyframes on discontinuities
            });

            hls.loadSource(data.proxy);
            hls.attachMedia(video);

            hls.on(Hls.Events.BUFFER_APPENDED, () => {
                if (video.buffered.length > 0) {
                    const bufferStart = video.buffered.start(0);
                    const bufferEnd = video.buffered.end(video.buffered.length - 1);
                    const currentTime = video.currentTime;

                    // If buffer grows beyond 2 minutes, trim it
                    if (bufferEnd - bufferStart > 150 && currentTime > bufferStart + 60) {
                        // console.log('Trimming excessive buffer by seeking');
                        // // Keep a full minute of backward buffer
                        // video.currentTime = Math.max(currentTime, bufferStart + 30);
                    }
                }
            });

            // Add error recovery handling
            hls.on(Hls.Events.ERROR, function (event, data) {
                if (data.fatal) {
                    clearInterval(countdownInterval);
                    if (window.loadingTimeout) {
                        clearTimeout(window.loadingTimeout);
                    }
                    loadingOverlay.classList.remove('visible');
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.log('Fatal network error encountered, trying to recover...');
                            hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.log('Fatal media error encountered, trying to recover...');
                            hls.recoverMediaError();
                            break;
                        default:
                            console.log('Fatal error, cannot recover:', data);
                            hls.destroy();
                            break;
                    }
                }
            });

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                const seekTo = hls.liveSyncPosition || video.duration;
                if (!isNaN(seekTo)) {
                    video.currentTime = seekTo;
                }
                video.play();
                viewingStartTime = Date.now();
                isLiveIndicatorActive = true;
                status.textContent = `Watching ${channel}`;

                // Add the class to hide the placeholder
                document.getElementById('video-container').classList.add('stream-active');

                // Start updating controls
                updateInterval = setInterval(updateControls, 250);

                // Reset controls visibility handling when stream loads
                resetControlsHandling();

            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = data.proxy;
            video.addEventListener('loadedmetadata', () => {
                video.play();
                viewingStartTime = Date.now();
                isLiveIndicatorActive = true;
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
            clearInterval(countdownInterval);
            loadingOverlay.classList.remove('visible');
            if (window.loadingTimeout) {
                clearTimeout(window.loadingTimeout);
            }
        }

        video.addEventListener('error', () => {
            clearInterval(countdownInterval);
            loadingOverlay.classList.remove('visible');
            if (window.loadingTimeout) {
                clearTimeout(window.loadingTimeout);
            }
        }, { once: true });

    } catch (err) {
        console.error(err);
        status.textContent = 'Failed to load stream.';
        document.getElementById('stream-loading-overlay').classList.remove('visible');
    }
};

let controlsTimeout = null;
let inactivityTimeout = null;

const resetInactivityTimer = () => {
    // Clear any existing inactivity timer
    clearTimeout(inactivityTimeout);

    // Show controls when there's activity
    showControls();

    // Set new inactivity timer - hide controls after 5 seconds of inactivity
    inactivityTimeout = setTimeout(() => {
        hideControls();
    }, 5000); // 5 seconds inactivity timeout
};

// Updated showControls function with more reliable behavior
const showControls = () => {
    const controls = document.querySelector('.custom-controls');

    // Cancel any pending hide operation
    clearTimeout(controlsTimeout);

    // Force a DOM reflow to ensure the opacity transition works
    void controls.offsetWidth;

    controls.style.opacity = '1';
    controls.style.pointerEvents = 'auto';
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

// Update video click handler
video.addEventListener('click', function (e) {
    e.stopPropagation();
    resetInactivityTimer();

    // Toggle play/pause on mobile devices
    if (isMobileDevice()) {
        // Show the controls immediately on click
        showControls();
    }
});

// Update video touch handler
video.addEventListener('touchstart', function (e) {
    e.stopPropagation();

    // Use a slight delay to avoid conflicts with HLS.js touch handlers
    setTimeout(() => {
        resetInactivityTimer();
    }, 10);
});

// Improve interaction tracking for controls
document.querySelector('.custom-controls').addEventListener('touchstart', () => {
    isInteractingWithControls = true;
    clearTimeout(controlsTimeout);
    clearTimeout(inactivityTimeout); // Also clear inactivity timeout
}, { passive: false });

document.querySelector('.custom-controls').addEventListener('touchend', () => {
    // Short delay before resetting the interaction flag
    setTimeout(() => {
        isInteractingWithControls = false;
        resetInactivityTimer(); // Reset inactivity timer after interaction
    }, 100);
}, { passive: false });

// Initialize controls state when the player is ready
video.addEventListener('loadedmetadata', resetInactivityTimer);

// Improved resetControlsHandling function
const resetControlsHandling = () => {
    clearTimeout(controlsTimeout);
    clearTimeout(inactivityTimeout);

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
        resetInactivityTimer();
    }
};

document.addEventListener('mousemove', resetInactivityTimer);
document.addEventListener('touchstart', resetInactivityTimer);
document.addEventListener('click', resetInactivityTimer);

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

// Stream directory functionality
document.addEventListener('DOMContentLoaded', function () {

    isFirstTimeLoad = true;

    const streamCards = document.querySelectorAll('.stream-card');

    streamCards.forEach(card => {
        card.addEventListener('click', function () {
            const channel = this.getAttribute('data-channel');
            if (channel) {
                // Update input field with the selected channel
                input.value = channel;

                // Load the selected channel
                loadChannel(channel);

                // Update URL parameter
                window.history.replaceState({}, '', `?channel=${channel}`);

                // Remove active class from all cards
                streamCards.forEach(c => c.classList.remove('active'));

                // Add active class to the clicked card
                this.classList.add('active');
            }
        });
    });

    // Mark active card based on current channel
    const currentChannel = getQueryParam('channel');
    if (currentChannel) {
        const activeCard = Array.from(streamCards).find(
            card => card.getAttribute('data-channel') === currentChannel
        );

        if (activeCard) {
            activeCard.classList.add('active');
        }
    }
});

// Handle when video naturally pauses (buffering, ended, etc.)
video.addEventListener('pause', () => {
    // Store time watched so far if we have a valid viewing start time
    if (viewingStartTime) {
        video.dataset.watchedTime = Date.now() - viewingStartTime;
    }
});

// Handle when video naturally plays (after buffering, etc.)
video.addEventListener('play', () => {
    // Restore the viewing timer if we have watched time data
    if (video.dataset.watchedTime) {
        viewingStartTime = Date.now() - parseInt(video.dataset.watchedTime, 10);
    } else if (!viewingStartTime) {
        // If this is the first play, set new viewing start time
        viewingStartTime = Date.now();
    }
});