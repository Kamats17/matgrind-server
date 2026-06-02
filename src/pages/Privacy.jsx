import React from 'react';
import NavBar from '../components/ui/NavBar';

export default function Privacy({ onBack }) {
  return (
    <div className="min-h-full bg-zinc-950 text-zinc-300">
      <NavBar title="Privacy Policy" onBack={onBack} />
      <div className="max-w-lg md:max-w-2xl mx-auto px-4 py-6">
        <p className="text-zinc-500 text-xs mb-6">Last updated: April 2026</p>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-white font-bold text-base mb-2">1. What Data We Collect</h2>
            <p>
              MatGrind collects minimal data to provide core game functionality:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-zinc-400">
              <li>Account information (username, authentication tokens)</li>
              <li>Game data (match history, scores, win/loss records, XP, achievements)</li>
              <li>Device information (screen size for responsive layout)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">2. How We Use Your Data</h2>
            <p>Your data is used exclusively to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-zinc-400">
              <li>Maintain your player profile and track progression</li>
              <li>Record match history and statistics</li>
              <li>Enable online multiplayer game sessions (room-code matches via our server)</li>
              <li>Save your preferences and game settings</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">3. Third-Party Services</h2>
            <p>
              This app uses <span className="text-zinc-200">Google Firebase</span> as a backend service
              for user authentication and data storage. Firebase processes and stores your account
              and game data on secure servers. Please refer to Google's privacy policy for
              details on their data handling practices.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">4. Analytics & Crash Reporting</h2>
            <p>
              This app uses <span className="text-zinc-200">Google Firebase Analytics</span> to
              collect non-personally identifiable gameplay events such as match starts, match
              completions, and error reports. These events help us improve game stability and
              balance. No usernames, email addresses, or device identifiers are included in
              analytics data. Firebase may collect standard analytics data as described in{' '}
              <a href="https://firebase.google.com/support/privacy" className="text-emerald-400 underline" target="_blank" rel="noopener noreferrer">
                Google's Firebase Privacy Policy
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">5. Local Storage</h2>
            <p>
              The app stores small amounts of data locally on your device using browser
              localStorage. This includes authentication tokens, sound preferences, and
              temporary match state for session recovery. This data never leaves your device
              except as part of normal authentication flows.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">6. Data Retention</h2>
            <p>
              Game data (match history, profile stats) is retained as long as your account
              is active. You may request deletion of your data at any time by contacting us.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">7. Children's Privacy</h2>
            <p>
              MatGrind is a sports simulation game suitable for all ages. We do
              not knowingly collect personal information from children under 13 beyond what
              is necessary for gameplay. If you are a parent or guardian and believe your
              child has provided personal information, please contact us.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">8. Data Security</h2>
            <p>
              We implement reasonable security measures to protect your data. However, no
              method of electronic transmission or storage is 100% secure. We cannot
              guarantee absolute security of your information.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">9. Changes to This Policy</h2>
            <p>
              We may update this privacy policy from time to time. Changes will be reflected
              by updating the "Last updated" date at the top of this page. Continued use of
              the app after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-base mb-2">10. Contact</h2>
            <p>
              For questions or concerns about this privacy policy or your data, please
              contact us at{' '}
              <a href="mailto:kamatsservices@gmail.com" className="text-emerald-400 underline">
                kamatsservices@gmail.com
              </a>.
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
