#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { CONFIG } from './config.mjs';
import { globFiles, sourcePath, repoPath, writeState, readState } from './lib.mjs';

const adapter = CONFIG.factsAdapter ? await import(pathToFileURL(repoPath(CONFIG.factsAdapter))) : null;
const facts = adapter ? await adapter.collectFacts({ globFiles, sourcePath }) : {};
if (!facts || typeof facts !== 'object' || Array.isArray(facts)) throw new Error('factsAdapter must return an object');
const previous = readState('facts.json');
const changed = JSON.stringify(previous?.facts) !== JSON.stringify(facts);
if (!process.argv.includes('--dry-run')) writeState('facts.json', { schema: 1, facts });
console.log(`사실 추출: ${Object.keys(facts).length}개 묶음 (${changed ? '변경됨' : '동일'})`);
