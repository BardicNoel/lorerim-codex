import { VercelRequest, VercelResponse } from '@vercel/node';
import Fuse from 'fuse.js';
import perks from '../data/perks.json';

const fuse = new Fuse(perks, {
  keys: ['name', 'description', 'tags'],
  threshold: 0.3,
});

export default function handler(req: VercelRequest, res: VercelResponse) {
  const query = req.query.q as string;
  if (!query) return res.status(400).json({ error: 'Missing query param: q' });

  const results = fuse.search(query).map(r => r.item);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(results);
}