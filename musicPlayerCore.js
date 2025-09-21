// musicPlayerCore.js - Core music player functionality for cross-page operation

class MusicPlayerCore {
    constructor(options = {}) {
        this.isHeadless = options.headless || false; // Headless mode for non-jams pages
        this.onStateChange = options.onStateChange || (() => {}); // Callback for state updates
        
        // Core player state
        this.audio = null;
        this.currentPlaylist = [];
        this.currentTrackIndex = 0;
        this.isPlaying = false;
        this.shuffleMode = false;
    this.loop = false;
        this.shuffledIndices = [];
        this.shuffleIndex = 0;
        this.artists = [];
        this.currentArtist = null;
        this.currentAlbum = null;
        this.lastStateSave = 0;
        
        this.initializeAudio();
        this.initializeStateSync();
        
        // Load saved state
        setTimeout(() => {
            this.loadPlayerState();
        }, 100);
    }
    
    initializeAudio() {
        // Create or get existing audio element
        this.audio = document.getElementById('audioPlayer');
        if (!this.audio) {
            this.audio = document.createElement('audio');
            this.audio.id = 'audioPlayer';
            this.audio.preload = 'metadata';
            document.body.appendChild(this.audio);
        }
        
        // Set up audio event listeners
        this.audio.addEventListener('loadedmetadata', () => this.onAudioLoadedMetadata());
        this.audio.addEventListener('timeupdate', () => this.onAudioTimeUpdate());
        this.audio.addEventListener('ended', () => this.nextTrack());
        this.audio.addEventListener('error', () => this.handleAudioError());
        this.audio.addEventListener('play', () => this.onAudioPlay());
        this.audio.addEventListener('pause', () => this.onAudioPause());
        
        // Set initial volume
        this.audio.volume = 1.0;
        
        // Initialize Media Session API
        this.initializeMediaSession();
    }
    
    initializeStateSync() {
        // Listen for storage changes from other tabs/pages
        window.addEventListener('storage', (e) => this.handleStorageChange(e));
        
        // Listen for actions from other pages (like mini player controls)
        window.addEventListener('storage', (e) => this.handleMusicAction(e));
        
        // Save state periodically
        setInterval(() => this.saveStateToStorage(), 1000);
    }
    
    initializeMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => this.play());
            navigator.mediaSession.setActionHandler('pause', () => this.pause());
            navigator.mediaSession.setActionHandler('previoustrack', () => this.previousTrack());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.nextTrack());
            
            try {
                navigator.mediaSession.setActionHandler('seekto', (details) => {
                    if (details.seekTime !== null) {
                        this.audio.currentTime = details.seekTime;
                    }
                });
            } catch (error) {
                // Seek action not supported on this platform
            }
        }
    }
    
    // Core playback methods
    async play() {
        if (this.currentPlaylist.length === 0 || this.currentTrackIndex < 0) return;
        
        try {
            await this.audio.play();
            this.isPlaying = true;
            this.updateMediaSession();
            this.saveState();
            this.notifyStateChange();
        } catch (error) {
            console.error('Play failed:', error);
            this.isPlaying = false;
            this.notifyStateChange();
        }
    }
    
    pause() {
        this.audio.pause();
        this.isPlaying = false;
        this.updateMediaSession();
        this.saveState();
        this.notifyStateChange();
    }
    
    togglePlayPause() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }
    
    async playTrack(index) {
        if (index < 0 || index >= this.currentPlaylist.length) return;
        
        this.currentTrackIndex = index;
        const track = this.currentPlaylist[index];
        
        // Stop current playback
        this.audio.pause();
        this.audio.currentTime = 0;
        
        // Set new track source
        let audioUrl;
        if (track.url) {
            audioUrl = track.url;
        } else if (track.albumId && track.filename) {
            audioUrl = `https://redscientist.com/Content/music/${track.albumId}/${track.filename}`;
        } else {
            console.error('Track has no valid audio source:', track);
            return;
        }
        
        this.audio.src = audioUrl;
        
        // Update document title
        document.title = `${track.title} - ${track.creator} | Jams`;
        
        this.updateMediaSession();
        this.saveState();
        this.notifyStateChange();
        
        // Auto-play if not headless
        if (!this.isHeadless) {
            await this.play();
        }
    }
    
    previousTrack() {
        if (this.currentPlaylist.length === 0) return;
        
        let newIndex;
        if (this.shuffleMode) {
            if (this.shuffleIndex > 0) {
                this.shuffleIndex--;
                newIndex = this.shuffledIndices[this.shuffleIndex];
            } else {
                // Go to last track in shuffle
                this.shuffleIndex = this.shuffledIndices.length - 1;
                newIndex = this.shuffledIndices[this.shuffleIndex];
            }
        } else {
            newIndex = this.currentTrackIndex - 1;
            if (newIndex < 0) {
                newIndex = this.currentPlaylist.length - 1;
            }
        }
        
        this.playTrack(newIndex);
    }
    
    nextTrack() {
        if (this.currentPlaylist.length === 0) return;

        // If loop is enabled, replay the current track instead of advancing
        if (this.loop) {
            try {
                this.audio.currentTime = 0;
            } catch (e) {
                // ignore
            }
            // Ensure playback resumes
            this.play();
            return;
        }

        let newIndex;
        if (this.shuffleMode) {
            if (this.shuffleIndex < this.shuffledIndices.length - 1) {
                this.shuffleIndex++;
                newIndex = this.shuffledIndices[this.shuffleIndex];
            } else {
                // Start shuffle over
                this.shuffleIndex = 0;
                newIndex = this.shuffledIndices[this.shuffleIndex];
            }
        } else {
            newIndex = this.currentTrackIndex + 1;
            if (newIndex >= this.currentPlaylist.length) {
                newIndex = 0;
            }
        }

        this.playTrack(newIndex);
    }
    
    setVolume(volume) {
        volume = Math.max(0, Math.min(1, volume / 100));
        this.audio.volume = volume;
        this.saveState();
    }
    
    seek(position) {
        if (this.audio.duration) {
            this.audio.currentTime = (position / 100) * this.audio.duration;
        }
    }
    
    toggleShuffle() {
        this.shuffleMode = !this.shuffleMode;
        
        if (this.shuffleMode) {
            this.generateShuffledIndices();
            // Find current track in shuffle
            this.shuffleIndex = this.shuffledIndices.indexOf(this.currentTrackIndex);
            if (this.shuffleIndex === -1) {
                this.shuffleIndex = 0;
            }
        }
        
        this.saveState();
        this.notifyStateChange();
    }

    toggleLoop() {
        this.loop = !this.loop;
        this.saveState();
        this.notifyStateChange();
    }
    
    generateShuffledIndices() {
        this.shuffledIndices = Array.from({length: this.currentPlaylist.length}, (_, i) => i);
        
        // Fisher-Yates shuffle
        for (let i = this.shuffledIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.shuffledIndices[i], this.shuffledIndices[j]] = [this.shuffledIndices[j], this.shuffledIndices[i]];
        }
        
        this.shuffleIndex = 0;
    }
    
    // Playlist management
    loadPlaylist(tracks, startIndex = 0) {
        this.currentPlaylist = tracks;
        this.currentTrackIndex = startIndex;
        
        if (this.shuffleMode) {
            this.generateShuffledIndices();
        }
        
        if (tracks.length > 0) {
            this.playTrack(startIndex);
        }
        
        this.saveState();
        this.notifyStateChange();
    }
    
    clearPlaylist() {
        this.audio.pause();
        this.audio.currentTime = 0;
        this.audio.src = '';
        
        this.currentPlaylist = [];
        this.currentTrackIndex = 0;
        this.isPlaying = false;
        this.shuffleMode = false;
        this.shuffledIndices = [];
        this.shuffleIndex = 0;
        this.currentArtist = null;
        this.currentAlbum = null;
        
        this.clearState();
        this.updateMediaSession();
        this.notifyStateChange();
        
        document.title = 'Jams - Music Player';
    }
    
    // State management
    saveState() {
        if (!this.currentPlaylist.length) {
            this.clearState();
            return;
        }
        
        const state = {
            playlist: this.currentPlaylist,
            currentTrackIndex: this.currentTrackIndex,
            currentPosition: this.audio.currentTime || 0,
            volume: this.audio.volume || 1.0,
            shuffleMode: this.shuffleMode,
            loop: this.loop,
            shuffledIndices: this.shuffledIndices,
            shuffleIndex: this.shuffleIndex,
            currentArtist: this.currentArtist,
            currentAlbum: this.currentAlbum,
            isPlaying: this.isPlaying,
            timestamp: Date.now()
        };
        
        // Save to memory system if available
        if (typeof memory !== 'undefined') {
            memory.write('Jams', 'playerState', state);
        }
    }
    
    loadPlayerState() {
        if (typeof memory === 'undefined') return false;
        
        const state = memory.read('Jams', 'playerState');
        if (!state || !state.playlist || !state.playlist.length) return false;
        
        // Check if state is not too old (7 days)
        const maxAge = 7 * 24 * 60 * 60 * 1000;
        if (Date.now() - state.timestamp > maxAge) {
            this.clearState();
            return false;
        }
        
        // Check for malformed URLs in the playlist and clear if found
        const hasMalformedUrls = state.playlist.some(track => {
            if (track.url && track.url.includes('/music/') && track.url.includes('/music/')) {
                // Check for double "/music/" in the URL which indicates malformed URL
                const musicMatches = track.url.match(/\/music\//g);
                return musicMatches && musicMatches.length > 1;
            }
            return false;
        });
        
        if (hasMalformedUrls) {
            this.clearState();
            return false;
        }
        
        // Restore state
        this.currentPlaylist = state.playlist;
        this.currentTrackIndex = state.currentTrackIndex || 0;
        this.shuffleMode = state.shuffleMode || false;
    this.loop = state.loop || false;
        this.shuffledIndices = state.shuffledIndices || [];
        this.shuffleIndex = state.shuffleIndex || 0;
        this.currentArtist = state.currentArtist || null;
        this.currentAlbum = state.currentAlbum || null;
        
        // Restore volume
        this.audio.volume = state.volume || 1.0;
        
        // Set up audio for current track
        if (this.currentPlaylist[this.currentTrackIndex]) {
            const track = this.currentPlaylist[this.currentTrackIndex];
            let audioUrl;
            if (track.url) {
                audioUrl = track.url;
            } else if (track.albumId && track.filename) {
                audioUrl = `https://redscientist.com/Content/music/${track.albumId}/${track.filename}`;
            }
            
            if (audioUrl) {
                this.audio.src = audioUrl;
                if (state.currentPosition) {
                    this.audio.addEventListener('loadedmetadata', () => {
                        this.audio.currentTime = state.currentPosition;
                    }, { once: true });
                }
            }
        }
        
        this.updateMediaSession();
        this.notifyStateChange();
        return true;
    }
    
    clearState() {
        if (typeof memory !== 'undefined') {
            memory.remove('Jams', 'playerState');
        }
        this.clearStorageState();
    }
    
    saveStateToStorage() {
        const musicState = {
            isPlaying: this.isPlaying,
            currentTrack: this.currentPlaylist[this.currentTrackIndex] || null,
            hasPlaylist: this.currentPlaylist.length > 0,
            progress: this.audio.duration ? (this.audio.currentTime / this.audio.duration) * 100 : 0,
            volume: this.audio.volume * 100,
            shuffleMode: this.shuffleMode,
            timestamp: Date.now()
        };
        
        try {
            localStorage.setItem('jamsMusicState', JSON.stringify(musicState));
        } catch (e) {
            console.warn('Could not save music state to localStorage:', e);
        }
    }
    
    clearStorageState() {
        try {
            localStorage.removeItem('jamsMusicState');
            localStorage.removeItem('jamsMusicAction');
        } catch (e) {
            console.warn('Could not clear localStorage:', e);
        }
    }
    
    // Event handlers
    onAudioLoadedMetadata() {
        this.notifyStateChange();
    }
    
    onAudioTimeUpdate() {
        this.saveStateToStorage();
        this.notifyStateChange();
    }
    
    onAudioPlay() {
        this.isPlaying = true;
        this.updateMediaSession();
        this.notifyStateChange();
    }
    
    onAudioPause() {
        this.isPlaying = false;
        this.updateMediaSession();
        this.notifyStateChange();
    }
    
    handleAudioError() {
        console.error('Audio error occurred');
        this.pause();
        
        // Try next track if current fails
        setTimeout(() => this.nextTrack(), 1000);
    }
    
    handleStorageChange(event) {
        if (event.key === 'jamsMusicState') {
            // Another tab updated the state, sync if needed
            // This helps keep multiple tabs in sync
        }
    }
    
    handleMusicAction(event) {
        if (event.key === 'jamsMusicAction') {
            try {
                const action = JSON.parse(event.newValue);
                
                // Ignore old actions (more than 5 seconds old)
                if (Date.now() - action.timestamp > 5000) return;
                
                switch (action.action) {
                    case 'togglePlayPause':
                        this.togglePlayPause();
                        break;
                    case 'nextTrack':
                        this.nextTrack();
                        break;
                    case 'previousTrack':
                        this.previousTrack();
                        break;
                    case 'clearPlaylist':
                        this.clearPlaylist();
                        break;
                    case 'setVolume':
                        if (action.volume !== undefined) {
                            this.setVolume(action.volume);
                        }
                        break;
                }
            } catch (e) {
                console.warn('Could not parse music action:', e);
            }
        }
    }
    
    updateMediaSession() {
        if ('mediaSession' in navigator && this.currentPlaylist.length > 0) {
            const track = this.currentPlaylist[this.currentTrackIndex];
            
            let artwork = [];
            if (track.image) {
                artwork.push({ src: track.image, sizes: '512x512', type: 'image/jpeg' });
            } else if (track.albumId) {
                artwork.push({ 
                    src: `https://redscientist.com/Content/music/${track.albumId}/front.jpg`, 
                    sizes: '512x512', 
                    type: 'image/jpeg' 
                });
            }
            
            navigator.mediaSession.metadata = new MediaMetadata({
                title: track.title || 'Unknown Title',
                artist: track.creator || 'Unknown Artist',
                album: track.album || 'Unknown Album',
                artwork: artwork
            });
            
            navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
        }
    }
    
    notifyStateChange() {
        this.onStateChange({
            isPlaying: this.isPlaying,
            currentTrack: this.currentPlaylist[this.currentTrackIndex] || null,
            currentTrackIndex: this.currentTrackIndex,
            playlist: this.currentPlaylist,
            shuffleMode: this.shuffleMode,
            volume: this.audio.volume,
            currentTime: this.audio.currentTime,
            duration: this.audio.duration,
            hasPlaylist: this.currentPlaylist.length > 0
        });
    }
    
    // API for external control
    getCurrentState() {
        return {
            isPlaying: this.isPlaying,
            currentTrack: this.currentPlaylist[this.currentTrackIndex] || null,
            currentTrackIndex: this.currentTrackIndex,
            playlist: this.currentPlaylist,
            shuffleMode: this.shuffleMode,
            volume: this.audio.volume * 100,
            currentTime: this.audio.currentTime,
            duration: this.audio.duration,
            hasPlaylist: this.currentPlaylist.length > 0,
            progress: this.audio.duration ? (this.audio.currentTime / this.audio.duration) * 100 : 0
        };
    }
}

// Make available globally
window.MusicPlayerCore = MusicPlayerCore;
