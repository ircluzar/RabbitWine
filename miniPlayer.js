// miniPlayer.js - Global mini player for navigation between pages while music is playing

class GlobalMiniPlayer {
    constructor() {
        this.isCreated = false;
        this.musicPlayer = null;
        this.init();
    }
    
    init() {
        // Check if we're on the jams page and if the music player exists
        if (window.musicPlayer) {
            this.musicPlayer = window.musicPlayer;
            this.createMiniPlayerForOtherPages();
        } else {
            // Check periodically if music player becomes available
            this.checkForMusicPlayer();
        }
    }
    
    checkForMusicPlayer() {
        const checkInterval = setInterval(() => {
            if (window.musicPlayer) {
                this.musicPlayer = window.musicPlayer;
                this.createMiniPlayerForOtherPages();
                clearInterval(checkInterval);
            }
        }, 100);
        
        // Stop checking after 5 seconds
        setTimeout(() => clearInterval(checkInterval), 5000);
    }
    
    createMiniPlayerForOtherPages() {
        // Only create if we're not on the jams page and player doesn't exist
        if (window.location.pathname.includes('/jams/') || this.isCreated) {
            return;
        }
        
        this.createMiniPlayerHTML();
        this.setupEventListeners();
        this.isCreated = true;
        
        // Update mini player state
        this.updateMiniPlayerFromJamsPage();
        
        // Check for updates periodically
        this.startUpdateLoop();
    }
    
    createMiniPlayerHTML() {
        const miniPlayerHTML = `
            <div id="globalMiniPlayer" class="global-mini-player" style="display: none;">
                <img id="globalMiniAlbumArt" class="global-mini-album-art" src="" alt="Album Art">
                <div class="global-mini-track-info">
                    <div id="globalMiniTrackTitle" class="global-mini-track-title">No track selected</div>
                    <div id="globalMiniTrackArtist" class="global-mini-track-artist">No artist</div>
                </div>
                <div class="global-mini-controls">
                    <button id="globalMiniPlayPauseBtn" class="global-mini-control-btn play" title="Play/Pause">▶</button>
                    <button id="globalMiniPlayerBtn" class="global-mini-control-btn player" title="Go to Player">🎵</button>
                    <button id="globalMiniCloseBtn" class="global-mini-control-btn close" title="Close Player">✕</button>
                </div>
                <div class="global-mini-progress">
                    <div id="globalMiniProgressFill" class="global-mini-progress-fill"></div>
                </div>
            </div>
        `;
        
        // Add CSS styles
        this.addMiniPlayerCSS();
        
        // Insert the mini player at the beginning of body
        document.body.insertAdjacentHTML('afterbegin', miniPlayerHTML);
    }
    
    addMiniPlayerCSS() {
        const css = `
            .global-mini-player {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                height: 60px;
                background: #3a3447;
                border-bottom: 1.5px solid #444;
                display: none;
                align-items: center;
                padding: 0 1rem;
                gap: 1rem;
                z-index: 1000;
                backdrop-filter: blur(10px);
                cursor: pointer;
                transition: all 0.2s ease;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            
            .global-mini-player:hover {
                background: #2d2738;
            }
            
            .global-mini-player.visible {
                display: flex !important;
            }
            
            .global-mini-album-art {
                width: 40px;
                height: 40px;
                border-radius: 8px;
                object-fit: cover;
                border: 1px solid #444;
            }
            
            .global-mini-track-info {
                flex: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            
            .global-mini-track-title {
                font-size: 0.9rem;
                font-weight: 500;
                color: #e2e2e2;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin: 0;
            }
            
            .global-mini-track-artist {
                font-size: 0.75rem;
                color: #a0a0a0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin: 0;
            }
            
            .global-mini-controls {
                display: flex;
                align-items: center;
                gap: 0.5rem;
            }
            
            .global-mini-control-btn {
                width: 32px;
                height: 32px;
                border-radius: 50%;
                background: #ccbcfc;
                color: #1a1626;
                border: none;
                font-size: 0.9rem;
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .global-mini-control-btn:hover {
                background: #b8a8f8;
                transform: scale(1.1);
            }
            
            .global-mini-control-btn.close {
                background: #3a3447;
                color: #a0a0a0;
                font-size: 0.8rem;
                font-weight: bold;
            }
            
            .global-mini-control-btn.close:hover {
                background: #e74c3c;
                color: #fff;
                transform: scale(1.1);
            }
            
            .global-mini-progress {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                height: 2px;
                background: rgba(255, 255, 255, 0.1);
            }
            
            .global-mini-progress-fill {
                height: 100%;
                background: #ccbcfc;
                width: 0%;
                transition: width 0.1s;
            }
            
            body.global-mini-player-visible {
                padding-top: 60px;
            }
            
            @media (max-width: 768px) {
                .global-mini-player {
                    padding: 0 0.5rem;
                    gap: 0.7rem;
                }
                
                .global-mini-track-title {
                    font-size: 0.8rem;
                }
                
                .global-mini-track-artist {
                    font-size: 0.7rem;
                }
                
                .global-mini-control-btn {
                    width: 28px;
                    height: 28px;
                    font-size: 0.8rem;
                }
            }
        `;
        
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }
    
