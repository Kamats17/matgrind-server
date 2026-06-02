import React from 'react';
import NavBar from '../components/ui/NavBar';
import { APP_VERSION } from '../lib/version';

export default function About({ onBack }) {
  return (
    <div className="min-h-full bg-zinc-950 text-zinc-300">
      <NavBar title="About" onBack={onBack} />
      <div className="max-w-lg md:max-w-2xl mx-auto px-4 py-6">
        {/* App info card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-6">
          <div className="text-center">
            <img src="/positions/matgrind-text.png" alt="MatGrind" className="h-6 mx-auto" draggable={false} />
            <p className="text-zinc-500 text-xs mt-1">Version {APP_VERSION}</p>
          </div>
        </div>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-white font-bold text-base mb-2">About the Game</h2>
            <p>
              A strategy card game built for wrestlers, by wrestlers. Master folkstyle, freestyle,
              and greco-roman wrestling through tactical card play that rewards real wrestling knowledge.
              Every move, counter, and chain sequence is grounded in actual wrestling technique.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">How It Works</h2>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li>Choose moves from your hand each round</li>
              <li>Counter your opponent with the right defensive card</li>
              <li>Chain setups into attacks for bonus power</li>
              <li>Manage stamina across three periods</li>
              <li>Win by pin, tech fall, or decision</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">Wrestling Styles</h2>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li><span className="text-white font-semibold">Folkstyle</span> - NFHS & NCAA rules, riding time, escapes</li>
              <li><span className="text-white font-semibold">Freestyle</span> - UWW/Olympic rules, par terre, exposure scoring</li>
              <li><span className="text-white font-semibold">Greco-Roman</span> - UWW/Olympic rules, upper body only, throws</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">Contact & Support</h2>
            <p>
              Questions, feedback, or issues? Reach us at:
            </p>
            <a
              href="mailto:kamatsservices@gmail.com"
              className="inline-block mt-2 text-emerald-400 hover:text-emerald-300 underline font-semibold"
            >
              kamatsservices@gmail.com
            </a>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">Legal</h2>
            <p className="text-zinc-400">
              By using this app you agree to our Privacy Policy and Terms of Service,
              accessible from the main menu.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-zinc-800">
          <button
            onClick={onBack}
            className="text-zinc-500 hover:text-zinc-300 transition-colors text-sm font-semibold"
          >
            &larr; Back to Menu
          </button>
          <p className="text-zinc-700 text-xs mt-3">&copy; 2026 Kamats Services. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
