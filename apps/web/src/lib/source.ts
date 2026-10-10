// The docs page tree, built by Fumadocs from content/docs.
import { loader } from 'fumadocs-core/source';
import { docs } from '@source/server';

export const source = loader({ baseUrl: '/docs', source: docs.toFumadocsSource() });
