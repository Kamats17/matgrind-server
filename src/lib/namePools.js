// ─── Centralized wrestler name pools + event roster name generation ──────────
//
// Single source of truth for every generated wrestler name in the game:
// career ranking pools, career rivals, standalone tournaments, dual meets.
// Before this module those pools lived in three separate files and drifted
// independently. `generateEventNames` is the one helper all of those paths
// call so duplicate-name safeguards live in exactly one place.

// Men's first/last pools. Large enough that a 128-wrestler bracket (127
// generated opponents) can get unique first AND last names without the
// numbered fallback.
export const MENS_FIRST_NAMES = [
  'Blake', 'Connor', 'Dylan', 'Ethan', 'Felix', 'Grayson', 'Hunter', 'Isaac',
  'Jack', 'Kyle', 'Liam', 'Mason', 'Nolan', 'Owen', 'Parker', 'Quincy',
  'Ryan', 'Sawyer', 'Trevor', 'Vince', 'Wyatt', 'Xavier', 'Zach',
  'Adrian', 'Brody', 'Caleb', 'Devin', 'Elliot', 'Finn', 'Grant',
  'Aiden', 'Asher', 'Austin', 'Bennett', 'Brandon', 'Carson', 'Cole',
  'Dakota', 'Damian', 'Diego', 'Drew', 'Easton', 'Eli', 'Emmanuel',
  'Gabriel', 'Garrett', 'Holden', 'Ivan', 'Jaxon', 'Jonah', 'Jordan',
  'Joseph', 'Joshua', 'Julian', 'Kai', 'Knox', 'Landon', 'Leo', 'Levi',
  'Logan', 'Lucas', 'Malachi', 'Marcus', 'Maverick', 'Micah', 'Miles',
  'Nathan', 'Noah', 'Oliver', 'Pierce', 'Preston', 'Ramon', 'Reed',
  'Roman', 'Rowan', 'Samuel', 'Silas', 'Tobias', 'Tristan', 'Tucker',
  'Wesley', 'William', 'Zane', 'Beckett', 'Cason', 'Cruz', 'Daniel',
  'Davis', 'Demarcus', 'Donovan', 'Emilio', 'Enzo', 'Greyson', 'Hudson',
  'Jasper', 'Jeremiah', 'Kameron', 'Karter', 'Kingston', 'Maddox', 'Otto',
  'Reid',
  'Nelson', 'Stan', 'Randolph', 'Emmanuel', 'Oliver', 'Russ', 'Ray',
  'Juan', 'Mark', 'Joe', 'Philip', 'Steven', 'Clay', 'Paul', 'Brendan',
  'Jeff', 'Hugo', 'Curtis', 'Garry', 'Brian', 'Lloyd', 'Kirk', 'Mike',
  'Roland', 'Roderick', 'Lowell', 'Herman', 'Scott', 'Rogelio', 'Edward',
  'Danny', 'Leroy', 'Casey', 'Harold', 'Bennie', 'Bert', 'Melvin',
  'Virgil', 'Orlando', 'Ruben', 'Patrick', 'Ali', 'Dale', 'Jonathan',
  'Alex', 'Marvin',
];

export const MENS_LAST_NAMES = [
  'Anderson', 'Brooks', 'Carter', 'Daniels', 'Edwards', 'Foster', 'Garcia',
  'Harrison', 'Ingram', 'Jackson', 'Kennedy', 'Larsen', 'Martinez',
  'Nelson', 'O\'Brien', 'Powell', 'Quintero', 'Richardson', 'Sullivan',
  'Thompson', 'Underwood', 'Vincent', 'Walsh', 'Young', 'Zimmerman',
  'Alvarez', 'Baker', 'Brown', 'Bryant', 'Campbell', 'Castillo', 'Chen',
  'Cole', 'Collins', 'Cooper', 'Cruz', 'Dalton', 'Davis', 'Delgado',
  'Diaz', 'Donovan', 'Dunn', 'Ellis', 'Fischer', 'Fitzgerald', 'Fleming',
  'Flores', 'Franklin', 'Gallagher', 'Gomez', 'Hall', 'Hamilton', 'Hayes',
  'Henderson', 'Hudson', 'Hughes', 'James', 'Jensen', 'Johnson', 'Kim',
  'King', 'Kowalski', 'Lopez', 'Marsh', 'McCarthy', 'Mitchell', 'Moore',
  'Morgan', 'Murphy', 'Nguyen', 'Ortiz', 'Patel', 'Patterson', 'Pearson',
  'Perez', 'Peterson', 'Quinn', 'Ramos', 'Reyes', 'Roberts', 'Rodriguez',
  'Romano', 'Schmidt', 'Singh', 'Smith', 'Stevens', 'Tanaka',
  'Aikens', 'Hopwood', 'Newton', 'Garwood', 'Clary', 'Bailey',
  'Sloan', 'Bassett', 'Hutchins', 'Church', 'Gray', 'Swift', 'Moor',
  'Potter', 'Butler', 'McCabe', 'Wilcox', 'Walters', 'Nichols',
  'Hensley', 'McDermott', 'Maloney', 'Williams', 'Dennis', 'Werner',
  'Hand', 'Proctor', 'Weiss', 'Root', 'Costello', 'Snider', 'Ewing',
  'Torres', 'Haney', 'Stanton', 'Roach', 'Harmon', 'Reed', 'Kirkpatrick',
  'Parker', 'Glass', 'Stone', 'Morton', 'Hardy', 'Murry', 'Cummings',
  'Weston', 'Mejia', 'Townsend', 'Hines', 'McCann', 'Miner',
];

