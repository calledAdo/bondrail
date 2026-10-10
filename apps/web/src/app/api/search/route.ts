// Docs search (Fumadocs, built from the page index).
import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

export const { GET } = createFromSource(source);
