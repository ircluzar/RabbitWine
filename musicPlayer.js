// jamsPlayer.js - Jams page music player UI implementation

class JamsPlayer {
    constructor() {
        // Initialize the core player (non-headless mode for jams page)
        this.core = new MusicPlayerCore({
            headless: false,
            onStateChange: (state) => this.handleCoreStateChange(state)
        });
        
        // UI-specific properties
        this.artists = [];
        this.currentPage = 'artists';
        this.lastStateSave = 0;
        
        // Check URL fragment early to prevent flash
        this.shouldStartOnPlayerPage = window.location.hash === '#player';
        
        this.initializeElements();
        this.initializeEventListeners();
        this.loadArtists();
        
        // Handle initial page state
        if (this.shouldStartOnPlayerPage) {
            // Hide main header immediately to prevent flash
            if (this.mainHeader) {
                this.mainHeader.classList.add('hidden');
            }
            // Set initial page without animation
            if (this.artistsPage && this.playerPage) {
                this.artistsPage.classList.remove('active');
                this.playerPage.classList.add('active');
                this.currentPage = 'player';
            }
        }
        
        // Try to load saved state after initialization
        setTimeout(() => {
            this.handleURLFragment();
            // Ensure mini player visibility is updated after potential state loading
            this.updateMiniPlayerVisibility();
        }, 150);
    }
    
    // Handle state changes from the core player
    handleCoreStateChange(state) {
        // Update UI elements based on core state
        this.updateTrackDisplay();
        this.updateProgress();
        this.updateMiniPlayer();
        this.updateMiniPlayerVisibility();
        this.updatePlayPauseButtons();
        this.updateShuffleButton();
        
        // Update tracks list highlighting
        this.updateTrackListHighlight();
    }
    
    // Proxy core player properties for backward compatibility
    get audio() { return this.core.audio; }
    get currentPlaylist() { return this.core.currentPlaylist; }
    set currentPlaylist(value) { this.core.currentPlaylist = value; }
    get currentTrackIndex() { return this.core.currentTrackIndex; }
    set currentTrackIndex(value) { this.core.currentTrackIndex = value; }
    get isPlaying() { return this.core.isPlaying; }
    set isPlaying(value) { this.core.isPlaying = value; }
    get shuffleMode() { return this.core.shuffleMode; }
    set shuffleMode(value) { this.core.shuffleMode = value; }
    get shuffledIndices() { return this.core.shuffledIndices; }
    set shuffledIndices(value) { this.core.shuffledIndices = value; }
    get shuffleIndex() { return this.core.shuffleIndex; }
    set shuffleIndex(value) { this.core.shuffleIndex = value; }
    get currentArtist() { return this.core.currentArtist; }
    set currentArtist(value) { this.core.currentArtist = value; }
    get currentAlbum() { return this.core.currentAlbum; }
    set currentAlbum(value) { this.core.currentAlbum = value; }
    
    // UI update methods that respond to core state changes
    updatePlayPauseButtons() {
        if (this.playPauseBtn) {
            if (this.isPlaying) {
                this.playPauseBtn.classList.remove('play');
                this.playPauseBtn.classList.add('pause');
            } else {
                this.playPauseBtn.classList.remove('pause');
                this.playPauseBtn.classList.add('play');
            }
        }
        
        if (this.miniPlayPauseBtn) {
            if (this.isPlaying) {
                this.miniPlayPauseBtn.classList.remove('play');
                this.miniPlayPauseBtn.innerHTML = '⏸';
            } else {
                this.miniPlayPauseBtn.classList.add('play');
                this.miniPlayPauseBtn.innerHTML = '▶';
            }
        }
    }
    
    updateTrackListHighlight() {
        // Update track highlighting in the tracks list
        document.querySelectorAll('.track-item').forEach(el => el.classList.remove('playing'));
        if (this.currentTrackIndex >= 0 && document.querySelectorAll('.track-item')[this.currentTrackIndex]) {
            document.querySelectorAll('.track-item')[this.currentTrackIndex].classList.add('playing');
        }
    }
    
    updateShuffleButton() {
        // Keep backward-compatible name but use it to reflect loop state now
        if (this.shuffleBtn) {
            this.shuffleBtn.classList.toggle('active', this.core.loop);
            // Update aria-pressed to reflect loop state as well
            this.shuffleBtn?.setAttribute('aria-pressed', String(!!this.core.loop));
        }
    }
    
    handleURLFragment() {
        // Check if URL has a fragment to navigate to player
        const fragment = window.location.hash.substring(1);
        if (fragment === 'player') {
            // Wait a bit for the page to load and then show player
            setTimeout(() => {
                if (this.currentPlaylist.length > 0) {
                    // Only navigate if we're not already on the player page (prevents double navigation)
                    if (this.currentPage !== 'player') {
                        this.navigateToPage('playerPage', true);
                    } else {
                        // We're already on the player page, just ensure tracks are rendered
                        this.renderTracksFromCurrentPlaylist();
                    }
                } else if (!this.shouldStartOnPlayerPage) {
                    // If no playlist and we didn't start on player page, go back to artists
                    this.navigateToPage('artistsPage', true);
                } else {
                    // We started on player page but have no playlist - stay on player with empty state
                    // This allows the mini player click to work even when no music is loaded
                    console.log('Started on player page but no playlist available');
                    if (this.tracksList) {
                        this.tracksList.innerHTML = `
                            <div class="error-state">
                                <div class="error-message">No music loaded</div>
                                <div style="font-size: 0.8rem; color: var(--text-accent); margin: 0.5rem 0;">
                                    Browse artists or use shuffle to load music
                                </div>
                                <button class="retry-btn" onclick="window.jamsPlayer.navigateToPage('artistsPage', true)">Browse Music</button>
                            </div>
                        `;
                    }
                }
            }, 100);
        }
    }
    