    setupEventListeners() {
        const miniPlayer = document.getElementById('globalMiniPlayer');
        const playPauseBtn = document.getElementById('globalMiniPlayPauseBtn');
        const playerBtn = document.getElementById('globalMiniPlayerBtn');
        const closeBtn = document.getElementById('globalMiniCloseBtn');
        
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePlayPause();
            });
        }
        
        if (playerBtn) {
            playerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.goToPlayer();
            });
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showClearPlaylistConfirmation();
            });
        }
        
        if (miniPlayer) {
            miniPlayer.addEventListener('click', () => {
                this.goToPlayer();
            });
        }
    }
    
    togglePlayPause() {
        // Send message to jams page if it's open in another tab/window
        if (this.musicPlayer && this.musicPlayer.togglePlayPause) {
            this.musicPlayer.togglePlayPause();
        } else {
            // Try to communicate with jams page through localStorage
            const currentState = localStorage.getItem('jamsMusicState');
            if (currentState) {
                const state = JSON.parse(currentState);
                state.action = 'togglePlayPause';
                state.timestamp = Date.now();
                localStorage.setItem('jamsMusicAction', JSON.stringify(state));
            }
        }
    }
    
    goToPlayer() {
        // Navigate to jams player page - handle both from root and subdirectory
        const currentPath = window.location.pathname;
        let jamsPagePath;
        
        if (currentPath === '/' || currentPath.endsWith('/index.htm')) {
            // From root directory
            jamsPagePath = './jams/index.htm#player';
        } else {
            // From subdirectory
            jamsPagePath = '../jams/index.htm#player';
        }
        
        window.location.href = jamsPagePath;
    }
    
    showClearPlaylistConfirmation() {
        // First try to send action to jams page if it's open
        if (this.sendActionToJamsPage('showClearConfirmation')) {
            return; // Jams page will handle the confirmation
        }
        
        // Check if we have access to the Modals system (might be available on some pages)
        if (typeof window.Modals !== 'undefined') {
            // Use the modal system if available
            this.showModalConfirmation();
        } else {
            // Fallback to browser confirm dialog
            this.showBrowserConfirmation();
        }
    }
    
    sendActionToJamsPage(actionType) {
        try {
            // Check if there's an active music state (meaning jams page might be open)
            const currentState = localStorage.getItem('jamsMusicState');
            if (currentState) {
                const action = {
                    action: actionType,
                    timestamp: Date.now()
                };
                localStorage.setItem('jamsMusicAction', JSON.stringify(action));
                return true;
            }
        } catch (e) {
            console.warn('Could not send action to jams page:', e);
        }
        return false;
    }
    
    async showModalConfirmation() {
        try {
            let message = `Are you sure you want to discard your current playlist?`;
            
            // Try to get current track info from storage
            const storedState = localStorage.getItem('jamsMusicState');
            if (storedState) {
                const musicState = JSON.parse(storedState);
                if (musicState.currentTrack) {
                    const track = musicState.currentTrack;
                    message += `\n\nCurrently playing: "${track.title}" by ${track.creator}`;
                }
            }
            
            const confirmed = await window.Modals.confirm(
                message,
                'Clear Playlist',
                'Yes, Clear',
                'Cancel'
            );
            
            if (confirmed) {
                this.clearPlaylist();
            }
        } catch (e) {
            console.warn('Modal confirmation failed, falling back to browser confirm:', e);
            this.showBrowserConfirmation();
        }
    }
    
    showBrowserConfirmation() {
        const message = "Are you sure you want to discard your current playlist?\n\nThis will stop playback and clear your queue.";
        
        if (confirm(message)) {
            this.clearPlaylist();
        }
    }
    
    clearPlaylist() {
        // Clear the playlist through direct access if available
        if (this.musicPlayer && this.musicPlayer.clearPlaylistAndHideMiniPlayer) {
            this.musicPlayer.clearPlaylistAndHideMiniPlayer();
        } else if (this.sendActionToJamsPage('clearPlaylist')) {
            // Jams page will handle the clearing
            // Hide the global mini player immediately
            const miniPlayer = document.getElementById('globalMiniPlayer');
            if (miniPlayer) {
                miniPlayer.classList.remove('visible');
                document.body.classList.remove('global-mini-player-visible');
            }
        } else {
            // Fallback: clear localStorage and hide mini player
            try {
                localStorage.removeItem('jamsMusicState');
                localStorage.removeItem('JamsMusicState');
            } catch (e) {
                console.warn('Could not clear localStorage:', e);
            }
            
            // Hide the global mini player immediately
            const miniPlayer = document.getElementById('globalMiniPlayer');
            if (miniPlayer) {
                miniPlayer.classList.remove('visible');
                document.body.classList.remove('global-mini-player-visible');
            }
        }
    }
    
    updateMiniPlayerFromJamsPage() {
        // Try to get music state from localStorage or directly from musicPlayer
        let musicState = null;
        
        if (this.musicPlayer) {
            // Direct access to music player
            musicState = {
                isPlaying: this.musicPlayer.isPlaying,
                currentTrack: this.musicPlayer.currentPlaylist[this.musicPlayer.currentTrackIndex],
                currentPage: this.musicPlayer.currentPage,
                hasPlaylist: this.musicPlayer.currentPlaylist.length > 0,
                progress: this.musicPlayer.audio ? (this.musicPlayer.audio.currentTime / this.musicPlayer.audio.duration) * 100 : 0
            };
        } else {
            // Try localStorage
            const storedState = localStorage.getItem('jamsMusicState');
            if (storedState) {
                musicState = JSON.parse(storedState);
            }
        }
        
        if (musicState && musicState.hasPlaylist) {
            this.updateMiniPlayerDisplay(musicState);
        }
    }
    
    updateMiniPlayerDisplay(musicState) {
        const miniPlayer = document.getElementById('globalMiniPlayer');
        const albumArt = document.getElementById('globalMiniAlbumArt');
        const trackTitle = document.getElementById('globalMiniTrackTitle');
        const trackArtist = document.getElementById('globalMiniTrackArtist');
        const playPauseBtn = document.getElementById('globalMiniPlayPauseBtn');
        const progressFill = document.getElementById('globalMiniProgressFill');
        
        if (!miniPlayer) return;
        
        // Show mini player if music is loaded and we're not on the jams player page
        const shouldShow = musicState.hasPlaylist && !window.location.pathname.includes('/jams/');
        
        if (shouldShow) {
            miniPlayer.classList.add('visible');
            document.body.classList.add('global-mini-player-visible');
            
            if (musicState.currentTrack) {
                const track = musicState.currentTrack;
                
                if (trackTitle) trackTitle.textContent = track.title || 'Unknown Title';
                if (trackArtist) trackArtist.textContent = track.creator || 'Unknown Artist';
                
                if (albumArt) {
                    if (track.image) {
                        albumArt.src = track.image;
                    } else if (track.albumId) {
                        albumArt.src = `https://redscientist.com/Content/music/${track.albumId}/front.jpg`;
                    }
                }
            }
            
            if (playPauseBtn) {
                if (musicState.isPlaying) {
                    playPauseBtn.innerHTML = '⏸';
                    playPauseBtn.classList.remove('play');
                    playPauseBtn.classList.add('pause');
                } else {
                    playPauseBtn.innerHTML = '▶';
                    playPauseBtn.classList.remove('pause');
                    playPauseBtn.classList.add('play');
                }
            }
            
            if (progressFill && musicState.progress) {
                progressFill.style.width = Math.max(0, Math.min(100, musicState.progress)) + '%';
            }
        } else {
            miniPlayer.classList.remove('visible');
            document.body.classList.remove('global-mini-player-visible');
        }
    }
    
    startUpdateLoop() {
        // Update every second
        this.updateInterval = setInterval(() => {
            this.updateMiniPlayerFromJamsPage();
        }, 1000);
        
        // Listen for localStorage changes from jams page
        window.addEventListener('storage', (e) => {
            if (e.key === 'jamsMusicState') {
                const musicState = JSON.parse(e.newValue);
                this.updateMiniPlayerDisplay(musicState);
            }
        });
    }
    
    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        
        const miniPlayer = document.getElementById('globalMiniPlayer');
        if (miniPlayer) {
            miniPlayer.remove();
        }
        
        document.body.classList.remove('global-mini-player-visible');
        this.isCreated = false;
    }
}

// Initialize global mini player when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    if (!window.location.pathname.includes('/jams/')) {
        window.globalMiniPlayer = new GlobalMiniPlayer();
    }
});