// Women's first-name pool. Last names are gender-neutral so the women's
// last pool is the men's pool plus a women's-canonical extension.
export const WOMENS_FIRST_NAMES = [
  'Caroline', 'Chelsea', 'Laura', 'Bertha', 'Carmen', 'Teresa', 'Stacie',
  'Danielle', 'Veronica', 'Alison', 'Jeanne', 'Kari', 'Toni', 'Jodie',
  'Samantha', 'Lea', 'Maxine', 'Susan', 'Josie', 'Bethany', 'Kristine',
  'Jean', 'Ruby', 'Penny', 'Hannah', 'Maryann', 'Sharon', 'Alexis', 'Leah',
  'Barb', 'Margie', 'Beatrice', 'Denni', 'Lydia', 'Brooke', 'Taylor',
  'Connie', 'Tonya', 'Paulette', 'Merle', 'Caitlin', 'Harriet', 'Isabel',
  'Tabitha', 'Suzanne', 'Alice', 'Valerie', 'Elsa', 'Audrey', 'Madeline',
  'Belinda', 'Lucille', 'Mabel', 'Patricia', 'Brandi', 'Elsie', 'Leanne',
  'Rachel', 'Edna', 'Jodi', 'Amanda', 'Colleen', 'Charlotte', 'Joann',
  'Gwendolyn', 'Heidi', 'Tracey', 'Jacquelyn', 'Jennie', 'Norma', 'Eunice',
  'Sonia', 'Robbie', 'Viola', 'Betsy', 'Paige', 'Marsha', 'Elvira', 'Lois',
  'Josefina', 'Cheri', 'Agnes', 'Kristen', 'Rita', 'Jane', 'Maggie',
  'Natalie', 'Alisha', 'Shari', 'Christina', 'Terri', 'Melanie', 'Florence',
  'Louise', 'Hazel', 'Kim', 'Sue', 'Sheryl', 'Martha', 'Juana',
  'Larissa', 'Angelee', 'Niki',
  'Aaliyah', 'Adriana', 'Allison', 'Amaya', 'Amelia', 'Aria', 'Ariana',
  'Aubrey', 'Bella', 'Brielle', 'Brynn', 'Camila', 'Cara', 'Cecilia',
  'Celeste', 'Cheyenne', 'Claudia', 'Cora', 'Daisy', 'Delaney', 'Delilah',
  'Diana', 'Eden', 'Elena', 'Elise', 'Elizabeth', 'Emerson', 'Emily',
  'Esme', 'Esperanza', 'Esther', 'Evelyn', 'Faith', 'Fiona', 'Frankie',
  'Gabriela', 'Gianna', 'Grace', 'Greta', 'Gwen', 'Haley', 'Helen',
  'Helena', 'Imani', 'Ingrid', 'Iris', 'Isabella', 'Ivy', 'Jada',
  'Jasmine', 'Jocelyn', 'Jordan', 'Julia', 'Juliet', 'Juniper', 'Kaori',
  'Karina', 'Kate', 'Katherine', 'Kayla', 'Kendall', 'Kendra', 'Kennedy',
  'Kira', 'Layla', 'Liliana', 'Logan', 'Luna', 'Madelyn', 'Mariah',
  'Marisol', 'Marley', 'Maya', 'Mei', 'Mia', 'Michelle', 'Morgan',
  'Naomi', 'Nia', 'Nora', 'Octavia', 'Olivia', 'Penelope', 'Peyton',
  'Phoebe', 'Phoenix', 'Quinn', 'Reagan', 'Reese', 'Regina', 'Reyna',
  'Riley', 'Rosalie', 'Roselyn', 'Sage', 'Saoirse', 'Sarah', 'Savannah',
  'Scarlett', 'Selena', 'Serena', 'Sienna', 'Sierra', 'Skylar', 'Sloane',
  'Sofia', 'Stella', 'Sydney', 'Talia', 'Tamyra', 'Taryn', 'Tessa',
  'Theodora', 'Tiana', 'Trinity', 'Valeria', 'Vanessa', 'Vera', 'Victoria',
  'Violet', 'Whitney', 'Willow', 'Yara', 'Zara', 'Zoe', 'Zoey',
];

