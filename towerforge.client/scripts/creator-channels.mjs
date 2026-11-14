// ============================================================
//  TowerForge — Creator channels for the live check
//  Writes TowerForge.Server/creator-channels.json: each creator's
//  YouTube @handle and Twitch login, from src/constants/creatorCodes.ts,
//  for the server's "who's live" check (LiveStreams/LiveStreamService.cs).
//  Run it after adding or changing a YouTube or Twitch link:
//      npm run creator-channels
//  (creatorCodes.test.ts fails until you do.)
// ============================================================

import { writeFile } from 'node:fs/promises';
import { CREATORS, creatorChannels } from '../src/constants/creatorCodes.ts';

const OUT = new URL('../../TowerForge.Server/creator-channels.json', import.meta.url);
const channels = creatorChannels(CREATORS);
const file = {
    about: 'Written by "npm run creator-channels" from towerforge.client/src/constants/creatorCodes.ts; don\'t edit by hand.',
    creators: channels,
};
await writeFile(OUT, JSON.stringify(file, null, 2) + '\n');
console.log(`Wrote ${channels.length} creators to TowerForge.Server/creator-channels.json`);
