import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// No effects or external imports are allowed in production handlers. Follow every local
// dependency, including ones outside src, so an RPC helper cannot bypass this boundary.
test('indexer source and its dependencies have no RPC, network I/O or effects (empty allow-list)', () => {
  const root = new URL('../src/', import.meta.url);
  const visited = new Set<string>();
  const violations: string[] = [];
  const forbidden = new Set(['createEffect', 'createPublicClient', 'http', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'require', 'eval', 'Function']);
  function inspect(url: URL) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const source = ts.createSourceFile(url.pathname, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && forbidden.has(node.text)) violations.push(`${url.pathname}: ${node.text}`);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) violations.push(`${url.pathname}: dynamic import`);
      if (ts.isImportEqualsDeclaration(node)) violations.push(`${url.pathname}: require-style import`);
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text;
        if (spec.startsWith('.')) {
          const target = new URL(spec, url);
          if (!/\.[cm]?[jt]sx?$/.test(target.pathname)) target.pathname += '.ts';
          inspect(target);
        } else if (spec !== 'envio') violations.push(`${url.pathname}: external module ${spec}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const file of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    if (/\.[cm]?[jt]sx?$/.test(file)) inspect(new URL(file, root));
  }
  assert.deepEqual(violations, []);
});
