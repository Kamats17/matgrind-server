import React from 'react';
import NavBar from '../components/ui/NavBar';

export default function Terms({ onBack }) {
  return (
    <div className="min-h-full bg-zinc-950 text-zinc-300">
      <NavBar title="Terms of Service" onBack={onBack} />
      <div className="max-w-lg md:max-w-2xl mx-auto px-4 py-6">
        <p className="text-zinc-500 text-xs mb-6">Last updated: April 2026</p>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-white font-bold text-base mb-2">1. Acceptance of Terms</h2>
            <p>
              By downloading, installing, or using MatGrind ("the App"), you agree
              to be bound by these Terms of Service. If you do not agree to these terms, do
              not use the App.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">2. Description of Service</h2>
            <p>
              MatGrind is a digital card-based wrestling simulation game offering
              single-player (vs CPU), local two-player, and network multiplayer modes across
              folkstyle, freestyle, and Greco-Roman wrestling styles.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">3. User Accounts</h2>
            <p>
              You may need to create an account to access certain features such as profile
              tracking, match history, and achievements. You are responsible for maintaining
              the confidentiality of your account credentials and for all activities that
              occur under your account.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">4. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-zinc-400">
              <li>Exploit bugs, glitches, or design flaws for unfair advantage</li>
              <li>Attempt to reverse-engineer, decompile, or modify the App</li>
              <li>Use automated tools, bots, or scripts to interact with the App</li>
              <li>Interfere with other users' enjoyment of the App</li>
              <li>Use the App for any unlawful purpose</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">5. Intellectual Property</h2>
            <p>
              All content, graphics, code, game mechanics, and other materials in the App are
              owned by or licensed to us and are protected by copyright and other intellectual
              property laws. You may not reproduce, distribute, or create derivative works
              based on the App without explicit permission.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">6. Virtual Items</h2>
            <p>
              XP, levels, titles, achievements, and other virtual items have no real-world
              monetary value. They are granted for entertainment purposes only and may be
              modified, reset, or removed at our discretion.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">7. Disclaimers</h2>
            <p>
              The App is provided "as is" and "as available" without warranties of any kind,
              either express or implied. We do not guarantee that the App will be
              uninterrupted, error-free, or free of harmful components.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">8. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, we shall not be liable for any
              indirect, incidental, special, consequential, or punitive damages arising
              from your use of the App, including but not limited to loss of data or
              interruption of gameplay.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">9. Modifications</h2>
            <p>
              We reserve the right to modify these terms at any time. Updated terms will be
              posted within the App. Your continued use of the App after modifications
              constitutes acceptance of the revised terms.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">10. Termination</h2>
            <p>
              We may suspend or terminate your access to the App at any time, for any
              reason, without prior notice. Upon termination, your right to use the App
              ceases immediately.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">11. Contact</h2>
            <p>
              For questions about these Terms of Service, please reach out through the
              app's support channels.
            </p>
          </section>
        </div>

        <div className="mt-8 pt-4 border-t border-zinc-800">
          <button
            onClick={onBack}
            className="text-zinc-500 hover:text-zinc-300 transition-colors text-sm font-semibold"
          >
            &larr; Back to Menu
          </button>
        </div>
      </div>
    </div>
  );
}