    // Save current player state to memory
    savePlayerState() {
        return this.core.saveState();
    }
    
    // Load player state from memory
    loadPlayerState() {
        return this.core.loadPlayerState();
    }
    
    // Clear saved player state
    clearPlayerState() {
        this.core.clearState();
    }
    
    // Update track display and UI elements
    updateTrackDisplay() {
        if (this.currentPlaylist.length > 0 && this.currentTrackIndex >= 0) {
            const track = this.currentPlaylist[this.currentTrackIndex];
            
            // Update current track display
            if (this.currentTrackTitle) {
                this.currentTrackTitle.textContent = track.title;
            }
            if (this.currentTrackArtist) {
                this.currentTrackArtist.textContent = track.creator;
            }
            if (this.currentTrackAlbum) {
                this.currentTrackAlbum.textContent = track.album;
            }
            
            // Update album art
            if (this.currentAlbumArt) {
                this.currentAlbumArt.src = `https://redscientist.com/Content/music/${track.albumId}/front.jpg`;
            }
            
            // Update page title
            if (this.albumPageTitle) {
                this.albumPageTitle.textContent = this.currentAlbum ? this.currentAlbum.name : 'Player';
            }
            
            // Update track list highlighting
            document.querySelectorAll('.track-item').forEach(el => el.classList.remove('playing'));
            const trackElements = document.querySelectorAll('.track-item');
            if (trackElements[this.currentTrackIndex]) {
                trackElements[this.currentTrackIndex].classList.add('playing');
            }
            
            // Update browser tab title
            document.title = `${track.creator} - ${track.title}`;
        }
    }
    
    // Show confirmation modal before clearing playlist
    async showClearPlaylistModal() {
        const trackCount = this.currentPlaylist.length;
        const currentTrack = trackCount > 0 ? this.currentPlaylist[this.currentTrackIndex] : null;
        
        let message = `Are you sure you want to discard your current playlist?`;
        if (trackCount > 0) {
            message += `\n\nThis will remove ${trackCount} track${trackCount !== 1 ? 's' : ''} from your queue.`;
            if (currentTrack) {
                message += `\n\nCurrently playing: "${currentTrack.title}" by ${currentTrack.creator}`;
            }
        }
        
        const confirmed = await Modals.confirm(
            message,
            'Clear Playlist',
            'Yes, Clear',
            'Cancel'
        );
        
        if (confirmed) {
            this.clearPlaylistAndHideMiniPlayer();
        }
    }
    
    // Clear playlist and hide mini player
    clearPlaylistAndHideMiniPlayer() {
        this.core.clearPlaylist();
        
        // Reset document title
        document.title = 'Jams - Music Player';
        
        // If we're on the player page, go back to artists
        if (this.currentPage === 'player') {
            this.showArtistsPage();
        }
    }
    
