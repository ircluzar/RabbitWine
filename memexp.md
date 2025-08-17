# Rabbitwine Memory Expansion Roadmap

This roadmap details the planned features for expanding Rabbitwine’s memory system to support offline music caching and improved asset management. Each feature is described as a user story, with subtasks explained for clarity and independent implementation.

---

## Status Legend

- ☐ Not started
- 🟡 In progress
- ✅ Completed

---

## User Story 1: As a user, I want to download albums for offline listening  
**Status:** ☐ Not started

- [ ] Implement a UI button to "Download Album" on the album page  
      _Add a visible button on each album page that allows users to initiate the download of all tracks for offline use._
- [ ] Add a method to memory.js to save audio blobs to IndexedDB  
      _Extend memory.js with a function that stores audio files (blobs) in IndexedDB, using album and track IDs as keys._
- [ ] Add a method to memory.js to retrieve audio blobs from IndexedDB  
      _Implement a function in memory.js to fetch and return audio blobs from IndexedDB for playback._
- [ ] Show download progress and completion status for each album  
      _Update the UI to display real-time progress as tracks are downloaded, and indicate when the album is fully cached._
- [ ] Display which albums are available offline in the UI  
      _Add visual indicators (such as icons or labels) to show which albums have been successfully downloaded and are available offline._

---

## User Story 2: As a user, I want to manage my offline music library  
**Status:** ☐ Not started

- [ ] Add a method to memory.js to list all cached albums and tracks  
      _Create a function that queries IndexedDB and returns a list of all albums and tracks stored for offline use._
- [ ] Implement a UI page to view and manage downloaded albums/tracks  
      _Design a dedicated page where users can see all their offline content and manage it (e.g., play, delete)._ 
- [ ] Add a method to memory.js to delete cached albums/tracks from IndexedDB  
      _Provide a function to remove specific albums or tracks from IndexedDB, freeing up storage space._
- [ ] Show storage usage and allow users to clear space  
      _Display the amount of storage used by offline music and offer controls to clear cached data as needed._

---

## User Story 3: As a user, I want the app to play cached music when offline  
**Status:** ☐ Not started

- [ ] Update the music player logic to check for cached tracks before streaming  
      _Modify the player to first look for a track in IndexedDB before attempting to stream it from the network._
- [ ] Add fallback logic to play from IndexedDB if the network is unavailable  
      _Ensure that if the app is offline, it automatically retrieves and plays tracks from local storage._
- [ ] Show an offline indicator when playing cached music  
      _Add a UI element that informs users when a track is being played from offline cache._

---

## User Story 4: As a user, I want the app to cache images and static assets for offline use  
**Status:** ☐ Not started

- [ ] Add a method to memory.js to cache images and assets using the Cache API  
      _Implement functions that store images and other static files in the browser’s Cache API for offline access._
- [ ] Add a method to memory.js to retrieve cached assets  
      _Provide a way to fetch cached images/assets from the Cache API for display when offline._
- [ ] Implement a UI option to pre-cache all images for an album or artist  
      _Allow users to download all related images for an album or artist with a single action._
- [ ] Show which images/assets are available offline  
      _Indicate in the UI which images and assets are cached and accessible without a network connection._

---

## User Story 5: As a user, I want to control and clear my cached data  
**Status:** ☐ Not started

- [ ] Add a method to memory.js to clear all IndexedDB music data  
      _Create a function that wipes all music blobs from IndexedDB, freeing up space._
- [ ] Add a method to memory.js to clear all Cache API assets  
      _Implement a function to remove all cached images and static assets from the Cache API._
- [ ] Implement a UI option to clear all cached data  
      _Add a button or menu item that lets users clear all offline content with one action._
- [ ] Show confirmation dialogs before deleting cached data  
      _Display a confirmation prompt to prevent accidental deletion of offline content._

---

## User Story 6: As a developer, I want unified access to all storage APIs via memory.js  
**Status:** ☐ Not started

- [ ] Add wrapper functions in memory.js for IndexedDB operations (save, get, list, delete)  
      _Develop a set of functions in memory.js that abstract away the details of IndexedDB, making it easy to store and retrieve blobs._
- [ ] Add wrapper functions in memory.js for Cache API operations (cache, get, list, delete)  
      _Similarly, create functions for interacting with the Cache API, handling asset storage and retrieval._
- [ ] Document all new memory.js methods with usage examples  
      _Write clear documentation and code samples for each new function added to memory.js._
- [ ] Add unit tests for new memory.js methods  
      _Develop tests to ensure each new function works correctly and reliably._

---

## User Story 7: As a user, I want to see which content is available offline  
**Status:** ☐ Not started

- [ ] Add UI indicators for offline availability on albums, tracks, and images  
      _Display icons or labels next to content that is cached and available offline._
- [ ] Update album/track listings to show offline status  
      _Modify listings to reflect the offline status of each item._
- [ ] Add a filter to show only offline content  
      _Provide a filter or view that displays only content available offline._

---

## User Story 8: As a user, I want to be notified of storage limits and errors  
**Status:** ☐ Not started

- [ ] Detect and handle storage quota errors in memory.js  
      _Add error handling to catch and respond to quota exceeded errors when saving data._
- [ ] Show user-friendly error messages when downloads fail due to space  
      _Inform users with clear messages if a download cannot complete because of insufficient storage._
- [ ] Display current storage usage and limits in the UI  
      _Show users how much space is used and how much is available for offline content._

---

## User Story 9: As a developer, I want to export and import cached data  
**Status:** ☐ Not started

- [ ] Add a method to memory.js to export all cached music and assets as a file  
      _Implement a function that bundles all offline data into a downloadable file for backup or transfer._
- [ ] Add a method to memory.js to import cached data from a file  
      _Provide a way to restore offline content from a previously exported file._
- [ ] Implement UI options for export/import  
      _Add buttons or menu items for users to export or import their offline library._
- [ ] Validate imported data before saving  
      _Ensure that imported files are checked for integrity and compatibility before adding to storage._

---

## User Story 10: As a user, I want my offline library to persist across sessions  
**Status:** ☐ Not started

- [ ] Ensure IndexedDB and Cache API data is persistent and not cleared on app reload  
      _Test and confirm that offline data remains available after closing and reopening the app._
- [ ] Add checks to restore offline library state on app startup  
      _On app launch, scan storage and update the UI to reflect available offline content._
- [ ] Notify users if any cached data is lost or evicted  
      _Inform users if the browser has removed any offline content due to storage constraints or other reasons._

---

**Note:**  
All subtasks are independent and can be tackled in any order. No subtask depends on another for implementation.