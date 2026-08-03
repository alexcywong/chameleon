/**
 * Clue Roast Generator — Generates witty, cheeky commentary on each player's clue.
 *
 * Roasts are context-aware: they consider the topic, secret word, and how "obvious"
 * or "vague" the clue is. The tone is playful trash-talk, not mean-spirited.
 */

// ── Template Categories ──────────────────────────────────

const TOO_OBVIOUS_ROASTS = [
  "Might as well have just said the secret word, {name}. Real subtle. 🙄",
  "{name} went with \"{clue}\"… bold strategy of not even TRYING to hide it.",
  "Wow {name}, \"{clue}\"? Just point at the answer next time, it'd be less obvious.",
  "Hey {name}, we said \"clue\" not \"spoiler\". \"{clue}\" basically gives it away!",
  "Subtlety level: zero. {name} really said \"{clue}\" with their whole chest.",
  "{name}'s clue \"{clue}\" is about as subtle as a foghorn at a library.",
  "\"{clue}\"? {name}, were you trying to WIN or just flex your vocabulary?",
  "{name} chose \"{clue}\" — not suspicious at all, nope, nothing to see here… 👀",
];

const TOO_VAGUE_ROASTS = [
  "\"{clue}\"? That could mean ANYTHING, {name}. Are you even playing the same game?",
  "{name} said \"{clue}\"… helpful as a chocolate teapot. ☕",
  "Thanks for nothing, {name}. \"{clue}\" tells us absolutely zilch.",
  "{name} went with \"{clue}\" — either genius-level misdirection or they're lost.",
  "\"{clue}\"… {name}, did you just pick a random word from the dictionary?",
  "{name} out here playing 4D chess with \"{clue}\" while we're playing Kiwi.",
  "Is \"{clue}\" even a real clue, {name}? Or did your cat walk on the keyboard?",
  "{name}'s strategy: say something so vague nobody can accuse you. \"{clue}\" — classic.",
];

const KIWI_SUSPICIOUS_ROASTS = [
  "\"{clue}\"? That's EXACTLY what a Kiwi would say, {name}. 🥝",
  "{name} sweated out \"{clue}\" — a clue that works for literally any word on the board.",
  "Hmm, {name}… \"{clue}\" is giving strong Kiwi energy right now.",
  "{name} said \"{clue}\" like they read the word grid upside down. Sus. 🤔",
  "\"{clue}\"? {name} is either the Kiwi or just terrible at this game.",
  "I've seen better bluffs in kindergarten, {name}. \"{clue}\"? Really?",
  "{name} dropped \"{clue}\" with the confidence of someone who didn't see the word.",
  "\"{clue}\" — {name} definitely picked the first word that popped into their head.",
];

const GENERIC_ROASTS = [
  "{name} chose \"{clue}\" — bold, confusing, and slightly unhinged. Love it.",
  "\"{clue}\"? {name}, you had one job and you chose… that. Interesting.",
  "{name} really woke up and said \"{clue}\" with zero hesitation. Respect? Fear? Both.",
  "Ah yes, \"{clue}\" by {name}. Shakespeare couldn't have done worse.",
  "{name}'s clue \"{clue}\" has the same energy as a participation trophy.",
  "Out of ALL the words, {name} went with \"{clue}\". A choice was made.",
  "\"{clue}\" — {name} either knows something we don't, or knows nothing at all.",
  "{name} submitted \"{clue}\" and honestly? The audacity is impressive.",
  "\"{clue}\", says {name}, as if that explains ANYTHING.",
  "{name} hit us with \"{clue}\" — the clue equivalent of a shrug emoji. 🤷",
  "The vibes from {name}'s clue \"{clue}\" are… chaotic. Very chaotic.",
  "{name} really said \"{clue}\" and thought we wouldn't notice the panic.",
];

const COPYCAT_ROASTS = [
  "\"{clue}\"? Funny, that's suspiciously similar to what someone else said, {name}…",
  "{name} going with \"{clue}\" — originality left the chat apparently.",
  "Did {name} copy someone's homework? \"{clue}\" feels very familiar…",
];

// ── Generator ────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isClueObvious(clue: string, secretWord: string): boolean {
  const c = clue.toLowerCase().trim();
  const w = secretWord.toLowerCase().trim();
  // Check if clue contains the word, or the word contains the clue, or they share a root
  if (c.includes(w) || w.includes(c)) return true;
  // Check if clue is a substring of the word or vice versa (3+ chars)
  if (c.length >= 3 && w.includes(c)) return true;
  if (w.length >= 3 && c.includes(w)) return true;
  return false;
}

function isClueVague(clue: string): boolean {
  const vaguishWords = ['thing', 'stuff', 'good', 'bad', 'nice', 'cool', 'yes', 'no', 'ok', 'hmm', 'idk', 'maybe', 'same', 'this', 'that', 'it', 'one', 'a', 'the'];
  return vaguishWords.includes(clue.toLowerCase().trim()) || clue.trim().length <= 2;
}

function isDuplicate(clue: string, allClues: string[]): boolean {
  const c = clue.toLowerCase().trim();
  return allClues.filter(x => x.toLowerCase().trim() === c).length > 1;
}

/**
 * Generate a roast for a player's clue.
 */
export function generateClueRoast(
  playerName: string,
  clue: string,
  secretWord: string,
  allClues: string[]
): string {
  let pool: string[];

  if (isClueObvious(clue, secretWord)) {
    pool = TOO_OBVIOUS_ROASTS;
  } else if (isClueVague(clue)) {
    pool = TOO_VAGUE_ROASTS;
  } else if (isDuplicate(clue, allClues)) {
    pool = COPYCAT_ROASTS;
  } else if (Math.random() < 0.3) {
    pool = KIWI_SUSPICIOUS_ROASTS;
  } else {
    pool = GENERIC_ROASTS;
  }

  const template = pickRandom(pool);
  return template
    .replace(/\{name\}/g, playerName)
    .replace(/\{clue\}/g, clue)
    .replace(/\{word\}/g, secretWord);
}
