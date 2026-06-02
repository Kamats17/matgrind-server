// src/components/ui/NavBar.jsx
//
// iOS-style top navigation bar. Standard 44pt touch-target height plus
// safe-area-top padding. Sticky so it stays pinned on scrolling screens.
//
//   ┌──────────────────────────────────┐
//   │ ‹   Profile                   ⚙  │   ← 44pt tall, pt-safe above
//   └──────────────────────────────────┘
//
// Props:
//   title   - centered title string (required)
//   onBack  - click handler for the chevron on the left (optional; if
//             omitted, the back button is hidden)
//   right   - optional React node rendered in the right slot (e.g. a
//             settings / edit button)
//
// Behaviour:
//   - Haptic .light() fires on back tap
//   - Back button is a 44x44 hit target even though the visible chevron
//     is small - this is the iOS HIG minimum
//   - Sticky at the top of its scroll container; backdrop blur so content
//     behind it looks correct when the user is mid-scroll

import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { haptic } from '../../lib/haptics';

export default function NavBar({ title, onBack, right = null, className = '' }) {
  const handleBack = () => {
    try { haptic.light(); } catch { /* silent */ }
    onBack?.();
  };

  return (
    <div
      className={
        'sticky top-0 z-20 bg-zinc-950/95 backdrop-blur ' +
        'border-b border-zinc-800 pt-safe ' + className
      }
    >
      <div className="h-11 flex items-center px-2 relative">
        {/* Left slot */}
        <div className="w-11 h-11 flex items-center justify-start">
          {onBack && (
            <button
              onClick={handleBack}
              aria-label="Back"
              className="w-11 h-11 -ml-1 flex items-center justify-center text-zinc-300 hover:text-white active:opacity-60 transition-opacity"
            >
              <ChevronLeft size={26} strokeWidth={2.5} />
            </button>
          )}
        </div>

        {/* Centered title */}
        <div className="flex-1 text-center font-bold text-white truncate px-2">
          {title}
        </div>

        {/* Right slot */}
        <div className="w-11 h-11 flex items-center justify-end">
          {right}
        </div>
      </div>
    </div>
  );
}
