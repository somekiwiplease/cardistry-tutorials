// Turns a YouTube video into a trick: a clean name, an optional creator, and a family.
// Works from the title, plus the description and tags when the API provides them.

const TUTORIAL = /tutorial|how to|learn|bootcamp|basics|for beginners|explained|lesson/i;
const NOT_A_TRICK = /trailer|review|unboxing|giveaway|vlog|q ?& ?a|podcast|interview|deck (review|reveal)|kickstarter|livestream|top \d+|best of|compilation|reacts?|challenge/i;
// Talks, channel housekeeping and section headings that pass as tutorials but teach no single trick.
const NOT_A_MOVE = /creative process|^what (is|makes)|practice efficiently|make a video|^history of|^styles of|^modern of|live performances|^lessons from|^level with|get started|^teach your|^be recognized|^performance of|for creating|^w\/|\bintro\b|^(community|classic videos|closing video|very hard|one-card moves|aerials & drops|the fontaine files|origami phone stand|hk pack|combo 101|di\.versity)$/i;
const SEPARATOR = /\s*(?:\/\/|\s\/\s|\||│|•|●|:|\s[-–—]+\s*)\s*/;
const NOISE = [
  /[\[(][^\])]*[\])]/g, // anything in brackets
  /#\w+/g,
  /\b(official|free|easy|simple|quick|new|hd|4k|full|in depth|in-depth|step by step|slow ?motion|beginner'?s?|intermediate|advanced|for beginners|the classics|classics)\b/gi,
  /\b(cardistry|card flourish(es|ing)?|flourish(es|ing)?|bootcamp|basics|tutorials?|lesson|explained|tips?)\b/gi,
  /\b(how to( do| perform| learn)?( the| a| an)?|learn( the| a| an)?|one[- ]handed cuts?|two[- ]handed cuts?|card tricks?)\b/gi,
  /\b(part|ep|episode|vol|volume)\.? ?\d+\b/gi,
  /\b20\d\d\b/g,
];

export function trickFromTitle(title) {
  if (!TUTORIAL.test(title) || NOT_A_TRICK.test(title)) return null;
  const segments = title.split(SEPARATOR).map((raw) => {
    let s = raw;
    for (const n of NOISE) s = s.replace(n, ' ');
    s = s.replace(/["“”'‘’!?*]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,&.-]+|[\s,&.-]+$/g, '');
    return { raw, s };
  });
  const kept = segments.filter((x) => x.s && !/^(the|a|an|by|with|and|for|of|in|to|do)$/i.test(x.s));
  if (!kept.length) return null;
  // Prefer the piece that carried the word "tutorial": it is nearly always the trick itself.
  // A piece that is only a credit ("by Zach Mueller") or a label ("Bundle") is never the trick.
  const credit = /^(by|with|ft\.?|feat\.?)\s/i;
  const label = /^(bundle|demos?|overview|performance|intro(duction)?|finesse|nss|nothing special saturdays|premium|series|squids|di\.cardistry|patreon exclusive|ndo premium|the new deck order premium)$/i;
  const usable = kept.filter((x) => !credit.test(x.s) && !label.test(x.s));
  if (!usable.length) return null;
  let name = (usable.find((x) => /tutorial/i.test(x.raw)) ?? usable[0]).s;
  let creator = kept.find((x) => credit.test(x.s))?.s.replace(credit, '').trim() ?? null;
  name = name.replace(/\s+(ft\.?|feat\.?)\s+.*$/i, '');
  const by = name.match(/^(.*?)\s+by\s+(.+)$/i);
  if (by && by[1]) [name, creator] = [by[1].trim(), by[2].trim()];
  name = name.replace(/^to\s+/i, '').replace(/\s+in \d+ minutes?$/i, '').replace(/[\s│-]+$/, '');
  if (NOT_A_MOVE.test(name)) return null;
  if (name === name.toUpperCase() && name.length > 4) name = name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  if (name.length < 2 || name.length > 48 || name.split(' ').length > 6) return null;
  return { name, creator };
}

export const keyOf = (name) =>
  name.toLowerCase().replace(/&/g, 'and').replace(/\b(the|cut|flourish)\b/g, ' ').replace(/[^a-z0-9]+/g, '');

// First rule that matches wins. Title counts first; description and tags break ties.
const FAMILIES = [
  ['Basics', /\bgrips?\b|break(ing)? in|deck care|conditioning|getting started|what is cardistry|which deck|fanning powder/],
  ['Isolations', /\bisolations?\b|\biso\b/],
  ['Shuffles', /shuffle|\bfaro\b/],
  ['One-handed cuts', /one[- ]hand(ed)?|\boh\b|charlier|revolution cut|scissor cut|thumb cut|index cut/],
  ['Springs & cascades', /\bspring\b|dribble|cascade|waterfall|anaconda/],
  ['Fans & spreads', /\bfans?\b|fanning|\bspreads?\b|ribbon/],
  ['Aerials & shots', /aerial|\bshots?\b|\bthrow|\btoss|boomerang|\bcatch\b|deck flip|\bflip\b/],
  ['Twirls & single card', /twirl|\bspin\b|pirouette|single card|one[- ]card|1[- ]card|card spin/],
  ['Combos', /\bcombo/],
  ['Two-handed cuts', /two[- ]hand(ed)?|\b2h\b|\bcuts?\b|sybil|packet|display/],
];
export function familyOf({ title = '', tags = [] }) {
  const t = title.toLowerCase();
  for (const [name, re] of FAMILIES) if (re.test(t)) return name;
  // Tags are the uploader's own labels. Descriptions are mostly channel boilerplate, so they are not used.
  const rest = tags.join(' ').toLowerCase();
  for (const [name, re] of FAMILIES) if (re.test(rest)) return name;
  return 'Unsorted';
}
