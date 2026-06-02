// src/components/modes/ModesScreen.jsx
//
// The Modes tab. Single home for every match-mode the app offers so the
// Home tab stays focused on a single "wrestle a CPU match" CTA. No new
// gameplay logic - every tile delegates to a handler passed down from
// WrestlingGame, which owns the navigation state.
//
// Layout: NavBar header + a vertical list of large tap targets, each
// row is "icon | name + 1-line description | chevron". This matches the
// pattern already used by ProgressScreen's leaderboard row, so the look
// is consistent with the rest of the v2.0 shell.

import React from 'react';
import {
  ChevronRight,
  Bot,        // Versus CPU
  Users,      // Head-to-Head
  Globe,      // Online MP
  Briefcase,  // Career
  Trophy,     // Tournament
  Swords,     // Dual Meet
  Dumbbell,   // Training
} from 'lucide-react';
import NavBar from '../ui/NavBar';

const TINTS = {
  yellow:  { bg: 'bg-yellow-950/40',  border: 'border-yellow-800/50',  icon: 'text-yellow-400'  },
  red:     { bg: 'bg-red-950/40',     border: 'border-red-800/50',     icon: 'text-red-400'     },
  emerald: { bg: 'bg-emerald-950/40', border: 'border-emerald-800/50', icon: 'text-emerald-400' },
  purple:  { bg: 'bg-purple-950/40',  border: 'border-purple-800/50',  icon: 'text-purple-400'  },
  amber:   { bg: 'bg-amber-950/40',   border: 'border-amber-800/50',   icon: 'text-amber-400'   },
  sky:     { bg: 'bg-sky-950/40',     border: 'border-sky-800/50',     icon: 'text-sky-400'     },
  zinc:    { bg: 'bg-zinc-900',       border: 'border-zinc-800',       icon: 'text-zinc-300'    },
};

function ModeRow({ icon: Icon, label, hint, tint = 'zinc', onClick, disabled = false }) {
  const t = TINTS[tint] || TINTS.zinc;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full ${t.bg} border ${t.border} rounded-2xl p-4 flex items-center gap-3 transition-all ${
        disabled
          ? 'opacity-40 cursor-not-allowed'
          : 'active:scale-[0.98] hover:bg-zinc-800/60'
      }`}
    >
      <div className={`w-10 h-10 rounded-xl bg-zinc-950 flex items-center justify-center ${t.icon}`}>
        <Icon size={20} />
      </div>
      <div className="flex-1 text-left">
        <div className="text-white font-black text-base">{label}</div>
        {hint ? <div className="text-zinc-400 text-xs">{hint}</div> : null}
      </div>
      <ChevronRight className="text-zinc-600" size={18} />
    </button>
  );
}

export default function ModesScreen({
  onBack,
  onVersusCpu,
  onHeadToHead,
  onNetwork,
  onCareer,
  onTournament,
  onDualMeet,
  onTraining,
  // Online-only modes get visually disabled when the device is offline.
  // We don't hide them - players need the affordance to know they exist.
  isOffline = false,
}) {
  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      <NavBar title="Modes" onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md md:max-w-2xl mx-auto w-full space-y-2">
        <ModeRow
          icon={Bot}
          label="Versus CPU"
          hint="Pick a difficulty and start a match"
          tint="yellow"
          onClick={onVersusCpu}
        />
        <ModeRow
          icon={Users}
          label="Head-to-Head"
          hint="Local 1v1 on the same device"
          tint="red"
          onClick={onHeadToHead}
        />
        <ModeRow
          icon={Globe}
          label="Online Multiplayer"
          hint={isOffline ? 'Offline - reconnect to play online' : 'Quick Match and matchmaking'}
          tint="emerald"
          onClick={onNetwork}
          disabled={isOffline}
        />
        <ModeRow
          icon={Briefcase}
          label="Career Mode"
          hint="Multi-season run with recruiting and growth"
          tint="purple"
          onClick={onCareer}
        />
        <ModeRow
          icon={Trophy}
          label="Tournament"
          hint="Bracket play against a custom field"
          tint="amber"
          onClick={onTournament}
        />
        <ModeRow
          icon={Swords}
          label="Dual Meet"
          hint="Team-vs-team across all weight classes"
          tint="sky"
          onClick={onDualMeet}
        />
        <ModeRow
          icon={Dumbbell}
          label="Training Hub"
          hint="Drills and reaction-time bests"
          tint="zinc"
          onClick={onTraining}
        />
      </div>
    </div>
  );
}
