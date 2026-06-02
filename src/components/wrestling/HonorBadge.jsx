import React, { useState } from 'react';
import { honorFor } from '../../lib/honors.js';

/**
 * Renders a special-honor badge for the given uid, if one exists.
 * Size presets: 'sm' (leaderboard row) | 'lg' (profile hero).
 *
 * @param {{ uid: string | null | undefined, size?: 'sm' | 'lg', className?: string }} props
 */
export default function HonorBadge({ uid, size = 'sm', className = '' }) {
  const [failed, setFailed] = useState(false);
  const honor = honorFor(uid);
  if (!honor || failed) return null;
  const px = size === 'lg' ? 56 : 28;
  return (
    <img
      src={honor.imageSrc}
      alt={honor.title}
      title={honor.title}
      width={px}
      height={px}
      draggable={false}
      onError={() => setFailed(true)}
      className={`flex-shrink-0 select-none ${className}`}
      style={{ width: px, height: px }}
    />
  );
}
