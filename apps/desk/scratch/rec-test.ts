import { openDb } from '../src/db';
import { recordTick } from '../src/recorder';
import { GeminiPublicClient } from '@contour/gemini';
const db = openDb(process.cwd() + '/../../data/test-rec.sqlite');
const r = await recordTick(db, new GeminiPublicClient());
console.log(r);
console.log(db.prepare('select ticker, category, expiry from ladders order by expiry').all());
