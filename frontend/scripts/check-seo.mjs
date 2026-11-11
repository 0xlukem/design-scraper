// Read-only HTTP contract for the production landing, separate from local UI QA.
// Never execute page JavaScript, follow redirects, or call an API/provider.
import { pathToFileURL } from 'node:url'

export const canonical = 'https://design-scraper.pages.dev/'
export const paths = Object.freeze([
  '/', '/robots.txt', '/sitemap.xml', '/app/', '/demo/',
  '/__seo-smoke-missing-page__', '/images/design-scraper-social.jpg',
])
const maxBytes = 2 * 1024 * 1024
const hasNoindex = value => /\b(?:noindex|none)\b/i.test(value || '')

// This is a smoke check for our generated HTML, not a general HTML/XML parser.
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)]
    .map(([, name, , value]) => [name.toLowerCase(), value]))
}
function tags(html, name) {
  const content = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '')
  return [...content.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(match => attributes(match[0]))
}
function metadata(html, name) {
  return tags(html, 'meta').filter(tag => tag.name?.toLowerCase() === name || tag.property?.toLowerCase() === name)
    .map(tag => tag.content || '')
}

export function validateResponse(path, response) {
  const { status, contentType = '', robots = '', body = '' } = response
  const issues = []
  const require = (condition, message) => { if (!condition) issues.push(message) }
  const missing = path === '/__seo-smoke-missing-page__'
  require(status === (missing ? 404 : 200), `Expected HTTP ${missing ? 404 : 200}; received ${status}`)
  if (path === '/images/design-scraper-social.jpg') {
    require(/^image\/jpeg\b/i.test(contentType), 'Social image must be JPEG, not an HTML fallback')
    require(response.jpeg === true, 'Social image bytes must have a JPEG signature')
    return issues
  }
  if (path === '/robots.txt') {
    require(/^text\/plain\b/i.test(contentType), 'robots.txt must be plain text, not an HTML fallback')
    require(!/<(?:!doctype|html)\b/i.test(body), 'robots.txt contains HTML')
    require(/^User-agent:\s*\*\s*$/mi.test(body), 'Missing general crawler group')
    require(/^Allow:\s*\/\s*$/mi.test(body), 'Missing root crawl allowance')
    require(!/^Disallow:\s*\/\s*(?:#.*)?$/mi.test(body), 'A root disallow hides indexing directives')
    require(body.split(/\r?\n/).some(line => line.trim() === `Sitemap: ${canonical}sitemap.xml`), 'Missing production sitemap declaration')
    return issues
  }
  if (path === '/sitemap.xml') {
    require(/^(?:application|text)\/xml\b/i.test(contentType), 'sitemap.xml must be XML, not an HTML fallback')
    require(/<urlset\b[^>]*xmlns=["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["'][^>]*>[\s\S]*<\/urlset>\s*$/i.test(body), 'Missing sitemap urlset')
    const locations = [...body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(match => match[1])
    require(locations.length === 1 && locations[0] === canonical, 'Sitemap must contain only the production landing')
    return issues
  }
  require(/^text\/html\b/i.test(contentType), 'Expected an HTML document')
  const robotMeta = [...metadata(body, 'robots'), ...metadata(body, 'googlebot')]
  if (path === '/') {
    require(!hasNoindex(robots) && !robotMeta.some(hasNoindex), 'Landing is blocked by HTTP or HTML noindex')
    const links = tags(body, 'link').filter(tag => tag.rel?.toLowerCase() === 'canonical')
    require(links.length === 1 && links[0].href === canonical, 'Landing must have one production canonical')
    const og = metadata(body, 'og:url')
    require(og.length === 1 && og[0] === canonical, 'Open Graph URL must match the canonical')
    require(metadata(body, 'og:image')[0] === `${canonical}images/design-scraper-social.jpg`, 'Missing expected Open Graph image')
    require(metadata(body, 'twitter:image')[0] === `${canonical}images/design-scraper-social.jpg`, 'Missing expected Twitter image')
    const staticHtml = body.replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>/gi, '')
    const headings = [...staticHtml.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)]
    require(headings.length === 1 && headings[0][1].replace(/<[^>]+>/g, '').trim().length > 0, 'Landing needs one nonempty H1 in initial HTML')
    require(/<main\b/i.test(staticHtml) && /<details\b/i.test(staticHtml), 'Static landing content and FAQ are missing')
  } else {
    require(robotMeta.some(hasNoindex), 'Application/error document needs HTML noindex')
    if (!missing) require(hasNoindex(robots), 'Application needs HTTP noindex')
    require(tags(body, 'link').every(tag => tag.rel?.toLowerCase() !== 'canonical'), 'Application/error page must not claim the landing canonical')
  }
  return issues
}

export async function inspectSite(origin, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const base = new URL(origin)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback))) {
    throw new Error('Supply an HTTPS origin, or an HTTP loopback origin, without credentials, path, query or fragment.')
  }
  const results = []
  for (const path of paths) {
    try {
      const response = await fetchImpl(new URL(path, base), {
        method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      })
      const reader = response.body?.getReader()
      const chunks = []
      let size = 0
      try {
        while (reader) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > maxBytes) throw new Error('Response exceeds the 2 MiB smoke-check limit')
          chunks.push(Buffer.from(value))
        }
      } finally { if (reader) await reader.cancel() }
      const bytes = Buffer.concat(chunks)
      const observed = {
        status: response.status, contentType: response.headers.get('content-type') || '',
        robots: response.headers.get('x-robots-tag') || '', body: bytes.toString('utf8'),
        jpeg: bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
      }
      results.push({ path, status: observed.status, contentType: observed.contentType,
        robots: observed.robots, issues: validateResponse(path, observed) })
    } catch (error) {
      results.push({ path, unavailable: `Could not inspect from this environment: ${error.message}` })
    }
  }
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) {
    console.error('Usage: npm run check:seo -- https://design-scraper.pages.dev')
    process.exitCode = 2
  } else {
    try {
      const results = await inspectSite(process.argv[2])
      for (const result of results) {
        const state = result.unavailable ? 'UNAVAILABLE' : result.issues.length ? 'FAIL' : 'PASS'
        console.log(`${state} ${result.path}${result.status ? ` (HTTP ${result.status}; ${result.contentType}; X-Robots-Tag: ${result.robots || 'absent'})` : ''}`)
        for (const issue of result.unavailable ? [result.unavailable] : result.issues) console.log(`  ${issue}`)
      }
      console.log('Read-only HTTP checks. No JavaScript or API calls. This does not prove indexing, ranking, rendering or deployment identity.')
      process.exitCode = results.some(result => result.unavailable || result.issues.length) ? 1 : 0
    } catch (error) {
      console.error(error.message)
      process.exitCode = 2
    }
  }
}
