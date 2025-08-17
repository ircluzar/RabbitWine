# Mini Player Implementation Guide

This guide explains how to add the global mini player to any page on your website, allowing users to control music that continues playing across page navigation.

## Overview

The mini player system consists of three main components:
1. **MusicPlayerCore** - Handles audio playback and state management
2. **GlobalMiniPlayer** - Provides the mini player UI on non-music pages  
3. **BackgroundMusic API** - Convenient wrapper for easy integration

## Quick Implementation

### Method 1: Auto-Initialize (Recommended)

Add these scripts to any page where you want the mini player:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Your Page</title>
</head>
<body>
    <!-- Your page content -->
    
    <!-- Required dependencies -->
    <script src="modals.js"></script>
    <script src="memory.js"></script>
    
    <!-- Music player system -->
    <script src="musicPlayerCore.js"></script>
    <script src="musicPlayerMini.js"></script>
    <script src="musicPlayerInit.js"></script>
</body>
</html>
```

That's it! The mini player will:
- Auto-detect if music is playing from other tabs/pages
- Show automatically when music starts
- Hide when music stops
- Persist across page navigation

### Method 2: Manual Control

For more control over initialization:

```html
<script src="modals.js"></script>
<script src="memory.js"></script>
<script src="musicPlayerCore.js"></script>
<script src="musicPlayerMini.js"></script>
<script src="musicPlayerInit.js"></script>

<script>
// Disable auto-initialization
BackgroundMusic.setConfig({ autoInit: false });

// Initialize manually when ready
document.addEventListener('DOMContentLoaded', () => {
    BackgroundMusic.init();
});
</script>
```

## Mini Player Features

### Visual Design
- **Fixed Position**: Stays at top of page (60px height)
- **Backdrop Blur**: Modern glass effect
- **Responsive**: Adapts to mobile screens
- **Theme Integration**: Matches your site's color scheme

### Controls
- **Album Art**: Shows current track artwork
- **Track Info**: Title and artist display
- **Play/Pause**: Toggle playback
- **Go to Player**: Navigate to full music page
- **Close**: Stop music and hide player

### Auto-Behavior
- **Smart Showing**: Only appears when music is actually playing
- **Cross-Tab Sync**: Updates when controlled from other tabs
- **Page Integration**: Automatically adjusts page padding

## Customization

### CSS Variables

The mini player uses CSS custom properties that you can override:

```css
:root {
    --mini-player-bg: #3a3447;
    --mini-player-hover: #2d2738;
    --mini-player-text: #e2e2e2;
    --mini-player-text-secondary: #a0a0a0;
    --mini-player-accent: #ccbcfc;
    --mini-player-border: #444;
}
```

### Advanced Styling

```css
/* Customize mini player appearance */
.global-mini-player {
    background: your-custom-background !important;
    border: your-custom-border !important;
}

/* Adjust positioning */
.global-mini-player {
    top: 80px !important; /* If you have a fixed header */
}

/* Mobile-specific adjustments */
@media (max-width: 768px) {
    .global-mini-player {
        height: 50px !important;
        padding: 0 0.5rem !important;
    }
}
```

### JavaScript Configuration

```javascript
// Configure before initialization
BackgroundMusic.setConfig({
    autoInit: true,
    showGlobalMiniPlayer: true,
    debug: false,
    initDelay: 100
});
```

## Integration with Existing Sites

### WordPress/CMS Integration

Add to your theme's footer:

```php
<!-- In footer.php -->
<script src="<?php echo get_template_directory_uri(); ?>/js/modals.js"></script>
<script src="<?php echo get_template_directory_uri(); ?>/js/memory.js"></script>
<script src="<?php echo get_template_directory_uri(); ?>/js/musicPlayerCore.js"></script>
<script src="<?php echo get_template_directory_uri(); ?>/js/musicPlayerMini.js"></script>
<script src="<?php echo get_template_directory_uri(); ?>/js/musicPlayerInit.js"></script>
```

### Single Page Applications (SPA)

For React, Vue, Angular apps:

```javascript
// Initialize once in your main app component
useEffect(() => {
    // Load scripts dynamically
    const scripts = [
        '/js/modals.js',
        '/js/memory.js', 
        '/js/musicPlayerCore.js',
        '/js/musicPlayerMini.js',
        '/js/musicPlayerInit.js'
    ];
    
    scripts.forEach(src => {
        const script = document.createElement('script');
        script.src = src;
        document.head.appendChild(script);
    });
}, []);
```

### Static Site Generators

For Jekyll, Hugo, etc., add to your layout template:

```html
<!-- In _layouts/default.html or equivalent -->
{{ content }}

