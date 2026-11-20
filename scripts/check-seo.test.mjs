import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { canonical, paths, inspectSite, validateResponse } from '../frontend/scripts/check-seo.mjs'

const root = await readFile(new URL('../frontend/index.html', import.meta.url), 'utf8')
const app = await readFile(new URL('../frontend/app/index.html', import.meta.url), 'utf8')
const demo = await readFile(new URL('../frontend/demo/index.html', import.meta.url), 'utf8')
const notFound = await readFile(new URL('../frontend/public/404.html', import.meta.url), 'utf8')
const robots = await readFile(new URL('../frontend/public/robots.txt', import.meta.url), 'utf8')
const sitemap = await readFile(new URL('../frontend/public/sitemap.xml', import.meta.url), 'utf8')
const social = await readFile(new URL('../frontend/public/images/design-scraper-social.jpg', import.meta.url))
const headerRules = await readFile(new URL('../frontend/public/_headers', import.meta.url), 'utf8')
const noindex = 'noindex, nofollow, noarchive'
const html = body => ({ status: 200, contentType: 'text/html; charset=utf-8', body })

test('current source has the intended static SEO contract', () => {
  assert.deepEqual(validateResponse('/', html(root)), [])
  assert.deepEqual(validateResponse('/app/', { ...html(app), robots: noindex }), [])
  assert.deepEqual(validateResponse('/demo/', { ...html(demo), robots: noindex }), [])
  assert.deepEqual(validateResponse('/__seo-smoke-missing-page__', { ...html(notFound), status: 404 }), [])
  assert.deepEqual(validateResponse('/robots.txt', { status: 200, contentType: 'text/plain', body: robots }), [])
  assert.deepEqual(validateResponse('/sitemap.xml', { status: 200, contentType: 'application/xml', body: sitemap }), [])
})

test('detects the observed old SPA deployment at every static route', () => {
  const stale = { ...html('<html><head><title>Design, decoded.</title></head><body><div id="root"></div></body></html>'), robots: noindex }
  for (const path of paths) assert.ok(validateResponse(path, stale).length > 0, path)
  assert.ok(validateResponse('/', stale).some(issue => issue.includes('noindex')))
  assert.ok(validateResponse('/__seo-smoke-missing-page__', stale).some(issue => issue.includes('404')))
})

test('HTTP and HTML indexing directives independently block the landing', () => {
  for (const directive of ['noindex', 'googlebot: noindex', 'none']) {
    assert.ok(validateResponse('/', { ...html(root), robots: directive }).some(issue => issue.includes('blocked')))
    assert.ok(validateResponse('/', html(root.replace('</head>', `<meta name="robots" content="${directive}"></head>`))).some(issue => issue.includes('blocked')))
  }
})

test('rejects duplicate/wrong canonicals and metadata but does not prescribe title copy', () => {
  assert.deepEqual(validateResponse('/', html(root.replace(/<title>.*?<\/title>/s, '<title>Different approved title</title>'))), [])
  assert.ok(validateResponse('/', html(root.replace('</head>', `<link rel="canonical" href="${canonical}"></head>`))).some(issue => issue.includes('canonical')))
  assert.ok(validateResponse('/', html(root.replaceAll(canonical, 'https://wrong.example/'))).some(issue => issue.includes('canonical')))
  assert.ok(validateResponse('/', html(root.replace(/<h1\b[\s\S]*?<\/h1>/, '<h1> </h1>'))).some(issue => issue.includes('H1')))
})

test('rejects HTML fallback, root crawl block and extra sitemap application URL', () => {
  assert.ok(validateResponse('/robots.txt', { ...html(root), contentType: 'text/plain' }).some(issue => issue.includes('HTML')))
  assert.ok(validateResponse('/robots.txt', { status: 200, contentType: 'text/plain', body: `${robots}\nDisallow: /` }).some(issue => issue.includes('disallow')))
  assert.ok(validateResponse('/sitemap.xml', { status: 200, contentType: 'application/xml', body: sitemap.replace('</urlset>', `<url><loc>${canonical}app/</loc></url></urlset>`) }).some(issue => issue.includes('only')))
  assert.ok(validateResponse('/sitemap.xml', { status: 200, contentType: 'application/xml', body: sitemap.replace('</urlset>', '') }).some(issue => issue.includes('urlset')))
})

test('app noindex and real error status are required, not a fallback 200', () => {
  assert.ok(validateResponse('/app/', html(app)).some(issue => issue.includes('HTTP noindex')))
  assert.ok(validateResponse('/app/', { ...html(root), robots: noindex }).some(issue => issue.includes('HTML noindex')))
  assert.ok(validateResponse('/__seo-smoke-missing-page__', html(notFound)).some(issue => issue.includes('404')))
})

test('real HTTP integration reads only the fixed static routes without redirects', async () => {
  const requests = []
  const fixtures = new Map([
    ['/', html(root)], ['/app/', { ...html(app), robots: noindex }],
    ['/demo/', { ...html(demo), robots: noindex }],
    ['/robots.txt', { status: 200, contentType: 'text/plain', body: robots }],
    ['/sitemap.xml', { status: 200, contentType: 'application/xml', body: sitemap }],
    ['/__seo-smoke-missing-page__', { ...html(notFound), status: 404 }],
    ['/images/design-scraper-social.jpg', { status: 200, contentType: 'image/jpeg', body: social }],
  ])
  const server = createServer((req, res) => {
    requests.push([req.method, req.url])
    const fixture = fixtures.get(req.url)
    if (!fixture) { res.writeHead(500).end(); return }
    res.writeHead(fixture.status, { 'content-type': fixture.contentType,
      ...(fixture.robots ? { 'x-robots-tag': fixture.robots } : {}) }).end(fixture.body)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const results = await inspectSite(`http://127.0.0.1:${server.address().port}`)
    assert.ok(results.every(result => !result.unavailable && result.issues.length === 0), JSON.stringify(results))
    assert.deepEqual(requests, paths.map(path => ['GET', path]))
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('fetch failures are unavailable evidence, not a claimed outage', async () => {
  const results = await inspectSite(canonical, { fetchImpl: async () => { throw new Error('Access denied by network policy') } })
  assert.equal(results.length, paths.length)
  assert.ok(results.every(result => result.unavailable?.includes('from this environment') && !result.issues))
})

test('redirects are not followed; unsafe targets are rejected before a request', async () => {
  let calls = 0
  const fetchImpl = async (url, options) => {
    calls++
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'manual')
    assert.ok(paths.includes(url.pathname))
    return new Response('', { status: 302, headers: { location: 'https://example.com/api/analyze' } })
  }
  const results = await inspectSite(canonical, { fetchImpl })
  assert.equal(calls, paths.length)
  assert.ok(results.every(result => result.status === 302 && result.issues.length > 0))
  for (const target of ['http://example.com', 'https://u:p@example.com', `${canonical}app/`, `${canonical}?token=not-real`, `${canonical}#fragment`]) {
    await assert.rejects(inspectSite(target, { fetchImpl }), /Supply an HTTPS origin/)
  }
  assert.equal(calls, paths.length)
})

test('large responses stop at the byte ceiling and do not pass', async () => {
  const results = await inspectSite(canonical, { fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) })
  assert.ok(results.every(result => result.unavailable?.includes('2 MiB')))
})

test('application header rules remain present in checked-in configuration', () => {
  for (const path of ['/app', '/app/*', '/demo', '/demo/*']) {
    assert.ok(headerRules.includes(`${path}\n  X-Robots-Tag: ${noindex}`), path)
  }
})