    initializeElements() {
        // Player controls
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.prevBtn = document.getElementById('prevBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.shuffleBtn = document.getElementById('shuffleBtn');
        this.volumeSlider = document.getElementById('volumeSlider');
        this.progressBar = document.getElementById('progressBar');
        this.progressFill = document.getElementById('progressFill');
        this.currentTime = document.getElementById('currentTime');
        this.totalTime = document.getElementById('totalTime');
        this.currentTrackTitle = document.getElementById('currentTrackTitle');
        this.currentTrackArtist = document.getElementById('currentTrackArtist');
        this.currentTrackAlbum = document.getElementById('currentTrackAlbum');
        this.currentAlbumArt = document.getElementById('currentAlbumArt');
        
        // Debug: Check for missing critical elements
        if (!this.playPauseBtn) console.warn('playPauseBtn not found');
        if (!this.shuffleAllBtn) console.warn('shuffleAllBtn will be checked later');
        
        // Mini player elements
        this.miniPlayer = document.getElementById('miniPlayer');
        this.miniAlbumArt = document.getElementById('miniAlbumArt');
        this.miniTrackTitle = document.getElementById('miniTrackTitle');
        this.miniTrackArtist = document.getElementById('miniTrackArtist');
        this.miniPlayPauseBtn = document.getElementById('miniPlayPauseBtn');
        this.miniCloseBtn = document.getElementById('miniCloseBtn');
        this.miniProgressFill = document.getElementById('miniProgressFill');
        
        // Pages
        this.artistsPage = document.getElementById('artistsPage');
        this.albumsPage = document.getElementById('albumsPage');
        this.playerPage = document.getElementById('playerPage');
        this.mainHeader = document.getElementById('mainHeader');
        
        // Content containers
        this.artistsGrid = document.getElementById('artistsGrid');
        this.albumsGrid = document.getElementById('albumsGrid');
        this.tracksList = document.getElementById('tracksList');
        
        // Debug: Check for missing critical elements
        if (!this.tracksList) console.error('tracksList element not found!');
        if (!this.artistsGrid) console.error('artistsGrid element not found!');
        if (!this.albumsGrid) console.error('albumsGrid element not found!');
        
        // Navigation
        this.backToArtistsFromAlbums = document.getElementById('backToArtistsFromAlbums');
        this.backToAlbums = document.getElementById('backToAlbums');
        this.artistPageTitle = document.getElementById('artistPageTitle');
        this.albumPageTitle = document.getElementById('albumPageTitle');
        
        // Redscientist button
        this.artistRedscientistBtn = document.getElementById('artistRedscientistBtn');
        this.artistBanner = document.getElementById('artistBanner');
        
        // Shuffle All button
        this.shuffleAllBtn = document.getElementById('shuffleAllBtn');
    }
    
    initializeEventListeners() {
        // Player controls - add defensive checks
        if (this.playPauseBtn) {
            this.playPauseBtn.addEventListener('click', () => {
                if (this.currentPlaylist.length === 0) {
                    // Show user feedback that no music is loaded
                    if (window.Modals) {
                        Modals.alert('No music loaded. Use the Shuffle button or browse artists to load music first.', 'No Music Loaded');
                    } else {
                        alert('No music loaded. Use the Shuffle button or browse artists to load music first.');
                    }
                    return;
                }
                this.togglePlayPause();
            });
        } else {
            console.warn('playPauseBtn not found, cannot attach event listener');
        }
        
        if (this.prevBtn) {
            this.prevBtn.addEventListener('click', () => this.previousTrack());
        }
        
        if (this.nextBtn) {
            this.nextBtn.addEventListener('click', () => this.nextTrack());
        }
        
        if (this.shuffleBtn) {
            this.shuffleBtn.addEventListener('click', () => this.toggleLoop());
        }
        
        if (this.volumeSlider) {
            this.volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value));
        }
        
        if (this.progressBar) {
            this.progressBar.addEventListener('click', (e) => this.seek(e));
        }
        
        // Shuffle All button
        if (this.shuffleAllBtn) {
            this.shuffleAllBtn.addEventListener('click', () => {
                console.log('Shuffle All button clicked');
                console.log('Core player state:', {
                    audio: this.core.audio,
                    hasAudio: !!this.core.audio,
                    currentPlaylist: this.currentPlaylist.length,
                    isPlaying: this.isPlaying
                });
                this.shuffleAllMusic();
            });
        } else {
            console.warn('shuffleAllBtn not found, cannot attach event listener');
        }
        
