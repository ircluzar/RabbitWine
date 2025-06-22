# Rabbit Wine – Design & UI Standards

This document describes the design principles, UI standards, and aesthetic guidelines for the Rabbit Wine application.  
Refer to this document when creating new pages or components to ensure a consistent look and feel.

---

## Color Palette

- **Background Primary:** `#1a1626` (dark, main background)
- **Background Secondary:** `#2a2438` (panel backgrounds)
- **Accent Background:** `#3a3448` (buttons, highlights)
- **Text Primary:** `#e6e6e6` (main text)
- **Text Accent:** `#b8b8b8` (labels, secondary text)
- **Borders:** `#4a4458`
- **Button Active:** `#5a5468`
- **Button Hover:** `#4a4458`
- **Error:** `#ff6b6b`
- **Success:** `#28a745`

---

## Typography

- **Font:** `'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`
- **Font Weight:** Use `500` or `600` for headings and buttons, normal for body text.
- **Font Size:**  
  - Headings: `1.5rem`  
  - Body: `16px`  
  - Small text/hints: `14px`

---

## Layout

- **Grid:**  
  - Desktop: Two-column layout with panels for packs, config, and stickers.
  - Mobile: Single-column, stacked panels.
  - Use CSS Grid for main container.
- **Panels:**  
  - Rounded corners (`12px` radius)
  - Padding: `20px` desktop, `15px` mobile
  - Subtle border using `--border-color`
- **Spacing:**  
  - Use `gap: 20px` (desktop) or `15px` (mobile) between panels.
  - Consistent margin and padding for all elements.

---

## Buttons

- **Shape:** Rounded (`8px` radius)
- **States:**  
  - Default: `--bg-accent` background, `--text-primary` text
  - Hover: `--button-hover` background
  - Active: `--button-active` background, `--text-accent` border
- **Special Buttons:**  
  - Add: Green (`#28a745`)
  - Remove: Red (`#dc3545`)
- **Size:**  
  - Minimum width: `80px` (desktop), `60px` (mobile)
  - Padding: `12px 20px` (desktop), `10px 16px` (mobile)

---

## Forms & Inputs

- **Inputs:**  
  - Background: `--bg-primary`
  - Border: `--border-color`
  - Rounded: `6px`
  - Font: Inherit
  - Padding: `12px 16px`
- **Selects:**  
  - Same style as inputs
  - Full width

---

## Sticker Grid & Preview

- **Sticker Grid:**  
  - Responsive grid, min `80px` per item (desktop), `60px` (mobile)
  - Items: Rounded, subtle border, hover highlight
  - Selected: Accent border and background
- **Sticker Images:**  
  - `object-fit: contain`
  - Rounded corners (`4px`)
- **Preview:**  
  - Centered in panel, max width/height
  - Clickable for copy/download
  - Feedback shown in `.copy-hint` below preview

---

## Accessibility & Usability

- **Contrast:**  
  - Ensure text and controls have high contrast against backgrounds.
- **Focus:**  
  - All interactive elements should be keyboard accessible.
- **Feedback:**  
  - Use color and text for feedback (e.g., copy/download success, errors).
- **Responsiveness:**  
  - All layouts and controls must adapt to mobile and desktop screens.

---

## Icons & Branding

- **Logo:**  
  - Use `rabbitwine.png` as the main logo.
- **Favicon & Touch Icons:**  
  - Provide all standard sizes for cross-platform compatibility.

---

## General Guidelines

- **Consistency:**  
  - All new pages and components must use these colors, spacing, and typography.
- **Simplicity:**  
  - Keep UI elements minimal and clear.
- **Modularity:**  
  - Structure new pages using panels and groups as in the main app.

---

_Refer to this document before making UI changes or adding new pages to Rabbit Wine._