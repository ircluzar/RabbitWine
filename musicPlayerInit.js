// backgroundMusicInit.js - Easy initialization script for background music on any page

(function() {
    'use strict';
    
    // Configuration
    const CONFIG = {
        // Whether to show debug logs
        debug: false,
        
        // Whether to auto-initialize on DOM ready
        autoInit: true,
        
        // Whether to automatically show global mini player
        showGlobalMiniPlayer: true,
        
        // Delay before initialization (ms)
        initDelay: 100
    };
    
    // Global state
    let backgroundPlayer = null;
    let globalMiniPlayer = null;
    
    function log(...args) {
        if (CONFIG.debug) {
            console.log('[BackgroundMusic]', ...args);
        }
    }
    
    function initializeBackgroundMusic() {
        log('Initializing background music system...');
        
        // Skip initialization if we're on the jams page
        if (window.location.pathname.includes('/jams/')) {
            log('Skipping initialization - on jams page');
            return;
        }
        
        // Check if MusicPlayerCore is available
        if (typeof MusicPlayerCore === 'undefined') {
            console.warn('MusicPlayerCore not found. Make sure musicPlayerCore.js is included.');
            return;
        }
        
        try {
            // Initialize the core player in headless mode
            backgroundPlayer = new MusicPlayerCore({
                headless: true,
                onStateChange: handleStateChange
            });
            
            // Make it globally accessible
            window.backgroundPlayer = backgroundPlayer;
            
            log('Background music player initialized');
            
            // Initialize global mini player if enabled
            if (CONFIG.showGlobalMiniPlayer && typeof GlobalMiniPlayer !== 'undefined') {
                globalMiniPlayer = new GlobalMiniPlayer();
                window.globalMiniPlayer = globalMiniPlayer;
                log('Global mini player initialized');
            }
            
            // Dispatch custom event for other scripts to listen to
            document.dispatchEvent(new CustomEvent('backgroundMusicReady', {
                detail: { player: backgroundPlayer, miniPlayer: globalMiniPlayer }
            }));
            
        } catch (error) {
            console.error('Failed to initialize background music:', error);
        }
    }
    
    function handleStateChange(state) {
        log('Player state changed:', state);
        
        // Dispatch custom event for state changes
        document.dispatchEvent(new CustomEvent('backgroundMusicStateChange', {
            detail: state
        }));
        
        // Update page title if music is playing
        if (state.hasPlaylist && state.currentTrack) {
            // Only update title if it's still the default or a music title
            const currentTitle = document.title;
            if (currentTitle.includes(' - ') && currentTitle.includes('|')) {
                // Looks like a music title, update it
                document.title = `${state.currentTrack.title} - ${state.currentTrack.creator} | ${currentTitle.split('|')[1]}`;
            } else if (!currentTitle.includes(' | ')) {
                // Add music info to current title
                document.title = `${state.currentTrack.title} - ${state.currentTrack.creator} | ${currentTitle}`;
            }
        }
    }
    
    // Public API
    window.BackgroundMusic = {
        // Initialize manually
        init: initializeBackgroundMusic,
        
        // Get the current player instance
        getPlayer: () => backgroundPlayer,
        
        // Get the current mini player instance
        getMiniPlayer: () => globalMiniPlayer,
        
        // Quick control functions
        play: () => backgroundPlayer?.play(),
        pause: () => backgroundPlayer?.pause(),
        togglePlayPause: () => backgroundPlayer?.togglePlayPause(),
        nextTrack: () => backgroundPlayer?.nextTrack(),
        previousTrack: () => backgroundPlayer?.previousTrack(),
        toggleShuffle: () => backgroundPlayer?.toggleShuffle(),
        setVolume: (volume) => backgroundPlayer?.setVolume(volume),
        clearPlaylist: () => backgroundPlayer?.clearPlaylist(),
        
        // Get current state
        getState: () => backgroundPlayer?.getCurrentState() || null,
        
        // Load a playlist
        loadPlaylist: (tracks, startIndex = 0) => backgroundPlayer?.loadPlaylist(tracks, startIndex),
        
        // Configuration
        setDebug: (enabled) => CONFIG.debug = enabled,
        getConfig: () => ({ ...CONFIG })
    };
    
    // Auto-initialize when DOM is ready
    if (CONFIG.autoInit) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(initializeBackgroundMusic, CONFIG.initDelay);
            });
        } else {
            // DOM already loaded
            setTimeout(initializeBackgroundMusic, CONFIG.initDelay);
        }
    }
    
    log('Background music initialization script loaded');
})();
