// src/lib/zIndex.js
//
// Centralized z-index scale for v2.0. Before this file, z-values were
// scattered across Tailwind classes (z-20, z-30, z-50, z-[100]) with no
// guarantee two overlapping layers used compatible stacks. That worked
// until the TabBar + BottomSheet + pin-attempt modal needed to coexist.
//
// Use these constants for inline styles, and prefer the matching Tailwind
// class where one exists. New overlay layers should extend this scale
// rather than invent their own.

export const Z = {
  NAVBAR:         20,  // NavBar.jsx sticky top
  TABBAR:         30,  // TabBar (always above screen content)
  SHEET_BACKDROP: 50,  // BottomSheet + CardDetailSheet dim layer
  SHEET_CONTENT:  55,  // Sheet content sits just above its backdrop
  FOCUS_OVERLAY:  70,  // Pin attempt, drill active-round, full-screen focus
  TOAST:          80,  // Ephemeral toasts, above everything except…
  PIN_MODAL:      90,  // …modal dialogs that must cover even toasts
};

export default Z;
