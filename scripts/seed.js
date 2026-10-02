/**
 * Seed sample content so the site looks alive on first run.
 * Safe to run more than once: it skips posts whose slug already exists.
 *   npm run seed            add sample posts
 *   npm run seed -- --reset delete ALL posts first (asks no questions — dev only)
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../src/db.js';
import { config } from '../src/config.js';
import { ensureAdmin } from './ensure-admin.js';
import { docToText, readingMinutes, makeExcerpt, countImages } from '../src/lib/content.js';
import { inspectImage } from '../src/lib/image.js';

const here = dirname(fileURLToPath(import.meta.url));
const db = getDb();
ensureAdmin();

if (process.argv.includes('--reset')) {
  db.exec('DELETE FROM posts');
  console.log('Removed all posts.');
}

// Copy bundled sample images into the uploads folder and register them as media.
mkdirSync(config.uploadDir, { recursive: true });
const assetDir = join(here, 'seed-assets');
const img = {};
if (existsSync(assetDir)) {
  for (const file of readdirSync(assetDir)) {
    const target = `seed-${file}`;
    const dest = join(config.uploadDir, target);
    if (!existsSync(dest)) copyFileSync(join(assetDir, file), dest);
    if (!db.prepare('SELECT 1 FROM media WHERE filename = ?').get(target)) {
      const info = inspectImage(readFileSync(dest));
      db.prepare('INSERT INTO media (filename, original_name, mime, size, width, height) VALUES (?, ?, ?, ?, ?, ?)').run(
        target, file, info?.mime || 'image/jpeg', statSync(dest).size, info?.width ?? null, info?.height ?? null,
      );
    }
    img[file.replace(/\.\w+$/, '')] = `/uploads/${target}`;
  }
}

// --- Tiny builders for Tiptap JSON --------------------------------------
const t = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((m) => (typeof m === 'string' ? { type: m } : m)) } : {}) });
const p = (...c) => ({ type: 'paragraph', content: c.map((x) => (typeof x === 'string' ? t(x) : x)) });
const h = (level, text) => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const ul = (...items) => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) });
const ol = (...items) => ({ type: 'orderedList', content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) });
const quote = (text) => ({ type: 'blockquote', content: [p(text)] });
const pull = (text, cite) => ({ type: 'pullQuote', attrs: { cite }, content: [t(text)] });
const image = (src, alt, caption, layout = 'normal') => ({ type: 'image', attrs: { src, alt, caption, layout } });
const callout = (variant, ...c) => ({ type: 'callout', attrs: { variant }, content: c });
const hr = { type: 'horizontalRule' };
const link = (text, href) => t(text, { type: 'link', attrs: { href, target: '_blank' } });
const doc = (...c) => ({ type: 'doc', content: c });

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

const posts = [
  {
    slug: 'inwed-2026-how-our-chapters-celebrated',
    title: 'How our chapters celebrated International Women in Engineering Day',
    subtitle: 'Site visits, school talks and a lot of hard hats: a look back at INWED across the country.',
    category: 'Events',
    tags: ['INWED', 'Chapters', 'Community'],
    featured: true,
    cover: 'cover-1',
    cover_alt: 'Abstract purple blueprint lines forming a bridge truss',
    days: 3,
    content: doc(
      p('Every year on 23 June, engineers around the world pause to celebrate the women shaping the built world. For APWEN, it is one of the busiest days on the calendar, and this year our chapters outdid themselves.'),
      h(2, 'Opening the gates'),
      p('Several chapters partnered with firms to open construction sites, plants and control rooms to secondary school students. For many of the girls, it was the first time they had seen an engineer at work who looked like them.'),
      image(img['inline-1'], 'Illustration of four engineers in hard hats', 'Students on a guided site visit during INWED week.', 'wide'),
      p('The format was simple: a short safety briefing, a walk through the site, and an open question session with engineers at different stages of their careers.'),
      pull('The question I heard most was “can I really do this?” By the end of the day, they were asking “how do I start?”', 'A chapter volunteer'),
      h(2, 'What worked'),
      ul(
        'Small groups of eight to ten students per engineer kept conversations personal.',
        'Hands-on demos, from soil tests to circuit boards, beat slide decks every time.',
        'Inviting parents to the closing session turned curiosity into family conversations.',
      ),
      callout('tip', p(t('Planning an outreach day? ', 'bold'), 'Reach out to your chapter secretariat early. Site access and safety approvals take time.')),
      h(2, 'Looking ahead'),
      p('We will share a short toolkit for chapters and partners so next year’s events can reach even more schools. If your organisation would like to host students, ', link('get in touch', 'mailto:info@apwen.org.ng'), '.'),
    ),
  },
  {
    slug: 'five-questions-for-a-young-structural-engineer',
    title: 'Five questions for a young structural engineer',
    subtitle: 'On first projects, finding mentors and the calculation that still keeps her up at night.',
    category: 'Member stories',
    tags: ['Careers', 'Civil engineering', 'Mentorship'],
    cover: 'cover-2',
    cover_alt: 'Purple geometric shapes suggesting steel beams',
    days: 9,
    content: doc(
      p('Our member stories series introduces the people behind the profession. This month we spoke with a structural engineer three years into her career, working on mid-rise buildings in Lagos.'),
      h(2, 'What drew you to structural engineering?'),
      p('I liked that you could point at a building and say: that stands because someone did the maths properly. It felt like the most honest kind of engineering.'),
      h(2, 'What surprised you about your first project?'),
      p('How much of the job is communication. The design is maybe half of it. The rest is making sure the contractor, the architect and the client all understand what the drawings mean.'),
      quote('A good drawing is a conversation that keeps going when you leave the room.'),
      h(2, 'How did you find mentors?'),
      p('Through APWEN, honestly. I went to a chapter meeting expecting speeches and left with three phone numbers. Two of those people still review my thinking when I am stuck.'),
      h(2, 'What advice would you give a final-year student?'),
      ol('Learn one analysis tool properly instead of five badly.', 'Visit sites whenever you can.', 'Ask for feedback on your calculations, not just your results.'),
      h(2, 'What is next for you?'),
      p('Professional registration, then a master’s in earthquake engineering. Nigeria is not a high seismic zone, but resilience thinking makes every design better.'),
    ),
  },
  {
    slug: 'girls-in-stem-what-a-school-visit-really-looks-like',
    title: 'What a school STEM visit really looks like',
    subtitle: 'A behind-the-scenes guide for volunteers who want to inspire the next generation.',
    category: 'STEM outreach',
    tags: ['Girls in STEM', 'Volunteering', 'Schools'],
    cover: 'cover-3',
    cover_alt: 'Purple and gold circuit-like pattern',
    days: 16,
    content: doc(
      p('School visits are at the heart of APWEN’s mission to inspire girls into science, technology, engineering and mathematics. Here is what volunteers can expect, and how to make the hour count.'),
      h(2, 'Before the visit'),
      ul('Agree a time and class size with the school.', 'Prepare one activity students can touch.', 'Bring a photo of yourself at work. It makes the career real.'),
      image(img['inline-2'], 'Illustration of colourful circuit components', 'Simple kits make abstract ideas tangible.'),
      h(2, 'During the visit'),
      p('Start with a story, not a definition. Then hand over the activity and let the students lead. Leave at least fifteen minutes for questions; they are always better than the ones you prepared for.'),
      callout('info', p('Keep a sign-up sheet so interested students and teachers can join our mailing list for future programmes.')),
      h(2, 'After the visit'),
      p('Send the teacher a short thank-you note and share photos with your chapter, with the school’s permission. Every visit helps us tell a bigger story about women in engineering.'),
    ),
  },
  {
    slug: 'engineering-for-the-energy-transition',
    title: 'Engineering for the energy transition, close to home',
    subtitle: 'Why mini-grids, efficient buildings and local skills matter as much as megaprojects.',
    category: 'Engineering insight',
    tags: ['Energy', 'Sustainability'],
    cover: 'cover-4',
    cover_alt: 'Abstract purple waveform suggesting electricity',
    days: 24,
    content: doc(
      p('Conversations about the energy transition often focus on huge power plants and national grids. For many communities, the most meaningful change is much smaller and much closer to home.'),
      h(2, 'Small systems, big impact'),
      p('Solar mini-grids can power clinics, schools and small businesses where the national grid does not reach reliably. Designing them well takes the same rigour as any large project: load studies, protection, maintenance plans.'),
      h(2, 'Buildings are energy projects'),
      p('Shading, ventilation and efficient equipment can cut a building’s energy demand significantly before a single panel is installed. That is engineering judgement, not an afterthought.'),
      h(2, 'Skills are infrastructure'),
      p('Every system needs people who can install, run and repair it. Training technicians, and making sure women are among them, is part of building resilient energy systems.'),
      callout('success', p('Have experience in renewable energy you would like to share? We welcome contributions from members for this blog.')),
    ),
  },
  {
    slug: 'welcome-to-the-apwen-blog',
    title: 'Welcome to the APWEN blog',
    subtitle: 'A new home for stories from our members, chapters and programmes.',
    category: 'News',
    tags: ['Announcements'],
    cover: 'cover-5',
    cover_alt: 'Purple gradient with soft geometric shapes',
    days: 30,
    content: doc(
      p('This blog is where we will share news from the association, stories from members across the country, and insight from women working in every field of engineering.'),
      p('Expect event recaps, career advice, technical explainers and updates on our STEM programmes for girls.'),
      hr,
      p('Follow us on ', link('Instagram', 'https://www.instagram.com/apwen_national/'), ' and ', link('Facebook', 'https://www.facebook.com/apwennational/'), ' for day-to-day updates.'),
    ),
  },
];

const insert = db.prepare(`INSERT INTO posts
  (slug, title, subtitle, excerpt, content, plain_text, cover_image, cover_alt, category, tags, status, featured,
   author_name, reading_minutes, published_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?)`);

let added = 0;
for (const post of posts) {
  if (db.prepare('SELECT 1 FROM posts WHERE slug = ?').get(post.slug)) continue;
  // drop images whose asset is missing
  post.content.content = post.content.content.filter((n) => n.type !== 'image' || n.attrs.src);
  const text = docToText(post.content);
  const when = daysAgo(post.days);
  insert.run(
    post.slug, post.title, post.subtitle, makeExcerpt(text), JSON.stringify(post.content), text,
    img[post.cover] ?? null, post.cover_alt, post.category, JSON.stringify(post.tags), post.featured ? 1 : 0,
    'APWEN Editorial', readingMinutes(text, countImages(post.content)), when, when, when,
  );
  added++;
}
console.log(`Seeded ${added} sample post${added === 1 ? '' : 's'}.`);
