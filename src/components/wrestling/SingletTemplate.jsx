import React, { useEffect, useId, useState } from 'react';
import {
  SINGLET_VIEWBOX,
  TEMPLATE_IMAGE,
  STRIPE_PATHS,
  TEXT_POSITIONS,
  SINGLET_DEFAULTS,
  autoFontSize,
  loadSingletMaskUrl,
} from '../../lib/singletDesign.js';

// Pure SVG renderer for the singlet. Either side (front | back) shows the
// matching half of the side-by-side template PNG, masked to the silhouette
// derived from a one-time client-side flood-fill of that PNG. Color zones
// are drawn beneath, the PNG outline is multiplied on top, and text is
// drawn outside the masked group so it stays crisp.
//
// Props:
//   view     'front' | 'back'                      (default 'front')
//   singlet  partial of SINGLET_DEFAULTS shape
//   width    number (CSS px), height auto-computes from viewBox aspect
//   className extra Tailwind classes for the wrapping <svg>
export default function SingletTemplate({
  view = 'front',
  singlet,
  width = 240,
  className = '',
}) {
  const data = { ...SINGLET_DEFAULTS, ...(singlet || {}) };
  // useId gives a unique mask id per component instance so multiple
  // SingletTemplate instances on one page don't collide on `mask-${view}`.
  const rawId = useId();
  const idSafe = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const maskId = `singlet-mask-${idSafe}`;

  const [maskUrl, setMaskUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadSingletMaskUrl()
      .then(url => { if (!cancelled) setMaskUrl(url); })
      .catch(err => { console.warn('[SingletTemplate] mask load failed:', err); });
    return () => { cancelled = true; };
  }, []);

  const imageX = view === 'back' ? TEMPLATE_IMAGE.backX : TEMPLATE_IMAGE.frontX;
  const isBack = view === 'back';

  // Text: front shows team + weight, back shows lastName + weight. Weight
  // text gets a " lbs" suffix in the design so onlookers know it's the
  // weight class. Empty strings render as nothing (textContent='').
  const tFront = TEXT_POSITIONS.front;
  const tBack  = TEXT_POSITIONS.back;
  const teamFS   = autoFontSize(data.teamText,        tFront.team.baseFS,   tFront.team.maxWidth);
  const fWeightFS = autoFontSize(data.weightClassText ? `${data.weightClassText} lbs` : '', tFront.weight.baseFS, tFront.weight.maxWidth);
  const nameFS   = autoFontSize(data.lastNameText,    tBack.name.baseFS,    tBack.name.maxWidth);
  const bWeightFS = autoFontSize(data.weightClassText ? `${data.weightClassText} lbs` : '', tBack.weight.baseFS,  tBack.weight.maxWidth);

  const stroke = data.textColor.toLowerCase() === '#ffffff' ? '#000' : '#fff';

  const vb = `0 0 ${SINGLET_VIEWBOX.width} ${SINGLET_VIEWBOX.height}`;
  const aspect = SINGLET_VIEWBOX.height / SINGLET_VIEWBOX.width;

  return (
    <svg
      viewBox={vb}
      width={width}
      height={width * aspect}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Singlet ${view} view`}
      className={className}
      style={{ display: 'block' }}
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width={SINGLET_VIEWBOX.width}
          height={SINGLET_VIEWBOX.height}
        >
          {/* Mask source is the processed PNG (bg black, singlet white).
              Until the flood-fill resolves, mask renders nothing; once
              maskUrl is set we re-render with the mask source applied. */}
          {maskUrl ? (
            <image
              href={maskUrl}
              xlinkHref={maskUrl}
              x={imageX}
              y={0}
              width={TEMPLATE_IMAGE.width}
              height={TEMPLATE_IMAGE.height}
              preserveAspectRatio="none"
            />
          ) : null}
        </mask>
      </defs>

      <g mask={`url(#${maskId})`}>
        {/* Chest base fill spans the entire viewBox; mask clips it to
            silhouette. Side stripes drawn on top, then the PNG outline
            is multiplied over the colored zones. */}
        <rect x="0" y="0" width={SINGLET_VIEWBOX.width} height={SINGLET_VIEWBOX.height} fill={data.chestColor} />
        <path d={STRIPE_PATHS.left}  fill={data.sidesColor} />
        <path d={STRIPE_PATHS.right} fill={data.sidesColor} />
        <image
          href={TEMPLATE_IMAGE.src}
          xlinkHref={TEMPLATE_IMAGE.src}
          x={imageX}
          y={0}
          width={TEMPLATE_IMAGE.width}
          height={TEMPLATE_IMAGE.height}
          preserveAspectRatio="none"
          style={{ mixBlendMode: 'multiply' }}
        />
      </g>

      {/* Text: outside the mask group so it always renders crisply, even
          before the mask URL has resolved. Front shows team + weight,
          back shows last name + weight. */}
      {!isBack && (
        <>
          <text
            x={tFront.team.x}
            y={tFront.team.y}
            textAnchor="middle"
            fontFamily="Impact, 'Figtree', sans-serif"
            fontWeight="900"
            fontSize={teamFS}
            letterSpacing="2"
            fill={data.textColor}
            stroke={stroke}
            strokeWidth="0.4"
            paintOrder="stroke"
          >
            {(data.teamText || '').toUpperCase()}
          </text>
          <text
            x={tFront.weight.x}
            y={tFront.weight.y}
            textAnchor="middle"
            fontFamily="Impact, 'Figtree', sans-serif"
            fontWeight="900"
            fontSize={fWeightFS}
            letterSpacing="2"
            fill={data.textColor}
            stroke={stroke}
            strokeWidth="0.3"
            paintOrder="stroke"
          >
            {data.weightClassText ? `${data.weightClassText} LBS` : ''}
          </text>
        </>
      )}

      {isBack && (
        <>
          <text
            x={tBack.name.x}
            y={tBack.name.y}
            textAnchor="middle"
            fontFamily="Impact, 'Figtree', sans-serif"
            fontWeight="900"
            fontSize={nameFS}
            letterSpacing="3"
            fill={data.textColor}
            stroke={stroke}
            strokeWidth="0.5"
            paintOrder="stroke"
          >
            {(data.lastNameText || '').toUpperCase()}
          </text>
          <text
            x={tBack.weight.x}
            y={tBack.weight.y}
            textAnchor="middle"
            fontFamily="Impact, 'Figtree', sans-serif"
            fontWeight="900"
            fontSize={bWeightFS}
            letterSpacing="2"
            fill={data.textColor}
            stroke={stroke}
            strokeWidth="0.3"
            paintOrder="stroke"
          >
            {data.weightClassText ? `${data.weightClassText} LBS` : ''}
          </text>
        </>
      )}
    </svg>
  );
}
