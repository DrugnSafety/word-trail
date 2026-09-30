import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildWorkbook, buildCardSVG } from '../public/lib/workbook.js';

const video = JSON.parse(await readFile(new URL('../public/data/videos/video-01.json', import.meta.url)));
const bank = JSON.parse(await readFile(new URL('../public/data/expressions.json', import.meta.url)));
const scene = video.scenes.find(value => value.targets.length);
const expressions = scene.targets.map(target => bank.find(value => value.id === target.expressionId));
const args = { title: 'Faceytalk · 첫 구간', video, scene, expressions };
const directory = new URL('../examples/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('faceytalk-first-scene.html', directory), buildWorkbook(args));
await writeFile(new URL('faceytalk-first-scene.svg', directory), buildCardSVG(args));
console.log(`Created standalone HTML and SVG with ${expressions.length} expressions.`);
