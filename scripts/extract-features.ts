#!/usr/bin/env bun

import { Glob } from 'bun';

async function extractFeatures() {
  const glob = new Glob('src/**/*.{ts,tsx}');
  const files = glob.scan('.');

  const features = new Set<string>();

  for await (const file of files) {
    const content = await Bun.file(file).text();
    const matches = content.match(/feature\(['"]([^'"]+)['"]\)/ug);

    if (matches) {
      for (const match of matches) {
        const featureName = ((/feature\(['"]([^'"]+)['"]\)/u).exec(match))?.[1];
        if (featureName !== undefined) {
          features.add(featureName);
        }
      }
    }
  }

  return Array.from(features).sort();
}

const features = await extractFeatures();

// eslint-disable-next-line no-console
console.log('export const FEATURES =', JSON.stringify(features, null, 2));
