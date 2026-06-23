// Server-safe constant - imported by both ThemeProvider ('use client') and ThemeScript (rendered
// into <head>). Plain export so Next inlines the string. AURA persists theme here directly (no
// consent gate, unlike arca).
export const THEME_STORAGE_KEY = "aura-theme";