{% unless page.url contains '/jams/' %}
<script src="{{ '/assets/js/modals.js' | relative_url }}"></script>
<script src="{{ '/assets/js/memory.js' | relative_url }}"></script>
<script src="{{ '/assets/js/musicPlayerCore.js' | relative_url }}"></script>
<script src="{{ '/assets/js/musicPlayerMini.js' | relative_url }}"></script>
<script src="{{ '/assets/js/musicPlayerInit.js' | relative_url }}"></script>
{% endunless %}
```

## API Reference

### BackgroundMusic Object

```javascript
// Playback control
BackgroundMusic.play()                    // Start/resume playback
BackgroundMusic.pause()                   // Pause playback
BackgroundMusic.togglePlayPause()         // Toggle play/pause
BackgroundMusic.nextTrack()               // Skip to next track
BackgroundMusic.previousTrack()           // Go to previous track
BackgroundMusic.toggleShuffle()           // Toggle shuffle mode

// Volume control (0-100)
BackgroundMusic.setVolume(75)

// Playlist management
BackgroundMusic.loadPlaylist(tracks, startIndex)
BackgroundMusic.clearPlaylist()

// State information
BackgroundMusic.getState()                // Returns current state object
BackgroundMusic.getPlayer()               // Get core player instance
BackgroundMusic.getMiniPlayer()           // Get mini player instance

// Configuration
BackgroundMusic.setDebug(true)            // Enable debug logging
BackgroundMusic.getConfig()               // Get current config
```

### Event System

```javascript
// System ready event
document.addEventListener('backgroundMusicReady', (event) => {
    const { player, miniPlayer } = event.detail;
    console.log('Music system initialized');
});

// State change events
document.addEventListener('backgroundMusicStateChange', (event) => {
    const state = event.detail;
    if (state.isPlaying) {
        console.log(`Now playing: ${state.currentTrack?.title}`);
    }
});
```

### State Object Structure

```javascript
const state = BackgroundMusic.getState();
// Returns:
{
    isPlaying: boolean,
    hasPlaylist: boolean,
    currentTrack: {
        title: string,
        creator: string,
        album: string,
        albumId: string,
        filename: string,
        location: string
    },
    currentTrackIndex: number,
    totalTracks: number,
    progress: number,        // 0-100 percentage
    currentTime: number,     // seconds
    duration: number,        // seconds
    volume: number,          // 0-100
    shuffleMode: boolean
}
```

## Loading Music from Other Pages

### Basic Track Loading

```javascript
// Load a single track
const track = {
    title: "Song Title",
    creator: "Artist Name", 
    album: "Album Name",
    albumId: "album123",
    filename: "song.mp3",           // Relative path
    location: "/music/song.mp3"     // Or full URL
};

BackgroundMusic.loadPlaylist([track], 0);
```

### Loading from Your Music Library

```javascript
// Example: Load from a JSON API
async function loadAlbum(albumId) {
    const response = await fetch(`/api/albums/${albumId}`);
    const album = await response.json();
    
    const tracks = album.tracks.map(track => ({
        title: track.title,
        creator: album.artist,
        album: album.title,
        albumId: album.id,
        filename: track.filename,
        location: `/music/${album.artist}/${album.title}/${track.filename}`
    }));
    
    BackgroundMusic.loadPlaylist(tracks, 0);
}
```

### Dynamic Playlist Building

```javascript
// Add tracks progressively
const playlist = [];

