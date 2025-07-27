
# Rabbit Wine – Design & UI Standards (2025)

This document describes the design principles, UI standards, and aesthetic guidelines for the Rabbit Wine application. Refer to this document when creating new pages or components to ensure a consistent look and feel.

---

## Color Palette

- **Background Primary:** `#1a1626` (main background)
- **Background Secondary:** `#2a2438` (panel backgrounds)
- **Tertiary Background:** `#3a2f4a` (sub-panels, overlays)
- **Accent Purple:** `#6b46c1` (primary accent)
- **Accent Pink:** `#ec4899` (secondary accent)
- **Accent Light:** `#ccbcfc` (highlight, focus)
- **Text Primary:** `#e2e8f0`
- **Text Secondary:** `#94a3b8`
- **Text Accent:** `#ccbcfc`
- **Borders:** `#4a4458` (panels), `#4a4a4a` (inputs)
- **Success:** `#10b981`
- **Warning:** `#f59e0b`
- **Error:** `#ef4444`

---

## Typography

- **Font:** `'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`
- **Font Weight:** 500/600 for headings and buttons, normal for body text
- **Font Size:**
  - Headings: `1.5rem`
  - Body: `1rem`
  - Small text/hints: `14px`

---

## Layout & Panels

- **Grid:**
  - Desktop: Two-column layout with panels for sticker packs, configuration, and preview
  - Mobile: Single-column, responsive stacking
  - Uses CSS Grid for main containers
- **Panels:**
  - Rounded corners (`12px` radius)
  - Subtle border using `--border` color
  - Consistent margin and padding
- **Spacing:**
  - `gap: 20px` (desktop), `15px` (mobile) between panels

---

## Buttons & Controls

- **Shape:** Rounded (`8px` radius)
- **States:**
  - Default: `--accent-purple` or `--accent-pink` background, `--text-primary` text
  - Active: `--accent-light` background, `--text-accent` border
- **Special Buttons:**
  - Add: Green (`#10b981`)
  - Remove: Red (`#ef4444`)
- **Size:**
  - Minimum width: `80px` (desktop), `60px` (mobile)
  - Padding: `12px 20px` (desktop), `10px 16px` (mobile)

---

## Forms & Inputs

- **Inputs:**
  - Background: `--primary-bg`
  - Padding: `12px 16px`
  - Border: `--border`
- **Selects:**
  - Same style as inputs
  - Full width

---

## Sticker Packs & Grid

- **Sticker Grid:**
  - Responsive grid, min `80px` per item (desktop), `60px` (mobile)
  - Selected: Accent border and background
- **Sticker Images:**
  - `object-fit: contain`
  - Rounded corners (`4px`)
- **Preview:**
  - Large preview with export/copy/download controls
- **Pack Management:**
  - Add custom packs via folder with `config.json` and images
  - Packs are loaded dynamically; errors shown in browser console

---

## New & Improved Features (2025)

- **Sticker Pack System:**
  - Browse, add, and switch between sticker packs
  - Packs support custom configuration and images
- **Settings Persistence:**
  - User settings and state are saved in browser localStorage
- **Scroll App (Todo/Task Manager):**
  - Integrated todo/task app with drag-and-drop, expiration, and completed/archived tasks
  - Responsive design, mobile-friendly
- **Modals:**
  - Reusable modal system for alerts, confirmations, and input dialogs
  - Consistent modal styling across all apps
- **Background Animation:**
  - Animated floating stars background for all main pages
  - Canvas lines connect floating elements for visual effect
- **Audio Feedback:**
  - Sound effects for actions (pop, break, tick) in objects and other apps
- **Accessibility:**
  - Improved keyboard navigation and focus management in modals and controls
- **Mobile Support:**
  - All layouts and controls are touch-friendly and responsive
- **Performance:**
  - Optimized for fast load and smooth UI transitions

---

## Deprecated/Removed Features

- No longer uses legacy sticker pack formats; all packs require a `config.json`
- Old UI panels and layouts replaced with modern CSS Grid and flexbox

---

_Refer to this document before making UI changes or adding new pages to Rabbit Wine. For more details, see the README and in-app help._