// Women's-canonical last names that extend the shared men's last pool.
export const WOMENS_LAST_EXTRAS = [
  'Aikens', 'Newton', 'Kamats', 'Garwood', 'Wennin',
  'Hoffman', 'Sampson', 'Graham', 'Blevins', 'Hatfield', 'Carver',
  'McGee', 'Mills', 'Chung', 'Pacheco', 'Gorman', 'Ferrell', 'Wood',
  'Evans', 'Morse', 'Lancaster', 'Dawson', 'Clements', 'Beck', 'Escobar',
  'Johns', 'Wilcox', 'Wells', 'Dixon', 'Morrison', 'Chase', 'Lucas',
  'Noble', 'Crowley', 'Blanchard', 'Duke', 'Henry', 'Bean', 'Bolton',
  'Head', 'Daniels', 'Hickey', 'Brennan', 'Kramer', 'Wang', 'Calderon',
  'Jefferson', 'Sherwood', 'Dickson', 'Fowler', 'Murray', 'Harmon',
  'Arnold', 'Page', 'Barnes', 'Bartlett', 'Franklin', 'Combs',
  'Christian', 'Joseph', 'Barrett', 'Larsen', 'Boyd', 'Henson',
  'McGuire', 'Valenzuela', 'Butler', 'Donaldson', 'Small', 'McGowan',
  'Huber', 'Hastings', 'Nolan', 'Molina', 'Pena', 'Rogers', 'Montoya',
  'Slater', 'West', 'Fulton', 'Dudley', 'Downing', 'Tate', 'Cordova',
  'Townsend', 'McElroy', 'Dodson', 'Burns', 'Love', 'Donahue',
  'Beard', 'McAllister', 'Ryan', 'McConnell', 'Moses', 'Hansen',
  'Baldwin', 'Black', 'Waller',
];

export const WOMENS_LAST_NAMES = [...MENS_LAST_NAMES, ...WOMENS_LAST_EXTRAS];

// The four wrestling styles the game supports. `id` is the value persisted
// on tournament/dual/career state; `label` is the UI string.
export const WRESTLING_STYLES = [
  { id: 'folkstyle', label: 'Folkstyle' },
  { id: 'freestyle', label: 'Freestyle' },
  { id: 'greco', label: 'Greco-Roman' },
  { id: 'womens_freestyle', label: "Women's Freestyle" },
];

/**
 * Map a wrestling style to the gender whose name pool its opponents draw
 * from. Women's Freestyle is the only women's-division style; everything
 * else (and anything unrecognized) is men's.
 * @param {string} [style]
 * @returns {'male'|'female'}
 */
export function genderForStyle(style) {
  return style === 'womens_freestyle' ? 'female' : 'male';
}

/**
 * Gender-appropriate first/last name pools.
 * @param {string} [gender] - 'female' selects the women's pool; anything else men's
 * @returns {{ firsts: string[], lasts: string[] }}
 */
export function getNamePools(gender) {
  return gender === 'female'
    ? { firsts: WOMENS_FIRST_NAMES, lasts: WOMENS_LAST_NAMES }
    : { firsts: MENS_FIRST_NAMES, lasts: MENS_LAST_NAMES };
}

/**
 * Resolve the effective wrestling style. Precedence, highest first:
 *   1. explicit style chosen on the event setup screen
 *   2. the current career / save's style
 *   3. the localStorage default style
 *   4. folkstyle
 * @param {{ eventStyle?: string, careerStyle?: string, storedDefault?: string }} [opts]
 * @returns {string}
 */
export function resolveStyle({ eventStyle, careerStyle, storedDefault } = {}) {
  return eventStyle || careerStyle || storedDefault || 'folkstyle';
}

function pickIndex(rng, len) {
  return Math.floor(rng() * len);
}

const PICK_TRIES = 60;

function commitName(full, first, last, ctx) {
  ctx.used.add(full);
  if (first) ctx.usedFirsts.add(first);
  if (last) ctx.usedLasts.add(last);
  return full;
}

/**
 * Pick a single name with the tiered fallback. Mutates ctx.used /
 * ctx.usedFirsts / ctx.usedLasts. Never throws.
 */