// Add individual tracks
playlist.push({
    title: "Track 1",
    creator: "Artist",
    album: "Album",
    location: "/music/track1.mp3"
});

// Add from search results
const searchResults = await searchMusic("rock");
playlist.push(...searchResults.map(formatTrack));

// Load the complete playlist
BackgroundMusic.loadPlaylist(playlist, 0);
```

## Troubleshooting

### Mini Player Not Appearing

**Problem**: Mini player doesn't show even when music is playing

**Solutions**:
1. Check browser console for JavaScript errors
2. Verify all required scripts are loaded
3. Ensure you're not on the main jams page
4. Check that music is actually loaded and playing:
   ```javascript
   const state = BackgroundMusic.getState();
   console.log('Has playlist:', state?.hasPlaylist);
   console.log('Is playing:', state?.isPlaying);
   ```

### Cross-Page State Issues

**Problem**: Music state doesn't sync between pages

**Solutions**:
1. Check localStorage is enabled in browser
2. Verify same-origin policy compliance
3. Check for JavaScript errors preventing state saves
4. Test state manually:
   ```javascript
   // Save state
   BackgroundMusic.getPlayer().saveState();
   
   // Load state
   BackgroundMusic.getPlayer().loadPlayerState();
   ```

### Audio Playback Issues

**Problem**: Audio won't play or has errors

**Solutions**:
1. Check audio file URLs are accessible
2. Verify CORS headers for cross-origin audio
3. Check browser autoplay policies
4. Test with different audio formats
5. Check Media Session API support:
   ```javascript
   console.log('Media Session supported:', 'mediaSession' in navigator);
   ```

### Mobile Compatibility

**Problem**: Mini player not working properly on mobile

**Solutions**:
1. Check viewport meta tag is present
2. Verify touch events are working
3. Test on different mobile browsers
4. Check for CSS issues with mobile layouts

## Performance Considerations

### Lazy Loading

Only load the music system when needed:

```javascript
// Load music system when user interacts with music
function initMusicWhenNeeded() {
    let musicLoaded = false;
    
    document.addEventListener('click', async (e) => {
        if (e.target.matches('.music-trigger') && !musicLoaded) {
            await loadMusicScripts();
            BackgroundMusic.init();
            musicLoaded = true;
        }
    });
}

async function loadMusicScripts() {
    const scripts = [
        'modals.js', 'memory.js', 'musicPlayerCore.js', 
        'musicPlayerMini.js', 'musicPlayerInit.js'
    ];
    
    for (const script of scripts) {
        await loadScript(script);
    }
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}
```

### Memory Management

The system automatically manages memory usage:
- Headless mode uses minimal resources
- State is compressed and stored efficiently  
- Old state data is automatically cleaned up
- Audio resources are properly disposed

### Bundle Size

Current system sizes:
- Core player: ~15KB minified
- Mini player: ~8KB minified
- Init wrapper: ~3KB minified
- Total impact: ~26KB for full functionality

## Browser Support

### Full Support
- Chrome 70+ (desktop/mobile)
- Firefox 65+ (desktop/mobile)  
- Safari 12+ (desktop/mobile)
- Edge 79+ (desktop/mobile)

### Partial Support
- IE 11: Basic playback only, no mini player
- Older mobile browsers: Reduced functionality

### Feature Detection

```javascript
// Check for required features
const hasRequiredFeatures = () => {
    return (
        'localStorage' in window &&
        'addEventListener' in document &&
        'querySelector' in document &&
        'Audio' in window
    );
};

if (hasRequiredFeatures()) {
    BackgroundMusic.init();
} else {
    console.warn('Browser lacks required features for music player');
}
```

## Migration from Old Versions

If updating from an older implementation:

1. **Replace old scripts** with new versions
2. **Update CSS classes** if you've customized styling
3. **Check API changes** in your existing code
4. **Test cross-page functionality** thoroughly
5. **Update event listeners** to use new event names

### Breaking Changes

- Event names changed from `musicPlayer*` to `backgroundMusic*`
- Configuration object structure updated
- Some CSS class names changed for consistency
- State object properties may have changed

See the changelog for complete migration details.