        // Mini player controls
        if (this.miniPlayPauseBtn) {
            this.miniPlayPauseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePlayPause();
            });
        }
        
        if (this.miniCloseBtn) {
            this.miniCloseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showClearPlaylistModal();
            });
        }
        
        if (this.miniAlbumArt) {
            this.miniAlbumArt.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showAlbumArtModal();
            });
        }
        
        if (this.miniPlayer) {
            this.miniPlayer.addEventListener('click', () => this.navigateToPage('playerPage', true));
        }
        
        // Audio events - UI specific only (core handles playback events)
        if (this.audio) {
            this.audio.addEventListener('loadedmetadata', () => this.updateDuration());
            this.audio.addEventListener('timeupdate', () => this.updateProgress());
        }
        
        // Navigation - use browser back button
        if (this.backToArtistsFromAlbums) {
            this.backToArtistsFromAlbums.addEventListener('click', () => history.back());
        }
        
        if (this.backToAlbums) {
            this.backToAlbums.addEventListener('click', () => history.back());
        }
        
        // Album art click to open modal
        if (this.currentAlbumArt) {
            this.currentAlbumArt.addEventListener('click', () => this.showAlbumArtModal());
        }
        
        // Mouse back button support
        document.addEventListener('mouseup', (e) => this.handleMouseBackButton(e));
        
        // Enhanced mobile back button support
        this.setupMobileBackHandling();
        
        // Listen for actions from other pages
        window.addEventListener('storage', (e) => this.handleStorageAction(e));
        
        // Set initial volume
        if (this.audio) {
            this.audio.volume = 1.0;
        }
    }
    
    setupMobileBackHandling() {
        // Handle browser back/forward navigation
        window.addEventListener('popstate', (e) => this.handlePopState(e));
        
        // Push initial state
        if (!window.history.state) {
            window.history.replaceState({ page: 'artists' }, '', '');
        }
    }
    
    handlePopState(event) {
        // Handle browser back button on mobile
        const state = event.state;
        if (state && state.page) {
            switch (state.page) {
                case 'artists':
                    this.showPage('artistsPage');
                    break;
                case 'albums':
                    this.showPage('albumsPage');
                    break;
                case 'player':
                    this.showPage('playerPage');
                    break;
            }
        } else {
            // Default to artists page
            this.showPage('artistsPage');
        }
    }
    
    showPage(pageId) {
        const pages = [this.artistsPage, this.albumsPage, this.playerPage];
        pages.forEach(page => page.classList.remove('active'));
        document.getElementById(pageId).classList.add('active');
        this.currentPage = pageId.replace('Page', '');
        
        // Show/hide main header based on current page
        if (pageId === 'artistsPage') {
            this.mainHeader.classList.remove('hidden');
        } else {
            this.mainHeader.classList.add('hidden');
        }
        
        // If navigating to player page and we have a playlist, render tracks
        if (pageId === 'playerPage' && this.currentPlaylist.length > 0) {
            // Use a small timeout to ensure the page is fully active
            setTimeout(() => {
                this.renderTracksFromCurrentPlaylist();
            }, 50);
        }
        
        // Update mini player visibility
        this.updateMiniPlayerVisibility();
        
        // Scroll to top when changing pages
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    navigateToPage(pageId, shouldAddToHistory = true) {
        const pageName = pageId.replace('Page', '');
        
        // Update browser history for mobile back button support
        if (shouldAddToHistory && window.history.state?.page !== pageName) {
            window.history.pushState({ page: pageName }, '', '');
        } else if (!shouldAddToHistory) {
            window.history.replaceState({ page: pageName }, '', '');
        }
        
        this.showPage(pageId);
    }
    
    updateMiniPlayerVisibility() {
        // Show mini player if music is loaded and not on player page
        const shouldShowMiniPlayer = this.currentPlaylist.length > 0 && 
                                   this.currentPage !== 'player';
        
        if (this.miniPlayer) {
            if (shouldShowMiniPlayer) {
                this.miniPlayer.classList.add('visible');
                document.body.classList.add('mini-player-visible');
            } else {
                this.miniPlayer.classList.remove('visible');
                document.body.classList.remove('mini-player-visible');
            }
        }
    }
    
    updateMiniPlayer() {
        if (this.currentPlaylist.length > 0 && this.currentTrackIndex >= 0) {
            const track = this.currentPlaylist[this.currentTrackIndex];
            
            // Update mini player track info
            if (this.miniTrackTitle) {
                this.miniTrackTitle.textContent = track.title;
            }
            if (this.miniTrackArtist) {
                this.miniTrackArtist.textContent = track.creator;
            }
            
            // Update mini player album art
            if (this.miniAlbumArt) {
                if (track.image) {
                    this.miniAlbumArt.src = track.image;
                } else {
                    this.miniAlbumArt.src = `https://redscientist.com/Content/music/${track.albumId}/folder.jpg`;
                }
            }
            
            // Update mini player play/pause state
            if (this.miniPlayPauseBtn) {
                if (this.isPlaying) {
                    this.miniPlayPauseBtn.classList.remove('play');
                    this.miniPlayPauseBtn.classList.add('pause');
                    this.miniPlayPauseBtn.innerHTML = '⏸';
                } else {
                    this.miniPlayPauseBtn.classList.remove('pause');
                    this.miniPlayPauseBtn.classList.add('play');
                    this.miniPlayPauseBtn.innerHTML = '▶';
                }
            }
        }
        
        this.updateMiniPlayerVisibility();
    }
    
    showArtistsPage() {
        this.navigateToPage('artistsPage', false); // Don't add to history when going back
    }
    
    showAlbumsPage() {
        this.navigateToPage('albumsPage', false); // Don't add to history when going back
    }
    
    showPlayerPage() {
        this.navigateToPage('playerPage', true); // Add to history when moving forward
    }
    
    showAlbumArtModal() {
        if (!this.currentPlaylist.length || this.currentTrackIndex < 0) return;
        
        const track = this.currentPlaylist[this.currentTrackIndex];
        if (!track) return;
        
        // Create the modal content
        const modalContent = document.createElement('div');
        
        // Try to use the highest quality image available
        const highResImage = `https://redscientist.com/Content/music/${track.albumId}/front.jpg`;
        const fallbackImage = `https://redscientist.com/Content/music/${track.albumId}/folder.jpg`;
        
        modalContent.innerHTML = `
            <img class="album-art-modal-image" 
                 src="${highResImage}" 
                 alt="Album Art"
                 onerror="this.src='${fallbackImage}'">
            <div class="album-art-modal-info">
                <div class="album-art-modal-title">${track.album}</div>
                <div class="album-art-modal-details">${track.creator} • ${track.title}</div>
            </div>
        `;
        
        // Open the modal with custom styling
        Modals.open({
            title: '',
            content: modalContent,
            confirmText: 'Close',
            showCancel: false,
            closeOnOverlay: true,
            onConfirm: () => {
                // Modal will close automatically
            }
        });
        
        // Add custom class to the modal for styling
        setTimeout(() => {
            const modalBox = document.querySelector('.modal-box');
            if (modalBox) {
                modalBox.closest('.modal-overlay').classList.add('album-art-modal');
            }
        }, 10);
    }
    
    handleMouseBackButton(event) {
        // Check if it's the back button (button 3)
        if (event.button === 3) {
            event.preventDefault();
            
            // Navigate based on current page
            switch (this.currentPage) {
                case 'albums':
                    this.showArtistsPage();
                    break;
                case 'player':
                    this.showAlbumsPage();
                    break;
                // Artists page is the root, so no back action needed
            }
        }
    }
    
    handleStorageAction(event) {
        if (event.key === 'jamsMusicAction') {
            try {
                const action = JSON.parse(event.newValue);
                
                // Only respond to recent actions (within 5 seconds)
                if (Date.now() - action.timestamp < 5000) {
                    switch (action.action) {
                        case 'togglePlayPause':
                            this.togglePlayPause();
                            break;
                        case 'clearPlaylist':
                            this.clearPlaylistAndHideMiniPlayer();
                            break;
                        case 'showClearConfirmation':
                            this.showClearPlaylistModal();
                            break;
                        // Add more actions as needed
                    }
                }
            } catch (e) {
                console.warn('Could not parse storage action:', e);
            }
        }
    }
    
    async loadArtists() {
        try {
            const response = await fetch('https://redscientist.com/Content/data/music.json');
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.artists || !Array.isArray(data.artists)) {
                throw new Error('Invalid data structure: artists array not found');
            }
            
            this.artists = data.artists.filter(artist => artist.id !== 'shuffle');
            this.renderArtists();
        } catch (error) {
            console.error('Error loading artists:', error);
            
            // Show modal for critical network errors
            if (error.message.includes('HTTP') || error.message.includes('fetch')) {
                Modals.alert(
                    'Unable to connect to the music catalog. Please check your internet connection and try again.',
                    'Connection Error'
                );
            }
            
            this.artistsGrid.innerHTML = `
                <div class="error-state">
                    <div class="error-message">Error loading artists</div>
                    <div style="font-size: 0.8rem; color: var(--text-accent); margin: 0.5rem 0;">
                        ${error.message}
                    </div>
                    <button class="retry-btn" onclick="location.reload()">Retry</button>
                </div>
            `;
        }
    }
    
    renderArtists() {
        this.artistsGrid.innerHTML = '';
        this.artists.forEach(artist => {
            const artistCard = document.createElement('div');
            artistCard.className = 'artist-card';
            
            const artistImageUrl = `https://redscientist.com/Content/banners/${artist.id}.jpg`;
            
            artistCard.innerHTML = `
                <img class="artist-image" src="${artistImageUrl}" alt="${artist.name}" 
                     onerror="this.style.display='none';">
                <div class="artist-name">${artist.name}</div>
            `;
            
            artistCard.addEventListener('click', () => this.selectArtist(artist));
            this.artistsGrid.appendChild(artistCard);
        });
    }
    
    async selectArtist(artist) {
        this.currentArtist = artist;
        this.artistPageTitle.textContent = `${artist.name}`;
        
        // Update artist Redscientist button
        this.artistRedscientistBtn.href = `https://redscientist.com/artist/${artist.id}`;
        
        // Update artist banner
        const artistImageUrl = `https://redscientist.com/Content/banners/${artist.id}.jpg`;
        this.artistBanner.src = artistImageUrl;
        this.artistBanner.alt = `${artist.name} Banner`;
        this.artistBanner.style.display = 'block';
        
        // Hide banner if it fails to load
        this.artistBanner.onerror = () => {
            this.artistBanner.style.display = 'none';
        };
        
        // Show loading state
        this.albumsGrid.innerHTML = `
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <div>Loading albums...</div>
            </div>
        `;
        
        this.navigateToPage('albumsPage', true); // Navigate forward to albums page
        
        try {
            const response = await fetch(`https://redscientist.com/Content/data/${artist.id}.json`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const responseText = await response.text();
            
            // Try to parse JSON with error handling
            let data;
            try {
                data = JSON.parse(responseText);
            } catch (jsonError) {
                console.error('JSON Parse Error:', jsonError);
                console.error('Response text:', responseText);
                
                // Try to fix common JSON issues
                let fixedJson = responseText
                    .replace(/,(\s*[}\]])/g, '$1')  // Remove trailing commas
                    .replace(/([{,]\s*)(\w+):/g, '$1"$2":');  // Add quotes to unquoted keys
                
                try {
                    data = JSON.parse(fixedJson);
                    console.log('Successfully parsed JSON after fixes');
                } catch (fixError) {
                    throw new Error(`Invalid JSON format: ${jsonError.message}`);
                }
            }
            
            if (!data.albums || !Array.isArray(data.albums)) {
                throw new Error('Invalid data structure: albums array not found');
            }
            
            this.renderAlbums(data.albums);
        } catch (error) {
            console.error('Error loading albums:', error);
            this.albumsGrid.innerHTML = `
                <div class="error-state">
                    <div class="error-message">Error loading albums</div>
                    <div style="font-size: 0.8rem; color: var(--text-accent); margin: 0.5rem 0;">
                        ${error.message}
                    </div>
                    <button class="retry-btn" onclick="window.jamsPlayer.selectArtist(window.jamsPlayer.currentArtist)">Retry</button>
                </div>
            `;
        }
    }
    
    renderAlbums(albums) {
        this.albumsGrid.innerHTML = '';
        albums.forEach(album => {
            const albumCard = document.createElement('div');
            albumCard.className = 'album-card';
            
            const albumCoverUrl = `https://redscientist.com/Content/music/${album.id}/frontweb.jpg`;
            
            albumCard.innerHTML = `
                <img class="album-cover" src="${albumCoverUrl}" alt="${album.name}">
                <div class="album-title">${album.name}</div>
                <div class="album-year">${album.year}</div>
            `;
            
            albumCard.addEventListener('click', () => this.selectAlbum(album));
            this.albumsGrid.appendChild(albumCard);
        });
    }
    
    async selectAlbum(album) {
        this.currentAlbum = album;
        this.albumPageTitle.textContent = `${album.name} (${album.year})`;
        
        // Show loading state in player page
        if (!this.tracksList) {
            this.tracksList = document.getElementById('tracksList');
        }
        
        if (this.tracksList) {
            this.tracksList.innerHTML = `
                <div class="loading-state">
                    <div class="loading-spinner"></div>
                    <div>Loading tracks...</div>
                </div>
            `;
        } else {
            console.error('tracksList element not found when showing loading state');
        }
        
        this.navigateToPage('playerPage', true); // Navigate forward to player page
        
        try {
            const response = await fetch(`https://redscientist.com/Content/music/${album.id}/playlist.xml`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const xmlText = await response.text();
            console.log('Received XML text, length:', xmlText.length);
            console.log('XML preview:', xmlText.substring(0, 200));
            
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.sanitizeXML(xmlText), 'text/xml');
            
            // Check for XML parsing errors
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                console.error('XML parsing error:', parseError.textContent);
                throw new Error(`Invalid XML format: ${parseError.textContent}`);
            }
            
            const trackElements = xmlDoc.getElementsByTagName('track');
            console.log('Found', trackElements.length, 'track elements');
            
            if (trackElements.length === 0) {
                throw new Error('No tracks found in playlist');
            }
            
            const tracks = Array.from(trackElements).map((trackEl, index) => {
                const location = trackEl.getElementsByTagName('location')[0]?.textContent || '';
                const title = trackEl.getElementsByTagName('title')[0]?.textContent || 'Unknown Title';
                const creator = trackEl.getElementsByTagName('creator')[0]?.textContent || 'Unknown Artist';
                const albumName = trackEl.getElementsByTagName('album')[0]?.textContent || 'Unknown Album';
                const image = trackEl.getElementsByTagName('image')[0]?.textContent || '';
                
                return {
                    index: index + 1,
                    title,
                    creator,
                    album: albumName,
                    url: `https://redscientist.com/Content/${location}`, // Use url for direct access
                    filename: location.split('/').pop(), // Just the filename for fallback
                    image: image ? `https://redscientist.com/Content/${image}` : '',
                    albumId: album.id
                };
            });
            
            console.log('Parsed tracks:', tracks);
            console.log('Loading playlist with', tracks.length, 'tracks');
            
            // Load playlist in core
            this.core.loadPlaylist(tracks, 0);
            
            // Render tracks in UI - add small delay to ensure core has processed
            setTimeout(() => {
                console.log('About to render tracks...');
                this.renderTracks(tracks);
            }, 100);
        } catch (error) {
            console.error('Error loading tracks:', error);
            
            // Show modal for critical track loading errors
            if (error.message.includes('HTTP') || error.message.includes('fetch') || error.message.includes('No tracks found')) {
                Modals.alert(
                    'Unable to load tracks from this album. Please try another album or check your connection.',
                    'Album Error'
                );
            }
            
            if (!this.tracksList) {
                this.tracksList = document.getElementById('tracksList');
            }
            
            if (this.tracksList) {
                this.tracksList.innerHTML = `
                    <div class="error-state">
                        <div class="error-message">Error loading tracks</div>
                        <div style="font-size: 0.8rem; color: var(--text-accent); margin: 0.5rem 0;">
                            ${error.message}
                        </div>
                        <button class="retry-btn" onclick="window.jamsPlayer.selectAlbum(window.jamsPlayer.currentAlbum)">Retry</button>
                    </div>
                `;
            } else {
                console.error('tracksList element not found when showing error state');
            }
        }
    }
    
    renderTracks(tracks) {
        console.log('renderTracks called with', tracks.length, 'tracks');
        console.log('tracksList element:', this.tracksList);
        
        // Re-get tracksList element if it's missing (timing issue fix)
        if (!this.tracksList) {
            console.warn('tracksList element not found, attempting to re-find it...');
            this.tracksList = document.getElementById('tracksList');
        }
        
        if (!this.tracksList) {
            console.error('tracksList element still not found! Cannot render tracks.');
            return;
        }
        
        this.tracksList.innerHTML = '';
        
        // Check if we're in playlist/shuffle mode by looking at the album page title
        const isPlaylistMode = this.albumPageTitle && this.albumPageTitle.textContent === 'Shuffle';
        
        tracks.forEach((track, index) => {
            const trackEl = document.createElement('div');
            trackEl.className = 'track-item';
            
            // In playlist mode, show "Artist - TrackName", otherwise just track name
            const displayName = isPlaylistMode ? `${track.creator} - ${track.title}` : track.title;
            
            trackEl.innerHTML = `
                <div class="track-number">${track.index}</div>
                <div class="track-name">${displayName}</div>
            `;
            trackEl.addEventListener('click', () => this.playTrack(index));
            this.tracksList.appendChild(trackEl);
            
            // Debug: verify track was added
            console.log('Added track element:', trackEl, 'to tracksList');
        });
        
        console.log('Rendered', tracks.length, 'tracks to tracksList');
        console.log('tracksList children count:', this.tracksList.children.length);
        console.log('tracksList visibility:', window.getComputedStyle(this.tracksList).display);
    }
    
    // Helper method to render tracks from current playlist (for mini player navigation)
    renderTracksFromCurrentPlaylist() {
        if (!this.currentPlaylist || this.currentPlaylist.length === 0) {
            console.log('No current playlist to render tracks from');
            return;
        }
        
        console.log('Rendering tracks from current playlist:', this.currentPlaylist.length, 'tracks');
        
        // Ensure we have the tracksList element
        if (!this.tracksList) {
            this.tracksList = document.getElementById('tracksList');
            if (!this.tracksList) {
                console.error('tracksList element not found, cannot render tracks');
                return;
            }
        }
        
        // Update album page title based on current state
        if (this.albumPageTitle) {
            if (this.shuffleMode || !this.currentAlbum) {
                this.albumPageTitle.textContent = 'Shuffle';
            } else {
                this.albumPageTitle.textContent = this.currentAlbum.name || 'Album';
            }
        }
        
        // Render the tracks
        this.renderTracks(this.currentPlaylist);
        
        // Update track highlighting
        this.updateTrackListHighlight();
    }
    
    playTrack(index) {
        this.core.playTrack(index);
    }
    
    play() {
        this.core.play();
    }
    
    pause() {
        this.core.pause();
    }
    
    togglePlayPause() {
        console.log('togglePlayPause called, core:', this.core);
        console.log('Current playlist length:', this.currentPlaylist.length);
        console.log('Current track index:', this.currentTrackIndex);
        
        if (this.currentPlaylist.length === 0) {
            console.log('No music loaded - cannot play/pause');
            // Could show a user-friendly message here
            return;
        }
        
        if (this.core) {
            this.core.togglePlayPause();
        } else {
            console.error('Core player not available');
        }
    }
    
    nextTrack() {
        this.core.nextTrack();
    }
    
    previousTrack() {
        this.core.previousTrack();
    }
    
    toggleShuffle() {
        this.core.toggleShuffle();
    }

    toggleLoop() {
        if (!this.core) return;
        this.core.toggleLoop();
        // Update UI immediately
        if (this.shuffleBtn) {
            const isLoop = !!this.core.loop;
            this.shuffleBtn.classList.toggle('active', isLoop);
            this.shuffleBtn.setAttribute('aria-pressed', String(isLoop));
            this.shuffleBtn.textContent = isLoop ? 'LOOP' : 'LOOP';
        }
        this.savePlayerState();
        this.updateMiniPlayer();
    }
    
    sanitizeXML(xmlText) {
        // Handle unescaped ampersands in XML content while preserving valid XML structure
        return xmlText
            // First, temporarily protect already escaped entities
            .replace(/&amp;/g, '__AMP_PLACEHOLDER__')
            .replace(/&lt;/g, '__LT_PLACEHOLDER__')
            .replace(/&gt;/g, '__GT_PLACEHOLDER__')
            .replace(/&quot;/g, '__QUOT_PLACEHOLDER__')
            .replace(/&apos;/g, '__APOS_PLACEHOLDER__')
            // Then escape remaining unescaped ampersands
            .replace(/&/g, '&amp;')
            // Restore the placeholders back to proper entities
            .replace(/__AMP_PLACEHOLDER__/g, '&amp;')
            .replace(/__LT_PLACEHOLDER__/g, '&lt;')
            .replace(/__GT_PLACEHOLDER__/g, '&gt;')
            .replace(/__QUOT_PLACEHOLDER__/g, '&quot;')
            .replace(/__APOS_PLACEHOLDER__/g, '&apos;');
    }
    
    setVolume(value) {
        this.core.setVolume(value);
    }
    
    seek(event) {
        if (this.progressBar) {
            const rect = this.progressBar.getBoundingClientRect();
            const percent = (event.clientX - rect.left) / rect.width;
            this.core.seek(percent * 100);
        }
    }
    
    updateProgress() {
        if (this.audio && this.audio.duration) {
            const percent = (this.audio.currentTime / this.audio.duration) * 100;
            if (this.progressFill) {
                this.progressFill.style.width = percent + '%';
            }
            if (this.miniProgressFill) {
                this.miniProgressFill.style.width = percent + '%';
            }
            if (this.currentTime) {
                this.currentTime.textContent = this.formatTime(this.audio.currentTime);
            }
            
            // Save state every few seconds
            if (!this.lastStateSave || Date.now() - this.lastStateSave > 5000) {
                this.savePlayerState();
                this.lastStateSave = Date.now();
            }
        }
    }
    
    updateDuration() {
        if (this.totalTime && this.audio) {
            this.totalTime.textContent = this.formatTime(this.audio.duration);
        }
    }
    
    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    async shuffleAllMusic() {
        try {
            // Disable button and show loading state
            this.shuffleAllBtn.disabled = true;
            this.shuffleAllBtn.textContent = 'Loading Music...';
            
            console.log('Starting shuffle all music...');
            
            // Get all artists (already loaded)
            if (!this.artists.length) {
                await this.loadArtists();
            }
            
            let allTracks = [];
            
            // Fetch all albums and tracks from all artists
            for (let artistIndex = 0; artistIndex < this.artists.length; artistIndex++) {
                const artist = this.artists[artistIndex];
                this.shuffleAllBtn.textContent = `Loading ${artist.name}... (${artistIndex + 1}/${this.artists.length})`;
                
                try {
                    // Fetch artist albums
                    const artistResponse = await fetch(`https://redscientist.com/Content/data/${artist.id}.json`);
                    if (!artistResponse.ok) {
                        console.warn(`Failed to load artist ${artist.name}:`, artistResponse.status);
                        continue;
                    }
                    
                    const artistData = await artistResponse.json();
                    
                    if (!artistData.albums || !Array.isArray(artistData.albums)) {
                        console.warn(`Invalid albums data for artist ${artist.name}`);
                        continue;
                    }
                    
                    // Fetch tracks from each album
                    for (const album of artistData.albums) {
                        try {
                            const playlistResponse = await fetch(`https://redscientist.com/Content/music/${album.id}/playlist.xml`);
                            if (!playlistResponse.ok) {
                                console.warn(`Failed to load album ${album.name}:`, playlistResponse.status);
                                continue;
                            }
                            
                            const xmlText = await playlistResponse.text();
                            const parser = new DOMParser();
                            const xmlDoc = parser.parseFromString(this.sanitizeXML(xmlText), 'text/xml');
                            
                            const trackElements = xmlDoc.getElementsByTagName('track');
                            
                            Array.from(trackElements).forEach((trackEl, index) => {
                                const location = trackEl.getElementsByTagName('location')[0]?.textContent || '';
                                const title = trackEl.getElementsByTagName('title')[0]?.textContent || 'Unknown Title';
                                const creator = trackEl.getElementsByTagName('creator')[0]?.textContent || artist.name;
                                const albumName = trackEl.getElementsByTagName('album')[0]?.textContent || album.name;
                                const image = trackEl.getElementsByTagName('image')[0]?.textContent || '';
                                
                                if (location) {
                                    allTracks.push({
                                        index: index + 1,
                                        title,
                                        creator,
                                        album: albumName,
                                        url: `https://redscientist.com/Content/${location}`, // Use url for direct access
                                        filename: location.split('/').pop(), // Just the filename for fallback
                                        image: image ? `https://redscientist.com/Content/${image}` : '',
                                        albumId: album.id,
                                        artistId: artist.id,
                                        albumYear: album.year || ''
                                    });
                                }
                            });
                            
                        } catch (albumError) {
                            console.warn(`Error processing album ${album.name}:`, albumError);
                            continue;
                        }
                    }
                    
                } catch (artistError) {
                    console.warn(`Error processing artist ${artist.name}:`, artistError);
                    continue;
                }
            }
            
            console.log(`Loaded ${allTracks.length} total tracks`);
            
            if (allTracks.length === 0) {
                throw new Error('No tracks found in the catalog');
            }
            
            // Show warning if very few tracks found
            if (allTracks.length < 50) {
                const proceed = await Modals.confirm(
                    `Only ${allTracks.length} tracks found. Continue with shuffle?`,
                    'Limited Tracks',
                    'Continue',
                    'Cancel'
                );
                if (!proceed) {
                    return; // User cancelled
                }
            }
            
            // Shuffle all tracks and select 420 (or all if less than 420)
            const shuffledTracks = [...allTracks];
            for (let i = shuffledTracks.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledTracks[i], shuffledTracks[j]] = [shuffledTracks[j], shuffledTracks[i]];
            }
            
            const selectedTracks = shuffledTracks.slice(0, Math.min(420, shuffledTracks.length));
            
            // Re-index the tracks for the mega playlist
            selectedTracks.forEach((track, index) => {
                track.index = index + 1;
            });
            
            // Set up the mega playlist using core
            this.currentArtist = null; // No artist context for shuffle - back goes to artists page
            this.currentAlbum = { 
                name: 'Shuffle', 
                id: 'shuffle-all',
                year: new Date().getFullYear()
            };
            
            // Update page titles
            this.albumPageTitle.textContent = 'Shuffle';
            
            // Navigate to player page
            this.navigateToPage('playerPage', true);
            
            // Load playlist with shuffle enabled
            this.core.shuffleMode = true;
            this.core.loadPlaylist(selectedTracks, 0);
            this.renderTracks(selectedTracks);
            
            console.log(`Created mega playlist with ${selectedTracks.length} songs`);
            
        } catch (error) {
            console.error('Error creating shuffle playlist:', error);
            Modals.alert(`Error creating shuffle playlist: ${error.message}`, 'Shuffle Error');
        } finally {
            // Re-enable button
            this.shuffleAllBtn.disabled = false;
            this.shuffleAllBtn.textContent = 'Shuffle';
        }
    }
}

// Make available globally
window.JamsPlayer = JamsPlayer;