function pickOneName(ctx) {
  const { firsts, lasts, rng, used, reserved, usedFirsts, usedLasts, enforceUniqueFirstLast } = ctx;

  // Tier 0 - unique full name AND unique first AND unique last.
  if (enforceUniqueFirstLast) {
    for (let t = 0; t < PICK_TRIES; t++) {
      const first = firsts[pickIndex(rng, firsts.length)];
      const last = lasts[pickIndex(rng, lasts.length)];
      const full = `${first} ${last}`;
      if (used.has(full) || reserved.has(full)) continue;
      if (usedFirsts.has(first) || usedLasts.has(last)) continue;
      return commitName(full, first, last, ctx);
    }
    // Tier 0 completion - deterministic scan. Random draws miss valid
    // combos once the pool nears saturation (e.g. the last slots of a
    // 128-bracket); this guarantees a unique first+last whenever the
    // pools can still supply one, so first/last repeats only ever happen
    // when the pool is genuinely too small.
    for (let fi = 0; fi < firsts.length; fi++) {
      const first = firsts[fi];
      if (usedFirsts.has(first)) continue;
      for (let li = 0; li < lasts.length; li++) {
        const last = lasts[li];
        if (usedLasts.has(last)) continue;
        const full = `${first} ${last}`;
        if (used.has(full) || reserved.has(full)) continue;
        return commitName(full, first, last, ctx);
      }
    }
  }

  // Tier 1 - unique full name only (first/last repeats allowed).
  for (let t = 0; t < PICK_TRIES; t++) {
    const first = firsts[pickIndex(rng, firsts.length)];
    const last = lasts[pickIndex(rng, lasts.length)];
    const full = `${first} ${last}`;
    if (used.has(full) || reserved.has(full)) continue;
    return commitName(full, first, last, ctx);
  }

  // Tier 2 - deterministic exhaustive scan. Guaranteed to find a unique
  // full name if the firsts x lasts namespace is not fully consumed.
  for (let fi = 0; fi < firsts.length; fi++) {
    for (let li = 0; li < lasts.length; li++) {
      const first = firsts[fi];
      const last = lasts[li];
      const full = `${first} ${last}`;
      if (used.has(full) || reserved.has(full)) continue;
      return commitName(full, first, last, ctx);
    }
  }

  // Tier 3 - numbered fallback. Only reachable when the entire namespace
  // is exhausted (count exceeds firsts x lasts distinct combinations).
  let n = used.size + 1;
  let name = `Wrestler ${n}`;
  while (used.has(name) || reserved.has(name)) {
    n++;
    name = `Wrestler ${n}`;
  }
  return commitName(name, '', '', ctx);
}

/**
 * Generate `count` unique wrestler names for one event (tournament bracket,
 * dual-meet roster, ranking-pool scope). The single helper every name-
 * generation path in the game calls.
 *
 * Guarantees:
 *  - No duplicate full name within the batch, nor against `used`/`reserved`.
 *  - With `enforceUniqueFirstLast` (default true) each first AND last name
 *    appears at most once, falling back gracefully when the pool is too
 *    small: unique first/last -> unique full name -> numbered "Wrestler N".
 *
 * @param {object} [opts]
 * @param {number} [opts.count] - how many names to generate
 * @param {string} [opts.gender] - 'female' selects the women's pool; else men's
 * @param {() => number} [opts.rng] - 0..1 rng; defaults to Math.random
 * @param {Set<string>} [opts.used] - already-taken full names; mutated in place
 * @param {Set<string>} [opts.reserved] - names that must never be produced
 * @param {Set<string>} [opts.usedFirsts] - shared first-name tracker (optional)
 * @param {Set<string>} [opts.usedLasts] - shared last-name tracker (optional)
 * @param {boolean} [opts.enforceUniqueFirstLast] - bound first/last repeats
 * @returns {string[]}
 */
export function generateEventNames({
  count,
  gender = 'male',
  rng = Math.random,
  used = new Set(),
  reserved = new Set(),
  usedFirsts = new Set(),
  usedLasts = new Set(),
  enforceUniqueFirstLast = true,
} = {}) {
  const { firsts, lasts } = getNamePools(gender);
  // Seed the first/last trackers from pre-existing taken names (e.g. the
  // player's name) so generated names de-collide against them too. Skipped
  // when first/last uniqueness is off - large ranking pools never need it.
  // usedFirsts/usedLasts may be shared Sets passed in so first/last
  // de-collision spans multiple calls within one event (e.g. a dual meet's
  // two teams); seeding from `used` is idempotent and safe in that case.
  if (enforceUniqueFirstLast) {
    for (const full of used) {
      const sp = String(full).indexOf(' ');
      if (sp > 0) {
        usedFirsts.add(String(full).slice(0, sp));
        usedLasts.add(String(full).slice(sp + 1));
      }
    }
  }
  const ctx = { firsts, lasts, rng, used, reserved, usedFirsts, usedLasts, enforceUniqueFirstLast };
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const result = [];
  for (let i = 0; i < n; i++) result.push(pickOneName(ctx));
  return result;
}
